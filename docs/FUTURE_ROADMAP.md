# Future Roadmap

This roadmap communicates direction, not committed dates. Reprioritize using customer value, restaurant risk, operational effort, and evidence from production.

## Now — stabilize the single-admin launch

- Keep menu, public ordering, counter checkout, receipts, inventory movements, and journals reliable.
- Expand automated coverage for totals, retries/idempotency, refunds/voids, stock reversal, and authorization.
- Add production observability for latency, error rate, database pool, disk/uploads, backup completion, and business reconciliation exceptions.
- Remove stale documentation/compatibility endpoints or label them explicitly.
- Establish routine restore drills and end-of-day reconciliation.

## Next — operational polish

- Faster counter keyboard flows, barcode support, and resilient printer handling.
- Better order notification/queue experience and explicit online fulfillment controls.
- Low-stock suggestions, purchase approvals, supplier ageing, and stock-count workflows.
- Exportable audit reports and clearer correction histories.
- Accessibility, performance budgets, and deeper mobile/device testing.
- Structured API schemas and generated reference documentation.

## Later — controlled staff-role rollout

- Re-enable waiter, kitchen, and cashier surfaces only after role permissions and end-to-end workflows are requalified.
- Add live order/KOT updates with reconnect and conflict behavior.
- Device/session administration and manager approval for sensitive actions.
- Kitchen timing, waiter attribution, shift controls, and staff training material.

## Explore

- Offline-first counter queue with explicit synchronization and conflict resolution.
- Multi-branch tenancy, branch-aware permissions, menu, stock, and consolidated reporting.
- Payment-provider integrations and automated settlement matching.
- Customer loyalty, offers, delivery zones, and order-status notifications.
- Native mobile or installable PWA experiences where operational evidence supports them.

## Entry criteria for roadmap work

Each initiative needs a problem statement, owner, measurable outcome, security/data review, migration and rollback approach, test plan, documentation update, and operational training/support plan. Financial or stock features also require reconciliation acceptance tests before release.
