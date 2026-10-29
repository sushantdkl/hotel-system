# QA Production Readiness Guide

This is the executable QA guide for approving Raithane Daure Chulo for production. It covers the public website, online ordering, counter POS, administration, inventory, purchasing, accounting, security, deployment, recovery, and operational readiness.

Do not mark the release production-ready because pages merely load. QA must prove that business transactions create the correct order, payment, stock, and accounting effects, that retries do not duplicate them, and that protected data cannot be reached without authorization.

## 1. Test-run record

Complete this block for every release candidate.

| Field | Value |
|---|---|
| Release/version/commit | |
| Test environment and URL | |
| Database type and schema version | |
| Test start/end time | |
| QA owner | |
| Technical contact | |
| Browser/device matrix | |
| Test account(s) | |
| Backup identifier | |
| Result | PASS / FAIL / BLOCKED |

Attach evidence to each failed case and every critical financial/security case. Evidence should include the test ID, timestamp, URL, inputs, expected result, actual result, screenshot/video, console/network error, and relevant sanitized server log entry. Never include passwords, cookies, tokens, database credentials, or real customer data.

## 2. Scope and release model

### Active production scope

- Public home, menu, about, gallery, and contact pages.
- Public menu search/filter, cart, WhatsApp ordering, and online order submission.
- Admin login, the single-admin counter POS at `/admin/pos` (table board, KOT, bill, payment), and bill management at `/admin/bills`.
- Products/categories, orders/bills, customers, CMS, settings, tables/reservations.
- Inventory, units, recipes, purchases, suppliers, wastage, and expenses.
- Employees, payroll, operational analytics, and reports.
- Double-entry accounting, cash/bank operations, corrections, settlements, payables, reconciliation, and financial reports.
- Menu/receipt uploads, persistent media, health check, PostgreSQL deployment, backup, and restore.

### Intentionally disabled scope

The legacy `/waiter`, `/kitchen`, and `/cashier` page families are disabled in the current single-admin deployment. They must redirect to `/admin/pos`. A successful redirect is a pass; exposing those role surfaces is a release-blocking failure. Their underlying shared order/billing logic is covered through the admin counter and API/integrity tests.

## 3. Severity and release decision

| Severity | Meaning | Release rule |
|---|---|---|
| S0 Blocker | Data loss/corruption, security bypass, incorrect charge/refund, unbalanced journal, duplicate payment/stock effect, site or checkout unavailable | Must be fixed and fully retested |
| S1 Critical | Major feature unusable with no safe workaround, wrong report/stock balance, failed backup/restore, serious privacy/accessibility issue | Must be fixed or launch explicitly cancelled |
| S2 Major | Important defect with a safe temporary workaround and no integrity/security risk | Requires owner, accepted risk, and scheduled fix |
| S3 Minor | Cosmetic/copy issue with no task, data, security, or accessibility impact | May ship if recorded |

Production approval requires:

- No open S0 or S1 defects.
- All critical-path and automated tests pass.
- Financial and inventory reconciliation passes exactly.
- Security, backup/restore, and rollback checks pass.
- Every S2 has written business/technical approval, owner, workaround, and target date.
- QA, technical owner, and business owner sign the go/no-go record.

## 4. Environment and test data preparation

### Production-like environment

- [ ] Use Node.js 22 and PostgreSQL 14+ with the same build and environment shape as production.
- [ ] Run in production mode over HTTPS with `FORCE_SECURE_COOKIES=1`.
- [ ] Use an isolated QA database; never perform destructive testing on live production data.
- [ ] Apply the same production schema/migrations and a known seed.
- [ ] Configure a writable persistent `UPLOADS_DIR` and realistic tax/service/receipt settings.
- [ ] Enable access to application logs, database verification queries/scripts, and browser developer tools.
- [ ] Record time zone, system time, currency display, and schema migration version.

### Required test data

Create clearly labeled QA records:

- One active administrator and one disabled/inactive account.
- Products in at least two categories: simple item, item with variants, unavailable item, zero-price-invalid attempt, long name, and an item with a recipe.
- Inventory items in different base units, one low-stock item, one out-of-stock item, and at least one unit conversion.
- Supplier, customer, employee, table/floor/type, bank account, and cash drawer.
- Tax/service settings, 58 mm and 80 mm receipt configurations, and payment QR where supported.
- Opening stock/cash/bank balances whose expected results can be calculated independently.

Use distinctive names such as `QA-<date>-<case-id>` so created records can be found and corrected through approved application workflows.

### Browser/device coverage

- [ ] Current Chrome/Chromium desktop at 1366×768 and 1920×1080.
- [ ] Current Edge desktop.
- [ ] Android-sized mobile viewport (approximately 360×800).
- [ ] iPhone-sized mobile viewport (approximately 390×844) using Safari/WebKit where available.
- [ ] Keyboard-only navigation at least on login, public order, and counter checkout.
- [ ] 200% browser zoom on public order and key admin workflows.

## 5. Automated release gates

Run from the repository root and attach full output.

```bash
npm run lint
npm run build
npm run test:e2e
npm run health
npm run db:migrate
node scripts/check-accounting.mjs
node scripts/check-entry-math.mjs
node scripts/check-inventory-ledger.mjs
node scripts/check-unit-conversions.mjs
node scripts/check-units.mjs
```

- [ ] Every applicable command exits successfully.
- [ ] Build has no missing environment, route, or database error.
- [ ] Playwright desktop and mobile projects pass without unexplained retries.
- [ ] Re-running migrations makes no unintended schema/data change.
- [ ] Any skipped test has a documented reason and manual replacement case.

## 6. Public website

### PUB-01 Navigation and branding

Test `/`, `/menu`, `/about`, `/gallery`, and `/contact`.

- [ ] Correct Raithane Daure Chulo name, logo, favicon, address, phone, opening hours, and calls to action appear.
- [ ] Header/footer links, logo-home link, browser back/forward, and direct URL entry work.
- [ ] No legacy Sundar/Bagaicha branding or reservation CTA appears where removed.
- [ ] Unknown URL returns the intended 404 experience without server details.
- [ ] Page title, description, canonical/metadata, and social/share image are correct where configured.

### PUB-02 Responsive and visual quality

- [ ] No horizontal overflow, clipped text, overlapping controls, unreadable contrast, or layout jump on required viewports.
- [ ] Images keep aspect ratio, load sharp enough, have useful alternative text where informative, and do not show broken placeholders.
- [ ] Long content, empty content, and missing optional image degrade gracefully.
- [ ] Focus is visible; dialogs/drawers trap and restore focus; Escape closes dismissible overlays.

### PUB-03 Menu

- [ ] Published categories, items, descriptions, variants, prices, availability, and images match admin data.
- [ ] Search is case-insensitive and handles partial match, spaces, no results, long text, and special characters.
- [ ] Category filters and reset/all state work; counts are accurate if shown.
- [ ] Unavailable/archived items cannot be ordered.
- [ ] Each stored image loads, and the same photo is not unintentionally assigned to multiple products.
- [ ] Currency is consistently rendered as Nepalese rupees with correct rounding.

### PUB-04 Contact and external actions

- [ ] Telephone links call the configured number.
- [ ] WhatsApp opens the correct number and correctly encoded message.
- [ ] Map/directions links point to the intended location.
- [ ] Inquiry form validates required fields, email/phone formats, whitespace, maximum lengths, repeated clicks, and rate limiting.
- [ ] Successful inquiry appears once in the admin inquiry/lead view with correct timestamp/content.

## 7. Cart and public online ordering

### ORD-01 Cart behavior

- [ ] Add a simple item and a variant item; chosen variant and price are correct.
- [ ] Increase/decrease quantity, enter boundary quantities, remove one item, and clear the cart.
- [ ] Subtotal and item count update exactly; zero/negative/non-numeric quantities are impossible or rejected.
- [ ] Cart remains usable after navigation/refresh according to intended persistence behavior.
- [ ] Empty cart cannot be submitted.

### ORD-02 Order submission

- [ ] Submit a valid order with minimum required customer and fulfillment data.
- [ ] Validate blank/whitespace name, invalid/short/long phone, overly long notes/address, and unsupported values.
- [ ] Confirmation clearly shows success and an order reference/status without exposing internal data.
- [ ] One public submission creates exactly one order with correct lines, customer data, totals, source/type, status, and timestamp.
- [ ] The order appears in `/admin/orders/online` and the main order view as intended.

### ORD-03 Server authority and abuse cases

Using browser/network tools or API testing:

- [ ] Tamper with item price, total, product name, variant price, status, and stock flags; server ignores/rejects unauthorized values.
- [ ] Submit nonexistent, unavailable, or deleted product/variant; request fails safely and creates no partial order.
- [ ] Double-click submit, refresh response, repeat the request, and simulate timeout/retry; no duplicate financial/stock effect occurs.
- [ ] Trigger public rate limit; receive 429 without impacting other normal users indefinitely.
- [ ] Send malformed JSON, wrong content type, unexpected fields, oversized body, and script/HTML strings; receive sanitized validation errors and no stored executable markup.

### ORD-04 Online order transitions

- [ ] Exercise pending/submitted → accepted → preparing → ready → completed.
- [ ] Cancel from every allowed state with a required reason.
- [ ] Invalid backward/skip/repeated transitions are rejected.
- [ ] Accepted/completed/cancelled timestamps and operator attribution are correct.
- [ ] Stock reservation/consumption occurs once at the intended transition and reverses once when applicable.
- [ ] Payment status/method and refunded amount remain consistent with bill/payment records.

### ORD-05 Table-token/QR ordering

- [ ] Generate/print a QR for an active table and open `/order/[token]` on mobile.
- [ ] Valid token shows only the intended table/menu/status; invalid, missing, or altered token is denied.
- [ ] Place a new order and append to the correct allowed active table order.
- [ ] Server revalidates prices/availability and prevents access to another table by changing token/ID.
- [ ] Turning `qr_ordering_enabled` off blocks ordering cleanly without breaking the public menu.

## 8. Authentication, sessions, and access control

### AUTH-01 Login

- [ ] Correct admin credentials create a session and land at `/admin/pos`.
- [ ] Wrong password/PIN, unknown user, inactive user, blank fields, spaces, and excessive length fail generically.
- [ ] Repeated failed login triggers configured throttling and later recovers as designed.
- [ ] Credential values are masked, not in the URL, browser console, analytics, or server logs.
- [ ] Seed/default credential must be changed and must not work after change.

### AUTH-02 Session lifecycle

- [ ] Refresh and a new tab retain a valid session.
- [ ] Logout revokes the server session, clears cookie, and prevents back-button access to protected data.
- [ ] Expired, altered, deleted, or revoked session is rejected by pages and APIs.
- [ ] Cookie has `HttpOnly`, production `Secure`, and intended `SameSite`, path, and expiry attributes.
- [ ] Concurrent sessions/device behavior matches policy.

### AUTH-03 Authorization matrix

- [ ] Direct unauthenticated access to every `/admin/**` page and `/api/admin/**` group is denied/redirected.
- [ ] Direct calls cannot change role, user ID, account, price, payment, stock, or journal ownership.
- [ ] `/waiter`, `/kitchen`, `/cashier`, and their child pages redirect to `/admin/pos` in current deployment.
- [ ] Hidden/disabled UI functions are also denied at API level.
- [ ] Cross-site mutating request, missing/invalid CSRF/origin, and framed UI attempt are blocked.

## 9. Counter POS, bills, and payments

### POS-01 New sale and held bill

- [ ] Search/filter products, select category, add simple/variant products, edit quantity, add notes, and remove lines.
- [ ] Hold a sale, create another, resume the original, and verify lines/customer/totals were preserved once.
- [ ] Empty, unavailable, deleted, and concurrently changed items are handled safely.
- [ ] Very large basket and long notes remain usable and within configured limits.

### POS-02 Calculation matrix

Independently calculate and compare UI, API, bill, receipt, reports, and journal for:

- [ ] One item × one quantity, multiple items, and quantities greater than one.
- [ ] Decimal/odd prices that exercise rounding.
- [ ] No discount, permitted fixed/percentage discount, boundary discount, and invalid excessive discount.
- [ ] Tax off/on, service charge off/on, and both enabled.
- [ ] Exact payment, underpayment, overpayment with change, and split payments.
- [ ] Zero/negative/NaN/very large values submitted through UI and API are rejected.

Record expected formula and values:

| Value | Expected | Actual |
|---|---:|---:|
| Subtotal | | |
| Discount | | |
| Taxable/service base | | |
| Tax | | |
| Service charge | | |
| Grand total | | |
| Paid | | |
| Change/refund | | |

### POS-03 Payment and idempotency

- [ ] Test every enabled method: cash, card, QR, eSewa, Khalti, credit, or configured subset.
- [ ] Split payment sum and individual records equal the bill's paid amount.
- [ ] Bill becomes paid only when payment requirement is satisfied.
- [ ] Double click, slow response, reload, network retry, and repeated API call do not double-charge or double-post.
- [ ] Payment method flows to payment history, cash/bank book/settlement, reports, and receipt correctly.
- [ ] Credit payment links to the correct customer/supplier/account and later settlement reduces the correct balance.

### POS-04 Receipt and bill history

- [ ] Receipt shows business name, address/contact, PAN/VAT, bill/order number, date/time, operator, items/variants, quantities, prices, discount, tax, service, total, payment, change, and footer correctly.
- [ ] Test 58 mm and 80 mm layouts, print preview, real printer if in scope, page breaks, long names, and reprint.
- [ ] Reprint is identical and creates no new payment, stock movement, bill, or journal.
- [ ] Bills/order detail, search, filters, date ranges, pagination, and empty results are accurate.

### POS-05 Corrections, voids, refunds, and reopen

- [ ] Authorized action requires reason and records actor/time/original reference.
- [ ] Partial and full refund values cannot exceed eligible paid amount.
- [ ] Void/refund/reopen status is consistent across order, bill, payments, reports, customer history, inventory, and accounting.
- [ ] Correct compensating/reversal journal is created; original journal remains unchanged.
- [ ] Repeating the correction is rejected or idempotent.
- [ ] Closed/reconciled periods/accounts cannot be silently altered.

### POS-06 Combined POS counter (`/admin/pos`)

- [ ] POS opens directly into the sale/billing screen (not a separate table board page).
- [ ] **Select Table** opens an in-page table picker; choosing a table resumes or starts that table's order in the same cart UI.
- [ ] **Bills** opens active orders; selecting one loads that order back into the POS cart for add items / Print KOT / Complete Sale.
- [ ] Menu items load with images; search and category filter return the correct items.
- [ ] Cart actions are exactly: **Print KOT**, **Clear**, **Complete Sale**.
- [ ] **Print KOT** prints a kitchen-readable ticket, moves the order to Bills as active, and clears the POS for a fresh sale.
- [ ] **Clear** removes unsent cart lines (or starts fresh when empty).
- [ ] **Complete Sale** opens payment and completes the bill; double-click/reload does not double-charge.
- [ ] Resuming from `/admin/bills` via `?order=` loads the same order in POS.

### BIL-01 Bill management (`/admin/bills`)

- [ ] Active tab lists open/live orders that have no finalized bill yet, alongside pending and completed bills; timestamps show Kathmandu (NPT) time.
- [ ] Selecting an open/live order opens the counter POS with that order loaded (`/admin/pos?order=<id>`) so items can be added and the bill generated and paid.
- [ ] Complete payment on a pending bill collects only the outstanding balance and marks the bill paid exactly once (retry/idempotent).
- [ ] Reopening a completed bill unlocks the same order in POS with previous items loaded for editing; Complete Sale settles only the difference vs the original paid total.
- [ ] After reopen, qty/add/remove work on previous lines; extra due is collected (or a refund is issued if the total drops); the original invoice history stays intact.
- [ ] Void and refund from the bill detail behave per POS-05 and cannot exceed eligible amounts.

## 10. Catalog, CMS, customers, tables, and reservations

### CAT-01 Products and categories

- [ ] Create, view, edit, archive/delete, search, filter, paginate, and restore where supported.
- [ ] Validate required name/category/price, duplicate names/SKU rules, negative price, very large value, long text, and special characters.
- [ ] Create/edit variants and confirm public/counter prices and availability update correctly.
- [ ] Category counts/order and deletion with linked products behave safely.
- [ ] Historical order lines remain unchanged after product/price/category edits.

### CMS-01 Public content and media

- [ ] Edit each supported public content section and verify published output.
- [ ] Empty, long, multilingual, punctuation, and HTML/script input render safely.
- [ ] Upload valid image formats at boundaries; reject wrong MIME, renamed executable, oversized, corrupted, and path-like filenames.
- [ ] Replace/delete media only when permitted; linked pages handle missing media gracefully.
- [ ] Media URL cannot traverse outside `UPLOADS_DIR` and persists across restart/redeploy.

### CUS-01 Customers and inquiries

- [ ] Create/edit/search customer and normalize Nepal/local phone formats correctly.
- [ ] Duplicate phone/customer behavior is predictable and does not merge unrelated people.
- [ ] Customer order/billing history and totals match source records.
- [ ] Inquiry list/counts/status/notes update correctly; unauthorized public/admin fields cannot be set by submitter.
- [ ] Export/delete/privacy behavior follows the agreed business policy.

### TAB-01 Tables, floors, types, and QR

- [ ] CRUD floors/types/tables; validate name/number, min/max capacity, shape/color, notes, and duplicates.
- [ ] Table availability/occupancy changes with active orders and returns correctly after completion/cancellation.
- [ ] Prevent conflicting active assignment or require the intended authorized override.
- [ ] QR generation is unique, scannable, maps to correct table, and old/rotated token behavior is correct.

### RES-01 Reservations

- [ ] Create through public/admin/restaurant paths with valid customer, date/time, party size, preferences, VIP/deposit fields where supported.
- [ ] Validate past/invalid time, capacity, overlap/conflict, missing contact, long notes, and duplicate submit.
- [ ] Exercise confirmed/arrived/seated/completed/cancelled/no-show states and allowed transitions.
- [ ] Change table, seat, link order/customer, and verify table/reservation/order synchronization.
- [ ] Hold, grace, dining, cleaning, lead, alert, and auto-cancel timings honor settings and time zone.

## 11. Inventory, recipes, purchasing, and wastage

### INV-01 Inventory master and units

- [ ] CRUD item/category with base unit, supplier, minimum stock, cost, menu link, and archive behavior.
- [ ] Reject negative opening stock/cost where not allowed, unknown units, duplicate identifiers, and invalid conversions.
- [ ] Test kg↔g, l↔ml, and custom pack conversions in both directions with rounding boundaries.
- [ ] Low-stock/out-of-stock dashboard and filters reflect current movement-derived balance.
- [ ] Item history shows correct chronological quantity, unit, reference, actor, reason, and running result.

### INV-02 Restock, adjustment, import

- [ ] Restock increases exact normalized quantity and creates one movement/accounting effect as designed.
- [ ] Positive/negative adjustment requires reason and cannot create prohibited stock state.
- [ ] Repeat/retry does not create duplicate movements.
- [ ] Import valid, duplicate, partial-invalid, missing-column, wrong-unit, large, and malicious-formula CSV/spreadsheet rows.
- [ ] Import preview/error report is accurate and failed atomic import leaves no partial unintended data.

### REC-01 Recipes and food cost

- [ ] Create/edit recipe with yield, ingredient quantities, units, and component/sub-recipe where supported.
- [ ] Reject missing ingredient, zero/negative quantity/yield, invalid conversion, and circular sub-recipe.
- [ ] Food cost and margin match independently calculated normalized ingredient cost.
- [ ] Completing an order deducts exact recipe quantities once; cancellation/correction restores only when designed.
- [ ] Later recipe/cost edits do not rewrite historical order or journal facts.

### PUR-01 Suppliers and purchases

- [ ] CRUD/search/archive supplier; linked history and duplicate/merge behavior are correct.
- [ ] Create purchase with multiple items, quantities, units, costs, invoice date/number, tax/discount if supported, and notes.
- [ ] Cash, bank, and credit purchase produce correct inventory increase, expense/COGS or inventory accounting, cash/bank decrease or payable increase.
- [ ] Purchase edit/cancel/delete rules protect received stock and posted journals; correction uses audit/reversal flow.
- [ ] Import valid/invalid purchase files and verify totals, supplier, item matching, units, duplicate invoice handling, and atomicity.

### WAS-01 Wastage

- [ ] Log raw-material and prepared/recipe wastage with quantity, unit, reason, employee/shift, note, and photo where supported.
- [ ] Required reason vocabulary, quantity limits, conversion, and available-stock rules are enforced.
- [ ] Exact stock deduction and Dr Wastage / Cr Inventory journal occur once.
- [ ] History filters, totals, analytics, image, actor, and timestamp are correct.
- [ ] Edit/delete/correction cannot erase posted history without an auditable reversal.

## 12. Employees, payroll, and expenses

### EMP-01 Employees and performance

- [ ] Create/edit/deactivate employee with username, role, position, salary, hire date, and PIN/password.
- [ ] Validate duplicates, weak/invalid credentials per policy, salary/date boundaries, and self-lockout behavior.
- [ ] Reset/change PIN works; old credential stops working; no plaintext credential appears in UI/API/log/database.
- [ ] Performance orders, sales, bills, wastage, date filters, and attribution match source records.

### PAY-01 Payroll

- [ ] Record salary payment for valid employee/period/date/amount and each supported payment source.
- [ ] Prevent negative/zero/duplicate or overpayment according to policy.
- [ ] Payment history, employee totals, cash/bank effect, and Dr Payroll / Cr Cash|Bank journal are exact.
- [ ] Delete/reversal requires authorization and preserves audit/accounting integrity.

### EXP-01 Expenses and categories

- [ ] CRUD categories; prevent unsafe removal when linked.
- [ ] Create/edit/correct expense with category, amount, date, payment method, supplier/reference, notes, and receipt upload.
- [ ] Validate negative/zero/too-large amount, future/invalid date policy, missing category, and unsupported payment account.
- [ ] Cash/bank/credit expense posts correct balanced journal once.
- [ ] Purchase/wastage-linked expenses cannot be accidentally duplicated or independently deleted into inconsistency.
- [ ] Expense filters, totals, receipt view, and reports match source records.

## 13. Accounting and finance

For every case below, compare UI totals with database/source transaction and journal lines. Every journal must have non-negative lines, at least two effective sides, total debit exactly equal total credit, correct date/reference, and no duplicate `external_ref`.

### ACC-01 Chart of accounts and general ledger

- [ ] Seeded account codes/names/types are present and structurally correct.
- [ ] Create/edit allowed account fields; prevent duplicate code, invalid type, or deletion of referenced account.
- [ ] General ledger filters by account/date/reference and opening/movement/closing calculations are exact.
- [ ] Journal detail shows all lines, description, source, actor/date, and balanced totals.

### ACC-02 Cash drawer and cash book

- [ ] Open drawer with opening cash; block invalid duplicate open.
- [ ] Cash sale, expense, payroll, refund, exchange, and adjustment appear once in the correct session/book.
- [ ] Close/reconcile with counted denominations/amount; expected vs actual variance is exact and recorded.
- [ ] Closed session cannot receive silent backdated mutation.

### ACC-03 Bank and bank book

- [ ] Create/manage bank account within allowed rules.
- [ ] Deposit, withdrawal, and bank-to-bank/cash transfer create correct two-sided entries.
- [ ] Reject insufficient/invalid amount where policy requires and same-account transfer.
- [ ] Bank book date/reference/balance agrees with journal lines.

### ACC-04 Settlements and cash exchange

- [ ] Record payment-provider settlement with gross, fee, net, method/account, and date.
- [ ] Journal moves correct receivable/clearing amount, expense fee, and bank/cash amount.
- [ ] Cash exchange preserves total value and attributes drawer/bank correctly.
- [ ] Duplicate settlement/reference is rejected or idempotent.

### ACC-05 Accounts payable

- [ ] Credit purchase creates exact supplier payable.
- [ ] Partial/full payment reduces the selected supplier and liability, using correct cash/bank account.
- [ ] Supplier statement, ageing buckets, as-of date, and total agree with journal sub-ledger.
- [ ] Cannot pay more than allowed or apply payment to wrong supplier through ID tampering.

### ACC-06 Bank reconciliation

- [ ] Import/enter statement boundaries and reconcile matching lines.
- [ ] Reconciled/unreconciled totals, statement balance, book balance, outstanding items, and difference are exact.
- [ ] Already reconciled line cannot be reconciled twice or altered without controlled undo.
- [ ] Date/account isolation prevents cross-bank contamination.

### ACC-07 Financial reports and finance dashboard

Test day, month, custom range, empty range, period boundary, and time-zone boundary.

- [ ] Trial balance total debit equals total credit exactly.
- [ ] Profit and loss income minus expenses equals reported profit/loss.
- [ ] Balance sheet satisfies Assets = Liabilities + Equity using intended retained-profit treatment.
- [ ] Cash book, bank book, ledger, payable, sales, expense, dashboard, and source records reconcile.
- [ ] Date filters are inclusive/exclusive as labeled and exports/print match onscreen values.
- [ ] Reversal/refund appears in the correct period and does not delete original activity.

## 14. Dashboards, analytics, reports, settings

### RPT-01 Operational dashboards and reports

- [ ] Admin dashboard cards/charts match independently queried orders, bills, payments, and dates.
- [ ] Sales by item/category/method/hour, top items, average values, and counts use correct denominator and status inclusion.
- [ ] Kitchen analytics prep times, queue/chef metrics, empty data, and overnight/time-zone cases are correct where active data exists.
- [ ] Filters, sort, pagination, export, refresh, and drill-down retain consistent totals.
- [ ] Cancelled/void/refunded/test transactions are included/excluded exactly as labels define.
- [ ] On the dashboard, the Needs Attention and Today's Activity cards stay fixed-height on desktop; long lists scroll inside each card without pushing later sections below the fold.
- [ ] The admin sidebar keeps its scroll position after navigating between pages (including links near the bottom); it does not jump back to the top.

### SET-01 Settings

- [ ] Business identity/contact/PAN/VAT changes appear in intended public pages and receipts.
- [ ] Tax, service charge, discount, payment method, QR, and receipt settings affect new transactions correctly and do not rewrite history.
- [ ] Reservation timing and ordering toggle values enforce server behavior.
- [ ] Validate blank, malformed, negative, excessive, and long values; failed save does not partially apply.
- [ ] Settings persist after refresh/restart and unauthorized API calls cannot change them.
- [ ] Credential/account change requires correct current credential and invalidates old credential as designed.

## 15. API, database, and transactional integrity

### API-01 Contract behavior

- [ ] Each active endpoint supports only declared methods; unsupported methods fail safely.
- [ ] Success and error responses use correct status, valid JSON/content type, stable shape, and sanitized message.
- [ ] IDs, pagination, sorting, date ranges, filters, and empty results behave consistently.
- [ ] Missing resource is 404; auth failures are 401/403; conflicts/rate limits use intended status.
- [ ] Malformed, oversized, duplicate, and concurrent requests do not crash the server or partially commit.

### DB-01 Constraints and migration

- [ ] Fresh database from `deploy/production_schema.sql` + `deploy/production_seed.sql` starts successfully (schema through migration `028`).
- [ ] Seed loads the full menu (13 categories, 103 items, 6 variants), a recipe for every item, and the ingredient master with opening stock 0; verify the counts and that stock is 0 until the client enters it.
- [ ] Seeded admin logs in with username `admin` / PIN `984898` and is forced to change the PIN on first sign-in.
- [ ] After the seed, `npm run db:migrate` reports every migration already applied (no-op) because the markers are present.
- [ ] Database at prior release upgrades through `npm run db:migrate` without losing or changing valid historical data.
- [ ] Migration rerun is safe and `schema_migrations` is correct.
- [ ] Required foreign keys, unique constraints, indexes, and delete restrictions protect history.
- [ ] PostgreSQL production behavior—not only SQLite fallback—is tested.

### DB-02 Atomicity and concurrency

Simulate network interruption, duplicate clicks, and two browser sessions acting on the same record.

- [ ] Sale/payment either fully commits order+bill+payment+stock+journal or fully rolls back.
- [ ] Purchase either fully commits purchase+lines+stock+payable/payment+journal or fully rolls back.
- [ ] Wastage/expense/payroll/correction is all-or-nothing.
- [ ] Concurrent payment, order transition, stock adjustment, and table assignment do not duplicate or overwrite silently.
- [ ] User receives a safe retry/conflict message and the final stored state is reconcilable.

## 16. Security and privacy testing

Perform only in the authorized QA environment.

- [ ] HTTPS redirects/policy and certificate are valid; no mixed content.
- [ ] Headers include effective content-type protection, frame protection/CSP, referrer policy, permissions policy, and production HSTS.
- [ ] XSS attempts in every text field display as text and never execute in list, detail, receipt, export, or public pages.
- [ ] SQL/meta characters do not bypass login/filter or cause database errors.
- [ ] Object ID changes cannot expose/update another protected record without authorization.
- [ ] Directory traversal and encoded traversal cannot read arbitrary media/server files.
- [ ] Upload validates real content type, size, filename, storage path, and access.
- [ ] Sensitive responses are not cached publicly; secrets and stack traces never reach browser responses.
- [ ] Logs redact credentials, tokens, cookies, database URL, and sensitive request fields.
- [ ] Rate limits are effective but do not permanently block normal operation.
- [ ] Dependency/advisory review has no unaccepted exploitable production finding.
- [ ] Only necessary customer/employee data is collected and access/export/retention follows business policy.

## 17. Accessibility, compatibility, and usability

- [ ] Every interactive element is reachable and operable by keyboard in logical order.
- [ ] Visible focus, labels/instructions, error association, required state, and status announcements are present.
- [ ] Buttons/links have accessible names; icon-only controls have labels.
- [ ] Heading hierarchy, landmarks, dialog semantics, table headers, and image alt text are meaningful.
- [ ] Text/controls meet contrast expectations; information is not conveyed by color alone.
- [ ] At 200% zoom and mobile width, content remains available without two-dimensional scrolling except true data tables.
- [ ] Loading, empty, success, validation, conflict, offline/network, permission, and server-error states explain the next action.
- [ ] Destructive actions require clear confirmation; irreversible/accounting actions explain consequences.
- [ ] Common counter task can be completed efficiently without accidental duplicate action.

## 18. Performance and reliability

Measure on production-like hosting with realistic data volume and record tooling/network conditions.

- [ ] Public landing and menu meet agreed Core Web Vitals/performance budget on mobile network profile.
- [ ] Login, menu search, add-to-cart, order submission, counter product search, checkout, and key reports meet agreed response targets.
- [ ] Large order/product/customer/inventory/report lists paginate and remain usable.
- [ ] Images are appropriately sized/cached; initial pages do not download unnecessary full-size media.
- [ ] A brief database/network failure produces a recoverable error, no white screen, and no partial/duplicate transaction.
- [ ] Application recovers after server restart; graceful shutdown does not corrupt in-flight operations.
- [ ] Database pool stays within host limits during representative concurrent use.
- [ ] Disk-full/near-full and upload failure are monitored and fail safely.

Suggested starting targets, unless the business sets stricter ones: health/API simple request under 1 second at normal load, transactional action under 3 seconds, report under 5 seconds, and no critical console error. Record percentile/load details rather than a single best run.

## 19. Deployment, monitoring, backup, and recovery

### OPS-01 Deployment

- [ ] Release excludes `.env`, local databases, `.git`, `node_modules`, `.next`, test artifacts, and temporary files from public exposure.
- [ ] cPanel uses Node 22, production mode, correct application root, and `server.js`; host-injected `PORT` is not overridden.
- [ ] Environment variables match `.env.example` requirements and secrets are unique.
- [ ] Build, migration, restart, health check, and smoke test procedure succeeds from written guide.
- [ ] Persistent uploads remain available after a release replacement.

### OPS-02 Monitoring and logging

- [ ] `/api/health` detects application/database failure and returns appropriate status without secrets.
- [ ] Operators can see application exceptions, failed jobs/requests, database connectivity, pool pressure, disk/uploads capacity, and backup status.
- [ ] Alert recipient and escalation path are tested.
- [ ] Timestamps/time zone and request/error correlation are useful for investigation.

### OPS-03 Backup and restore drill

- [ ] Create timestamped PostgreSQL dump and upload-folder backup.
- [ ] Verify backup file is non-empty, protected, retained, and includes required data/media.
- [ ] Restore into an isolated database/storage location using documented steps.
- [ ] Start the restored app and verify admin login, settings, product images, customers, orders, bills, payments, stock movements, and journals.
- [ ] Compare counts/checksums/control totals between source and restored system.
- [ ] Record achieved recovery time and recovery point against business targets.

### OPS-04 Rollback drill

- [ ] Previous application release is available and rollback owner/decision threshold are documented.
- [ ] Roll back application safely in staging and re-run health/critical smoke tests.
- [ ] For schema changes, demonstrate the forward-fix/compatibility plan; never overwrite newer orders with an older backup without explicit incident authorization.
- [ ] Confirm failed deployment and rollback leave no half-applied migration or unavailable uploads.

## 20. End-to-end reconciliation scenario

This scenario is mandatory because it proves integration across modules.

1. Record opening cash, bank, and inventory control values.
2. Create/verify a supplier, inventory item/unit conversion, menu item, and recipe.
3. Receive a credit purchase, then make a partial supplier payment from bank.
4. Create a counter cash sale for the recipe item and a separate online order paid through another method.
5. Log controlled wastage and one operating expense.
6. Issue a partial or full correction/refund through the supported workflow.
7. Close/reconcile the cash drawer and reconcile the bank test items.
8. Run sales, inventory, payable, ledger, trial balance, P&L, balance sheet, and cash/bank reports.

Pass only when:

- [ ] Order and bill totals equal independently calculated values.
- [ ] Payments minus refunds equal cash/bank/clearing movements as applicable.
- [ ] Closing inventory equals opening + purchases/restocks − recipe use − wastage ± approved corrections.
- [ ] Supplier payable equals credit purchases − supplier payments ± corrections.
- [ ] Every event has exactly one intended balanced journal/reversal.
- [ ] Trial balance balances and financial reports reconcile to ledger/source records.
- [ ] Actors, timestamps, references, reasons, and audit history allow every change to be traced.

## 21. Final production smoke test

Run immediately after deployment with controlled data:

- [ ] `/api/health` passes and public home/menu/images load over HTTPS.
- [ ] Contact/phone/WhatsApp and restaurant information are correct.
- [ ] Admin login works and wrong credentials fail.
- [ ] Create one marked test counter sale, accept payment, and print/review receipt.
- [ ] Submit one marked public order and verify it appears in admin.
- [ ] Confirm associated order, bill/payment, stock movement, and journal records.
- [ ] Confirm dashboard/report totals reflect the tests.
- [ ] Reverse test transactions through the approved auditable workflow; do not directly delete financial history.
- [ ] Verify legacy role routes redirect, security headers/cookies are active, uploads work, logs are clean, and monitoring receives data.
- [ ] Confirm the scheduled database/uploads backup is active.

## 22. Sign-off

| Role | Name | Decision | Date/time | Notes |
|---|---|---|---|---|
| QA owner | | PASS / FAIL | | |
| Technical owner | | GO / NO-GO | | |
| Business owner | | GO / NO-GO | | |

### Open accepted risks

| Defect ID | Severity | Risk and workaround | Owner | Target date | Approver |
|---|---|---|---|---|---|
| | | | | | |

### Final decision

- Release identifier:
- Deployment time:
- Backup identifier:
- QA evidence location:
- Decision: **GO / NO-GO**
- Rollback deadline/criteria:

The release is production-ready only when this guide is completed with evidence and the exit criteria in Section 3 are satisfied.
