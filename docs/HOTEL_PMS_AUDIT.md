# Hotel PMS completion audit

Audit date: 2026-10-29. Baseline: commit `3673a43` on branch `hotel-pms-completion`.
Baseline tests: 388 unit tests pass (SQLite), PostgreSQL integration test passes
(migrations 001–086 on PostgreSQL 17).

Status words: COMPLETE, FUNCTIONAL BUT INCOMPLETE, UI ONLY, API PARTIAL,
DATABASE ONLY, LEGACY, BROKEN, NOT IMPLEMENTED.

## Initial state (before this work)

| Module | UI | API | DB | Accounting | Permissions | Tests | Status |
|---|---|---|---|---|---|---|---|
| Front desk | Arrivals, departures, in-house lists, KPIs | `/api/hotel` command bus | `hotel_reservations` | n/a | `hotel.view`, `hotel.front_desk` | unit | FUNCTIONAL BUT INCOMPLETE: no late arrivals, no-show queue, outstanding folios, OOO list |
| Reservations | Calendar + list, booking modal | `book`, `change_dates`, `cancel` | one row per room = reservation + stay + room assignment | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: no tentative/guaranteed, adults/children, company, agent, segment, guarantee, notes, special requests, manual no-show |
| Availability | Client filter + server `roomConflict` | inside the property-row lock | index on room/dates | n/a | n/a | unit | COMPLETE for physical rooms (no room-type inventory, no unassigned bookings) |
| Multi-room | Multi-select rooms | `book` with several rooms | `group_id` text only | n/a | yes | unit | API PARTIAL: no master record, no payer choice, no add-room-to-group |
| Room move | Select room | `move` | room_id overwritten | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: no reason, no history, no rate decision |
| Room rack / room detail | Rack by floor, room modal | snapshot | `cleaning_status`, `blocked` | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: no out-of-service, DND, folio balance in detail |
| Guest profiles | List, profile, documents | `/api/hotel/guests` | `hotel_guests`, documents | n/a | `hotel.front_desk` | unit | FUNCTIONAL BUT INCOMPLETE: no restaurant/room-service spend, no guest 360 |
| Folios | Folio page, charge/payment/refund | `charge`, `payment`, `refund`, `post_nights` | `hotel_folio_entries` (charge/payment, room/service) | journals 1320/4030/4040/2020 | `hotel.folios` | unit | FUNCTIONAL BUT INCOMPLETE: no source types, no reversals, no windows, no transfers, refunds stored as charges |
| Deposits | Deposit before arrival | `payment` on confirmed | folio payment row | credited to 1320 (no liability) | yes | unit | LEGACY accounting: deposit not a liability |
| Restaurant charge to room | Admin/cashier POS | pay route `room` allocation | folio row `restaurant-bill:<id>` | revenue once via sale journal (Dr 1320) | `pos.charge_to_room` | unit | FUNCTIONAL BUT INCOMPLETE: no table/order link to stay, no corrections, no package allowance |
| Meal plans | Rate plan name + supplement | `plan` | `hotel_rate_plans` | supplement inside room revenue | `hotel.setup` | unit | UI ONLY for entitlement (label shown, no allowance logic) |
| Room service | QR room-service tables | QR ordering | `tables.hotel_room_id` | sale journal | yes | none | FUNCTIONAL BUT INCOMPLETE: no delivery states, not separated in analytics |
| Restaurant table reservation link | none | none | none | n/a | n/a | none | NOT IMPLEMENTED |
| Checkout | Folio checkout | `checkout` | statement snapshot | requires zero balance | yes | unit | FUNCTIONAL BUT INCOMPLETE: no deposit application, no group checkout |
| Night audit | Button on front desk | `night_audit` | `hotel_night_audits` | room nights via folio | `hotel.folios` | unit | FUNCTIONAL BUT INCOMPLETE: idempotent per date, but no pre-audit checks and no package accrual |
| Housekeeping | Kanban board | `clean`, `assign_task` | tasks | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: no stayover/DND, no turnaround report |
| Maintenance | Ticket list | `report_issue`, `ticket_update` | tickets | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: 3 states; resolving makes room sellable immediately |
| Laundry | none | none | none | none | none | none | NOT IMPLEMENTED |
| Minibar | Free-text form | `minibar` | folio charge | 4040 | yes | unit | FUNCTIONAL BUT INCOMPLETE: no catalog, no stock movement |
| Accounting mapping | n/a | n/a | 1320, 4030, 4040 | yes | n/a | unit | FUNCTIONAL BUT INCOMPLETE: no deposit liability, package, laundry, minibar accounts |
| Hotel reports | Business report | `/api/admin/business-report` | ledger + folios | ledger based | owner/manager | unit | FUNCTIONAL BUT INCOMPLETE: ADR/RevPAR/P&L only; no operational report set |
| Combined / GM dashboard | Overview page | `/api/admin/overview` | ledger + snapshot | ledger based (no double count) | owner/manager | none | FUNCTIONAL BUT INCOMPLETE |
| Owner alerts | Inbox | yes | `owner_alerts` | n/a | yes | unit | FUNCTIONAL BUT INCOMPLETE: rate override only for hotel |
| Booking channels | Channels page | webhook + iCal | OTA tables | commission not posted | yes | unit | FUNCTIONAL BUT INCOMPLETE: no provider adapters (no credentials) |
| Events / banquets | none | none | none | none | none | none | NOT IMPLEMENTED (no module exists in this repository) |
| Security desk | Page | yes | `security_log` | n/a | `hotel.security` | unit | COMPLETE for gate/visitor/patrol/incident log |
| CCTV | Grid, PTZ | yes | cameras | n/a | `cctv.*` | unit | FUNCTIONAL; needs a MediaMTX server (external) |
| Global search | none | none | n/a | n/a | n/a | none | NOT IMPLEMENTED |
| Performance | snapshot loads every booking and folio row | | | | | | needs bounding |

## Key findings

- The reservation row is one room's stay. Folio rows key on that row (`reservation_id`), not
  on room number, so charges already follow the stay through a room move.
- Restaurant charge to room is correct accounting: the sale journal debits 1320 and credits
  4010 once; the folio row has no journal of its own; folio payment clears 1320.
- Revenue in reports comes from income accounts, so the combined dashboard does not double
  count a restaurant bill moved to a folio.
- Booking writes take a lock on the property row (PostgreSQL `FOR UPDATE`, SQLite queued
  transactions), which prevents concurrent double booking.
- No Events/Banquets module, laundry, global search, or restaurant-to-stay link exists.
- No Indian GST/CGST/SGST terms exist in the code; tax is a configurable percentage.
