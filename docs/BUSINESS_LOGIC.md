# Business Logic

## Orders and pricing

- The database product/variant price is authoritative; never accept a client-calculated unit price as final.
- Order lines snapshot item name, selected variant, quantity, and unit price so later menu edits do not rewrite history.
- Quantity must be positive and the item/variant must exist and be available.
- Subtotal is the sum of line quantity × unit price. Tax, service charge, discounts, total, paid amount, and change use shared calculation helpers and consistent rounding.
- Status changes follow the defined order lifecycle. A completed or cancelled order cannot silently return to an active state.

## Bills, payments, and corrections

- A bill belongs to an order and has a unique bill number.
- Split payments are allowed; bill status becomes paid only after valid payments cover the payable total.
- Reprinting is side-effect free.
- Refund, void, and reopen actions require authorization, reason/audit data, and compensating accounting entries. Historical journal entries are reversed, not edited into a false history.
- Idempotency/external references prevent duplicate sale journals when a request is retried.

## Inventory

- `stock_movements` is the audit trail for stock changes; a displayed balance must be reconcilable to movements.
- Purchases/restocks increase stock. Recipe consumption, wastage, and approved negative adjustments decrease it.
- Unit conversions must exist before converting package units to an item's base unit.
- Order stock is reserved/consumed at most once. Cancellation or correction restores stock only when a prior movement needs reversal.
- Moving-average cost and food-cost calculations use normalized quantities and validated non-negative costs.

## Purchasing and suppliers

- A purchase records supplier, invoice context, line quantities, costs, and payment status.
- Cash/bank purchases credit the selected asset account; credit purchases create accounts payable associated with the supplier.
- Receiving inventory, writing the expense/payable, and posting the journal are one atomic business operation.

## Accounting

- Every posted journal balances: sum(debits) = sum(credits), with non-negative line values.
- Sales, expenses, payroll, purchases, wastage, settlements, cash exchanges, refunds, and voids post through shared accounting services.
- Ledger balances and financial statements are derived values. Do not store or manually patch report totals.
- Closed/reconciled operational records are corrected with explicit reversing/adjusting entries.

## Customers, reservations, and tables

- Customer phone digits are normalized for lookup/deduplication while preserving a display form.
- Reservations require a valid service date/time, party size, and contact identity.
- Seating checks table capacity/availability and connects the reservation, table, and order where applicable.
- A table cannot be assigned to conflicting active service unless an authorized override workflow explicitly supports it.

## Security-sensitive rules

- Passwords/PINs are hashed; plaintext credentials are never stored or logged.
- Server-side role checks protect privileged operations even when UI controls are hidden.
- Login and public write endpoints are rate-limited.
- File uploads validate type, size, generated name, and resolved destination path.

## Transactions and errors

Any operation spanning orders, bills, payments, stock, or journal rows must commit or roll back as a unit. Expected validation and conflict errors are safe to show in user-friendly language; database details, stack traces, and secret values remain server-only.
