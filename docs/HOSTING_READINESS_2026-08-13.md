# Hosting readiness audit — 13 August 2026

## Verdict

The application builds and its functional unit tests pass, but do not publish
it as fully verified until the launch blockers below are cleared on a staging
PostgreSQL database.

Verified in this checkout:

- `npm run build`: passed; Next.js generated 181 routes.
- `npm run test:unit`: passed; 79/79 tests.
- Local `/api/health`: healthy with SQLite.
- PostgreSQL migration runner is ordered, transactional, and repeatable.
- Production requires PostgreSQL when `NODE_ENV=production`.
- Sessions are database-backed; production cookies are secure and CSRF checked.

Not yet a passing gate:

- `npm audit --omit=dev --audit-level=high`: four high-severity production
  dependency groups (`next`, `postcss`, `sharp`, `nanoid`). The suggested full
  repair moves Next.js from 16.0.7 to 16.3.0, so it requires a deliberate
  framework upgrade and regression pass rather than an unreviewed force-fix.
- `npm run lint`: 31 errors and 36 warnings in older React/CMS/reservation,
  cashier, admin and shared UI files.
- Browser E2E was not executed because the Playwright Chromium executable was
  unavailable. The reported cases were browser launch failures, not failed app
  assertions.
- Production PostgreSQL was not present in the local `.env`, so migrations,
  grants, data counts and backup/restore still require staging verification.

## Launch blockers

- [ ] Upgrade the vulnerable production dependencies, then rerun audit, build,
  unit, lint and browser tests. Do not use `npm audit fix --force` directly on
  the live release.
- [ ] Make `npm run lint` pass.
- [ ] Migrate staging PostgreSQL through `043_delivery_pricing`.
- [ ] Install Playwright Chromium and pass `npm run test:e2e` on staging.
- [ ] Rehearse a complete shift: opening cash, two parties on one table, KOT and
  additional KOT, cancellation, delivery, payment, receipt and day close.
- [ ] Verify uploads survive a release/restart.
- [ ] Complete a PostgreSQL plus uploads backup/restore drill.

## Database procedure

### Fresh restaurant database

1. Create a dedicated PostgreSQL database and non-superuser application user.
2. Keep database sessions in UTC:

   ```sql
   ALTER ROLE your_app_user SET timezone TO 'UTC';
   ```

3. Set the real `DATABASE_URL` and the provider's correct `PGSSL` policy.
4. Choose one initialization path:

   - Generic empty setup: `npm run db:migrate`, then `npm run db:seed` with a
     strong one-time `ADMIN_PASSWORD`.
   - Kathmandu master-data setup: load `deploy/production_schema.sql`, load
     `deploy/production_seed.sql`, then **still run** `npm run db:migrate`.

5. Verify migration state:

   ```sql
   SELECT version, applied_at
   FROM schema_migrations
   ORDER BY version;

   SELECT version
   FROM schema_migrations
   ORDER BY version DESC
   LIMIT 1;
   ```

   For this release, the last row must be `043_delivery_pricing`. This prevents
   errors such as `column k.void_reason does not exist`.

6. Verify critical schema added during this work:

   ```sql
   SELECT table_name, column_name
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (
       (table_name = 'kots' AND column_name IN
         ('void_reason','cancel_reason','cancelled_at')) OR
       (table_name = 'orders' AND column_name IN
         ('prep_started_at','ready_at','delivery_fee','delivery_distance_km')) OR
       (table_name = 'bills' AND column_name = 'delivery_fee')
     )
   ORDER BY table_name, column_name;

   SELECT to_regclass('public.role_permissions'),
          to_regclass('public.waiter_requests'),
          to_regclass('public.salary_advances');
   ```

7. If migrations used another owner, grant the app user CRUD on all tables and
   usage on all sequences. Adapt `migrations/grant_app_user.sql`; it contains an
   old hard-coded username and must not be run unchanged.
8. Seed only a new database. `db:seed` upserts the administrator and marks it to
   change password, so do not casually rerun it on a live database.
9. Change the first admin password immediately.

### Existing database deployment

1. Pause order entry for the maintenance window.
2. Back up PostgreSQL and persistent uploads.
3. Deploy code and install locked dependencies with `npm ci`.
4. Run `npm run db:migrate` before restarting.
5. Run `npm run build`, restart, then run `npm run health`.
6. Verify the migration version and smoke-test login, KOT, payment, receipt and
   reports before reopening ordering.

Never manually edit production tables to hide a schema error. Add or run an
ordered migration so staging, production and the next restaurant stay aligned.

## Hosting configuration

Use Node.js 22 and `server.js`. Required production values include:

- `NODE_ENV=production`
- `APP_URL` and `NEXT_PUBLIC_SITE_URL` with the final HTTPS domain
- `DATABASE_URL`
- `PGSSL` and, where appropriate, `PGSSL_REJECT_UNAUTHORIZED=true`
- unique long `SESSION_SECRET` and `CSRF_SECRET`
- `FORCE_SECURE_COOKIES=1`
- `HOSTNAME=0.0.0.0`
- persistent `UPLOADS_DIR` and `IMAGES_PATH=/uploads`
- `RESTAURANT_MODE` and `POS_ENABLED_ROLES`

Do not copy the local `.env`; it has no production URL or PostgreSQL connection.
Create the production environment from `.env.example` and the host secret store.

Uploads currently write menu, CMS and receipt files to disk:

- cPanel/VPS: use an absolute persistent folder outside release directories,
  back it up nightly, and set `UPLOADS_DIR` to it.
- Serverless/ephemeral host: replace disk storage with object storage before
  launch. Temporary writable storage is not durable.

## Final smoke test

- [ ] HTTPS login/logout works and `/api/health` reports `driver: postgres`.
- [ ] Role navigation matches permissions without avoidable 403 requests.
- [ ] Two parties on one table appear as two active orders.
- [ ] Cancellation records once, returns stock once, appears red and is excluded
  from totals.
- [ ] Kitchen analytics loads with correct Nepal-time ranges.
- [ ] Old orders/KOTs remain resolvable after midnight.
- [ ] Reopen/new-day priority follows the current Nepal date.
- [ ] Close blockers equal the visible active KOT/order/bill lists.
- [ ] Fixed, banded and per-km delivery fees match checkout and bill.
- [ ] Purchases, import, suppliers and advances obey cashier permissions.
- [ ] Real KOT/bill printers produce correct paper output.
- [ ] Nightly database and upload backups are scheduled and monitored.
