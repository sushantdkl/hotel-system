# Security Guide

## Security model

The application uses server-side sessions, credential hashing, route-level authorization, origin/CSRF protection, rate limiting, parameterized SQL, and controlled media storage. Security controls must be enforced on the server; hidden UI controls are not authorization.

## Production baseline

- Serve only through HTTPS.
- Set `FORCE_SECURE_COOKIES=1`.
- Generate independent, high-entropy `SESSION_SECRET` and `CSRF_SECRET` values.
- Keep `.env`, SQL deployment files, logs, backups, and uploads outside `public_html` where possible.
- Give the application database user access only to its own database.
- Change the seeded administrator credential immediately after first login.
- Restrict cPanel, database, and backup access with unique credentials and MFA where available.

## Authentication and sessions

- Credentials/PINs are hashed and compared using the shared auth service.
- Login is rate-limited; generic errors should not reveal whether a username exists.
- Sessions are stored server-side with expiration and can be revoked on logout.
- Cookies must be `HttpOnly`, `Secure` in production, and use an appropriate `SameSite` policy.
- Privileged routes verify the current user and allowed role on every request.

## Request protection

- Validate all bodies, query values, path IDs, and enum/status transitions.
- Mutating cookie-authenticated requests must pass origin/CSRF checks.
- Use parameterized SQL; never interpolate untrusted values into a query.
- Do not trust client prices, totals, account IDs, role values, or stock effects.
- Rate-limit login, public ordering, inquiries, and other abuse-prone endpoints.

## Uploads and media

- Allow-list MIME types/extensions and enforce size limits.
- Generate server filenames; strip path components from user filenames.
- Resolve and verify that every destination remains under `UPLOADS_DIR`.
- Do not execute uploaded files or serve them with an executable content type.
- Back up uploads and scan suspicious content before publication when possible.

## Data and logging

- Never log passwords/PINs, session tokens, cookies, secret environment values, full payment credentials, or raw database URLs.
- Avoid collecting customer data not required for service.
- Limit who can export reports or view customer/employee/financial records.
- Encrypt backup transport/storage and test deletion/retention procedures.

## Dependency and release hygiene

- Commit and deploy from `package-lock.json` with Node 22.
- Review dependency advisories and framework security releases before launch.
- Run lint, build, E2E tests, and targeted authorization checks for every release.
- Do not expose source maps, verbose errors, or development mode in production.

## Incident response

1. Preserve logs and note the detection time and affected accounts/actions.
2. Contain access: revoke sessions, rotate application/database credentials, and disable the vulnerable route if required.
3. Assess data and financial integrity, including order, payment, stock, and journal changes.
4. Restore or correct through audited operations; do not erase evidence.
5. Patch, test, redeploy, monitor, and document preventive actions.

Report suspected vulnerabilities privately to the project owner; do not place exploitable details or real secrets in a public issue.
