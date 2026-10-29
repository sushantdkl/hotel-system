# Deployment Guide

This guide summarizes the supported setup. The detailed cPanel procedure in [`deploy/INSTALL.md`](../deploy/INSTALL.md) remains the operational source of truth.

## Local development

```bash
npm install
copy .env.example .env
npm run dev
```

Development runs on `http://localhost:3002`. Configure a development database before exercising authenticated/data features. SQLite fallback is suitable for local work; use PostgreSQL for production-like testing.

## Pre-deployment verification

```bash
npm run lint
npm run build
npm run test:e2e
```

Also review pending migrations, verify `.env.example`, and back up the target PostgreSQL database and persistent uploads.

## Fresh cPanel/PostgreSQL install

1. Provision Node.js 22 and PostgreSQL 14+.
2. Create a dedicated database/user and grant access only to that database.
3. Load `deploy/production_schema.sql`, then `deploy/production_seed.sql`.
4. Run `npm run db:migrate`. This is mandatory even on a fresh install: the
   packaged snapshot is only a baseline and the migration directory is the
   source of truth for newer features.
5. Upload the app outside `public_html`, excluding `.git`, `.env`, `node_modules`, `.next`, local databases, test artifacts, and non-persistent uploads.
6. Set cPanel application root to the project directory and startup file to `server.js`.
7. Configure production environment variables from `.env.example`; do not set `PORT` because cPanel injects it.
8. Run npm install and `npm run build`, then start/restart the application.
9. Run `npm run health`, open the public site, and sign in.
10. Immediately change the seeded administrator password and complete business/tax/receipt settings.

## Existing deployment

1. Announce a maintenance window if the schema or checkout changes.
2. Take timestamped database and upload backups.
3. Upload/install the new release and dependencies.
4. Run `npm run db:migrate` for incremental database updates.
5. Run `npm run build` and restart the Node application.
6. Run the health check and smoke-test login, menu, sale/payment, receipt, and reports.
7. Monitor logs and database/storage health after release.

## Required environment

At minimum: `NODE_ENV=production`, `APP_URL`, `DATABASE_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `FORCE_SECURE_COOKIES=1`, `HOSTNAME=0.0.0.0`, and a persistent `UPLOADS_DIR`. Configure `PGSSL` for the actual provider; local cPanel PostgreSQL commonly uses `false`.

## Backups

Schedule nightly `pg_dump` backups and archive `UPLOADS_DIR`. Retain 7–30 days and periodically restore into an isolated database to verify recoverability. A backup that has never been restored is unverified.

## Rollback

- Keep the previous application release available.
- If no incompatible data/schema changes occurred, point the app back and restart.
- If a migration has run and new data exists, prefer a forward corrective release/migration. Do not restore an old database over new orders without explicit business approval.
- Re-run health and smoke tests after rollback.
