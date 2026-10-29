# Hotel PMS completion report

Branch `hotel-pms-completion`. Commits: `3673a43` (pre-existing PostgreSQL fixes),
`c079650` (server: domain, folio, packages, restaurant link, audit, reports),
`fccc062` (UI). Initial-state matrix: `docs/HOTEL_PMS_AUDIT.md`.

## A. Initial state

The hotel already had rooms, categories, reservations (one row per room), check-in,
a charge/payment folio with ledger posting, restaurant charge-to-room in the admin
POS, night audit, housekeeping dispatch, maintenance tickets, OTA sync, CCTV,
security desk, guest profiles and a Business report. See the audit file for the
per-module matrix.

## B. Gaps found

Folios lacked source types, reversals, windows, transfers and a deposit liability.
Meal plans were labels only. Room moves had no reason, history or rate decision.
Reservations lacked status types, pax split, company, agent, segment, guarantee
and requests; multi-room had no master record or payer choice. No laundry, no
minibar stock, no restaurant-to-stay links, no hotel report set, no GM view, no
global search. Charge to Room could not settle on PostgreSQL at all (allocation
CHECK constraint lacked `room`). No Events/Banquets module exists.

## C. What was completed

| Module | Status now |
|---|---|
| Front desk command center | Complete (lists + one-click actions) |
| Reservations (status types, detail, no-show, plan change, add room, master/payer) | Complete; unassigned (room-type-only) bookings not supported |
| Availability / double booking | Complete (property-row lock, tested concurrently on PostgreSQL and SQLite) |
| Room move (reason, rate decision, comp-upgrade permission, history) | Complete |
| Folio (sources, windows, reversal, transfer, routing, allowance, city ledger) | Complete |
| Deposits (2150 liability, applied at checkout/cancel) | Complete |
| Meal plans / packages (daily allowance, outlet, time, 2160, breakage) | Complete |
| Restaurant charge to room (allowance split, mixed pay, void correction) | Complete in admin/cashier POS; not in waiter app or reopened bills |
| Room service (same kitchen; delivery states; separate analytics) | Complete |
| Table reservation / order link to stay | Complete |
| Checkout (deposit, package close, invoice original/duplicate, dirty + task) | Complete |
| Night audit (checklist, idempotent, re-run, business-date alignment) | Complete; manual start (no scheduler) |
| Housekeeping (types, stayover, DND/pickup, turnaround) | Complete |
| Maintenance (6-state workflow, OOO vs OOS, inspection before resale) | Complete |
| Laundry | Complete |
| Minibar (catalog, inventory stock movement) | Complete for consumption; no per-room par/restock tracking |
| Hotel reports (24 reports, CSV, print) | Complete |
| Combined control center / GM dashboard | Complete; Events section states the module is absent |
| Global search, Guest 360, cross-navigation bill ↔ folio | Complete |
| Events / banquets / room blocks | NOT IMPLEMENTED (no module to extend) |
| Booking channel provider adapters | Not built (needs provider credentials) |

## D. Database

Migration `087_pms_core.sql`: folio columns (source_type, source_id, room_number,
quantity, unit, discount, package_cents, window_no, reversal_of, transfer_ref,
reason, city_ledger_account), widened kind/category/method checks, unique reversal
index; reservation columns (adults, children, booking_type, company, travel_agent,
market_segment, guarantee, special_requests, notes, no_post, credit_limit_cents);
room block_kind and hk_flag; tables hotel_groups, hotel_room_moves,
hotel_folio_windows, hotel_routing_rules, hotel_deposit_applications; accounts
1330, 2150, 2160, 4041–4043, 4045; indexes on dates, status, guest, group, source.

Migration `088_pms_operations.sql`: plan_code, hotel_plan_components,
hotel_package_usage, hotel_package_settlements, hotel_laundry_orders,
hotel_minibar_items, orders.hotel_stay_id + room-service delivery columns,
reservations.hotel_stay_id, housekeeping task_type/started_at, maintenance
workflow statuses, audit reason/business_date, invoice print_count, guest
preferences, allocation methods `room` and `package`.

SQLite mirrors live in `lib/hotel/folio-schema.js` and `lib/hotel/pms-schema.js`
(one-time table rebuilds where CHECKs changed).

## E. Restaurant ↔ Hotel

- Charge to Room: the restaurant bill stays a restaurant bill. Its sale journal
  credits 4010 once and debits 2160 (meal-plan covered part, method `package`)
  and/or 1320 (overage, method `room`). The folio row (RESTAURANT or ROOM_SERVICE,
  source_id = bill id) has no journal. Retries cannot duplicate (unique keys).
  Cash/online part payment plus room is supported. Voiding the bill credits the
  folio row and releases the allowance.
- Meal plans: components with per-adult/child daily allowance, serving window,
  outlets and morning-after/evening timing.
- Room service: orders on room-service tables use the normal menu, KOT, kitchen
  and bill; delivery states are tracked; reports show room service separately.
- Table reservations and orders can be linked to a stay (badge, Guest 360 spend).

## F. Hotel operations

Reservation → check-in → stay (same row) → folio → night audit → checkout. Room
move keeps stay, folio, payments, restaurant charges and plan; the old room goes
dirty with a task. Add room creates a linked stay in the master reservation with
payer routing (all, rooms only, or separate). Checkout requires posted nights
and every window at zero, applies the deposit, closes the package, freezes the
invoice, sets the room dirty and creates the cleaning task.

## G. Accounting (no double counting)

| Event | Journal |
|---|---|
| Room night | Dr 1320 / Cr 4030 room part, 2020 tax, 2160 package part |
| Hotel service | Dr 1320 / Cr 4040–4043 + 2020 |
| Restaurant bill to room | Restaurant sale journal only (Cr 4010 once) |
| Deposit received | Dr Cash/Bank / Cr 2150 |
| Deposit applied | Dr 2150 / Cr 1320 |
| Folio payment | Dr Cash/Bank or 1330 / Cr 1320 (no revenue) |
| Refund | Dr 2150 or 1320 / Cr Cash/Bank |
| Reversal | Mirror of the original journal |
| Transfer / routing | No journal (receivable moves between folios) |
| Package breakage | Dr 2160 / Cr 4045 + 2020 |

The scenario test asserts: debits = credits, 1320/2150/2160 clear to zero,
4010 equals the restaurant bills once, departmental total equals income accounts.

## H. Reporting

Hotel: arrivals, departures, in-house, reservations, cancellations, no-shows,
room moves, extensions/early/late, availability, occupancy/ADR/RevPAR, room
status, housekeeping turnaround, maintenance/OOO, revenue by room type / plan /
source / segment, departmental revenue, restaurant revenue by guest type,
deposits, outstanding folios, city ledger, OTA ledger, payments, packages, guest
spend, night audit history. Combined: control center, Business report (now on
the shared room-night definitions). Financial reports are the existing ledger
reports (unchanged; hotel accounts appear in them automatically).

## I. Tests executed (2026-10-29)

- Unit (SQLite): 394 pass, 0 fail (`npm run test:unit`), including the new
  end-to-end scenario file `tests/unit/hotel-pms-scenario.test.js` (6 tests).
- PostgreSQL 17 integration: `production.test.js` and new `hotel-pms.test.js`
  pass, each on a fresh migrated database (real POS pay route, concurrency).
- Migrations 001–088 applied on fresh PostgreSQL databases.
- Production build: passes (`npm run build`).
- E2E (Playwright, production build on a disposable PostgreSQL database):
  hotel-pms, hotel-folios, hotel-live specs pass on desktop and phone.
  `phase11-settings-permissions` passes on desktop; the phone run fails on a
  save-then-read race in that existing test (permissions page unchanged).
- The developer database (`hotelsystem`) was not migrated: run `npm run db:migrate`.

## J. External dependencies still open

Booking.com / Agoda / Expedia / Airbnb or channel-manager API credentials and
adapters; payment-gateway merchant accounts (non-cash posts to the primary bank,
as before); IRD/CBMS e-billing approval and integration (invoices show PAN/VAT
from Settings and are not labelled IRD-approved); CCTV needs a MediaMTX/NVR
server; WhatsApp/SMS gateway URL for notifications; an Events/Banquets module.
