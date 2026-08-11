import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, sha256File, ensureArtifactsDir, applicationDir } from "./io.js";
import { pageSnapshot, tryOpenApplication, extractForm, fillField, uploadFile, clickSafeNavigation, clickFinalSubmit } from "./browser_helpers.js";
import { detectRemoteBrowserRequirement, detectAccountRequirement, inferProfileKey, normalize } from "./classify.js";

const approvalPath = process.argv[2];
if (!approvalPath) {
  console.error("Usage: node src/submit.js approvals/<application>.json");
  process.exit(2);
}

const approval = readJson(approvalPath);
const applicationId = approval.application_id;
if (!applicationId) throw new Error("approval.application_id is required");
if (approval.approved !== true || approval.approval_phrase !== "CONFIRM" || approval.final_submit !== true) {
  throw new Error("Submission blocked: approval must contain approved=true, approval_phrase=CONFIRM, final_submit=true");
}

const appDir = applicationDir(applicationId);
const inspectionPath = path.join(appDir, "inspection.json");
const bundlePath = path.join(appDir, "bundle.json");
if (!fs.existsSync(inspectionPath)) throw new Error(`Missing ${inspectionPath}`);
if (!fs.existsSync(bundlePath)) throw new Error(`Missing ${bundlePath}`);
const actualInspectionHash = sha256File(inspectionPath);
if (!approval.inspection_sha256 || approval.inspection_sha256 !== actualInspectionHash) {
  throw new Error("Submission blocked: approval inspection hash does not match the current inspection.json");
}

const inspection = readJson(inspectionPath);
const bundle = readJson(bundlePath);
const profile = readJson(bundle.profile_path || "profile/professional.json");
const artifactDir = ensureArtifactsDir(applicationId);
const resultPath = path.join(appDir, "submission.json");

let browser;
let result = {
  application_id: applicationId,
  command_id: approval.command_id || null,
  company: inspection.company || bundle.company || null,
  role: inspection.role || bundle.role || null,
  attempted_at: new Date().toISOString(),
  status: "UNKNOWN"
};

function answerFor(field) {
  if (Object.prototype.hasOwnProperty.call(bundle.answers || {}, field.key)) return bundle.answers[field.key];
  const pkey = inferProfileKey(field);
  if (pkey && Object.prototype.hasOwnProperty.call(profile, pkey)) return profile[pkey];
  return undefined;
}

function fileFor(field) {
  if (Object.prototype.hasOwnProperty.call(bundle.files || {}, field.key)) return bundle.files[field.key];
  const l = normalize(field.label);
  if (/resume|cv/.test(l) && bundle.default_files?.resume) return bundle.default_files.resume;
  if (/cover letter/.test(l) && bundle.default_files?.cover_letter) return bundle.default_files.cover_letter;
  if (/transcript/.test(l) && bundle.default_files?.transcript) return bundle.default_files.transcript;
  if (/writing sample/.test(l) && bundle.default_files?.writing_sample) return bundle.default_files.writing_sample;
  return undefined;
}

async function hasValue(page, field) {
  let locator = null;
  if (field.id) locator = page.locator(`[id=${JSON.stringify(field.id)}]`).first();
  else if (field.name) locator = page.locator(`[name=${JSON.stringify(field.name)}]`).first();
  else if (field.label) locator = page.getByLabel(field.label, { exact: true }).first();
  if (!locator || !(await locator.count().catch(() => 0))) return false;
  if (field.type === "radio") {
    if (!field.name) return false;
    return (await page.locator(`input[type='radio'][name=${JSON.stringify(field.name)}]:checked`).count().catch(() => 0)) > 0;
  }
  if (field.type === "checkbox") return await locator.isChecked().catch(() => false);
  if (field.type === "file") return (await locator.evaluate((el) => el.files?.length || 0).catch(() => 0)) > 0;
  return !!String(await locator.inputValue().catch(() => "")).trim();
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
  });
  let page = await context.newPage();
  const targetUrl = bundle.job_url || inspection.final_url || inspection.requested_url;
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);

  let snap = await pageSnapshot(page);
  if (detectRemoteBrowserRequirement(snap) || detectAccountRequirement(snap)) {
    result = { ...result, status: "REMOTE_BROWSER_REQUIRED", reason: detectRemoteBrowserRequirement(snap) || detectAccountRequirement(snap), final_url: snap.url };
  } else {
    const opened = await tryOpenApplication(page);
    if (opened.page) page = opened.page;

    let progressed = false;
    let finalState = null;
    const pageLog = [];

    for (let step = 0; step < 10; step++) {
      snap = await pageSnapshot(page);
      const remoteReason = detectRemoteBrowserRequirement(snap);
      const accountReason = detectAccountRequirement(snap);
      if (remoteReason || accountReason) {
        finalState = { status: "REMOTE_BROWSER_REQUIRED", reason: remoteReason || accountReason, final_url: snap.url };
        break;
      }

      const form = await extractForm(page);
      const actions = [];

      for (const field of form.controls) {
        if (field.type === "password" || field.sensitive) continue;
        if (field.type === "file") {
          const filePath = fileFor(field);
          if (filePath) {
            if (!fs.existsSync(filePath)) {
              finalState = { status: "MISSING_APPLICATION_FILE", field: field.key, file_path: filePath };
              break;
            }
            const r = await uploadFile(page, field, filePath).catch((e) => ({ uploaded: false, reason: String(e) }));
            actions.push({ field: field.key, action: "upload", result: r });
            if (r.uploaded) progressed = true;
          }
          continue;
        }
        const answer = answerFor(field);
        if (answer !== undefined && answer !== null && answer !== "") {
          const r = await fillField(page, field, answer).catch((e) => ({ filled: false, reason: String(e) }));
          actions.push({ field: field.key, action: "fill", result: r });
          if (r.filled) progressed = true;
        }
      }
      if (finalState) break;

      const missing = [];
      for (const field of form.controls.filter((f) => f.required && !f.disabled)) {
        if (field.sensitive) {
          missing.push({ key: field.key, label: field.label, reason: "SENSITIVE_REQUIRED_FIELD" });
          continue;
        }
        if (!(await hasValue(page, field))) {
          missing.push({ key: field.key, label: field.label, reason: "REQUIRED_FIELD_UNRESOLVED" });
        }
      }

      pageLog.push({ step, url: page.url(), actions, missing, submit_candidates: form.submitButtons.map((b) => b.text), navigation: form.navigationButtons.map((b) => b.text) });
      await page.screenshot({ path: path.join(artifactDir, `submit-step-${step}.png`), fullPage: true }).catch(() => null);

      if (missing.length) {
        finalState = { status: "NEEDS_USER_INPUT", missing_fields: missing, final_url: page.url() };
        break;
      }

      if (form.submitButtons.length) {
        if (!progressed) {
          finalState = { status: "SUBMISSION_BLOCKED", reason: "No application fields were filled or files uploaded in this run", final_url: page.url() };
          break;
        }
        const submit = await clickFinalSubmit(page, form.submitButtons);
        if (!submit.clicked) {
          finalState = { status: "SUBMISSION_BLOCKED", reason: submit.reason, final_url: page.url() };
          break;
        }
        const after = await pageSnapshot(page);
        const confirmText = normalize(after.body);
        const confirmed = /thank you|application submitted|application has been submitted|application received|we received your application|successfully submitted/.test(confirmText);
        finalState = {
          status: confirmed ? "SUBMITTED" : "SUBMISSION_UNCONFIRMED",
          clicked_button: submit.text,
          final_url: after.url,
          page_title: after.title,
          confirmation_excerpt: after.body.slice(0, 2000)
        };
        await page.screenshot({ path: path.join(artifactDir, "confirmation.png"), fullPage: true }).catch(() => null);
        break;
      }

      const nav = await clickSafeNavigation(page, form.navigationButtons);
      if (!nav.clicked) {
        finalState = { status: "UNSUPPORTED_APPLICATION_FLOW", reason: nav.reason, final_url: page.url() };
        break;
      }
      progressed = true;
    }

    result = { ...result, ...(finalState || { status: "UNSUPPORTED_APPLICATION_FLOW", reason: "Step limit reached" }), page_log: pageLog };
  }

  await context.close();
} catch (error) {
  result = { ...result, status: "SUBMISSION_ERROR", error: String(error?.stack || error) };
} finally {
  if (browser) await browser.close().catch(() => null);
  writeJson(resultPath, result);
  console.log(JSON.stringify({ status: result.status, result_path: resultPath, application_id: applicationId }));
  if (["SUBMISSION_ERROR"].includes(result.status)) process.exitCode = 1;
}
