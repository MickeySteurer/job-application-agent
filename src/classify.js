export function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const sensitivePatterns = [
  /social security|\bssn\b/,
  /date of birth|birth date|\bdob\b/,
  /race|ethnicity|ethnic origin/,
  /gender|sex assigned|sexual orientation|gender identity/,
  /disability|medical condition|health information/,
  /veteran|military status/,
  /criminal history|conviction|arrest record/,
  /religion|religious/,
  /marital status/,
  /national origin/
];

export function isSensitiveField(field) {
  const text = normalize([
    field?.label,
    field?.name,
    field?.id,
    field?.placeholder,
    field?.autocomplete
  ].filter(Boolean).join(" "));
  return sensitivePatterns.some((p) => p.test(text));
}

const remoteRequiredPatterns = [
  /captcha/,
  /verify you are human/,
  /are you human/,
  /unusual traffic/,
  /access denied/,
  /bot detection/,
  /security challenge/,
  /cloudflare/,
  /checking your browser/,
  /enable cookies to continue/,
  /verification code/,
  /one time passcode/,
  /one time password/,
  /multi factor authentication/,
  /two factor authentication/
];

export function detectRemoteBrowserRequirement({ title = "", body = "" } = {}) {
  const text = normalize(`${title} ${body}`);
  const matched = remoteRequiredPatterns.find((p) => p.test(text));
  return matched ? matched.source : null;
}

const loginPatterns = [
  /sign in to continue/,
  /log in to continue/,
  /create an account/,
  /create account to apply/,
  /candidate login/,
  /enter your password/
];

export function detectAccountRequirement({ title = "", body = "" } = {}) {
  const text = normalize(`${title} ${body}`);
  const matched = loginPatterns.find((p) => p.test(text));
  return matched ? matched.source : null;
}

export function isSafeNavigationButton(text = "") {
  const t = normalize(text);
  return ["next", "continue", "review", "save and continue", "review application"].includes(t);
}

export function isFinalSubmitButton(text = "") {
  const t = normalize(text);
  return ["submit", "submit application", "send application", "finish application"].includes(t);
}

export function inferProfileKey(field) {
  const text = normalize([field?.label, field?.name, field?.id, field?.placeholder, field?.autocomplete].filter(Boolean).join(" "));
  const rules = [
    ["first_name", /first name|given name/],
    ["last_name", /last name|family name|surname/],
    ["full_name", /full name|legal name/],
    ["email", /email/],
    ["phone", /phone|mobile|telephone/],
    ["linkedin", /linkedin/],
    ["portfolio", /portfolio|personal website|website url|website/],
    ["city", /\bcity\b/],
    ["state", /state|province|region/],
    ["postal_code", /zip|postal code/],
    ["country", /country/],
    ["school", /school|university|college/],
    ["degree", /degree/],
    ["major", /major|field of study/],
    ["graduation_date", /graduation|degree date|completion date/],
    ["gpa", /\bgpa\b|grade point/]
  ];
  for (const [key, pattern] of rules) {
    if (pattern.test(text)) return key;
  }
  return null;
}
