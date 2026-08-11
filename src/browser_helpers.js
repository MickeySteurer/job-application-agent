import { normalize, isSensitiveField, isSafeNavigationButton, isFinalSubmitButton } from "./classify.js";

export async function pageSnapshot(page) {
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return { title, body: body.slice(0, 30000), url: page.url() };
}

export async function tryOpenApplication(page) {
  // Only attempt this when the current page does not already look like an application form.
  const initialCount = await page.locator("input, select, textarea").count().catch(() => 0);
  if (initialCount >= 2) return { attempted: false, opened: false };

  const applyCandidates = [
    page.getByRole("link", { name: /^apply( now)?$/i }),
    page.getByRole("button", { name: /^apply( now)?$/i }),
    page.getByText(/^apply for this job$/i, { exact: true })
  ];

  for (const locator of applyCandidates) {
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const target = locator.first();
    if (!(await target.isVisible().catch(() => false))) continue;

    const popupPromise = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await target.click({ timeout: 10000 }).catch(() => null);
    const popup = await popupPromise;
    const active = popup || page;
    await active.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
    await active.waitForTimeout(1500);
    return { attempted: true, opened: true, page: active };
  }
  return { attempted: true, opened: false };
}

export async function extractForm(page) {
  const raw = await page.evaluate(() => {
    const norm = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const optionLabelFor = (el) => {
      if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.innerText).join(" ").trim();
      return el.getAttribute("aria-label") || el.value || "";
    };
    const groupLabelFor = (el) => {
      const fieldset = el.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.innerText?.trim();
      if (legend) return legend;
      const group = el.closest('[role="radiogroup"], [role="group"]');
      if (group) {
        const aria = group.getAttribute("aria-label");
        if (aria) return aria.trim();
        const labelledBy = group.getAttribute("aria-labelledby");
        if (labelledBy) {
          const txt = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
          if (txt) return txt;
        }
        const candidate = group.querySelector("legend, .question, [data-automation-id*='label'], .label");
        if (candidate?.innerText) return candidate.innerText.trim();
      }
      const container = el.closest('[data-automation-id*="formField"], .form-field, .field, .application-question');
      if (container) {
        const candidate = container.querySelector("legend, .question, [data-automation-id*='label'], .label");
        if (candidate?.innerText) return candidate.innerText.trim();
      }
      return "";
    };
    const labelFor = (el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "radio") {
        const group = groupLabelFor(el);
        if (group) return group;
      }
      if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.innerText).join(" ").trim();
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const txt = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ").trim();
        if (txt) return txt;
      }
      const parentLabel = el.closest("label");
      if (parentLabel) return parentLabel.innerText.trim();
      const group = groupLabelFor(el);
      if (group) return group;
      return el.getAttribute("placeholder") || el.getAttribute("name") || el.id || "";
    };

    const rawControls = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(el => visible(el))
      .filter(el => (el.getAttribute("type") || "").toLowerCase() !== "hidden")
      .map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || tag).toLowerCase();
        const label = labelFor(el);
        const base = label || el.getAttribute("name") || el.id || `field ${index + 1}`;
        const key = `${type}|${norm(base)}`;
        const options = tag === "select"
          ? Array.from(el.options).map(o => ({ value: o.value, text: o.textContent?.trim() || "", selected: o.selected }))
          : [];
        return {
          index,
          key,
          tag,
          type,
          id: el.id || "",
          name: el.getAttribute("name") || "",
          label,
          option_label: type === "radio" ? optionLabelFor(el) : "",
          placeholder: el.getAttribute("placeholder") || "",
          autocomplete: el.getAttribute("autocomplete") || "",
          required: !!el.required || el.getAttribute("aria-required") === "true",
          disabled: !!el.disabled,
          checked: !!el.checked,
          value: type === "password" ? "[REDACTED]" : (el.value || ""),
          options
        };
      });

    // Aggregate radio controls into one logical question so Yes/No does not become two fields.
    const controls = [];
    const radioGroups = new Map();
    for (const field of rawControls) {
      if (field.type !== "radio") {
        controls.push(field);
        continue;
      }
      const groupId = field.name || field.key;
      if (!radioGroups.has(groupId)) {
        radioGroups.set(groupId, {
          ...field,
          id: "",
          key: `radio|${norm(field.label || field.name || "radio question")}`,
          value: "",
          checked: false,
          options: []
        });
      }
      const group = radioGroups.get(groupId);
      group.required = group.required || field.required;
      group.disabled = group.disabled && field.disabled;
      group.options.push({
        id: field.id,
        value: field.value,
        text: field.option_label || field.value,
        checked: field.checked,
        disabled: field.disabled
      });
      if (field.checked) {
        group.checked = true;
        group.value = field.value;
      }
    }
    controls.push(...radioGroups.values());

    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], a"))
      .filter(el => visible(el))
      .map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute("value") || el.getAttribute("aria-label") || "").trim(),
        type: el.getAttribute("type") || "",
        href: el.getAttribute("href") || "",
        disabled: !!el.disabled
      }))
      .filter(b => b.text);

    return { controls, buttons };
  });

  const controls = raw.controls.map((f) => ({
    ...f,
    sensitive: isSensitiveField(f),
    value: isSensitiveField(f) && f.value ? "[REDACTED]" : f.value
  }));

  const navigationButtons = raw.buttons.filter((b) => isSafeNavigationButton(b.text));
  const submitButtons = raw.buttons.filter((b) => isFinalSubmitButton(b.text));
  return { controls, buttons: raw.buttons, navigationButtons, submitButtons };
}

export async function clickSafeNavigation(page, buttons) {
  const allowed = buttons.filter((b) => !b.disabled && isSafeNavigationButton(b.text));
  if (allowed.length !== 1) return { clicked: false, reason: allowed.length ? "AMBIGUOUS_NAVIGATION" : "NO_SAFE_NAVIGATION" };
  const text = allowed[0].text;
  const candidates = [
    page.getByRole("button", { name: text, exact: true }),
    page.getByRole("link", { name: text, exact: true }),
    page.locator(`input[type='button'][value=${JSON.stringify(text)}], input[type='submit'][value=${JSON.stringify(text)}]`)
  ];
  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    if (!n) continue;
    await c.first().click({ timeout: 10000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1000);
    return { clicked: true, text };
  }
  return { clicked: false, reason: "NAVIGATION_CONTROL_NOT_FOUND" };
}

export async function clickFinalSubmit(page, buttons) {
  const allowed = buttons.filter((b) => !b.disabled && isFinalSubmitButton(b.text));
  if (allowed.length !== 1) return { clicked: false, reason: allowed.length ? "AMBIGUOUS_SUBMIT" : "NO_SUBMIT_BUTTON" };
  const text = allowed[0].text;
  const candidates = [
    page.getByRole("button", { name: text, exact: true }),
    page.locator(`input[type='submit'][value=${JSON.stringify(text)}]`)
  ];
  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    if (!n) continue;
    await c.first().click({ timeout: 10000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);
    return { clicked: true, text };
  }
  return { clicked: false, reason: "SUBMIT_CONTROL_NOT_FOUND" };
}

export async function fillField(page, field, value) {
  if (field.sensitive) return { filled: false, reason: "SENSITIVE_FIELD" };
  if (field.disabled) return { filled: false, reason: "DISABLED" };

  let locator = null;
  if (field.id) locator = page.locator(`[id=${JSON.stringify(field.id)}]`).first();
  else if (field.name) locator = page.locator(`[name=${JSON.stringify(field.name)}]`).first();
  else if (field.label) locator = page.getByLabel(field.label, { exact: true }).first();
  if (!locator || !(await locator.count().catch(() => 0))) return { filled: false, reason: "LOCATOR_NOT_FOUND" };

  const t = field.type;
  if (t === "file") return { filled: false, reason: "FILE_FIELD" };
  if (["checkbox", "radio"].includes(t)) {
    const desired = String(value).toLowerCase();
    if (t === "checkbox") {
      const truthy = ["true", "yes", "1", "checked"].includes(desired);
      if (truthy) await locator.check({ force: false });
      else await locator.uncheck({ force: false });
      return { filled: true };
    }
    // Radio: locate the option by group name/value/adjacent label rather than blindly checking first match.
    const groupName = field.name;
    if (!groupName) return { filled: false, reason: "RADIO_GROUP_WITHOUT_NAME" };
    const radios = page.locator(`input[type='radio'][name=${JSON.stringify(groupName)}]`);
    const count = await radios.count();
    for (let i = 0; i < count; i++) {
      const r = radios.nth(i);
      const rv = normalize(await r.getAttribute("value") || "");
      const rid = await r.getAttribute("id");
      let rl = "";
      if (rid) rl = normalize(await page.locator(`label[for=${JSON.stringify(rid)}]`).innerText().catch(() => ""));
      if (normalize(value) === rv || normalize(value) === rl) {
        await r.check();
        return { filled: true };
      }
    }
    return { filled: false, reason: "RADIO_OPTION_NOT_FOUND" };
  }
  if (field.tag === "select") {
    const opts = field.options || [];
    const desired = normalize(value);
    const match = opts.find((o) => normalize(o.text) === desired || normalize(o.value) === desired)
      || opts.find((o) => normalize(o.text).includes(desired));
    if (!match) return { filled: false, reason: "SELECT_OPTION_NOT_FOUND" };
    await locator.selectOption(match.value);
    return { filled: true };
  }
  await locator.fill(String(value));
  return { filled: true };
}

export async function uploadFile(page, field, repoPath) {
  if (field.type !== "file") return { uploaded: false, reason: "NOT_FILE_FIELD" };
  let locator = null;
  if (field.id) locator = page.locator(`[id=${JSON.stringify(field.id)}]`).first();
  else if (field.name) locator = page.locator(`[name=${JSON.stringify(field.name)}]`).first();
  else if (field.label) locator = page.getByLabel(field.label, { exact: true }).first();
  if (!locator || !(await locator.count().catch(() => 0))) return { uploaded: false, reason: "LOCATOR_NOT_FOUND" };
  await locator.setInputFiles(repoPath);
  return { uploaded: true };
}
