# Hotel + Restaurant roadmap

Single source of truth for what is built and what comes next. Update this file
whenever a phase starts or finishes. Details of finished work live in
`docs/HOTEL_IMPLEMENTATION.md`; the original audit is `PLAN.md`.

Work happens on branch `hotel-phase-1` (one commit per phase).

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Hotel foundation: rooms, reservations, check-in, guest folios, room-night posting, payments, checkout statement, housekeeping board | Done (`ebfaba8`) |
| 1 | Restaurant / Hotel login tabs; `manager`, `receptionist`, `housekeeping` roles; owner-only guards; Restaurant / Hotel / Combined workspace switcher; combined overview | Done (`a1b4a5a`) |
| 2 | Charge restaurant bills to an in-house hotel room from the POS (unified folio) | Done (`12d12cb`) |
| 3 | Staff HR: clock in/out, leave requests (worker → manager, manager → owner), `/staff` self-service page for every role, manager "Alert owner" → owner inbox with sound | Done (`c3764e2`) |
| 4 | Front desk depth: guest profiles, private ID/KYC upload, group (multi-room) bookings, room move / extend / shorten, advance deposits + refunds, rate override (permission + audit + owner alert) | Done (`423755f`) |
| 5 | Night audit, rates and reports: seasons and rate plans (per-night pricing), night audit (room nights, no-shows, occupancy), Business report with ADR / RevPAR and restaurant / hotel / combined P&L, expense categories tagged by business, attendance payroll suggestion, CSV + print/PDF | Done (`168941d`) |
| 6 | Housekeeping and operations: auto-assign cleaning to on-shift housekeepers (workload, floor, urgent same-day arrivals), staff notifications (in-app + WhatsApp/SMS webhook adapter), minibar charges, damage reports → maintenance tickets with photo and out-of-order, `maintenance` and `watchman` roles, security desk (gate/vehicle/patrol/incident log, emergency owner alert) | Done (`a174c52`) |
| 7 | OTA sync: channels with commission, token-authenticated webhook (`/api/webhooks/ota/<channel>`), per-room iCal import + private iCal export, OTA booking records (total, commission, prepaid), sync log, conflict queue (retry / dismiss), OTA commission in Business report | Done (`0d9b6ad`) |
| 8 | CCTV: camera registry by area, MediaMTX WebRTC grid (1×1–4×4, fullscreen, area filter), push config / status via MediaMTX API, ONVIF PTZ (WS-Security), `cctv.view` / `cctv.ptz_control`, cameras linked from owner alerts and security emergencies | Done (`39e2b1e`) |
| 9 | Custom role builder (owner + manager; roles built on a base role, own permissions), guest QR room service (room-service tables, in-house only), online check-in links | Done (`3528964`) |
| 10 | Hotel UI restructure (user request): each hotel section is its own sidebar page (no in-page tabs), live hotel by default, room categories (price, capacity, beds, amenities) with bulk room creation, Rooms & categories vs Hotel settings | Done (`fe35452`) |
| 11 | User request: demo/design preview removed (live records only), hotel settings merged into main Settings (Hotel tab), per-staff permission overrides (Allow / Block any permission per person, audited) | Done (see git log) |

| 12 | PMS completion (brief "complete the hotel PMS", branch `hotel-pms-completion`): audit matrix (`docs/HOTEL_PMS_AUDIT.md`); traceable folio (source, windows, reversal, transfer, routing, city ledger); deposits as liability (2150); meal plans with daily allowances, package liability (2160) and breakage; restaurant charge-to-room with allowance split, mixed settlement, void correction, order/table-reservation links; reservation detail, master reservations + add room + payer, room move reason/rate/history, no-show, plan change, group checkout; night audit checklist, idempotent re-run, business-date alignment; housekeeping types/stayover/DND; maintenance workflow with inspection; laundry; minibar catalog with stock; hotel reports + KPIs + CSV; GM control center; global search; Guest 360; tax invoice original/duplicate; migrations 087–088 | Done (see git log) |

Remaining work is the follow-up list below.

## Known follow-ups (not yet scheduled)

- Shift scheduling (planned shifts per person) is not built. Without it there is no Late status and overtime uses a fixed 8-hour day (`STANDARD_DAY_HOURS`). Leave coverage warnings count other staff in the same role who are off, not scheduled shifts.
- Attendance payroll is a read-only suggestion (all approved leave paid, overtime at 1x hourly rate, unrecorded days unpaid). Salary payments are still recorded manually on the Payroll page.
- Night audit is run manually from the front desk once a day; there is no background scheduler. It is not tied to restaurant business-day closing.
- Business report: hotel revenue is booked on the posting date (ledger), while room-night KPIs use each night's service date; available room-nights use today's unblocked room count for every day in the range. OTA commissions are not split yet (Phase 7).
- Waiter "hand over open tables before clock-out" is a free-text handover note only.
- Cashier workspace has no leave-approval page (route is under `/admin`); cashiers with `hrm.attendance.manage` can use the API only.
- Refunds are stored as folio charge rows labelled "Refund to guest" (they raise the credit balance back to zero); the folio "Net charges" line includes them. A dedicated refund row type needs a folio-table CHECK change.
- Deposits taken before migration 087 stayed in 1320 (legacy); new deposits go to 2150 Guest Advance Deposits.
- External notifications need `NOTIFY_WEBHOOK_URL` (+ optional `NOTIFY_WEBHOOK_TOKEN`) pointing at a WhatsApp/SMS gateway that accepts `{ to, title, body, link }`; there is no retry for failed deliveries (the error is stored on the notification).
- Cleaning tasks are only auto-assigned when a housekeeper is clocked in; otherwise they stay Unassigned until reassigned on the board. Workload counts open tasks, not room size.
- Maintenance tickets have one photo each. Minibar restock/par checks per room are not tracked (consumption only).
- Watchman has no access to hotel guest data; the security desk is a separate page. Owner alerts can now come from a manager or the watchman.
- OTA webhook accepts one normalized JSON shape (see `lib/hotel/ota.js`); a provider-specific adapter (Channex / SiteMinder payload → normalized event) and outbound ARI push (rates/availability API) are not built. Outbound availability is via the per-room iCal export only.
- iCal sync runs on "Sync calendars now" or an external cron calling `POST /api/webhooks/ota/ical-sync` with `x-sync-token: $OTA_SYNC_TOKEN`; no built-in scheduler. iCal events carry no price or guest count (1 guest, room tariff/seasons). Our own exported blocks echoed back by an OTA are skipped when they match an existing booking's room and dates exactly.
- OTA commission is recorded per booking and shown in the Business report, but not posted to the ledger as an expense; OTA prepaid amounts are flagged, not posted (record the payout when it arrives).
- CCTV needs a MediaMTX server (`CCTV_STREAM_BASE_URL` for the browser, `MEDIAMTX_API_URL` for setup); not tested against real cameras or MediaMTX here. Stream pages are not proxied or token-protected by this app: keep MediaMTX on the private network / VPN or enable its read auth. Camera RTSP URLs and ONVIF passwords are stored unencrypted (visible only on the setup screen). PTZ is a 0.5 s nudge per press, no presets; no recording/playback. The CSP change for the stream origin needs a rebuild/restart after changing `CCTV_STREAM_BASE_URL`. Only admin/manager and the watchman open `/admin/cctv`; `cctv.view` for other roles has no page yet.
- Per-staff permissions change what a person may do, not which app they open: a waiter allowed hotel front desk still signs in to the waiter app. Use a hotel role (or custom role on one) for a different workspace. Designation is the HRM job title only; it carries no permissions.
- Custom roles are built on a base role (which still decides portal and sign-in side); no staff groups beyond HRM departments; no shift scheduling.
- Room-service QR uses one restaurant table per room ("Room 101"); these appear in restaurant table lists. The bill is charged to the room manually in POS.
- Online check-in fills the guest profile and ETA only; key issue and physical check-in stay at the desk. Links are sent manually (copy link), not emailed.
- Alerts are polled every 20 s (no push/SSE); sound may need one click on the page first (browser autoplay rules).

- Room-charged restaurant bills can be voided (folio row credited, allowance released). Partial refunds, reopen and settlement edits of room-charged bills stay blocked (`assertNotRoomCharged`); use a folio allowance instead.
- Room charging works in the admin/cashier POS first-time checkout (room, or cash/online + room). Not yet: waiter app, reopened bills, online orders.
- No Events/Banquets module exists in this repository, so event room blocks and event billing are not built.
- OTA provider adapters (Channex/SiteMinder/Booking.com APIs) still need credentials; channels stay normalized-webhook + iCal.
- Unassigned reservations (room type only, no physical room) are not supported: every reservation holds a room.
- Property-level service charge on hotel folios is not configurable (tax only). IRD/CBMS e-billing integration is not built; invoices show PAN/VAT from Settings.
- Night audit is still started manually; no scheduler.
- Hotel staff still see some action buttons their role cannot use; the server rejects them.
- PostgreSQL migrations 001–088 apply cleanly on PostgreSQL 17; `npm run test:integration` runs `production.test.js` and `hotel-pms.test.js`, each in its own disposable database (verified 2026-10-29).
- Real-time updates are polling; no SSE/WebSocket yet.
- Single property, NPR, Asia/Kathmandu only.
