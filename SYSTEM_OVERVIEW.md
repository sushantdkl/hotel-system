# Restaurant POS — Complete System Overview

Full-stack restaurant POS + accounting system. Next.js (App Router) + PostgreSQL.
Every accounting number is derived from a single double-entry journal; no stored
balances. 44 tables, ~90 API routes, role-based access (admin / cashier / waiter
/ kitchen) with a public customer-ordering surface.

Stack: Next.js 15 (webpack), custom `server.js` (cPanel/Node), PostgreSQL
(SQLite fallback for local dev), PIN/token auth, thermal print system.

---

## 1. Authentication & Roles
- **Purpose:** PIN-based login, session tokens, role gating.
- **Features:** staff picker login, per-request `requireAuth`/`verifyAuth`, change-credentials, rate-limited login.
- **Pages:** `/login`, Settings → Account.
- **APIs:** `/api/users/active`, `/api/auth/change-credentials`, `AuthService.verifySession` used by every protected route.
- **Tables:** `users` (roles: admin/cashier/waiter/kitchen), `sessions`, `devices`, `rate_limits`.
- **Integration:** every `/api/admin/*` and `/api/restaurant/*` route.

## 2. Tables, Floors & QR
- **Purpose:** table roster, floor/type taxonomy, secure per-table QR.
- **Features:** floors & types CRUD, capacity/status, live floor board, printable table QR.
- **Pages:** `/admin/tables` (live board), `/admin/table-management` (roster + QR).
- **APIs:** `/api/admin/tables`, `/api/admin/table-floors`, `/api/admin/table-types`, `/api/admin/table-qr`, `/api/restaurant/tables`.
- **Tables:** `tables` (+`qr_token`, `position_x/y` for future drag-drop), `table_floors`, `table_types`.
- **Integration:** orders (occupancy), customer QR ordering, billing.

## 3. Menu & Categories
- **Purpose:** menu items + categories, public menu feed.
- **Features:** item CRUD, category filter + counts, availability, images, veg flag.
- **Pages:** `/admin/products`, `/admin/categories`, public `/menu`.
- **APIs:** `/api/admin/products`, `/api/restaurant/menu`, `/api/restaurant/menu/categories`, `/api/public/menu`, `/api/uploads/menu`.
- **Tables:** `menu_items`, `menu_categories`, `menu_item_variants`.
- **Integration:** orders, recipes, customer ordering, billing prices.

## 4. Orders
- **Purpose:** order lifecycle (pending→preparing→ready→completed), shared by every channel.
- **Features:** create/append items, status flow, stock deduction on order, table auto-occupy, waiter attribution, kitchen timing capture.
- **Pages:** `/waiter`, `/waiter/new-order`, `/waiter/order/[id]`, `/admin/orders`, `/admin/orders/[id]`.
- **APIs:** `/api/restaurant/orders`, `/api/restaurant/orders/[id]`, `/api/restaurant/orders/[id]/items`, `/api/admin/orders`.
- **Tables:** `orders` (+`prep_started_at`,`ready_at`,`prepared_by`), `order_items`, `kots`, `kot_items`.
- **Integration:** kitchen, billing (sale journal), inventory (deduction/restore), customer QR ordering — all use `OrderRepository`.

## 5. Kitchen Display & Analytics
- **Purpose:** live cook board + throughput/chef metrics.
- **Features:** status-tinted tickets, urgency/aging, queue counts, log/view wastage; analytics (orders today, avg prep, by-hour, chef performance).
- **Pages:** `/kitchen`, `/admin/kitchen-analytics`.
- **APIs:** `/api/restaurant/orders?board=kitchen`, `/api/restaurant/orders/[id]` (status), `/api/admin/kitchen-analytics`.
- **Tables:** `orders` (timing columns), `kots`.
- **Integration:** orders status flow; wastage modal.

## 6. Customer QR Ordering
- **Purpose:** mobile self-ordering from a table QR.
- **Features:** token-gated menu, cart, place/append to the table's order, live status, `qr_ordering_enabled` toggle. Reuses the exact waiter order workflow.
- **Pages:** `/order/[token]`.
- **APIs:** `/api/public/order/[token]` (GET menu/status, POST place — rate-limited, server-side price/availability).
- **Tables:** `tables.qr_token`, `orders`, `order_items`.
- **Integration:** orders, kitchen, billing.

## 7. Billing & Payments
- **Purpose:** turn an order into a paid bill; thermal receipt.
- **Features:** VAT + service + discount, split payments, cash/card/QR/eSewa/Khalti/credit, change, shared 58/80mm thermal print, payment QR display.
- **Pages:** `/cashier`, `/cashier/bill/[id]`, `/cashier/billing`, `/admin/billing`.
- **APIs:** `/api/restaurant/bills/[id]/payment`, `/api/restaurant/bills`, `/api/restaurant/payments`.
- **Tables:** `bills` (+`void_reason`,`voided_at`,`refunded_amount`), `bill_payments`, `bill_corrections`.
- **Integration:** **posts the sale journal atomically**; accounting corrections (void/refund); customers.

## 8. Host Desk, Reservations & Customers
- **Purpose:** reservations/leads pipeline + customer records.
- **Features:** reservation timers (hold/grace/dining/cleaning/auto-cancel/lead), seat/assign, alerts, customer sales history.
- **Pages:** `/admin/leads` (Host desk), `/admin/customers`, `/waiter/reservations`.
- **APIs:** `/api/admin/reservations/*`, `/api/restaurant/reservations`, `/api/admin/customers`, `/api/admin/leads/*`, `/api/public/reservations`, `/api/public/inquiries`.
- **Tables:** `reservations`, `customers`, `inquiries`.
- **Integration:** tables, orders, billing (customer on receipt); settings (reservation timers).

## 9. Inventory, Categories & Units
- **Purpose:** raw-material stock with a movement ledger.
- **Features:** items, categories (managed), unit conversions (custom pack sizes), min-stock, moving-average cost, movements, adjustments, restock.
- **Pages:** `/admin/inventory`, `/admin/inventory/[id]`, `/admin/inventory-categories`, `/admin/unit-conversion`.
- **APIs:** `/api/admin/inventory`, `/api/admin/inventory/[id]`, `/api/admin/inventory/restock`, `/api/admin/inventory-categories`, `/api/admin/unit-conversions`, `/api/admin/stock-movements`.
- **Tables:** `inventory_items` (+`category_id`), `inventory_categories`, `unit_conversions`, `stock_movements`, `stock_items`.
- **Integration:** recipes (deduction), purchases (receipt), wastage, orders; units in `lib/units.js`.

## 10. Purchases & Suppliers
- **Purpose:** goods-received + supplier records + payables.
- **Features:** receive delivery, purchase lines, cash/bank/**credit** (→ AP), supplier merge, spend history.
- **Pages:** `/admin/purchases`, `/admin/purchases/import`, `/admin/suppliers`.
- **APIs:** `/api/admin/purchases`, `/api/admin/suppliers`, `/api/admin/accounts-payable`.
- **Tables:** `purchases`, `purchase_items`, `suppliers`, `journal_lines.supplier_id` (AP sub-ledger).
- **Integration:** inventory (stock in), accounting (COGS/Cash or AP journal), expenses (linked).

## 11. Recipes
- **Purpose:** BOM per menu item; food cost & margin.
- **Features:** ingredients + sub-recipes, live costing, yield, margin, links to menu item (drives stock deduction).
- **Pages:** `/admin/recipes`, `/admin/recipes/[id]`.
- **APIs:** `/api/admin/recipes`.
- **Tables:** `recipes`, `recipe_items`.
- **Integration:** inventory (deduction on order), menu items, wastage (recipe waste).

## 12. Wastage
- **Purpose:** log + analyze inventory/prepared-food loss.
- **Features:** log (kitchen/waiter/cashier), history/filter/analytics, reasons, employee/shift, photo; deducts stock + books a non-cash inventory loss journal.
- **Pages:** `/admin/wastage`; modal in kitchen/waiter/cashier.
- **APIs:** `/api/admin/wastage`.
- **Tables:** `wastage_log`.
- **Integration:** inventory, accounting (Dr Wastage / Cr Inventory), expenses.

## 13. Employees, Payroll & Performance
- **Purpose:** staff records, salary payments, performance.
- **Features:** employee CRUD + PIN, salary/hire-date/position, per-employee payroll drawer + payment history, performance metrics (orders/sales/bills/wastage).
- **Pages:** `/admin/employees`, `/admin/employee-performance`.
- **APIs:** `/api/admin/employees`, `/api/admin/payroll`, `/api/admin/employee-performance`.
- **Tables:** `users` (+`salary`,`hire_date`,`position`), `salary_payments`.
- **Integration:** accounting (Dr Payroll / Cr Cash|Bank on payment), orders/bills (attribution).

## 14. Expenses & Categories
- **Purpose:** operating expenses + managed categories.
- **Features:** log/edit/delete, categories, receipts, payment method; auto-posts a journal; purchase/wastage expenses linked.
- **Pages:** `/admin/expenses`, `/admin/expense-categories`.
- **APIs:** `/api/admin/expenses`, `/api/admin/expense-categories`.
- **Tables:** `expenses`, `expense_categories`.
- **Integration:** accounting (Dr expense / Cr Cash|Bank|AP), purchases, wastage.

## 15. Operational Reports
- **Purpose:** sales/ops reporting.
- **Pages:** `/admin/reports`, `/admin/dashboard`.
- **APIs:** `/api/admin/reports/*`, `/api/admin/dashboard`.
- **Tables:** derived from `orders`,`bills`,`bill_payments`.
- **Integration:** billing, orders.

## 16. Accounting (double-entry engine)
- **Purpose:** the financial backbone — every event posts one balanced journal.
- **Modules & pages:**
  - Chart of Accounts `/admin/chart-of-accounts`
  - General Ledger + Journal `/admin/general-ledger`
  - Cash Book `/admin/cash-book`, Bank Book `/admin/bank-book`
  - Cash Drawer (open/close/reconcile) `/admin/cash-drawer`
  - Bank (deposit/withdraw/transfer) `/admin/bank`
  - Payment Settlement `/admin/settlements`, Cash Exchange `/admin/cash-exchange`
  - Financial Reports (P&L, Balance Sheet, Trial Balance) `/admin/financial-reports`
  - Corrections (refund/void/reverse) `/admin/corrections`
  - Accounts Payable + ageing `/admin/accounts-payable`
  - Finance Dashboard `/admin/finance-dashboard`
  - Bank Reconciliation `/admin/bank-reconciliation`
- **APIs:** `/api/admin/accounts`, `/ledger`, `/cash-drawer`, `/bank`, `/settlements`, `/cash-exchange`, `/financial-reports`, `/corrections`, `/accounts-payable`, `/finance-dashboard`, `/bank-reconciliation`.
- **Tables:** `accounts`, `journal_entries` (+`external_ref` idempotency), `journal_lines` (+`drawer_id`,`bank_account_id`,`supplier_id`,`reconciled`), `cash_drawers`, `drawer_sessions`, `bank_accounts`, `payment_settlements`, `bank_reconciliations`.
- **Core libs:** `accounting.js` (postJournal engine + seed), `accounting-cash.js`, `accounting-reports.js`, `accounting-corrections.js`, `accounting-suppliers.js`, `accounting-dashboard.js`, `accounting-reconcile.js`, `bill-corrections.js`.
- **Integration:** posted automatically from sales, purchases, expenses, wastage, payroll, cash/bank ops. No stored balances — everything derives from `journal_lines`.

## 17. Settings (Configuration Center)
- **Purpose:** business/tax/receipt/ordering config.
- **Features:** tabbed — Business, Billing & Tax, Reservations, Receipt (58/80mm + footer), Ordering (QR toggle), Payments & QR, shortcuts, Account.
- **Pages:** `/admin/settings`.
- **APIs:** `/api/admin/settings`.
- **Tables:** `system_settings` (key/value).
- **Integration:** billing (VAT/service), receipts (name/VAT/PAN/footer/paper size), reservation engine, QR ordering gate.

## 18. Platform / Infrastructure
- **server.js** — cPanel Node entrypoint (PORT/HOSTNAME, graceful shutdown).
- **middleware.js** — security headers (nosniff, frame-deny, HSTS, permissions-policy) + landing rewrite.
- **lib/db/** — dual backend (Postgres prod / SQLite dev), pooled Postgres, `?`→`$n` adapter.
- **Uploads** — `/api/uploads/*` → `UPLOADS_DIR`, served via `/api/media`.
- **Migrations** — `migrations/001…023` (incremental) + `deploy/production_schema.sql` + `deploy/production_seed.sql` (fresh install).
- **Tests** — `scripts/check-accounting.mjs`, `scripts/check-unit-conversions.mjs`.
