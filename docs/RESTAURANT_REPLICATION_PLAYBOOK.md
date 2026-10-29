# Restaurant system replication playbook

Use this for the next restaurant. Work in order, check every box, and never copy
Dim Sum Puri's secrets or live operational data.

## Phase 0 — discovery and scope

- [ ] Record legal/business identity, PAN/VAT, contacts, map, hours and receipt footer.
- [ ] Choose `FULL_SERVICE` or `COUNTER_READY_SERVE` mode and required roles.
- [ ] Record floors/rooms/sections, tables, seats, cabins and extra tables.
- [ ] Collect approved menu, variants, prices, photos and availability.
- [ ] Decide tax, service, discount, credit, split-payment and QR rules.
- [ ] Decide dine-in, takeaway, counter, online and delivery workflows.
- [ ] Decide inventory depth: stock, recipes, purchases, wastage and accounting.
- [ ] Agree the Nepal business-day cutoff and after-midnight policy.

Done when the owner signs off the data and workflow sheet.

## Phase 1 — clean foundation

- [ ] Copy source code, never `.env`, databases, uploads, logs or build output.
- [ ] Replace branding in pages, metadata, WhatsApp, bills, KOTs and seeds.
- [ ] Configure Node 22, PostgreSQL, HTTPS, persistent uploads and backups.
- [ ] Store timestamps in UTC; display/filter in `Asia/Kathmandu`.
- [ ] Use ordered transactional migrations; never patch only the live DB.
- [ ] Create a strong one-time admin credential and force its replacement.

Done when a fresh DB reaches the latest migration, health reports PostgreSQL up,
the app builds, and no old restaurant identity appears.

## Phase 2 — authentication and permissions

- [ ] Create unique staff accounts with correct roles and active states.
- [ ] Expose capabilities to UI so roles do not call forbidden endpoints.
- [ ] Make cashier purchase permissions separate: view, receive/create, import,
  edit and void.
- [ ] Make supplier view/create/edit separate; supplier merge remains admin-only.
- [ ] Make salary-advance permission separate from payroll payment.
- [ ] Default sensitive cashier permissions to disabled.
- [ ] Audit permission changes with actor, before/after values and time.

Done when revoked UI is hidden, direct API access is rejected, granted actions
work, and routine screens do not generate avoidable 403s.

## Phase 3 — rooms, tables, reservations and parties

- [ ] Create room/floor/category records and tables with seats and active state.
- [ ] Group dashboard tables by room/category with state counts.
- [ ] Support multiple parties/orders on the same physical table.
- [ ] Make active-order counts party-aware, not table-aware.
- [ ] Generate QR tokens and deduplicate waiter-call requests.
- [ ] Verify reservations, alerts, assignment, grace and cleaning time.

Done when two parties at one table stay separate through KOT, bill and payment.

## Phase 4 — menu, public site and online ordering

- [ ] Import categories, items, variants, dietary flags, prices and active state.
- [ ] Upload unique optimized photos and verify all stored images load.
- [ ] Configure public identity, CMS, gallery, contact, map, hours and WhatsApp.
- [ ] Verify search/category filters and mobile layout.
- [ ] Save online orders before composing their WhatsApp message.
- [ ] Rate-limit public inquiry, reservation and order endpoints.

Done when public/POS prices agree and a complete online order reaches staff.

## Phase 5 — POS, orders and KOT lifecycle

- [ ] Support counter, dine-in, takeaway and delivery orders.
- [ ] Create initial/additional KOTs with stable numbers.
- [ ] Track pending, preparing, ready, completed and cancelled states.
- [ ] Make ticket/item cancellation idempotent: one cancellation record and one
  stock return.
- [ ] Preserve cancellation reason, actor and Nepal-time display.
- [ ] Resolve the original KOT when all its items are cancelled.
- [ ] Exclude cancelled items from counts, totals, bills and sales.
- [ ] Show cancelled KOTs/items clearly in red everywhere.
- [ ] Verify KOT print, reprint, bill checkout and bill print permissions.

Done when repeated cancellation cannot duplicate tickets, stock or money and
kitchen analytics loads without missing-column errors.

## Phase 6 — billing and payments

- [ ] Recalculate subtotal, discount, tax, service and total on the server.
- [ ] Support cash, QR, credit and mixed payments with consistent rounding.
- [ ] Validate cash tender/change and customer credit limit.
- [ ] Preserve paid, unpaid, credit, void and corrected history.
- [ ] Attribute payment, void, reopen and correction to staff.
- [ ] Test real 58/80 mm bill printers.
- [ ] Keep bill/order filters compact, horizontal and mobile-friendly.

Done when drawer cash, bill, allocations and accounting journal reconcile.

## Phase 7 — delivery pricing

- [ ] Let admin choose fixed fee, distance bands or per-km pricing.
- [ ] Configure minimum fee, maximum distance and range labels.
- [ ] Show delivery cost before public confirmation.
- [ ] Allow authorized checkout adjustment when required.
- [ ] Snapshot fee, distance and label on order and bill.
- [ ] Exclude delivery from dine-in/takeaway/counter.

Done when cart, saved order, checkout, receipt, bills and reports agree.

## Phase 8 — inventory, recipes and units

- [ ] Use one clear stock/consumption unit for simple items.
- [ ] Add purchase conversion only where deliveries use a different unit; verify
  factor direction with a real example.
- [ ] Record opening stock, minimum level, cost and active/archive state.
- [ ] Configure recipe/BOM consumption where needed.
- [ ] Reserve, deduct and return stock exactly once.
- [ ] Ledger every purchase, sale, wastage, adjustment and cancellation with
  reason and actor.

Done when selected ingredients reconcile from purchase through sale/cancellation.

## Phase 9 — suppliers, purchases and import

- [ ] Create supplier contact and ledger data.
- [ ] Receive purchase invoice/date, item, quantity, unit cost and payment.
- [ ] Update stock, supplier balance, expense/accounting and history atomically.
- [ ] Edit/void with reversal history, not destructive deletion.
- [ ] Expose cashier pages only when permitted.
- [ ] Permit cashier batch import through `purchases.import`.
- [ ] Group import lines by invoice, map columns and preview before commit.
- [ ] Match active inventory items only and report rejected lines.

Done when a multi-invoice CSV produces correct purchases, stock, costs,
expenses/payables and actor with no partial invalid commit.

## Phase 10 — accounting, expenses and cash

- [ ] Configure chart of accounts, drawer, bank/QR accounts and opening balances.
- [ ] Post balanced journals for every money/stock lifecycle.
- [ ] Verify payables, receivables, bank reconciliation and settlements.
- [ ] Require reasons for voids, corrections and unexplained cash differences.
- [ ] Attribute reports by business day as well as timestamp.

Done when trial balance and a hand-calculated sample shift agree.

## Phase 11 — payroll and salary advances

- [ ] Store employee pay structure and payroll periods.
- [ ] Record each advance with employee, amount, date, method, note, giver and day.
- [ ] Show advanced, deducted and outstanding totals per employee.
- [ ] Deduct selected outstanding advances during payroll and pay net salary.
- [ ] Prevent deduction above outstanding balance.
- [ ] Provide employee/period report and CSV export.
- [ ] Allow trusted cashier advances only with explicit admin permission.

Done when advance and payroll affect cash/accounting once and preserve history.

## Phase 12 — business day and midnight

- [ ] Open with physical cash; never count opening cash as revenue.
- [ ] Make same-Nepal-date reopen the primary action.
- [ ] Make next-day opening primary after Nepal midnight.
- [ ] Allow carried orders/KOTs to complete/cancel after midnight.
- [ ] Block normal close only for truly active orders, KOTs and unpaid bills.
- [ ] Ignore pending KOTs whose parent order is cancelled/voided.
- [ ] Require reason and admin authority for force close.
- [ ] Reconcile expected, counted, difference and session history.

Done after passing a 23:59/00:01 Nepal test with accurate visible blockers.

## Phase 13 — analytics, reports and Nepal time

- [ ] Centralize Nepal display and report-range helpers.
- [ ] Test Today, Yesterday, Week, Month and Custom around midnight.
- [ ] Verify kitchen timing and employee performance.
- [ ] Verify sales, void, stock, purchase, expense, payroll, delivery and day reports.
- [ ] Use Nepal time in exports and prints.
- [ ] Treat suffix-less DB timestamps consistently as UTC.

Done when UI, dashboard, export and close report place boundary records identically.

## Phase 14 — UX and operational polish

- [ ] Keep filters compact and avoid oversized controls/vertical lettering.
- [ ] Use consistent statuses; cancelled/destructive state is red.
- [ ] Test desktop, tablet, phone and POS widths for overflow.
- [ ] Show actionable empty/error states instead of raw API errors.
- [ ] Do not poll APIs unavailable to the current role.
- [ ] Make critical controls touch-friendly and keyboard accessible.

Done when every role completes its main flow without irrelevant UI or errors.

## Phase 15 — launch

- [ ] Complete the hosting-readiness audit for the target restaurant.
- [ ] Pass lint, units, build, browser E2E and a manual shift rehearsal.
- [ ] Use a dedicated PostgreSQL user and run all migrations.
- [ ] Store secrets only in the host environment/secret manager.
- [ ] Enable HTTPS, secure cookies, rate limits and least privilege.
- [ ] Persist uploads and prove database plus upload restore.
- [ ] Add uptime, disk/database, backup and error monitoring.
- [ ] Keep a rollback release; prefer forward migrations after live data exists.
- [ ] Train staff and keep a manual-order/outage procedure at the counter.

Done only after owner approval of totals, restore, permissions and printed output.

## Phase 16 — post-launch

- [ ] Monitor errors, slow queries, storage, backups and unusual voids.
- [ ] Reconcile the first seven daily closes with owner/accountant.
- [ ] Review permissions and inactive staff monthly.
- [ ] Restore-test quarterly and before major schema releases.
- [ ] Put every reusable fix in migration/config and a regression test.

## Change these for every restaurant

Never copy `.env`, database, staff credentials, sessions, customers, orders,
bills, balances, uploads, day history, identity, contacts, menu, rooms/tables,
tax/service rules, receipt text, bank/QR, stock/cost, recipes, suppliers,
delivery ranges, payroll data or permission grants.

Reusable: source code, ordered migrations, permission model, tests, deployment
process and this playbook.

## Handoff prompt for the next project

> Use `docs/RESTAURANT_REPLICATION_PLAYBOOK.md` as the source of truth. Audit the
> new restaurant repository and data first; do not assume it matches Kathmandu
> Momo. Plan and implement phase by phase with migrations and acceptance tests.
> Never copy secrets or operational data. Store time in UTC and use
> Asia/Kathmandu for business dates/display. Do not declare readiness until lint,
> unit tests, build, browser E2E, manual shift rehearsal, migration verification
> and backup restore all pass.
