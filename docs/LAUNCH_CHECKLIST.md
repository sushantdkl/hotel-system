# Launch Checklist

## Ownership and readiness

- [ ] Name the launch owner, technical owner, restaurant operator, and rollback decision-maker.
- [ ] Freeze the release commit and record the deployment window.
- [ ] All critical PRD acceptance criteria and QA checks pass; known issues have owner/severity/workaround.
- [ ] Menu, variants, prices, availability, tax, service charge, receipt, address, phone, WhatsApp, and opening hours are approved by the business.

## Infrastructure and data

- [ ] Production uses Node.js 22, PostgreSQL 14+, HTTPS, correct domain/DNS, and adequate disk/database capacity.
- [ ] Production secrets are unique; `.env`, database dumps, and deployment SQL are not web-accessible.
- [ ] `FORCE_SECURE_COOKIES=1`; database user is least-privileged.
- [ ] Migrations/schema and production seed were applied successfully.
- [ ] Persistent `UPLOADS_DIR` is writable and survives releases.
- [ ] Timestamped database/uploads backup exists and restore has been tested.

## Security and access

- [ ] Seeded admin password changed immediately and authorized users reviewed.
- [ ] Login throttling, session expiry/logout, CSRF/origin checks, upload controls, and admin API authorization verified.
- [ ] cPanel/database access uses unique credentials and MFA where supported.
- [ ] Logs do not expose secrets, credentials, session values, or sensitive customer data.

## Release verification

- [ ] `npm run lint` and `npm run build` pass for the release.
- [ ] Target health check passes.
- [ ] Public pages, live menu, images, contact links, cart, and one controlled online order pass on mobile and desktop.
- [ ] Admin login, counter sale, payment, receipt, order history, stock movement, and accounting journal pass.
- [ ] Reports and daily totals reconcile with the controlled test sale.
- [ ] Test transactions are clearly marked and reversed/removed through an auditable approved process.

## Operations

- [ ] Staff know login, sale, hold/resume, correction, refund/void, receipt, end-of-day, and escalation procedures.
- [ ] Printer/browser device settings and fallback receipt method are tested.
- [ ] Monitoring and alert contacts cover application health, database, storage, backups, and error logs.
- [ ] Support contact and incident process are available during launch.
- [ ] Previous release and rollback instructions are ready.

## Go/no-go

Launch only when no open issue can cause incorrect payment, accounting imbalance, data loss, unauthorized access, or inability to complete/identify an order. Record approver, time, release identifier, backup identifier, and verification evidence.

## First 24 hours

- [ ] Watch error rate, health, database connections, disk, and upload storage.
- [ ] Reconcile online/counter orders, payments, cash, stock movements, and journals at agreed intervals.
- [ ] Confirm nightly database and uploads backup.
- [ ] Capture incidents and improvement items without making unreviewed production data edits.
