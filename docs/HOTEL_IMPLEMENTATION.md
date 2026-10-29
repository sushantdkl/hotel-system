# Hotel implementation progress

Phase status and follow-ups: see `docs/ROADMAP.md`.

## Phase 10: hotel pages and room categories (28 October 2026)

- **Navigation**: every hotel section is its own sidebar entry (Front desk, Room rack, Reservations, Guest folios, Guests, Housekeeping, Maintenance, Booking channels, Rooms & categories, Hotel settings), defined once in `components/hotel/pages.js` with its permission; the in-page tab strip is gone. Each page has its own header; "New reservation" shows on front desk, room rack, reservations and guests. Opening a hotel URL from the restaurant workspace switches the sidebar to Hotel. Hotel staff see only pages their permissions allow.
- **Live by default**: the hotel opens on saved records for everyone. Admins can open the sample design preview from the footer link; staff never see it.
- **Room categories** (`hotel_room_types`, Rooms & categories page): name, nightly price, max guests, beds, amenities, description, room count. Add one room (category fills price/capacity unless overridden) or a range (e.g. 101–110 on floor 1, optional prefix; existing numbers skipped; up to 100). Renaming a category renames it on its rooms and seasons; "apply price to rooms" updates room prices (bookings keep theirs). A category with rooms cannot be deleted. Rooms created earlier get categories automatically.
- **Hotel settings** keeps property/tax, seasons & rate plans and room-service QR.
- Schema: `085_room_categories.sql`. Code: `lib/hotel/categories.js`, `components/hotel/room-setup.jsx`, `components/hotel/pages.js`. Tests: `tests/unit/hotel-categories.test.js`; e2e specs use `tests/e2e/hotel-nav.js` to open pages from the sidebar.

## Phase 9: custom roles, room-service QR, online check-in (28 October 2026)

- **Custom roles** (Staff Roles & Permissions): owner or manager creates a role (e.g. Bellboy) from a base role; it starts with the base role's permissions. Users keep `users.role` = base role (portal, sign-in side) and `users.custom_role` = role key; every permission check uses `permissionRole(user)`. Managers can edit custom roles only; built-in roles stay owner-only. A role with staff cannot be deleted. Staff form lists custom roles; the login screen shows the custom name.
- **Room-service QR** (Hotel setup → Room service QR): one restaurant table per room ("Room 101", section Room service, `tables.hotel_room_id`) with its QR code; print from Table Management. Orders go through normal QR ordering, are refused unless a guest is in-house, and note the guest name. Settle with Charge to room.
- **Online check-in**: reservation → "Create online check-in link" → `/checkin/<token>` where the guest confirms name, phone, email, nationality, ID type/number, address, arrival time and optional ID photo. Updates the guest profile, adds the document, marks the stay "Checked in online" with ETA (shown on arrivals). Valid only while confirmed and before departure; rate limited.
- Schema: `084_custom_roles_guest_self_service.sql`. Code: `lib/permissions.js` (custom roles), `lib/hotel/room-service.js`, `lib/hotel/precheckin.js`, `/api/public/checkin/[token]`, `/api/hotel/room-service`. Tests: `tests/unit/phase9-self-service.test.js`.

## Phase 8: CCTV (28 October 2026)

- **Setup** (`/admin/cctv` → Setup, owner/manager): name, area (Lobby, Reception, Kitchen, Cash Counter, Restaurant, Corridors, Gate, Parking, Other), RTSP source, display order, optional ONVIF PTZ (service URL, user, password, profile token). Each camera gets a stable MediaMTX path `cam-<id>`. **Push to MediaMTX** creates/replaces each path via `POST /v3/config/paths/replace/<path>` (`sourceOnDemand`); **Check status** reads `/v3/paths/get/<path>`.
- **Viewing**: grid 1×1 / 2×2 / 3×3 / 4×4, area filter, fullscreen per tile, status dot. Each tile embeds MediaMTX’s WebRTC player at `CCTV_STREAM_BASE_URL/<path>/`; the middleware adds that origin to CSP `frame-src`. Viewers never receive source URLs or passwords.
- **PTZ**: per-tile **PTZ** button shows a pad (pan/tilt/zoom). The server sends ONVIF `ContinuousMove` with a WS-Security UsernameToken digest, waits 0.5 s, then `Stop`.
- **Access**: `cctv.view` (watchman on by default) and `cctv.ptz_control` (off by default); admin/manager always. Watchman sidebar has CCTV.
- **Links**: the manager’s Alert owner form and the watchman’s emergency form can pick a camera; the owner inbox shows **View camera**, opening `/admin/cctv?camera=<id>` at 1×1.
- Env: `CCTV_STREAM_BASE_URL`, `MEDIAMTX_API_URL`, optional `MEDIAMTX_API_USER` / `MEDIAMTX_API_PASS`. Schema: `083_cctv.sql`. Code: `lib/cctv.js`, `/api/cctv`, `/api/cctv/[id]/ptz`, `app/admin/cctv/page.jsx`. Tests: `tests/unit/cctv.test.js`.

## Phase 7: OTA and channel sync (28 October 2026)

- **Channels** (Hotel → Channels; setup needs `hotel.setup`, the queue and log need `hotel.front_desk`): name, commission %, active/paused, secret webhook token (copy / replace).
- **Webhook** `POST /api/webhooks/ota/<channelId>` with header `x-ota-token: <token>` (or `?token=`), body:
  `{ "event": "new|modified|cancelled", "external_id": "...", "room": "101" or "room_type": "Deluxe", "guest": { "name", "phone" }, "arrival": "YYYY-MM-DD", "departure": "YYYY-MM-DD", "guests": 2, "total_amount": 7000, "prepaid": true }`.
  New: requested room or first free room of the type; guest profile matched/created; nightly rate = total ÷ nights (else tariff + seasons); source = channel name; commission and prepaid recorded in `hotel_ota_bookings`. Repeats are idempotent per (channel, external_id). Modified: dates/room updated if free. Cancelled: cancelled if confirmed and the folio is empty. Anything else (overbooking, unknown room, checked-in guest, money on folio, past arrival) goes to the **conflict queue** (HTTP 200, `outcome: conflict`) with Retry / Dismiss. Every event is in the sync log.
- **iCal**: per room and channel, an import URL (fetched on "Sync calendars now" or by cron at `POST /api/webhooks/ota/ical-sync` with `x-sync-token: $OTA_SYNC_TOKEN`) and a private export URL `/api/ical/<token>.ics` (booked nights + out-of-order, no guest data) for the OTA to import. Imported events create/modify bookings; events that disappear are cancelled; exact echoes of our own bookings are skipped.
- Business report shows OTA bookings and commission for arrivals in the range.
- Schema: `082_ota_sync.sql`. Code: `lib/hotel/ota.js`, `/api/hotel/ota`, `/api/webhooks/ota/*`, `/api/ical/[token]`, `components/hotel/channels.jsx`. Tests: `tests/unit/hotel-ota.test.js`.

## Phase 6: housekeeping dispatch, maintenance and security (28 October 2026)

- **Roles**: `maintenance` (lands on Hotel → Maintenance; `hotel.view` + `hotel.maintenance`) and `watchman` (lands on `/admin/security`; `hotel.security` only, no guest data). Migration `081_operations.sql` widens the role CHECK; SQLite rebuilds `users` when its CHECK lacks any role in `lib/roles.js` (`ROLE_CHECK_SQL`).
- **Cleaning dispatch** (`createCleaningTask` in `lib/hotel/operations.js`, used by checkout, room move and readiness changes): assigns a clocked-in housekeeper with the fewest open tasks, then one already on that floor; High priority + "URGENT · next arrival today" when a confirmed arrival for today exists. Front desk can reassign on the board; housekeepers can filter "My tasks".
- **Notifications** (`lib/notifications.js`, `staff_notifications`): assignment and maintenance events notify staff in-app (badge on "My HR & notifications", list on `/staff`). After each hotel command commits, undelivered notifications are POSTed to `NOTIFY_WEBHOOK_URL` as `{ to: phone, title, body, link }` (best effort; errors stored per notification).
- **Minibar** (`minibar` command, housekeeping or folios permission): posts "Minibar · item xN" as a taxed service charge to the in-house guest of that room; rejected once the guest has checked out.
- **Maintenance tickets** (`report_issue` / `ticket_update`, Maintenance tab): from housekeeping, maintenance or front desk; priority, optional "take room out of order" (not allowed for occupied rooms), optional photo (JPG/PNG/WebP ≤ 2 MB, private). Maintenance staff are notified, start work and resolve with a note; resolving unblocks the room unless another open ticket still blocks it.
- **Security desk** (`/admin/security`, `security_log`): visitor / vendor / guest vehicle check-in and check-out, patrol rounds, incidents, "inside now" list, daily log; emergency button sends an urgent/critical Security alert to the owner inbox and logs an incident.
- Code: `lib/hotel/operations.js`, `lib/notifications.js`, `lib/security.js`, `/api/notifications`, `/api/security`, `/api/hotel/tickets/[id]/photo`. Tests: `tests/unit/hotel-operations.test.js`.

## Phase 5: rates, night audit and business reporting (28 October 2026)

- **Seasons and rate plans** (Hotel setup): seasons adjust the room tariff by a percentage for a date range, for all rooms or one room type (room-type season wins, then latest start). Rate plans add a per-night supplement (e.g. Half board). Each booking snapshots one price per night in `nightly_rates_json`; posting, deposits caps and the folio use those prices. Changing seasons or plans never re-prices existing bookings. Rate override still sets one flat rate.
- **Night audit** (Front desk panel, `night_audit` command, `hotel.folios`): once per hotel date; posts every due room night for in-house stays, marks confirmed bookings with an earlier arrival as no-shows (status cancelled, `no_show = 1`) when their folio is empty and lists the rest for review, and stores occupancy, overstays and the night's room revenue in `hotel_night_audits`. Requires the business day/session to be open when nights need posting.
- **Business report** (`/admin/business-report`, admin/manager): restaurant / hotel / shared / combined P&L from the ledger; hotel occupancy, ADR, RevPAR, room revenue, no-shows; daily table; CSV download; print / save as PDF. Expense categories now have a business (Restaurant / Hotel / Shared) under Finance → Expense Categories; purchases and wastage count as restaurant; voids follow the original posting.
- **Attendance payroll** (`/admin/hrm/payroll-attendance`, `payroll.view`): per staff member for a month: present / half / leave / absent, paid days, hours, overtime, base pay, overtime pay, advance due and suggested net. Read-only.
- Schema: `080_rates_night_audit.sql`. Code: `lib/hotel/rates.js`, `lib/hotel/night-audit.js`, `lib/business-report.js`, `payrollAttendance` in `lib/staff-hr.js`. Tests: `tests/unit/phase5-reports.test.js`.

## Phase 4: front desk depth (28 October 2026)

- **Guest profiles** (`hotel_guests`, Guests tab): name, phone, email, nationality, ID type/number, address, notes, VIP, blacklisted. Every booking links a profile (`hotel_reservations.guest_id`): explicit choice, else same name + phone, else a new profile. Blacklisted guests cannot be booked. Editing a profile updates the name/phone snapshot on unfinished stays.
- **ID/KYC documents** (`hotel_guest_documents`): JPG/PNG/WebP/PDF up to 2 MB, stored base64 in the database (never under `public/`), served by `/api/hotel/guest-documents/[id]` with `no-store`, only with `hotel.front_desk`. Upload/delete are audited.
- **Group bookings**: the booking form takes several rooms; all are created in one transaction with a shared `group_id`, or none if any room is unavailable.
- **Room move** (`move`): confirmed or in-house; target must be free for the rest of the stay, unblocked, big enough, and (in-house) ready. The vacated room becomes dirty with a housekeeping task. Agreed rate unchanged.
- **Extend / shorten** (`change_dates`): conflict-checked; in-house stays keep their arrival, cannot end before today or on/before an already-posted night.
- **Deposits and refunds**: payments on a confirmed reservation are advance deposits (capped at the reserved stay value). `refund` pays out a credit balance (Dr 1320, Cr Cash/Bank, source `hotel_payment` so drawer reconciliation nets it). Cancelling requires a zero folio balance: refund, or post a cancellation fee as a charge.
- **Rate override**: optional nightly rate at booking. A rate different from the tariff needs `hotel.rate_override` (off for receptionists), writes a `rate_override` audit event and a medium owner alert.
- Schema: `079_hotel_front_desk.sql`. Code: `lib/hotel/guests.js`, `lib/hotel/service.js` (`book`, `move`, `change_dates`), `lib/hotel/folios.js` (deposits, `refund`), `/api/hotel/guests*`, `components/hotel/guests.jsx`. Tests: `tests/unit/hotel-front-desk.test.js`.

## Phase 3: staff HR self-service and owner alerts (28 October 2026)

- `/staff` (every role; linked from admin, cashier and hotel sidebars and the waiter/kitchen headers): clock in/out with handover note, monthly attendance (present / half day / leave / absent, hours, overtime over 8 h/day), leave requests (Sick, Casual, Emergency) with status and cancel.
- Clocking in marks the HRM attendance register `present` unless someone already marked that day. Approved leave marks each day `leave`.
- `/admin/hrm/leave`: who is on duty now, pending/all leave requests with a coverage warning (other staff of the same role off on overlapping days), approve/reject with note.
- Rules (`canDecideLeave`): nobody decides their own leave; a manager's leave only the owner; other staff the owner, a manager, or `hrm.attendance.manage`. The owner does not file leave. On the manual register, non-owners cannot change their own row or admin/manager rows (those rows are skipped on save).
- `/admin/alerts`: managers send incidents (low / medium / urgent / critical, category, optional room/table/camera reference). The owner sees an inbox with a sidebar badge, polled every 20 s, with a tone for new urgent/critical alerts; acknowledge and resolve.
- Combined overview adds Staff on duty and whether a manager is clocked in.
- Schema: `078_staff_hr.sql` (PostgreSQL) / created on demand in SQLite: `staff_clock_events`, `leave_requests`, `owner_alerts`. Code: `lib/staff-hr.js`, `/api/staff/me`, `/api/admin/hrm/leave`, `/api/alerts`. Tests: `tests/unit/staff-hr.test.js`.

## Phase 2: charge restaurant bills to a hotel room (28 October 2026)

- POS **Bill Payment** shows a **Room** option when the user has `pos.charge_to_room` (cashier default on; admin/manager always) and the bill is a first-time checkout. Pick the in-house guest; the panel shows guest name, room, departure and meal plan to confirm.
- Accounting: payment method `room` maps to 1320 Hotel Guest Receivables. The sale journal is Dr 1320 / Cr 4010 (+2020 tax). No `bill_payments` row is written (no money received); the allocation has `settlement_status = 'room_charge'`. The bill is `paid` from the restaurant side.
- The guest folio gets a charge `Restaurant bill <number>` linked to the sale journal (`journal_id`), with no second journal, so revenue is recognized once. Hotel checkout requires it to be settled; the folio payment (Dr Cash/Bank, Cr 1320) clears the receivable.
- The stay is re-checked inside the POS transaction (PostgreSQL locks the property row, as checkout does), so a guest cannot be checked out mid-charge. Only `in_house` stays qualify.
- Payment-mix reports bucket `room` with credit (on account), never cash or online.
- Room-charged bills cannot be voided, refunded, reopened, settlement-revised or journal-reversed yet (`assertNotRoomCharged`), because the folio entry would remain. Listed in ROADMAP follow-ups.
- Code: `lib/hotel/room-charges.js`, `GET /api/hotel/stays`, `recordInitialSplitSettlement(..., room)`, POS pay route, `components/pos/bill-payment-panel.jsx`. Tests: `tests/unit/hotel-room-charges.test.js`.
- Also fixed: managers can now give customer credit (the allocation check still hard-coded admin/cashier).

## Phase 1: login types, roles and workspaces (28 October 2026)

- New roles: `manager`, `receptionist`, `housekeeping` (`lib/roles.js`). PostgreSQL needs `077_staff_roles.sql`; existing SQLite databases rebuild the `users` table once on open to widen the role CHECK.
- Login has **Restaurant** and **Hotel** tabs. Restaurant staff appear only under Restaurant, hotel staff only under Hotel; admin and manager appear in both and land on that side's dashboard.
- Admin and manager get a **Restaurant / Hotel / Combined** switcher in the sidebar. Each nav entry has a `scope` (one workspace or a list). Restaurant: restaurant pages plus shared ones. Hotel: hotel pages, security desk and CCTV plus the shared Finance, Accounting, HRM, alerts, roles and settings (no restaurant inventory, ledgers, CMS or printer). Combined: **Combined report** (`/admin/overview`), then one collapsible **Hotel** group and one **Restaurant** group (key pages only), plus everything shared.
- Combined report: pick a period (today, yesterday, last 7 days, this month, last month or custom). Total revenue, expenses, net profit and money collected, each split restaurant / hotel; a card per business (revenue lines by income account, bills and average bill / room-nights, occupancy, ADR, RevPAR, check-ins); combined P&L with shared costs; expenses by category; money collected by payment method; daily chart and table; live "right now" status. Numbers come from `businessReport` (shared journal: 4030/4040 hotel, other income restaurant; money collected = cash/bank/card/wallet lines of `bill`, `refund` and `hotel_payment` entries). CSV and print export.
- Manager passes every admin role gate and inline override, except owner-only: Staff Permissions, creating/editing/deleting admin or manager accounts, cash-count anti-theft settings and permanent purchase deletion.
- Hotel staff only open `/admin/hotel/*`. Hotel actions are gated by new permission keys editable under Staff Permissions: `hotel.view`, `hotel.front_desk`, `hotel.folios`, `hotel.housekeeping`, `hotel.setup` (defaults: receptionist view/front desk/folios; housekeeping view/housekeeping; setup off). Restaurant permissions cannot be granted to hotel roles, or hotel permissions to restaurant roles.
- Not yet: custom role builder (roles are a fixed list), per-business expense split, hiding individual action buttons for hotel roles (the server rejects them).

27 October 2026 — live folios, ledger posting, checkout statements and housekeeping implemented.

## Current phase: folios, payments and checkout

Open **Live hotel → Guest folios** after checking in a reservation. Post its due room nights, add any extra service charges, record cash/online payment parts, then review and finalize checkout. A finalized statement can be printed or saved through the browser's print dialog. Checkout marks the room dirty and creates one saved task in **Housekeeping**. Complete cleaning, inspection and readiness before the next check-in.

Financial postings require today's open business day and business session under **Opening & Closing**. Starting/stopping a hotel stay does not automatically open or close the restaurant drawer. Failed finance commands leave no partial folio, journal, receipt, checkout statement or cleaning dispatch.

### Posting policy

- The first reserved night is charged on arrival, with a one-night minimum. Later nights become due after they have elapsed. Posting is an explicit staff action; a scheduled night audit is not yet implemented.
- Early checkout does not charge unused future nights. Overdue nights use the reservation's agreed nightly rate. Checkout preview explains this policy and requires confirmation of departure today.
- Room rates and configured room/extra-service tax are captured on each new reservation. Existing reservations retain their rate/tax after settings change. Existing reservations upgraded from the earlier phase have a 0% tax snapshot; there is no invented historical tax backfill.
- Tax defaults to 0% until configured in Hotel setup. Enter room/service prices before tax; tax rounds per charge to integer minor units. No jurisdiction-specific compliance certification or fiscal invoice is claimed. The printable artifact is a hotel stay statement.
- Charges post Dr Hotel Guest Receivables (1320), Cr Room Revenue (4030) or Service Revenue (4040), with configured tax credited to Tax Payable (2020).
- Payments post Dr Cash (1010) or Primary Bank (1020), Cr Hotel Guest Receivables. Collecting payment does not recognize revenue again. Cash is tagged to the open drawer; online money is tagged to the active primary bank.
- Hotel cash collections have a separate line in drawer reconciliation. Online Received separates Hotel Payments from Restaurant Sale. Normal GL/cash/bank and financial statements read the same journal entries.
- Payment means recording money already received; it does not initiate a bank/card transfer. Overpayments and payments against unposted future nights are rejected. Split payments are entered as separate parts.
- Unique source keys prevent repeated room-night posting. Request receipts make retries safe. Folio revisions reject stale payments/checkout. Finalized statements preserve property, guest, room, charge and payment details as they stood at checkout.

### Data and migration

PostgreSQL requires `076_hotel_folios.sql`, after the foundation migration. SQLite upgrades columns/tables idempotently. New tables are `hotel_folio_entries`, `hotel_checkout_statements` and `hotel_housekeeping_tasks`. The upgrade adds tax snapshots and `checked_out_at` without rebuilding the existing reservations table. An effective checked-out stay is derived from that timestamp; every inventory/occupancy check excludes closed stays.

Housekeeping task and room readiness updates share one transaction, support optimistic task versions and keep Hotel setup's readiness controls in sync. Tasks show Unassigned until a future assignment workflow is added; no sample staff are presented as real assignees.

Accounting schema preparation is now cached per database handle rather than with a process-wide flag, so separate SQLite connections and isolated databases each initialize correctly.

### Verification and remaining scope

Verification: 51 selected folio, business-day, reconciliation, statement and summary tests pass; the earlier foundation tests also pass. All 18 desktop/mobile hotel browser scenarios pass, and the complete folio flow was rerun on both viewports after the final account/bank guards. Coverage includes room setup/reservation persistence, ledger-backed partial cash/online payments, closing reconciliation, checkout, print statement, cleaning/inspection, public-home regressions and preview workflows. Print HTML escaping, account-code conflicts, missing bank mappings and transaction rollback are tested. Desktop folio, mobile housekeeping and printable statement captures were visually inspected. Targeted ESLint and whitespace checks pass. Browser tests use the separate ignored `hotel-folios-verification.db` with `HOTEL_VERIFY_DIST=1`; no operational records were used.

Run `tests/e2e/hotel-folios.spec.js` alongside the earlier hotel specs with `HOTEL_LIVE_E2E=1` only against an isolated server. The financial test opens a business session in that test database. PostgreSQL staging concurrency, full production build, physical printers and physical mobile devices remain unverified.

Restaurant-to-room bill transfers, advance deposits, reversals/refunds, formal tax invoices, scheduled night audit, room moves/extensions, dynamic hotel roles, KYC and housekeeping assignments remain later work. Manual extra charges must not be used to re-enter restaurant bills: that integration must transfer receivables without recognizing the sale twice. Existing restaurant sales reports remain restaurant reports; shared ledger totals and payment reconciliation include hotel events.

## Previous phase: saved hotel records

Use **Open live hotel**, then **Hotel setup**. This is separate from the sample design preview. Live hotel records persist in the configured database; preview actions never populate these tables.

Implemented now:

- Property name, room creation/editing, floors (0–99), type, capacity and nightly rate.
- Room blocking/unblocking and cleaning → inspection → ready transitions, with optimistic room versions.
- Saved reservations with guest name/phone, dates, meal plan, source and agreed nightly-rate snapshot.
- Searchable reservation list/calendar, cancellation and check-in; real in-house occupancy feeds the room rack/front desk.
- Server-side date, capacity, readiness, occupied-room and overlap checks. Overdue in-house guests still hold their rooms.
- Retry receipts and audit events committed in the same transaction as each command.
- Hotel/Restaurant dashboard/Restaurant POS/Public website links at the top of the hotel workspace; the sidebar names Restaurant dashboard explicitly.

`/api/hotel` uses the existing authenticated API guard and is restricted to administrators for this phase. Custom hotel roles/groups, KYC, multi-room reservations, moves/extensions, folio posting, real payments, checkout and task dispatch are still pending. Live folios show this limitation rather than presenting an unposted balance as settled. The full payment/checkout/housekeeping demonstration remains available in preview mode.

New tables: hotel_properties, hotel_rooms, hotel_reservations, hotel_audit_events, hotel_command_receipts. SQLite creates them idempotently without inserting sample rooms/guests. PostgreSQL requires forward migration `075_hotel_foundation.sql`; 072–074 remain reserved for the separate restaurant parity port. Do not treat the gap as completed restaurant migrations. PostgreSQL writes lock the property row before checking inventory; SQLite hotel transactions are queued per connection. Production PostgreSQL concurrency and deployment still need staging verification.

The implementation is single-property and NPR/Asia-Kathmandu for now. Amounts are stored as integer minor units. Bookings retain their agreed rate after a room's current rate changes. Nothing in this phase posts financial journals.

## Reported errors

- Fixed public menu reads on older SQLite schemas: item/variant stock dependencies, including `inventory_items.is_archived`, are initialized before queries. Schema preparation is cached per database connection, not process-wide.
- Fresh SQLite seeds now include archive/stock-visibility columns.
- Fixed a related fresh-install error in the restaurant order badge by preparing bill correction tables before the query.
- Default `npm run dev` now uses Webpack, matching the existing production build script. Restart the old Turbopack process to pick up this change; public-home browser checks verified no reported stock-column/source-map errors under Webpack.
- Temporary session verification timeouts/5xx responses preserve saved credentials. Explicit invalid-session responses still sign out, and every API independently checks the session.

An optional `HOTEL_VERIFY_DIST=1` uses ignored `.next-hotel-check` output so automated verification does not conflict with an existing `.next` developer process. Verification uses the separate ignored `hotel-foundation-verification.db`; it is not the user's operational database.

Current verification: 31 selected model/database/restaurant regression tests and 16 desktop/mobile browser tests pass, plus targeted ESLint and whitespace checks. Browser coverage includes actual authenticated saved-room/reservation/check-in operations and reload persistence, unauthorized API rejection, the public homepage, preview interactions, and temporary session verification outages. Database tests cover per-connection menu preparation, competing bookings, idempotency receipts, cancellation, readiness, capacities, rate snapshots and reconnection. PostgreSQL migration/concurrency and a full production build are not claimed as verified.

Run live browser checks only against an isolated database:

```powershell
$env:DB_NAME='hotel-foundation-verification.db'
$env:HOTEL_VERIFY_DIST='1'
node node_modules/next/dist/bin/next dev --webpack -p 3006
# In another terminal:
$env:E2E_PORT='3006'
$env:E2E_BROWSER_CHANNEL='chrome'
$env:HOTEL_LIVE_E2E='1'
node node_modules/@playwright/test/cli.js test tests/e2e/hotel-live.spec.js tests/e2e/hotel-folios.spec.js tests/e2e/phase11-settings-permissions.spec.js --workers=1
```

## Earlier visual milestone

## Available now

Open `/admin/hotel` using an administrator account, or choose **Hotel** in the existing sidebar. The five routes are:

- `/admin/hotel`: front desk with occupancy, arrivals, departures, room summary and handover activity.
- `/admin/hotel/rooms`: floor-grouped room rack, status filters, guest/room search and room details.
- `/admin/hotel/reservations`: weekly calendar with previous/next/today controls, searchable list and new-reservation dialog.
- `/admin/hotel/folios`: guest charges, payments, balances and settlement/checkout demonstration. `?guest=HT-1025` opens the due-out guest.
- `/admin/hotel/housekeeping`: turnover board with floor filters and cleaning/inspection stages.

All screens explicitly show **Design preview**. The example date is 27 October 2026; it does not follow the host clock. State survives navigation inside the hotel workspace and resets on a full reload, leaving the workspace or Reset demo. There are no hotel mutation endpoints, database writes, accounting postings or real payments in this milestone. The existing shell continues to use its normal authentication and badge APIs.

## Try the workflow

1. Create a reservation for Anjali Gurung, room 104, 27–28 October, two guests.
2. Open Front desk, review that arrival and check in. Room rack now shows the guest in room 104. View guest folio from the room drawer.
3. Select Sophie Williams in Guest folios. Her recorded balance is settled and she is due out; check out.
4. Open Housekeeping. Her checkout creates a room 102 task. Start cleaning, send for inspection and inspect/mark ready. The room rack becomes Ready.
5. Use another in-house folio to try a partial demo payment. Invalid, excessive and post-checkout payments are rejected. Future room charges are not yet posted by this prototype.

Overlap checks allow back-to-back reservations. Check-in requires a vacant, ready, unblocked room and an eligible arrival date. Checkout requires a settled balance and a due-out stay. Early checkout/rate adjustments are deferred to the actual folio service. Cleaning requires all three transitions before a room is ready. These checks are client-side preview rules, not production concurrency guarantees.

## UI foundation

Hotel components and styles are scoped under `components/hotel/`, with pure display helpers (money, dates, room state, availability) under `lib/hotel/view.js`. They reuse the existing admin shell, icons and neutral management-interface conventions, with a restrained green accent. Native modal dialogs provide focus containment and Escape dismissal, with explicit trigger-focus restoration. Mobile tables/calendars scroll within their panels.

The root layout's unused Google font downloads were removed, following the restaurant reference, and the missing sans/monospace fallbacks were restored. No restaurant business logic was changed.

## Verification

- Four Node tests cover overlap/back-to-back booking, readiness, duplicate transitions, settlement, partial/invalid payments and checkout-to-cleaning.
- Eight Playwright tests pass: four scenarios each on desktop Chrome and an emulated Pixel 7 viewport. All five pages were rendered, checked for page overflow/runtime errors and captured as screenshots.
- Dialog Escape/focus restoration, new reservation/check-in/folio navigation and checkout/clean/inspect flows pass.
- Targeted ESLint passes for the new components, routes, model and tests. Git whitespace checks pass.
- Rendered desktop front desk/folios and mobile room rack were visually inspected. This is browser emulation, not physical-device testing.
- No full production build, full legacy regression suite or production database verification is claimed for this preview milestone.

Commands (PowerShell, development server on port 3006):

```powershell
node node_modules/next/dist/bin/next dev --webpack -p 3006
npm run -s test:unit
node node_modules/eslint/bin/eslint.js components/hotel app/admin/hotel lib/hotel tests/unit/hotel-view.test.js tests/e2e
$env:E2E_PORT='3006'
$env:E2E_BROWSER_CHANNEL='chrome'
HOTEL_LIVE_E2E=1 node node_modules/@playwright/test/cli.js test tests/e2e/hotel-live.spec.js --workers=1
```

Browser tests mock existing authentication/badge APIs and do not use restaurant records. Screenshots are in ignored `test-results/`. The test configuration now accepts `E2E_BROWSER_CHANNEL`, matching the restaurant project. Local verification reused the sibling restaurant's installed dependencies through an ignored `node_modules` junction; a clean checkout should install its own dependencies with `npm ci`.

## Remaining roadmap

This implements the five-screen visual milestone from `PLAN.md`; it does not complete restaurant parity or the whole hotel system. Next work is the reviewed restaurant feature port, real property/room schema and settings, dynamic staff authorization, transactional reservation/stay services, private guest documents and folio/accounting integration. OTA, night audit, full HR and camera integrations remain later phases. Replace the demo state through service adapters only after database and accounting invariants are implemented and tested.

## Phase 11: one Settings page, no demo mode, per-staff permissions

- **Demo / design preview removed.** The hotel workspace always loads saved records (`HotelProvider` in `components/hotel/workspace.jsx`). Sample data, "Reset demo", "View design preview" and the `hotel_workspace_mode` session flag are gone. `lib/hotel/demo.js` became `lib/hotel/view.js` (display helpers only).
- **Hotel settings moved into Settings.** `/admin/settings` has a **Hotel** tab (owner/manager): property name and tax, seasons and rate plans, room-service QR. `/admin/settings?tab=hotel` opens it directly. The `/admin/hotel/setup` page and its sidebar entry are removed. Rooms and categories stay on **Rooms & categories**.
- **Per-staff permissions.** Table `user_permissions (user_id, permission_key, allowed)` (migration `086_user_permissions.sql`; SQLite creates it on demand). `permissionRole(user)` now returns `user:<id>:<role>` for staff; `isPermissionAllowedSync` checks the person's Allow/Block first, then their custom or built-in role. `baseRoleOf()` resolves the built-in role for the static map in `lib/auth/auth.js`. Owner and managers set any catalog permission per person under **Staff Roles & Permissions → By staff member** (or the shield icon on Employees, `/admin/permissions?user=<id>`). Owner/manager accounts cannot get overrides. Every change is written to `permission_audit` with role `user:<id>`.
- Tests: `tests/unit/phase11-user-permissions.test.js`, `tests/unit/hotel-view.test.js`, `tests/e2e/phase11-settings-permissions.spec.js` (needs `HOTEL_LIVE_E2E=1`). The folio e2e spec was updated to current button labels.

