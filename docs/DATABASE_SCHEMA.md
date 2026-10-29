# Database Schema

## Source of truth

- Incremental changes: `migrations/001_init.sql` through the latest numbered migration.
- Fresh PostgreSQL install: `deploy/production_schema.sql`.
- Production seed: `deploy/production_seed.sql`.
- Local development may use `pos_restaurant.db` through the SQLite adapter.

The production schema currently contains 40 domain tables plus the migration ledger (41 tables in total). Do not infer the live schema from this summary alone; inspect migrations and the deployed database before a destructive change.

## Table groups

| Domain | Tables |
|---|---|
| Identity | `users`, `sessions`, `devices`, `rate_limits` |
| Menu | `menu_categories`, `menu_items`, `menu_item_variants` |
| Service | `tables`, `table_floors`, `table_types`, `reservations`, `customers`, `inquiries` |
| Orders | `orders`, `order_items`, `kots`, `kot_items` |
| Billing | `bills`, `bill_payments`, `bill_corrections` |
| Inventory | `inventory_items`, `inventory_categories`, `stock_items`, `stock_movements`, `unit_conversions`, `wastage_log` |
| Recipes | `recipes`, `recipe_items` |
| Purchasing | `suppliers`, `purchases`, `purchase_items` |
| Accounting | `accounts`, `journal_entries`, `journal_lines`, `cash_drawers`, `drawer_sessions`, `bank_accounts`, `bank_reconciliations`, `payment_settlements` |
| Staff/operations | `salary_payments`, `expenses`, `expense_categories`, `system_settings` |
| Schema control | `schema_migrations` |

## Important relationships

```text
menu_categories -> menu_items -> menu_item_variants
tables -> orders -> order_items
orders -> kots -> kot_items
orders -> bills -> bill_payments / bill_corrections
menu_items -> recipes -> recipe_items -> inventory_items
suppliers -> purchases -> purchase_items -> inventory_items
journal_entries -> journal_lines -> accounts
cash_drawers / bank_accounts / suppliers -> journal_lines
```

Foreign keys use restrictive or explicit delete behavior to protect financial history. Application code must not depend on cascading deletion of completed orders, bills, stock movements, or journals.

## Data conventions

- Primary keys are integer identities/serials.
- Timestamps are stored by the database/runtime and should be serialized consistently.
- Boolean compatibility is handled by the database adapter because SQLite commonly stores `0/1` while PostgreSQL has native booleans.
- Money and quantities use numeric/real columns; application helpers normalize and round at business boundaries.
- Status fields are controlled vocabularies enforced by application logic and, where present, constraints.
- `journal_entries.external_ref` supports idempotent postings.

## Migration workflow

1. Create the next zero-padded SQL file in `migrations/`.
2. Make it safe to apply once through `scripts/migrate.mjs`; prefer idempotent statements where supported.
3. Update code to tolerate rollout order when necessary.
4. Test against a new database and a copy at the previous schema version.
5. Refresh/verify the fresh-install production schema and seeds.
6. Back up production, apply migration, run health and accounting checks, then verify key journeys.

Never edit an already-applied migration to change production history. Add a new corrective migration.
