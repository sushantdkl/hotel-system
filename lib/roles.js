/**
 * Staff roles. Keep dependency-free: imported by middleware-safe modules,
 * client pages and API routes alike.
 *
 * - admin: the owner. Immutable full access.
 * - manager: full operational access to both restaurant and hotel, but cannot
 *   change staff permissions or create/edit admin and manager accounts.
 * - restaurant staff log in to the restaurant side, hotel staff to the hotel.
 */
export const RESTAURANT_STAFF_ROLES = ['cashier', 'waiter', 'kitchen'];
export const HOTEL_STAFF_ROLES = ['receptionist', 'housekeeping', 'maintenance', 'watchman'];
export const ALL_ROLES = ['admin', 'manager', ...RESTAURANT_STAFF_ROLES, ...HOTEL_STAFF_ROLES];
/** SQL CHECK for users.role. Keep the latest migration's list in sync. */
export const ROLE_CHECK_SQL = `CHECK (role IN (${ALL_ROLES.map((r) => `'${r}'`).join(', ')}))`;

export const ROLE_LABELS = {
  admin: 'Owner / Admin',
  manager: 'Manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen: 'Kitchen',
  receptionist: 'Receptionist',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  watchman: 'Watchman / Security',
};

/** Landing page after sign-in for hotel staff roles. */
export const HOTEL_ROLE_HOME = {
  receptionist: '/admin/hotel',
  housekeeping: '/admin/hotel/housekeeping',
  maintenance: '/admin/hotel/maintenance',
  watchman: '/admin/security',
};

export const isAdminLike = (role) => role === 'admin' || role === 'manager';
/** Role whose permissions apply: a custom role (lib/permissions.js) overrides the base role. */
// Subject for permission checks: per-user overrides first, then the custom or built-in role.
export const permissionRole = (user) => {
  const role = user?.custom_role || user?.role;
  return user?.id && !isAdminLike(user.role) ? `user:${user.id}:${role}` : role;
};
export const isHotelStaff = (role) => HOTEL_STAFF_ROLES.includes(role);

/** Login side a role belongs to. Admin and manager may sign in to either. */
export function canSignInTo(side, role) {
  if (isAdminLike(role)) return true;
  return side === 'hotel' ? isHotelStaff(role) : RESTAURANT_STAFF_ROLES.includes(role);
}

/** Only the owner may create, edit or remove admin and manager accounts. */
export const canManageAccount = (actorRole, targetRole) => actorRole === 'admin' || !isAdminLike(targetRole);

/** Admin and manager switch between these workspaces; hotel staff stay in hotel. */
export const WORKSPACES = [
  { id: 'restaurant', label: 'Restaurant', home: '/admin/dashboard' },
  { id: 'hotel', label: 'Hotel', home: '/admin/hotel' },
  { id: 'combined', label: 'Combined', home: '/admin/control-center' },
];
export const WORKSPACE_STORAGE_KEY = 'hms_workspace';
