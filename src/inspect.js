import { chromium } from "playwright";
import path from "node:path";
import { readJson, writeJson, ensureArtifactsDir, applicationDir } from "./io.js";
import { pageSnapshot, tryOpenApplication, extractForm } from "./browser_helpers.js";
import { detectRemoteBrowserRequirement, detectAccountRequirement } from "./classify.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node src/inspect.js queue/inspect/<application>.json");
  process.exit(2);
}

const request = readJson(inputPath);
for (const key of ["application_id", "job_url"]) {
  if (!request[key]) throw new Error(`Missing required request key: ${key}`);
}

const appDir = applicationDir(request.application_id);
const artifactDir = ensureArtifactsDir(request.application_id);
const resultPath = path.join(appDir, "inspection.json");

let browser;
let result = {
  application_id: request.application_id,
  command_id: request.command_id || null,
  company: request.company || null,
  role: request.role || null,
  requested_url: request.job_url,
  inspected_at: new Date().toISOString(),
  status: "UNKNOWN"
};

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
  });
  let page = await context.newPage();
  await page.goto(request.job_url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);

  let snap = await pageSnapshot(page);
  let remoteReason = detectRemoteBrowserRequirement(snap);
  if (remoteReason) {
    result = { ...result, status: "REMOTE_BROWSER_REQUIRED", reason: remoteReason, final_url: snap.url, page_title: snap.title };
  } else {
    const opened = await tryOpenApplication(page);
    if (opened.page) page = opened.page;
    snap = await pageSnapshot(page);
    remoteReason = detectRemoteBrowserRequirement(snap);
    const accountReason = detectAccountRequirement(snap);

    if (remoteReason) {
      result = { ...result, status: "REMOTE_BROWSER_REQUIRED", reason: remoteReason, final_url: snap.url, page_title: snap.title };
    } else if (accountReason) {
      result = { ...result, status: "REMOTE_BROWSER_REQUIRED", reason: `ACCOUNT_OR_VERIFICATION_REQUIRED:${accountReason}`, final_url: snap.url, page_title: snap.title };
    } else {
      const form = await extractForm(page);
      const usableFields = form.controls.filter((f) => f.type !== "hidden" && f.type !== "password");
      result = {
        ...result,
        status: usableFields.length ? "READY_FOR_REVIEW" : "NO_APPLICATION_FORM_FOUND",
        final_url: snap.url,
        page_title: snap.title,
        body_excerpt: snap.body.slice(0, 4000),
        fields: usableFields,
        buttons: form.buttons,
        safe_navigation: form.navigationButtons,
        final_submit_candidates: form.submitButtons,
        stats: {
          fields: usableFields.length,
          required_fields: usableFields.filter((f) => f.required).length,
          sensitive_fields: usableFields.filter((f) => f.sensitive).length,
          file_fields: usableFields.filter((f) => f.type === "file").length
        }
      };
    }
  }

  await page.screenshot({ path: path.join(artifactDir, "inspection.png"), fullPage: true }).catch(() => null);
  await context.close();
} catch (error) {
  result = { ...result, status: "INSPECTION_ERROR", error: String(error?.stack || error) };
} finally {
  if (browser) await browser.close().catch(() => null);
  writeJson(resultPath, result);
  console.log(JSON.stringify({ status: result.status, result_path: resultPath, application_id: request.application_id }));
  if (["INSPECTION_ERROR"].includes(result.status)) process.exitCode = 1;
}
