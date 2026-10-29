/**
 * Deployment profile — restaurant-agnostic, driven entirely by env vars below.
 *
 * Two supported modes:
 *  - FULL_SERVICE (default): admin + waiter + kitchen + cashier all active,
 *    floor/table/KOT/kitchen-display workflow on.
 *  - COUNTER_READY_SERVE: single admin role, counter/ready-to-serve only.
 *    Staff roles are PRESERVED in the schema and codebase, just gated off.
 *
 * Env overrides (optional):
 *   RESTAURANT_MODE=FULL_SERVICE|COUNTER_READY_SERVE
 *   POS_ENABLED_ROLES="admin,waiter,kitchen,cashier" (admin is always included)
 * Keep this module dependency-free so it is safe to import from middleware.
 */

export const RESTAURANT_MODE = process.env.RESTAURANT_MODE || 'FULL_SERVICE';

const isFullService = RESTAURANT_MODE === 'FULL_SERVICE';

const configuredRoles = (
  process.env.POS_ENABLED_ROLES || (isFullService ? 'admin,waiter,kitchen,cashier' : 'admin')
)
  .split(',')
  .map((r) => r.trim().toLowerCase())
  .filter(Boolean);

// admin is always enabled regardless of env configuration. The restaurant mode
// only gates restaurant staff; manager and hotel staff are always available.
export const ENABLED_ROLES = Array.from(new Set(['admin', 'manager', 'receptionist', 'housekeeping', 'maintenance', 'watchman', ...configuredRoles]));

export const FEATURES = {
  waiterWorkflow: isFullService,
  kitchenDisplay: isFullService,
  kitchenTicket: isFullService,
  requiredTableAssignment: isFullService,
  staffRoleLogin: isFullService,
  reservations: isFullService,
  qrTableOrdering: true,
  counterSaleDefault: !isFullService,
};

/** Legacy role landing routes — only blocked when staffRoleLogin is off. */
export const LEGACY_ROLE_ROUTES = ['/waiter', '/kitchen', '/cashier'];

/** Primary post-login destination — admin dashboard. */
export const PRIMARY_ROUTE = '/admin/dashboard';

/**
 * Admin nav entries hidden in COUNTER_READY_SERVE mode (by href).
 * Routes still exist for historical data; they are only removed from the
 * primary navigation. Derived from the feature flags above.
 */
export const HIDDEN_NAV_HREFS = [
  ...(FEATURES.reservations ? [] : ['/admin/leads', '/cashier/reservations']),
  // Tables stay visible — dashboard / POS / multi-party rely on them.
  ...(FEATURES.kitchenDisplay ? [] : ['/admin/kitchen-analytics']),
  ...(FEATURES.staffRoleLogin ? [] : ['/admin/employee-performance']),
];

export function isFeatureEnabled(name) {
  return Boolean(FEATURES[name]);
}

export function isRoleEnabled(role) {
  return ENABLED_ROLES.includes(String(role || '').toLowerCase());
}

export function isNavHidden(href) {
  return HIDDEN_NAV_HREFS.includes(href);
}
