# Hotel & Restaurant Management: Audit and Implementation Plan

Audit date: 27 October 2026. Target: `hotel-management`. Reference: sibling `newraithane` working tree, including its uncommitted changes.

Implementation status: the preview, persistent room/reservation foundation, live guest folios, room-night/service charges, ledger-backed payments, checkout statements and housekeeping dispatch are implemented. See `docs/HOTEL_IMPLEMENTATION.md` for tested behavior, posting policy and remaining scope. The audit below records the original baseline; the full roadmap is not complete.

## 1. Executive finding

The hotel folder is currently a substantial restaurant POS application with a hotel expansion brief in `CLAUDE.md`. It does not yet implement the hotel operating model described in that brief. This is a product-completion project as well as a UI project.

Keep the existing restaurant, accounting, inventory and reporting foundations. Review and bring across the newer restaurant improvements as coherent features. Then build hotel-specific operations using the same visual language, with a new front-desk workspace rather than renaming restaurant tables into hotel rooms.

The design target is the restaurant's operational interface: white surfaces, restrained borders, clear typography, compact record tables, readable forms, consistent drawers and useful status chips. Its public marketing website has a separate visual system; that should inform the hotel's public website, not the staff workspace.

## 2. Scope and evidence limits

This is a source-code audit: route/file inventories, byte comparisons, selected diffs, schema/migrations, authentication, permissions, layouts, shared UI, reservation/order semantics, finance, HR and test infrastructure. No application code or database was changed for the audit. This document is the only intended addition.

No rendered browser walkthrough, production database inspection, full build, lint or test suite was performed. The hotel folder has no local `node_modules`; the restaurant folder does. Therefore visual findings describe implemented patterns and source-level gaps, not measured screenshots or certified runtime behavior. Existing features below mean code exists, not that every feature passed acceptance testing.

### Repository comparison

Counts include all files in the five listed directories; page and API counts are file-based, not unique business capabilities.

| Area | Hotel files | Restaurant files | Byte-identical shared files | Byte-different shared files | Restaurant-only files |
| --- | ---: | ---: | ---: | ---: | ---: |
| app | 337 | 347 | 283 | 54 | 10 |
| components | 117 | 119 | 96 | 21 | 2 |
| lib | 131 | 143 | 98 | 33 | 12 |
| migrations | 73 | 76 | 52 | 21 | 3 |
| tests | 60 | 69 | 43 | 17 | 9 |

There are no hotel-only files within these five areas. Hotel: 169 page files and 148 route-handler files. Restaurant: 177 page files and 150 route-handler files. This volume must not be mistaken for implemented hotel functionality.

Important correction to the raw counts: all 21 byte-different shared migration files are identical after normalizing CRLF/LF line endings. They are not 21 schema changes. Restaurant migrations 072–074 are actual additions.

The hotel working tree was clean before this document. The restaurant working tree contains many modified and untracked files. Its latest state cannot be recovered simply by copying a committed branch or cherry-picking without first recording the intended source snapshot.

## 3. What already exists and should be retained

| Foundation | Evidence | Hotel use |
| --- | --- | --- |
| Next.js 16.0.7, React 19.2.1, JavaScript, Tailwind 4 | `package.json` | Extend current stack; no framework rewrite |
| PostgreSQL production adapter, SQLite development fallback | `lib/db/index.js`, `lib/db/postgres.js` | PostgreSQL integration tests required for concurrency and migration behavior |
| Staff authentication with bcrypt and database session verification | `lib/auth/auth.js` | Extend identity and authorization for hotel staff |
| Configurable permissions for existing staff roles | `lib/permissions.js`, migration 038 | Starting point for dynamic roles; not a complete custom-role engine |
| Table/floor board, POS, KOT, kitchen, restaurant reservations | `components/tables/table-room-board.jsx`, `components/pos/admin-pos.jsx`, `lib/reservation-core.js` | Preserve dine-in operations and extend room-service integration |
| Bills, split payments, receipts, corrections | `components/billing/`, `lib/bills-admin.js`, `lib/print-receipt.js` | Reuse payment/print primitives, add hotel folios separately |
| Double-entry accounting and business-day controls | `lib/accounting.js`, `lib/business-days.js` | Extend one journal; avoid a second hotel balance engine |
| Inventory, recipes, purchases, suppliers, expenses | `app/admin/inventory/`, `lib/stock-movements.js`, `lib/purchases.js` | Reuse for restaurant and hotel consumables |
| Attendance register, departments, designations, payroll | migration 045, `lib/hrm.js`, `lib/payroll.js` | Extend into shifts, clock events, leave and hotel departments |
| Data tables, KPI/report components, forms, calendars, confirmations | `components/admin/data-grid.jsx`, `report-kit.jsx`, `components/ui/` | Core hotel component vocabulary |
| Unit, integration and desktop/mobile E2E infrastructure | `tests/`, `playwright.config.js` | Add hotel lifecycle coverage and protect restaurant regressions |

Existing users have a single legacy `role` field. PostgreSQL migration 001 and SQLite seed DDL constrain it to admin/cashier/waiter/kitchen. Orders link to restaurant tables and customers; table occupancy links to active orders and waiters. These are not hotel room assignments or stays.

## 4. Prioritized findings

Priority definitions: P0 = prerequisite or correctness blocker; P1 = required for daily hotel operations; P2 = expanded operations; P3 = advanced integration.

| Priority | Finding and evidence | Required action |
| --- | --- | --- |
| P0 | No hotel room/stay/folio/housekeeping module was found in app, lib or migrations. `CLAUDE.md` describes future requirements. | Implement a real hotel domain and complete workflows, not only dashboard widgets. |
| P0 | `users.role` and panel/login policies assume four restaurant roles. `MANAGED_ROLES` is waiter/cashier/kitchen. | Add role/group/permission data, ownership protections, route/API/resource checks and migration compatibility. |
| P0 | Restaurant reservations move through arrived/seated and link to tables. | Build hotel reservations with date-range inventory, stays and room assignments in separate tables. |
| P0 | No unified guest folio or restaurant-to-stay charge path. | Add immutable charge/payment/reversal records, exact-once posting and checkout reconciliation. |
| P0 | Existing business-day behavior was designed for restaurant work. | Define overnight stays, room-night posting and hotel audit separately from POS drawer closing. |
| P1 | Hotel screens and room inventory controls are absent. | Build front desk, room rack, reservation calendar, arrivals/departures, guest drawer and checkout. |
| P1 | Hotel shares most reference UI primitives already. | Reuse and standardize those primitives; spend design effort on hotel tasks and screen completeness. |
| P1 | Latest payroll, profitability, stock and billing changes are absent from hotel. | Port reviewed dependency groups and their tests, including migrations 072–074. |
| P1 | Existing live pages largely use polling, from 5 to 60 seconds in sampled workflows. | Add authorized event delivery for rooms, bookings, folios and tasks, with reconnect/refetch and polling fallback. |
| P1 | HR attendance is a manual daily register; no hotel shift/leave/self-service system was found. | Add clock events, shifts, leave approvals, self-service and manager/owner separation. |
| P1 | Public identity and metadata still describe Raithane restaurant. | Introduce property identity/settings and hotel marketing content; retain a restaurant section. |
| P1 | README and overview are stale: README calls UI future work and overview says Next 15 while package specifies 16. | Replace misleading completion claims, setup links, ports and module documentation. |
| P2 | No hotel maintenance/security/escalation workflow found. | Add work orders, room blocks, incidents, visitor logs and an owner inbox. |
| P3 | No OTA ingestion, inventory publishing or camera streaming subsystem found. | Add provider adapters and operational controls after core inventory is reliable. |

### Additional source-level quality work

- `components/ui/dialog.jsx` is a custom overlay. It does not itself implement dialog semantics, focus trapping/restoration or Escape handling. Replace or upgrade it centrally using accessible dialog primitives, then verify keyboard behavior.
- Root hotel layout instantiates Google Geist fonts without applying their generated class/variable. Restaurant has removed these font calls. Choose and apply a deliberate font strategy, including Devanagari, rather than retaining unused network/font work.
- Shared CSS defines theme tokens, but components also use literal white/gray styles. Standardize new hotel surfaces before advertising complete dark-mode support.
- `lib/order-types.js` normalizes object orders with no table into takeaway except delivery. Room service requires changes in normalization, SQL grouping, reports, kitchen labels and receipts, not merely another option in a select.
- Login currently constructs session token bytes from base64 JSON containing identity and time. Verification correctly requires a live session row; this is not the old token-forgery fallback. Replace generation with cryptographically random opaque tokens and review storage/expiry/revocation before expanding sensitive hotel access.
- Guest ID documents need private storage and authorized access. Existing menu/image publishing helpers are not a suitable access model for identity documents.
- CSP currently limits external connections/frames. Streaming, provider integrations and upload capture need explicit integration-specific configuration. Do not broaden all origins globally.
- The repository already has financial/POS/permission audit tables. Extend them with a consistent hotel event model and enforce append-only access for finalized/high-risk events; do not assume the current audit mechanisms make all future hotel records immutable.

## 5. Restaurant improvements to adopt

Use `newraithane` as a reviewed reference snapshot. Do not replace the whole hotel folder or copy database files, generated builds, uploads, secrets or demo records.

| Port as a coherent group | Main files/dependencies | Verification |
| --- | --- | --- |
| Monthly staff payroll and retry-safe payouts | migrations 072/073, `lib/payroll-months.js`, `payroll-payout.js`, `payroll-requests.js`, employees/payroll APIs, payroll drawer, expense salary entry | Partial payout, historic rates, advances, waivers, duplicate retries and funding reconciliation |
| Purchase/consumption/profitability reports | migration 074, `lib/purchase-sales-analysis.js`, `analysis-*`, inventory/recipe history modules, shared report component, four admin/cashier pages and report API | Filters, server permissions, saved costs, missing-cost display, exports and printing |
| Billing, stock, purchase and permission refinements | Changed billing/POS components and relevant bills, stock, purchases, report and access-policy modules | Settlement correction, duplicate submits, stock deltas and existing report totals |
| Visual and print refinements | Invoice, expense/purchase drawers, date/quantity controls, public components, font/layout changes | Desktop/mobile layout, readable forms, A4 and thermal output |

The new restaurant reports intentionally distinguish consumption-based gross profit from posted accounting profit. Retain that distinction in hotel reporting. Do not silently change the existing purchases-as-expenses policy during hotel integration.

Shared migration SQL differs only in line endings; retain applied historical migrations and add forward migrations for actual hotel changes. Confirm database-applied versions on an authorized staging copy before choosing final migration numbers.

## 6. UI direction and exact screen plan

### Staff workspace rules

- Use the restaurant's management UI as the baseline: pale neutral canvas, white panels, gray borders, roughly 12–16px panel corners, restrained shadows, Lucide icons, strong headings and muted supporting text.
- Keep the reference sidebar's grouped navigation and remembered expansion. Add hotel groups and permission-filtered role landing pages. Separate hotel floors from restaurant table floors in labels and data.
- One clear title/action row, one main filter row and a visible primary action per screen. Keep related actions in context menus or a detail drawer.
- Reuse `DataGrid` for searchable record lists and `report-kit` for analytical tables. Use room cards only for room operations; use charts where trends help a decision.
- Standardize page header, filter bar, status badge, empty/error/loading state, detail drawer, form section and sticky action footer. Save pending/error state and prevent duplicate submissions.
- Color must have a textual status/icon alongside it. Keep room operational status distinct from payment status and cleaning status.
- Desktop layouts must work at 1366px as well as larger monitors; tablets at about 768px; phones around 390px. Contain horizontal scrolling inside calendars/tables. Use mobile drawers/full-screen forms with visible actions and 44px touch targets.
- Use property-local time; retain existing AD/BS presentation utilities. Dates of stay are date-only values; actual check-in/out events are timestamps. Test this distinction explicitly.

### Screen inventory

| Screen | Main content and actions | Completion requirement |
| --- | --- | --- |
| Owner overview | Occupancy, room/F&B revenue, due balances, on-shift staff, arrivals/departures, incidents | Every number has an agreed definition and drills into matching source records |
| Front desk / room rack | Floor/category groups, status legend/counts, date selector, search, room detail drawer | Book, check in, extend, move, check out and block room with permission checks |
| Booking calendar | Room rows, date columns, reservations/blocks, today marker, filters | New booking, edit, reschedule and cancel; conflict checks on every write; drag only after form workflow is reliable |
| Reservation list/detail | Source, dates, guest, rooms, deposit, status and activity timeline | Walk-in/direct/multi-room reservations, cancellation/no-show and printable confirmation |
| Arrivals / in-house / departures | Task-focused lists with date/time, assigned room, balance and readiness | Staff can finish each task without searching across unrelated screens |
| Check-in flow | Find/create guest, private ID, occupancy, room readiness, rate/meal plan, deposit, keys | Atomic stay creation; dirty/blocked room and inventory conflicts handled visibly |
| Guest profile | Contact details, companions, stay history, preferences and authorized documents | Reuse customer links where useful without exposing private IDs to restaurant staff |
| Stay/room detail | Guest, dates, assigned room, service requests, meal plan, folio summary, history | Extend, move room, add service, view timeline and apply permitted overrides |
| Guest folio / checkout | Dated charge lines, restaurant links, taxes, deposits, payments, reversals and due balance | Preview invoice, split payment, authorized transfer/refund, finalize and print |
| Housekeeping board/mobile | Dirty/in-progress/inspection/ready tasks, floor, urgency, assignee, notes/photos | Claim/assign, clean, inspect, report damage and mark DND; room readiness updates reliably |
| Maintenance | Open/in-progress/resolved work orders, priority, room block and assignee | Prevent selling blocked dates; separate repair completion from room readiness |
| Room service | Occupied-room lookup, guest verification, meal entitlement, existing POS menu/KOT | Deliver, charge folio and track tray clearance without creating a takeaway sale |
| Staff / roles / groups | Worker profile, department/group, role builder, granular permissions | Owner safeguards, no self-approval and no granting permissions actor lacks |
| My work / HR | Clock in/out, own shift/calendar, leave request and assigned tasks | Worker sees only own HR records; manager leave goes to owner |
| Night audit | Unposted room nights, unsettled folios, overdue departures, discrepancies, close summary | Preview exceptions, resolve, post once and close with a recoverable audit trail |
| Hotel reports | Occupancy, ADR, RevPAR, room revenue, sources, receivables, housekeeping | Date scope and drilldown/export totals agree; unavailable values are not fabricated |
| Settings | Property identity, floors/types, amenities, rates, tax rules, check-in/out, document numbering | No code changes needed for routine property setup |
| Public hotel website | Rooms, genuine photos, amenities, restaurant, offers, location and inquiry flow | Branding and room content are hotel-specific; label inquiry versus confirmed booking accurately |
| Later: integrations/security | OTA sync/conflicts, cameras, visitor logs and escalation inbox | Clear offline/stale/error states and role-scoped access |

### First visual milestone

Build five reviewable, responsive screens with explicitly marked sample data: front-desk overview, room rack, reservation calendar, folio/checkout and housekeeping. Include occupied, overdue, dirty, blocked, empty and failed-loading examples. Compare rendered screenshots with the restaurant UI before expanding the design to other modules. Sample data must never be presented as live operational data.

## 7. Hotel domain rules that must be settled in implementation

1. Model reservation, actual stay, room assignment, housekeeping and maintenance separately. A booking can exist before a room number is allocated; a room move must preserve the same stay and folio.
2. Use half-open date ranges `[arrival, departure)` for room-night inventory. Define day-use/early-arrival rules separately. Back-to-back reservations are permitted only when the readiness workflow allows check-in.
3. Serialize inventory writes and enforce database constraints for assigned-room overlap. For unassigned room-type bookings, lock the type/date inventory and reject capacity overflow. Frontend conflict warnings alone are insufficient.
4. Keep occupancy, cleanliness and serviceability as separate facts. Due-out/overdue are computed badges, not permanent replacements for occupancy. A repaired room may still need cleaning and inspection.
5. Capture agreed nightly rate, meal plan and tax snapshots. Editing tomorrow's tariff must not rewrite yesterday's charges. Support authorized rate overrides, extra beds, early/late charges and reasons.
6. A restaurant charge must link to an active eligible stay, verify the guest and respect charge privileges. Room number alone is unsafe because rooms are reused by different guests.
7. Select one restaurant-to-folio accounting policy. If the POS already recognizes revenue, folio transfer only moves receivables; checkout must not recognize that revenue again. Test food tax and room tax separately.
8. Deposits are tracked separately from revenue and allocated/refunded with an audit trail. Decide posting/recognition policy with the business accountant before finalizing hotel journals.
9. Room nights, folio charges, restaurant transfers, payments and job retries require unique source/idempotency keys. Reversals refer to original entries; finalized invoices are corrected through explicit adjustments.
10. Checkout atomically closes the stay/settlement under the selected credit policy, releases occupancy and creates one cleaning task. Notification delivery happens after commit and can retry without another checkout.
11. Run a hotel night audit explicitly; POS drawer close must not silently check out guests or cancel future hotel reservations. Open overnight stays remain active across business dates.
12. Begin with one property, but give new hotel tables a property key. Multi-property permissions and consolidated accounts are a separate expansion, not an assumed completed feature.

## 8. Proposed database additions and relationships

This is a logical schema proposal, not migration-ready DDL. Existing restaurant tables remain. Final migration SQL must include constraints, indexes, backfill and PostgreSQL/SQLite compatibility decisions.

| Domain | Proposed tables and important fields |
| --- | --- |
| Property/rooms | `hotel_properties` (name, timezone, currency); `hotel_floors`; `hotel_room_types` (capacity); `hotel_rooms` (property, floor, type, unique room number, active); amenities and room/type amenity links |
| Rates | `hotel_rate_plans` (meal plan, currency); `hotel_rate_rules` (type, dates, occupancy, price); `hotel_booking_nights` (reservation-room, stay date, price/tax snapshots) |
| Guests | `hotel_guests` (optional existing customer link, contacts); `hotel_guest_documents` (private storage key, document metadata, retention/access metadata) |
| Reservations | `hotel_reservations` (property, source/external ref, arrival/departure, status, lead guest); `hotel_reservation_rooms` (type, occupants); `hotel_reservation_guests`; expiring inventory holds if needed |
| Stays/inventory | `hotel_stays` (reservation-room, actual times, status); `hotel_room_assignments` (stay, room, start/end); `hotel_room_blocks` (room, interval, reason); `hotel_room_status_events` |
| Folios | `hotel_folios` (stay/reservation, currency, status); `hotel_folio_entries` (charge/payment/adjustment, source reference, amounts/tax, reversal link, journal link); `hotel_deposits`; `hotel_deposit_allocations`; `hotel_invoices` and immutable invoice lines |
| POS bridge | `hotel_restaurant_charges` (unique bill/transfer source, stay/folio link, transfer/reversal state); extend orders with nullable stay/room-service context and update all order-type consumers |
| Operations | `hotel_housekeeping_tasks` and task events (room, checkout source, priority, assignee, inspection); `hotel_maintenance_tickets`; `hotel_service_requests`; `hotel_tray_tasks` |
| Access | `roles`, `permissions`, new role-permission bindings or safely migrated existing `role_permissions`, `user_roles`, `staff_groups`, `staff_group_members`, group-role bindings, `audit_events` |
| HR | `staff_shifts`, `staff_shift_assignments`, `staff_clock_events`, `staff_leave_requests`, approval history and attendance adjustments; integrate existing users/attendance/payroll rather than duplicate employees |
| Reliability | `outbox_events`, `background_jobs`, `notification_deliveries`, `hotel_night_audit_runs` and audit-run items with uniqueness per property/business date |
| Later integrations | `hotel_channel_connections`, external room/rate mappings, `hotel_channel_events`, sync runs/conflicts; `security_cameras`, `security_incidents`, visitor/vehicle/patrol logs |

Core relationship map:

```text
property -> floors / room types -> rooms
guest -> reservation -> reservation rooms -> nightly rate snapshots
reservation room -> stay -> timed room assignments -> room
stay -> folio -> entries -> existing journal entries/lines
restaurant bill -> unique room-charge transfer -> folio entry
checkout -> housekeeping task -> cleaning/inspection events
maintenance ticket -> dated room block
users -> user roles / groups -> permission bindings
business event -> transactional outbox -> event delivery / retryable jobs
```

Constraints: property-scoped identifiers; end after start; room assignment exclusion/locking; one active room occupant under the chosen occupancy model; unique external channel references; unique charge/job source keys; foreign keys and indexes on dates/status/assignee/source; explicit deletion/retention policy. Use exact decimal money for new hotel records and define rounding at journal boundaries without silently changing legacy numeric columns.

For dynamic RBAC, do not immediately remove the legacy role column. Backfill role memberships, add compatibility handling for existing restaurant paths, migrate all checks, then retire legacy assumptions deliberately. Existing admin-to-owner mapping needs an explicit migration decision so no user gains owner powers accidentally.

## 9. Backend, events and jobs

Keep Next route handlers thin. Put business transactions in `lib/hotel/` services and repositories. Reuse the database transaction adapter, identity, shared validation and existing accounting entry points. Use consistent validation errors, pagination, resource permissions and request keys.

Proposed endpoint groups:

- `/api/hotel/dashboard`, `/api/hotel/room-rack`, `/api/hotel/availability`
- `/api/hotel/rooms`, `/room-types`, `/floors`, `/rate-plans`, `/room-blocks`
- `/api/hotel/reservations` and `/:id/{confirm,cancel,no-show}`
- `/api/hotel/guests`, private `/:id/documents`
- `/api/hotel/stays` and `/:id/{check-in,extend,move-room,check-out}`
- `/api/hotel/folios/:id` and `/entries`, `/payments`, `/transfers`, `/refunds`, `/finalize`
- `/api/hotel/housekeeping`, `/maintenance`, `/service-requests`, `/tray-tasks`
- `/api/hotel/reports`, `/night-audits`, `/settings`
- `/api/staff/roles`, `/groups`, `/shifts`, `/attendance`, `/leave`, `/me/*`
- `/api/events` for authorized server-sent events; `/api/webhooks/ota/:provider` for later provider ingestion

Use GET for reads and explicit mutation methods for transitions. Scope every resource by property and permission. Workers must not gain financial or guest-document access through broad operational APIs.

Event categories: `room.updated`, `reservation.updated`, `stay.updated`, `folio.updated`, `housekeeping.assigned`, `maintenance.updated`, `staff.clocked`, `escalation.created`, `channel.conflict`. Never broadcast private ID documents, camera credentials or salary details to a general staff stream. Clients reconnect with a cursor where supported and refetch authoritative state after gaps.

Recommended initial job architecture: a database-backed job/outbox worker with locked claims, bounded retries, backoff, deduplication, failure visibility and an operator retry action. Keep it in a separate supervised process suitable for the deployment host. Add Redis/another queue only if the actual host and load justify it.

Jobs: room-night posting, audit preparation, hold expiry, cleaning dispatch notifications, overdue reminders, provider sync/reconciliation and approved document-retention work. No job should depend on a staff member keeping a browser tab open.

## 10. Phased delivery and acceptance gates

These are dependency-ordered milestones, not promises of calendar dates. Estimate after the reference snapshot, business rules and five-screen prototype have been reviewed.

| Phase | Work | Exit gate |
| --- | --- | --- |
| 0. Baseline and reference review | Record intended restaurant working tree; inspect target deployment/database version; set up isolated demo DB; capture representative reference screenshots; document rule decisions | Repeatable setup, preserved restaurant behavior, accepted feature and design scope |
| 1. Restaurant parity and UI foundation | Port coherent restaurant features/tests; migrations 072–074; shared page/form/status/drawer patterns; property identity; five-screen visual prototype | Restaurant regression checks pass; hotel screens render clearly at desktop/tablet/mobile sizes |
| 2. Hotel schema and access | Property/rooms/types/rates/guests; dynamic roles/groups; anti-escalation; private documents; audit/outbox foundation | Receptionist/cleaner/manager/owner permissions verified on APIs and direct URLs; migration tested on populated copy |
| 3. Reservations and front desk | Availability, holds, booking calendar, reservations, arrivals, check-in, moves/extensions, in-house/departure lists | Concurrent booking tests cannot oversell; multi-room booking and room moves preserve history |
| 4. Folios and room service | Nightly charges, deposits, adjustments, POS transfers, split payments, checkout invoices | Full stay reconciles to journal; retries never duplicate money; food/room revenue not counted twice |
| 5. Housekeeping and maintenance | Checkout dispatch, worker mobile tasks, inspection, DND, damage, room blocks, tray clearance, live updates | One checkout creates one task; dirty/blocked rooms cannot be checked in; reconnect shows correct state |
| 6. Audit and management reporting | Night audit, room/F&B segmentation, occupancy/ADR/RevPAR, receivables, cash exceptions, CSV/A4/thermal outputs | Room-night rerun safe; business-day rollover retains stays; drilldowns match financial sources |
| 7. HR and oversight completion | Shift/clock/leave self-service, owner/manager approvals, escalation inbox, visitor/security logs | Manager cannot approve own leave or alter owner; attendance effects on payroll explicitly approved/tested |
| 8. Provider integrations and public hotel website | OTA adapters/conflicts, notifications, camera gateway and scoped viewer; public rooms/inquiry content | Provider sandbox/replay and failure recovery verified; credentials private; stale feeds/sync clearly reported |
| 9. Pilot and release | Data import rehearsal, staff UAT, backup/restore, permissions review, performance, runbooks | Staff completes a full hotel day plus overnight rollover on staging; restore and rollback paths proven |

A core hotel pilot can follow phases 0–6 plus the staff access needed for those workflows. The full brief additionally needs phases 7–9. Public hotel content can proceed alongside later core work once property content is supplied. OTA/CCTV should not block proving the core booking-to-checkout lifecycle.

## 11. Required acceptance scenarios

1. Book room type -> take deposit -> allocate clean room -> check in -> post nights -> room-service KOT -> charge folio -> partial/split settlement -> checkout -> cleaning -> inspection -> ready.
2. Two receptionists attempt the final available room concurrently; one succeeds, one receives a clear conflict, and no partial deposit/stay is left behind.
3. Back-to-back bookings, early arrival, late departure, cancellation/no-show, extension collision, out-of-order dates, multi-room party and room move all preserve correct inventory.
4. Duplicate requests and worker retries produce one room-night charge, one restaurant transfer, one payment and one cleaning task.
5. Dirty room stays unsellable for immediate check-in until required inspection; maintenance resolution does not silently mark it clean.
6. A closed folio, old occupant or changed room number cannot receive a new room-service charge without a permitted correction flow.
7. Deposit application/refund, bill reversal and room-charge reversal reconcile exactly; room and restaurant revenue totals agree with journal policy.
8. Receptionist cannot edit roles; cleaner cannot view financial/ID details; manager cannot modify owner or approve self; revoked access stops working on direct API calls.
9. Night audit at the property-local business boundary is rerunnable after failure and does not check out an overnight guest or double-charge a night.
10. Keyboard-only dialogs, clear validation, empty states, network errors, loading, unsaved changes, small-screen calendars and print layouts are checked visually.
11. Existing dine-in, takeaway/delivery, KOT, paid-bill corrections, inventory, payroll, drawer close and restaurant reports continue to pass after hotel changes.
12. PostgreSQL integration tests prove inventory locking and money transactions. SQLite tests alone are insufficient for production claims.

Build/lint, focused unit/integration tests and desktop/mobile E2E checks are phase gates. Use isolated test databases and explicit demo fixtures, never the restaurant's working data. Verify accessible focus behavior and print output in the browser, and physical thermal output when hardware is available.

## 12. Integration limits and decisions to confirm during implementation

- OTA provider access and capabilities require provider-specific verification. An iCal import alone must not be presented as complete real-time, bidirectional rate/inventory synchronization. Plan conflict review, reconciliation and manual fallback.
- Camera viewing needs a browser-compatible gateway and supported device protocol. Never expose raw camera credentials in client configuration. PTZ is an optional capability per device, with a separate permission.
- WhatsApp/SMS sending needs the selected provider, approved configuration and delivery status. Checkout/cleaning must still work when notifications fail.
- The expansion brief mentions GST/UPI, while the existing application is Nepal-oriented with VAT and local payment methods. Implement configurable tax/payment rules; confirm actual property requirements before coding tax behavior. This audit makes no legal/tax compliance certification.
- Confirm room count/floors/types, check-in/out policy, meal plans, deposits/cancellation rules, owner account mapping, rate/discount authority, room charging privileges, night-audit cutoff, credit checkout, document retention and intended hosting capacity.

## 13. Recommended first implementation batch

Start with the reference snapshot and a small shared UI foundation, then show front desk, room rack, booking calendar, folio/checkout and housekeeping with marked fixtures. In parallel within the implementation sequence, settle room-state, inventory, RBAC and folio rules before database writes are connected. Once that model and design are accepted, complete one real booking-to-checkout-to-cleaning lifecycle before adding advanced modules.

Success means staff can run the hotel through complete, consistent screens while the restaurant continues to work. More menu entries and dashboard cards alone will not meet that goal.
