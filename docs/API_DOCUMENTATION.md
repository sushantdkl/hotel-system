# API Documentation

## Conventions

- Base path: same origin as the web application.
- Request/response format: JSON unless uploading or serving media.
- Authentication: server-issued session cookie or supported bearer/session token, depending on the route helper.
- Mutating authenticated requests are subject to origin/CSRF checks.
- Errors use an appropriate HTTP status and a sanitized JSON message.
- Dynamic resources use numeric IDs unless the route names a secure token, such as `/api/public/order/[token]`.

Typical statuses: `200/201` success, `400/422` invalid input, `401` unauthenticated, `403` forbidden, `404` missing resource, `409` state conflict, `429` rate limited, and `500` unexpected failure.

## Public endpoints

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/health` | GET | Runtime/database health |
| `/api/public/menu` | GET | Published categories, products, variants |
| `/api/public/cms` | GET | Public site content |
| `/api/public/orders` | POST | Submit a public takeaway/delivery order |
| `/api/public/order/[token]` | GET, POST | Table-token menu/status and ordering |
| `/api/public/inquiries` | POST | Contact inquiry |
| `/api/public/reservations` | POST | Reservation request |
| `/api/media/[...path]` | GET | Validated uploaded-media delivery |

Public write routes are rate-limited. Product identity, price, availability, totals, and allowed order transitions are verified server-side.

## Authentication

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Validate credentials and create session |
| `/api/auth/logout` | POST | Revoke current session |
| `/api/auth/verify` | POST | Verify session/token |
| `/api/users/active` | GET | Active staff list for supported login UI |
| `/api/admin/login` | POST | Admin login compatibility endpoint |

## Counter and restaurant operations

- Menu: `/api/restaurant/menu`, `/api/restaurant/menu/categories`
- Tables: `/api/restaurant/tables`, `/api/restaurant/tables/[id]`
- Orders: `/api/restaurant/orders`, `/api/restaurant/orders/[id]`, `/items`, and `/api/restaurant/order-items/[id]/status`
- Kitchen tickets: `/api/restaurant/kots`, `/api/restaurant/kots/[id]`
- Bills/payments: `/api/restaurant/bills`, `/api/restaurant/bills/[id]/payment`, `/api/restaurant/payments`
- Reservations: `/api/restaurant/reservations`, `/api/restaurant/reservations/[id]`

These routes require authentication. Method support is declared in each `route.js`; clients must not assume every collection supports full CRUD.

## Administration groups

| Group | Route prefix/examples |
|---|---|
| Dashboard/reporting | `/api/admin/dashboard`, `/analytics`, `/reports`, `/kitchen-analytics` |
| Orders/billing | `/api/admin/orders`, `/bills`, `/billing`, `/corrections` |
| Catalog | `/api/admin/products`, `/categories` via restaurant API, `/cms` |
| Inventory | `/api/admin/inventory`, `/inventory/dashboard`, `/inventory/restock`, `/stock-movements`, `/unit-conversions`, `/wastage` |
| Purchasing | `/api/admin/purchases`, `/suppliers`, `/accounts-payable` |
| People | `/api/admin/customers`, `/employees`, `/payroll`, `/employee-performance` |
| Tables/reservations | `/api/admin/tables`, `/table-floors`, `/table-types`, `/table-qr`, `/reservations` |
| Finance | `/api/admin/accounts`, `/ledger`, `/financial-reports`, `/cash-drawer`, `/bank`, `/bank-reconciliation`, `/settlements`, `/cash-exchange`, `/finance-dashboard` |
| Configuration | `/api/admin/settings`, `/cms`, `/cms/media` |

## Uploads

`POST /api/uploads/menu` and `POST /api/uploads/receipts` accept authenticated multipart uploads. Use configured size/type limits and never construct a filesystem path from an unsanitized filename. Files are served through the media route from `UPLOADS_DIR`.

## Change discipline

When adding or changing an endpoint, update validation, authorization, tests, this catalog, and any affected business-flow document in the same change. For exact payload shapes, the route handler and its imported validation/domain function are authoritative.
