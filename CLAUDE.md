# CLAUDE.md

**Progress tracking:** read `docs/ROADMAP.md` first. It lists every phase, which are done (with commits) and known follow-ups. Update it when a phase starts or finishes. Implementation details per phase are in `docs/HOTEL_IMPLEMENTATION.md`.

Inspect the current repository to understand our existing tech stack, folder structure, database schema, and authentication setup for our restaurant software.

We are expanding this existing restaurant software into a full-fledged, enterprise-grade **Hotel & Restaurant Management System (HMS)**.

CRITICAL RULE: Do NOT break or overwrite existing working restaurant POS functionality. Extend the current architecture modularly so the existing restaurant workflows integrate seamlessly with the new Hotel, HR, CCTV, OTA, and Accounting modules.

---

### PHASE 0: Codebase Audit & Architectural Plan (`PLAN.md`)
Before writing or modifying application code, inspect the codebase and generate a comprehensive `PLAN.md` covering:
1. Current stack analysis and how existing users, orders, and tables are modeled.
2. Complete Database Schema / ERD migrations required for the new modules.
3. Backend API routes, WebSocket/SSE real-time channels, and background job queues.
4. Phased implementation roadmap so we can build and test incrementally.

Wait for my approval on `PLAN.md` before executing code changes, OR if I tell you to proceed, implement Phase by Phase with clean commits.

---

### CORE SYSTEM SPECIFICATIONS

#### MODULE 1: Dynamic Role-Based Access Control (RBAC) & Custom Role Builder
Instead of hardcoded roles, implement a **Database-Driven Role, Group & Permission Engine**:
- **Schema**: `roles`, `permissions`, `role_permissions`, `staff_groups`, and `users`.
- **Dynamic Role & Group Creation**: Both `owner` and `manager` can create new operational roles and worker groups from the UI (e.g., `Watchman`, `Waiter`, `House Cleaners`, `Receptionist`, `Kitchen Staff`, `Maintenance`, `Bellboy`, `Accountant`) and assign granular permission checkboxes (e.g., `pos.create_order`, `pos.charge_to_room`, `rooms.view_rack`, `rooms.check_in_out`, `housekeeping.update_status`, `hr.view_own_attendance`, `hr.manage_worker_attendance`, `hr.approve_worker_leave`, `accounting.view`, `cctv.view`, `cctv.ptz_control`).
- **Strict Hierarchy & Anti-Escalation Guards**:
  1. `owner` has immutable super-admin access to everything.
  2. `manager` can add/edit/remove workers, organize workers into groups, and create custom worker roles—but CANNOT edit the `owner` account, grant permissions the manager does not possess, delete audit logs, or edit/approve the `manager`'s own attendance or leave.
  3. Any high-risk action (voiding a paid bill, overriding room tariffs, manual cash drawer adjustments) logs an immutable entry in `audit_logs` and flags the `owner`.

---

#### MODULE 2: Role-Specific Portals & Workflows

##### 1. `owner` (Super Admin & Command Center)
- **Overall Watch Dashboard**: Real-time single-screen command center showing live hotel occupancy %, active restaurant tables, today's revenue (Room vs. F&B), staff currently clocked in (including Manager), and flagged audit anomalies.
- **Live CCTV Surveillance & Control Module**:
  - Manage camera feeds (`Cameras` table: `name`, `zone` [Lobby, Kitchen, Cash Counter, Corridors, Gate], `rtsp_or_stream_url`, `ptz_supported`, `status`).
  - Browser-compatible low-latency multi-camera grid viewer (1x1, 2x2, 3x3, 4x4 layouts) using WebRTC/HLS/MediaMTX proxy.
  - Interactive PTZ (Pan-Tilt-Zoom) directional and zoom controls for supported cameras.
- **Manager Oversight & Escalation Inbox**:
  - Receive instant, high-priority real-time alerts triggered by the Manager (`low`, `medium`, `urgent`, `critical`) with sound/visual notification.
  - Approve/reject `manager` leave requests and review `manager` attendance logs.

##### 2. `manager` (Operations, HR & Floor Admin)
- **Worker & Group Management**: Add, edit, deactivate, or remove workers; assign them to groups (`Watchman`, `Waiter`, `House Cleaners`, etc.) and schedule shifts.
- **Attendance & Leave Management**:
  - View live and historical attendance reports for all workers (Present, Late, Half-Day, Absent, Overtime hours).
  - Approve or reject worker leave applications with automatic shift-coverage conflict warnings.
  - Self-attendance tab for the Manager to clock in/out and apply for leave (routed to `owner` for approval).
- **"Alert Owner" Escalation Trigger**: Quick-action button/modal to send urgent incident reports (VIP issue, security breach, equipment failure, cash dispute) directly to the Owner's Command Center, optionally linking a specific Room, Table, or CCTV camera feed.
- **Full Operational Control**: Access to Live Room Rack, OTA bookings, Restaurant POS, Inventory, and daily expense logging.

##### 3. `waiter` (Restaurant POS, Room Service & Self-Service Portal)
- **Restaurant & Hotel Room-Service Operations**:
  - Visual table management, dine-in ordering, course firing, split bills, and Kitchen Order Ticket (KOT) routing.
  - **Charge to Hotel Room**: Look up an occupied room number, verify the checked-in guest's name and meal plan entitlement (e.g., `Complimentary Breakfast Included`), and post restaurant/room-service bills directly to the guest's master room folio.
  - **Live Kitchen Alerts & 86'd Items**: Real-time notification when kitchen marks food `Ready for Pickup`, plus disabled buttons for out-of-stock dishes.
  - **Room-Service Tray Tracker**: Track delivered room-service trays pending clearance from guest corridors.
- **Waiter Self-Service HR Portal**:
  - Clock-in / Clock-out and personal monthly attendance calendar with total hours and overtime.
  - Apply for leave (Sick, Casual, Emergency) with date range and reason, and track approval status (`Pending`, `Approved`, `Rejected`).
  - View assigned shift schedule, allocated tips, and hand over open tables before clocking out.

##### 4. `house_cleaner` (Automated Housekeeping & Self-Service Portal)
- **Automated Post-Checkout Cleaning Dispatch**:
  - The instant a guest checks out at the Front Desk (or a room is marked `Dirty`), automatically transition the room state to `Dirty - Needs Cleaning`, assign it to an on-shift `house_cleaner` (balanced by floor/workload), and dispatch an automated **In-App Real-Time Alert + WhatsApp/SMS Notification** (via a pluggable notification service adapter).
  - Priority tagging (`URGENT - Next Arrival Today at [Time]` vs. `Standard Turnaround`).
- **Room Status & Inspection Workflow**:
  - Update room states (`Dirty` -> `Cleaning in Progress` -> `Clean / Ready`).
  - Log minibar items consumed (automatically adds to guest bill if pre-checkout check) and report room damages/maintenance issues with photo/notes.
- **Cleaner Self-Service HR Portal**:
  - Personal attendance clock-in/out, attendance history, shift view, and leave application portal.

##### 5. Additional Pre-Seeded Hotel Roles
- **`receptionist` (Front Desk)**: Manage walk-in/OTA bookings, guest check-in/out, ID/KYC upload, room key assignment, and unified folio checkout billing.
- **`kitchen_staff` (KDS)**: Live Kitchen Display Screen for dine-in and room-service orders.
- **`watchman` (Security & Gate)**: Log visitor/vendor gate entries, guest vehicles, night patrol logs, and emergency alerts, plus personal attendance/leave portal.
- **`maintenance` (Technician)**: Receive room repair tickets from house cleaners and toggle rooms between `Out of Order` and `Available`.

---

#### MODULE 3: Live Room Rack & Automated OTA Sync (Booking.com, Airbnb, etc.)
- **Interactive Live Room Rack**:
  - Real-time visual dashboard showing all rooms grouped by floor/category.
  - Color-coded live states: `Available (Clean)`, `Occupied`, `Due Out Soon` (countdown to checkout time), `Overstay / Late Checkout Alert`, `Dirty`, `Cleaning in Progress`, `Out of Order`.
  - Clicking any room shows current guest info, check-in time, exact checkout time, meal plan, booking source badge (`Walk-In`, `Direct`, `Booking.com`, `MakeMyTrip`, `Airbnb`, `Agoda`), and live folio balance.
- **Automated OTA Booking Sync Engine**:
  - Build a webhook receiver (`/api/webhooks/ota`) + background iCal (`.ics`) sync adapter capable of ingesting new, modified, or cancelled bookings from Booking.com and other OTAs (compatible with Channel Manager webhooks like Channex/SiteMinder + iCal feeds).
  - Automatically create the guest & booking record, hold/assign room inventory, log OTA commission rates and prepayment status, and push availability updates back out to prevent double-bookings.
  - Include an **OTA Sync Log & Conflict Resolution Queue** for the Manager if an overbooking occurs.

---

#### MODULE 4: Unified Hotel & Restaurant Accounting Engine
- **Master Guest Folio (Unified Billing)**:
  - Automatically combine room night tariffs, extra bed/early check-in fees, minibar charges, and all linked Restaurant/Room-Service POS bills into a single checkout invoice.
  - Support split payments (Cash, Card, UPI, Bank Transfer, OTA Virtual Card/Prepaid), advance security deposits, and automated GST/tax calculation.
- **Complete Income & Expense Ledger**:
  - **Revenues**: Segmented by Room Revenue, Restaurant Dine-In, Room Service, and Extra Services.
  - **Expenses**: Vendor/kitchen inventory purchases, utility & maintenance costs, OTA commissions, and petty cash.
  - **Attendance-Linked Payroll**: Calculate staff and manager salary payouts based on logged attendance days, approved paid leaves, overtime hours, and salary advances.
- **Night Audit & Financial Reports**:
  - Daily automated closing summary (Cash drawer reconciliation, Occupancy %, ADR, RevPAR, pending receivables) and exportable P&L and Tax reports (CSV/PDF) for the Owner.

---

### EXECUTION INSTRUCTIONS FOR CLAUDE CODE
1. Start by scanning the project directory and database configuration.
2. Create `PLAN.md` with the complete database schema additions, API architecture, and step-by-step build phases.
3. Present `PLAN.md` summary to me and ask if I want you to begin executing **Phase 1 (Database Migrations & Dynamic RBAC Engine)** immediately.
