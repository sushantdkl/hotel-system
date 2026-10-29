# Final production audit report

**Date:** 2026-07-21  
**Scope:** Restaurant POS only — legacy multi-shop/SQLite distribution stack removed from runtime.  
**Deploy target:** cPanel Node.js 22 + PostgreSQL (fresh DB + secure seed).

Companion docs:

- [CPANEL_DEPLOYMENT.md](./CPANEL_DEPLOYMENT.md)
- [PRODUCTION_VERIFICATION.md](./PRODUCTION_VERIFICATION.md)
- [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md) (baseline blockers)

## Fixed findings

| Area | Before | After |
|------|--------|-------|
| Database | Dual SQLite + optional Postgres; PRAGMA / sqlite_master SQL | Production requires `DATABASE_URL`; migrations `001_init.sql`; dialect adapters |
| Legacy APIs | Multi-shop / distribution routes live | Return **410** (`goneLegacy`) |
| Auth gaps | Many admin/upload routes open | `requireAuth` on admin, uploads, categories |
| Sessions | Bearer only; noisy login logs | HttpOnly cookies + CSRF cookie; generic login errors; rate limits |
| Payments | Multi-step non-atomic; race possible | Single transaction + row lock + unique paid bill index |
| Uploads | MIME trust only; path leaks | Magic bytes, size, path containment; media API no dir disclosure |
| Kitchen load | N+1 detail poll every 5s | `/api/restaurant/orders?board=kitchen` + 8s poll + visibility pause |
| Dashboard | Per-day query loop | Single `GROUP BY DATE(created_at)` |
| Ops | No health / error boundaries | `/api/health`, `error.js`, `global-error.js`, `not-found.js`, `loading.js` |
| Hosting | Desktop `server.js` port 3000 + browser open | cPanel `PORT`/`HOSTNAME`, quiet start, graceful shutdown |
| Seed | PIN/SHA mismatches | bcrypt `password_hash`, `must_change_password`, env-driven admin |

## Remaining risks / follow-ups

1. **Client still stores bearer token in localStorage** — cookies are set; migrate SPA fully to cookie+CSRF headers for XSS resistance.
2. **Forced password-change UI** — API returns `must_change_password`; ensure UI blocks POS until changed.
3. **CSP allows `'unsafe-inline'` / `'unsafe-eval'`** — required for Next bootstrap; tighten when nonces are feasible.
4. **SQLite optionalDependency** — local/dev only; production must not rely on it.
5. **Horizontal scale** — single Node process + Postgres pool max 5 is correct for cPanel; multi-instance needs sticky sessions or shared session store (already DB-backed sessions — OK).
6. **Integration test suite** — concurrent double-payment / rollback cases should be automated in CI when a Postgres service is available.

## Required environment variables

See `.env.example`. Critical: `NODE_ENV`, `APP_URL`, `DATABASE_URL`, `UPLOADS_DIR`, `SESSION_SECRET`, `FORCE_SECURE_COOKIES`.

## Deployment commands (summary)

```bash
npm ci
npm run db:migrate
ADMIN_PASSWORD='…' npm run db:seed
npm run build
# cPanel restart → startup: server.js
curl -sS "$APP_URL/api/health"
```

## Architecture (production)

```text
Browser → HTTPS domain
       → Next.js (server.js / Node 22)
       → PostgreSQL (pg pool)
       → UPLOADS_DIR (persistent files via /api/media)
```

Public surfaces: marketing site, `/api/public/menu`, `/api/public/reservations`, `/api/public/inquiries`, `/api/health`, media GET.

All other `/api/admin/*`, `/api/restaurant/*`, `/api/uploads/*` require authenticated staff with role checks.
