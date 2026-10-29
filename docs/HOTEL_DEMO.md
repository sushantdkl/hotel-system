# Hotel demo data

Run `npm run db:seed-hotel` from the project root to populate the local SQLite
database selected by the app (including `DB_NAME` or the local license selection).
The command refuses PostgreSQL and production environments. It takes a consistent
SQLite backup in `databases/backups/` before making changes.

The dataset includes:

- 18 rooms on four floors and five categories with beds, amenities and NPR rates.
- 16 fictional guest profiles, including VIPs, with explicitly fake contact/ID details.
- 16 reservations: five in house, eight confirmed (including today's arrivals,
  a two-room group and future bookings), two cancelled (one no-show), and one checked out.
- Room charges, laundry/transfer charges, partial cash/online payments, an advance
  deposit, and a settled checkout statement. Folio entries use the application's
  posting functions and create balanced accounting journals.
- Four housekeeping tasks spanning dirty, cleaning and inspection states, including
  an urgent arrival; three maintenance tickets, with one blocked room.
- Four meal plans, an upcoming seasonal rate adjustment and two disabled demo OTA
  channels with sample import records. No external feeds or notifications are sent.

Dates are relative to the first run in Asia/Kathmandu. Financial postings use the
existing open business day, which must be within the last two days with an open
drawer session. If no day is open, the seed opens today with zero opening cash.
An existing day/session is preserved. Demo cash collections affect its expected cash.

The script adds records in one transaction and records a completion marker.
Rerunning it preserves the demo's dates and any subsequent edits, without duplicates.
Existing room numbers or conflicting category names cause rollback. Existing
restaurant records and user credentials are preserved. The default “Your hotel”
property is renamed to “Himalayan Courtyard Hotel (Demo)” with 13% room tax; an
already configured property keeps its name and tax settings.

Refresh the hotel's dashboard, room rack, reservations, guests, folios,
housekeeping, maintenance, rates and channels pages after seeding.
