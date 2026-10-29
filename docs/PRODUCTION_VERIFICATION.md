# Production verification checklist

Use after every deploy. Mark each item only when verified on the live (or staging) host.

## Infrastructure

- [ ] Node.js 22 selected in cPanel Application Manager
- [ ] Startup file is `server.js`
- [ ] `DATABASE_URL` points at PostgreSQL (not SQLite)
- [ ] `npm run db:migrate` applied without errors
- [ ] Fresh seed created admin with `must_change_password`
- [ ] `UPLOADS_DIR` exists, writable, backed up
- [ ] `GET /api/health` → `ok: true`, `database: up`
- [ ] Process restart recovers cleanly; health still green

## Security

- [ ] Unauthenticated `GET /api/admin/dashboard` → 401
- [ ] Legacy `/api/shop/login`, `/api/products` → 410
- [ ] `/api/users/active` does not list staff publicly
- [ ] Login rate limit trips after repeated failures (429)
- [ ] Public reservation/inquiry rate limits work
- [ ] Session cookie is `HttpOnly; Secure; SameSite=Strict` over HTTPS
- [ ] Security headers present (`CSP`, `X-Frame-Options`, `HSTS` on HTTPS)
- [ ] Error responses never include SQL, stack traces, or disk paths

## Auth / RBAC

- [ ] Admin, waiter, cashier, kitchen can sign in
- [ ] Waiter cannot process payments
- [ ] Kitchen cannot access admin settings
- [ ] Cashier can bill; admin can manage employees/settings
- [ ] Logout invalidates server session

## Reservations

- [ ] Public booking creates reservation
- [ ] Host desk confirms / seats / completes lifecycle
- [ ] Waiter board shows ops reservations
- [ ] Paying a seated order marks reservation completed

## POS flows

- [ ] Waiter creates order, adds items, sends to kitchen
- [ ] Kitchen board shows items (single board API; no per-order storm)
- [ ] Kitchen marks ready; waiter serves
- [ ] Cashier bills exact total
- [ ] Rs 0 bill requires reason
- [ ] Double payment rejected (unique paid bill)
- [ ] Table returns to available after payment
- [ ] Interrupted payment (kill mid-request) leaves no half-paid bill

## Admin / ops

- [ ] Dashboard sales chart loads (no per-day query loop errors)
- [ ] Reports for date ranges
- [ ] Inventory / expenses / employees CRUD
- [ ] Menu image upload validates type/size; serves via `/uploads`

## Printing / UX

- [ ] Receipt data returns after payment
- [ ] Offline/error pages: `error`, `not-found` render gracefully
- [ ] Loading state appears on slow navigations

## Backup / restore drill

- [ ] `pg_dump` succeeds
- [ ] Uploads archive succeeds
- [ ] Restore into empty DB recovers schema + data
- [ ] App boots against restored DB
