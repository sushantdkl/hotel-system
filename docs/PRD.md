# Product Requirements Document

## Product summary

Raithane Daure Chulo is a restaurant website and counter POS that joins menu publishing, customer ordering, order fulfillment, billing, stock control, purchasing, expenses, and accounting in one application. The current operating model is a single-admin counter workflow; legacy waiter, kitchen, and cashier pages remain in the codebase but are redirected to the admin billing counter by middleware.

## Problem

Restaurant staff need one dependable source for menu prices, orders, payments, stock, and financial records. Customers need a fast mobile menu and a low-friction way to order. Owners need daily operational visibility without reconciling disconnected spreadsheets.

## Users

- **Customer:** browses the public site/menu and submits an online or WhatsApp order.
- **Counter administrator:** signs in, creates and manages sales, bills, payments, products, orders, stock, and expenses.
- **Owner/manager:** reviews dashboards, reports, ledger entries, cash/bank activity, purchasing, and configuration.
- **Future staff roles:** waiter, kitchen, and cashier capabilities exist but are not part of the current single-admin launch model.

## Primary outcomes

1. Publish an accurate, mobile-friendly restaurant presence and menu.
2. Accept counter and online orders without trusting client-supplied prices.
3. Produce correct bills and payment records.
4. Keep inventory movements traceable through purchases, use, adjustment, and wastage.
5. Derive financial reports from balanced double-entry journals.
6. Operate safely on a cPanel Node.js and PostgreSQL deployment.

## In scope

- Public home, menu, about, gallery, and contact pages.
- Online cart and order submission, including customer contact and fulfillment details.
- Admin authentication and protected administration area.
- POS billing, held bills, order history, corrections, and receipts.
- Products, categories, inventory, recipes, purchasing, suppliers, and wastage.
- Customers, inquiries, tables, reservations, and settings.
- Expenses, payroll, chart of accounts, journals, cash/bank operations, reconciliation, and financial reports.
- Image/receipt uploads and persistent media delivery.

## Out of scope for the current launch

- Native mobile applications.
- Guaranteed offline synchronization across devices.
- Multi-branch tenancy and consolidated reporting.
- Card-wallet provider settlement automation.
- Real-time kitchen/waiter rollout until role workflows are re-enabled and requalified.

## Functional acceptance criteria

- A customer can browse menu items, search/filter them, add items, and submit an order.
- An administrator can authenticate, complete a sale, record payment, and view the resulting records.
- Prices, tax, service charge, discount, totals, and change are calculated server-side consistently.
- Stock-affecting operations leave an auditable movement record.
- Every posted accounting transaction balances debits and credits.
- Protected admin pages and APIs reject unauthenticated or unauthorized requests.
- Production exposes a successful `/api/health` response and preserves uploads across releases.

## Success measures

- No critical checkout, accounting, authentication, or data-loss defect at launch.
- 100% of launch checklist critical items completed.
- Key public and admin Playwright journeys pass on desktop and mobile projects.
- Daily database and uploads backups are restorable.
- Menu price/order discrepancies and unexplained cash variance are measurable and investigated.

## Constraints

- Node.js 22 is required.
- PostgreSQL is the production database; SQLite is a development fallback, not the production target.
- The cPanel host injects `PORT`; production must not hard-code it.
- Uploaded media must live in a persistent directory outside replaceable release artifacts.
