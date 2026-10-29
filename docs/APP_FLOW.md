# Application Flow

## Public customer flow

```text
Home -> Menu -> Search/filter -> Add items -> Cart
  -> WhatsApp order, or
  -> Enter customer/fulfillment details -> Submit online order -> Confirmation
```

The server reloads current products, availability, variants, and prices before accepting an order. The client cart is a request, not a trusted financial record. Public pages also expose restaurant information, gallery, contact, and inquiry actions.

## Administrator flow

```text
/login -> credential validation -> session cookie -> /admin/billing
  -> New sale / held bill / existing order
  -> Select items and variants -> totals -> payment -> receipt
  -> order, bill, payment, stock, and journal records
```

Middleware protects `/admin/**`. In the current single-admin configuration, visits to legacy `/waiter`, `/kitchen`, and `/cashier` surfaces redirect to `/admin/billing`.

## Counter sale lifecycle

1. Start a new or held sale.
2. Add available products and variants; quantities must be positive.
3. Apply permitted discount, tax, and service settings.
4. Persist the order and its immutable unit-price snapshots.
5. Record one or more supported payment methods.
6. Mark the bill paid only when the required amount is satisfied.
7. Deduct recipe/inventory quantities once and record movements.
8. Post the corresponding balanced accounting journal.
9. Print or reprint the receipt without duplicating payment or journal effects.

## Online order lifecycle

```text
submitted/pending -> accepted -> preparing -> ready -> completed
                         \-> cancelled (with reason)
```

Transitions must follow the allowed workflow. Acceptance/reservation and stock-consumption flags prevent duplicate stock effects. Cancellation records a reason and restores/resolves inventory only when the original transition consumed or reserved it.

## Inventory and purchasing flow

```text
Supplier -> Purchase + line items -> Stock movement IN -> Inventory valuation
Order/recipe -> Stock movement OUT
Adjustment/wastage -> Audited movement -> Accounting effect when applicable
```

Units are normalized with configured conversions. Purchases may create cash/bank effects or supplier payable entries depending on payment terms.

## Accounting flow

Operational actions call the shared journal service. Each journal entry contains at least two lines and total debit equals total credit. Reports—general ledger, trial balance, profit and loss, balance sheet, cash/bank books, and finance dashboard—are derived from these journals rather than separately maintained balances.

## Logout and expiry

Logout invalidates the current server-side session and clears the cookie. Expired, invalid, or revoked sessions return an authentication failure and the UI returns the user to login.

## Failure behavior

- Validation failures return a 4xx response and do not partially write data.
- Authentication/authorization failures return 401/403.
- Conflicts such as invalid transitions return 409 where applicable.
- Unexpected failures return a sanitized 5xx response, are logged server-side, and leave atomic operations rolled back.
