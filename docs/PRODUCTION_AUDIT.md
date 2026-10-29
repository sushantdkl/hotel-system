# Production readiness audit (baseline)

Generated before cPanel / PostgreSQL migration work. Findings are from static review of this repository.

## Locked decisions

- Restaurant POS only (legacy multi-shop / distribution stack removed from production)
- Fresh PostgreSQL database with secure seed (no SQLite sales import)
- cPanel Setup Node.js App, Node.js 22, SSH available, dedicated domain/subdomain

## Blockers (must fix before go-live)

| ID | Finding | Severity |
|----|---------|----------|
| B1 | Many `/api/admin/*` and upload routes lack server-side auth | Critical |
| B2 | Dual DB stacks: Stack A (SQLite/Postgres) vs legacy `shop-db` / `admin-db` | Critical |
| B3 | SQLite-only SQL (`PRAGMA`, `sqlite_master`, `char(10)`, `julianday`, `AUTOINCREMENT`) | Critical |
| B4 | Seed/auth mismatch (`pin`+SHA-256 vs `password_hash`+bcrypt) | Critical |
| B5 | Payment not atomic; bills.order_id not unique | Critical |
| B6 | `server.js` hardcodes port 3000 and opens a browser | Critical |
| B7 | Unauthenticated menu upload | Critical |
| B8 | Public `/api/users/active` enumerates staff | High |
| B9 | Kitchen N+1 polling every 5s | High |
| B10 | No health check, error pages, or backup runbook | High |

## Public vs authenticated surfaces

**Public (keep):** `/api/public/menu`, `/api/public/reservations`, `/api/public/inquiries`, marketing `sundar.html`

**Must authenticate:** all `/api/admin/*` (except none for shop login — remove), `/api/restaurant/*`, `/api/uploads/*`, `/api/auth/*` (except login), `/api/users/*`

**Legacy (quarantine / remove):** `/api/orders`, `/api/products`, `/api/customers`, `/api/transactions`, `/api/held-bills`, `/api/credit-payments`, `/api/ingredients`, `/api/menu-items`, `/api/shop/*`, `/api/admin/shops`, `/api/admin/login`

## Environment inventory

| Variable | Required in production | Notes |
|----------|------------------------|-------|
| `NODE_ENV` | yes | `production` |
| `APP_URL` | yes | Public origin, e.g. `https://pos.example.com` |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `PGSSL` | optional | `true` only for remote TLS |
| `PG_POOL_MAX` | recommended | `5` on shared cPanel |
| `SESSION_SECRET` | yes | Cookie signing / CSRF |
| `CSRF_SECRET` | yes | Mutation CSRF |
| `UPLOADS_DIR` | yes | Persistent writable path |
| `IMAGES_PATH` | yes | Public prefix, default `/uploads` |
| `LOG_LEVEL` | optional | `info` / `warn` / `error` |
| `ADMIN_USERNAME` | seed only | First admin |
| `ADMIN_PASSWORD` | seed only | First admin (min 8 chars) |
| `DB_NAME` | no | SQLite only — do not use in production |
| `RESTAURANT_NAME` | optional | Display / seed |

## Dependency notes

- Keep: `next`, `react`, `pg`, `bcryptjs`, `lucide-react`, Tailwind stack, `@zxing/browser` (scanner)
- Production: do **not** require `better-sqlite3` when `DATABASE_URL` is set (lazy/optional)
- Prune candidates: unused Radix packages, `pkg`, desktop packaging scripts
- Engines: Node.js `>=20.9.0` (target **22** on cPanel)

## Next steps in this migration

1. Quarantine legacy routes; require Postgres in production
2. Migrations + secure seed
3. Auth guards on all non-public APIs
4. Atomic payments + unique paid bill
5. Upload hardening, performance, cPanel entrypoint, docs
