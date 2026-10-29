# Restaurant POS — Production Install (cPanel + PostgreSQL + Node.js)

Fresh install from scratch. ~15 minutes.

## 0. Requirements
- cPanel with **Setup Node.js App** (Node 22).
- **PostgreSQL 14+** (cPanel → PostgreSQL Databases).
- `psql` access (cPanel Terminal, or phpPgAdmin for the SQL files).

## 1. Database
In cPanel → PostgreSQL Databases: create a database + user, grant the user **all**
privileges on the database. Then load the schema + seed (Terminal):

```bash
export PGPASSWORD='your_db_password'
psql -h localhost -U DBUSER -d DBNAME -f deploy/production_schema.sql
psql -h localhost -U DBUSER -d DBNAME -f deploy/production_seed.sql
```

`production_schema.sql` is a baseline snapshot, not the final schema contract.
`production_seed.sql` loads the Chart of Accounts, default cash drawer and bank, Raithane Daure
Chulo restaurant settings, the first admin (login **PIN 984898**), floors /
table types / tables `T-01..T-12`, unit conversions, the real menu (15
categories, 178 items — no photos or recipe ingredient lines yet, add those
via Admin → Products / Recipes), the ingredient master (opening stock **0**
— the client enters real stock later) and an empty recipe shell per item. It
also marks migrations `001`-`038` applied.

**Always run this immediately after loading both SQL files:**

```bash
npm run db:migrate
```

At the time of this guide the migration source of truth continues through
`043_delivery_pricing`. The command is safe to repeat and must also run after
every future release. Skipping it causes runtime errors such as missing KOT,
kitchen timing, salary advance, or delivery pricing columns.

> Alternative for a live/existing DB: run `npm run db:migrate` (applies the
> incremental `migrations/*.sql`) and then load only `deploy/production_seed.sql`
> for the master data. Both paths converge on the same schema level.

## 2. Upload the app
Upload the project (without `node_modules`, `.next`, `.env`, `uploads/*`) to a
folder **outside** `public_html` (e.g. `~/pos`). Keep `uploads/` persistent.

## 3. Environment variables
Copy `.env.example` → `.env` and set real values. Minimum required:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://your-domain.com` (no trailing slash) |
| `DATABASE_URL` | `postgresql://DBUSER:PASSWORD@localhost:5432/DBNAME` (URL-encode special chars, e.g. `@`→`%40`) |
| `SESSION_SECRET` | long random string |
| `CSRF_SECRET` | another long random string |
| `FORCE_SECURE_COOKIES` | `1` |
| `HOSTNAME` | `0.0.0.0` |
| `UPLOADS_DIR` | `./uploads` (or an absolute persistent path) |
| `PGSSL` | `false` (usually, for local cPanel Postgres) |

Keep PostgreSQL sessions in UTC (`ALTER ROLE your_app_user SET timezone TO
'UTC';`). The application stores operational timestamps in UTC and converts
display and report boundaries to Nepal time (`Asia/Kathmandu`).

Optional: `PG_POOL_MAX=5`, `LOG_LEVEL=info`, `RATE_LIMIT_LOGIN=10`,
`RATE_LIMIT_PUBLIC=8`. **Do not** set `PORT` — cPanel injects it.

## 4. Node.js App (cPanel → Setup Node.js App)
- Application root: your upload folder (`~/pos`).
- Application startup file: **`server.js`**.
- Node version: 22. Application mode: **Production**.
- Add the env vars from step 3 in the app's Environment Variables panel
  (or the `.env` file is read too).
- Click **Run NPM Install**, then in the app's terminal: `npm run build`.
- Start / Restart the app. cPanel proxies your domain to it.

## 5. Verify
- `npm run health` (or open the site). Log in at `/login` with **admin, PIN 984898**.
- Confirm `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;`
  returns at least `043_delivery_pricing` for this release.
- **Immediately** change the admin PIN (you are forced to on first login).
- Settings → fill Business info, VAT/PAN, receipt paper size (58/80mm).

## 6. Uploads & static
- Menu/receipt images are written to `UPLOADS_DIR` and served via `/api/media`.
  Keep this folder out of the release directory so redeploys don't wipe it.
- `next.config.mjs` uses `images.unoptimized` — no `sharp`/native build needed.

## 7. Backups
Schedule a nightly dump (cPanel Cron):
```bash
pg_dump -h localhost -U DBUSER DBNAME | gzip > ~/backups/pos_$(date +\%F).sql.gz
```
Also back up the `uploads/` folder. Keep 7–30 days.

## 8. Security checklist
- [ ] Admin password changed from default.
- [ ] `SESSION_SECRET` / `CSRF_SECRET` are unique random strings.
- [ ] `FORCE_SECURE_COOKIES=1`, site served over HTTPS.
- [ ] `.env` not inside `public_html`; DB user limited to its own DB.
- [ ] `deploy/production_*.sql` not web-served.

## Default login
`admin` / PIN `984898` — **change on first sign-in.**
