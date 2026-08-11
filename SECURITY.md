# Security rules

- Keep this repository private after initial setup.
- Never commit GitHub tokens, passwords, SSNs, DOB, demographic data, MFA codes, or identity-verification answers.
- Store the GitHub fine-grained token only as the Apps Script `GITHUB_TOKEN` Script Property.
- Restrict that token to this repository only and grant only `Contents: Read and write`.
- Inspection is read-only.
- Final submission requires an exact per-application `CONFIRM` approval tied to the current inspection hash.
- CAPTCHA, MFA, account verification, and anti-bot barriers must stop as `REMOTE_BROWSER_REQUIRED`.
