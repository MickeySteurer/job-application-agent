# Job Application Agent

Free-first cloud job application automation using GitHub Actions + Playwright.

## Runtime flow

1. ChatGPT sends a structured `[JOBAPP] INSPECT` or `[JOBAPP] SUBMIT` email through the user's connected Gmail.
2. A private Google Apps Script bridge reads the command email and writes only the required queue/bundle files to this repository through the GitHub Contents API.
3. GitHub Actions runs Chromium with Playwright on GitHub-hosted infrastructure. The user's computer can be off.
4. Inspection or submission results are committed under `applications/<application_id>/`.
5. Apps Script sees the matching `command_id` and emails the result back to Gmail.

## Safety

- Inspection never submits.
- Final submission requires an approval JSON containing `approved=true`, `approval_phrase="CONFIRM"`, `final_submit=true`, and a SHA-256 hash matching the latest inspection.
- Sensitive or unknown required fields stop the run.
- CAPTCHA, MFA, account verification, and anti-bot barriers return `REMOTE_BROWSER_REQUIRED`.
- Do not store passwords, SSNs, DOB, demographic data, API tokens, or identity-verification answers in this repository.

## Setup

Use the companion `SETUP_UNDER_30_MIN.md` from the setup package. After the initial browser upload, this repository should be **Private**.
