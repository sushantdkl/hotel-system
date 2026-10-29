# Technical Requirements Document

## Architecture

The system is a Next.js 16 App Router application running on React 19. Pages and API route handlers share one deployment. `server.js` starts the production Next server and honors the host-provided `PORT` and `HOSTNAME`.

```text
Browser
  -> Next.js pages/components
  -> app/api route handlers
  -> domain services in lib/
  -> repositories and SQL adapter in lib/db/
  -> PostgreSQL (production) or SQLite (local fallback)
```

## Runtime requirements

- Node.js `>=22 <23`
- npm with the committed `package-lock.json`
- PostgreSQL 14+ for production
- Writable persistent upload directory configured by `UPLOADS_DIR`
- HTTPS and secure cookies in production

## Code organization

| Path | Responsibility |
|---|---|
| `app/(public)` | Public restaurant pages |
| `app/admin` | Protected counter and management pages |
| `app/api` | HTTP API route handlers |
| `components` | Shared and feature UI components |
| `lib` | Domain rules, validation, auth, accounting, and data access |
| `lib/db` | Database selection, SQL helpers, and repositories |
| `migrations` | Ordered incremental schema changes |
| `deploy` | Fresh-production schema, seed, and install instructions |
| `scripts` | Migration, seed, import, verification, and health utilities |
| `tests/e2e` | Playwright browser acceptance tests |

## Key engineering requirements

- Route handlers validate untrusted input and use parameterized database queries.
- Protected operations use the shared authentication/authorization helpers.
- Monetary calculations use the shared billing/accounting functions; UI code must not become the source of truth.
- Multi-write business operations run in database transactions.
- Accounting posts balanced journal lines and uses external references/idempotency where supported.
- Order and stock transitions are explicit and reject invalid repeat transitions.
- Public endpoints use rate limiting where abuse is plausible.
- Logs must be useful operationally without exposing secrets, PINs, tokens, or sensitive request bodies.

## Data and migration strategy

Fresh production installs load `deploy/production_schema.sql` followed by `deploy/production_seed.sql`. Existing installations apply ordered files through `npm run db:migrate`. Every schema change must include an idempotent migration and, before release, a refreshed production schema when the deployment process requires it.

## Configuration

Required production variables are `NODE_ENV`, `APP_URL`, `DATABASE_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `FORCE_SECURE_COOKIES`, `HOSTNAME`, and `UPLOADS_DIR`. Pool, SSL, rate-limit, and logging variables are described in `.env.example`. Secrets must be injected by the hosting environment or an untracked `.env` file.

## Quality gates

Run these from the repository root:

```bash
npm run lint
npm run build
npm run test:e2e
npm run health
```

Database verification scripts (`check-accounting`, `check-entry-math`, inventory/unit checks) should also pass against the release database or a production-like copy.

## Operational requirements

- Nightly PostgreSQL dump and upload-folder backup, retained for 7–30 days.
- A documented restore test before launch and after meaningful schema changes.
- Health monitoring of `/api/health`, application errors, storage, and database connectivity.
- Rollback deploy must not roll back the database blindly; use forward corrective migrations when data has already been written.
