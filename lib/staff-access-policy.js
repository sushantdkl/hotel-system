/** Browser-safe page authorization policy for the cashier workspace. */
const CASHIER_PAGE_RULES = [
  ['/cashier/employee-performance', 'employee_performance.view'],
  ['/cashier/expense-categories', 'expense_categories.manage'],
  ['/cashier/table-management', 'tables.manage'],
  ['/cashier/kitchen-analytics', 'kitchen_analytics.view'],
  ['/cashier/business-funding', 'business_funding.manage'],
  ['/cashier/summary-report', 'summary.view'],
  ['/cashier/category-sales', 'report.categories.view'],
  ['/cashier/analytics', 'analytics.view'],
  ['/cashier/promotions', 'promotions.manage'],
  ['/cashier/cancellations', 'cancellation_verifications.manage'],
  ['/cashier/employees', 'employees.manage'],
  ['/cashier/settings', 'settings.manage'],
  ['/cashier/printer', 'settings.manage'],
  ['/cashier/combos', 'combos.manage'],
  ['/cashier/tables', 'tables.manage'],
  ['/cashier/leads', 'host_desk.manage'],
  ['/cashier/cms', 'cms.manage'],
  ['/cashier/accounts-receivable', 'customer_ledger.access'],
  ['/cashier/accounts-payable', 'supplier_ledger.access'],
  ['/cashier/inventory/dashboard', 'inventory.dashboard.view'],
  ['/cashier/inventory/movements', 'inventory.movements.view'],
  ['/cashier/inventory-categories', 'inventory.setup.manage'],
  ['/cashier/unit-conversion', 'inventory.setup.manage'],
  ['/cashier/reports/compare', 'reports.view'],
  ['/cashier/previous-day-activity', 'report.previous_day.view'],
  ['/cashier/finance-dashboard', 'finance_dashboard.access'],
  ['/cashier/chart-of-accounts', 'chart_of_accounts.access'],
  ['/cashier/bank-reconciliation', 'bank_reconciliation.access'],
  ['/cashier/financial-reports', 'financial_reports.access'],
  ['/cashier/waiter-requests', 'waiter_calls.access'],
  ['/cashier/payment-history', 'payments.access'],
  ['/cashier/online-orders', 'online_orders.access'],
  ['/cashier/business-days', 'business_days.view'],
  ['/cashier/hrm/departments', 'hrm.departments.manage'],
  ['/cashier/hrm/designations', 'hrm.designations.manage'],
  ['/cashier/hrm/attendance', 'hrm.attendance.manage'],
  ['/cashier/hrm/holidays', 'hrm.holidays.manage'],
  ['/cashier/general-ledger', 'general_ledger.view'],
  ['/cashier/cash-exchange', 'cash_exchange.manage'],
  ['/cashier/cash-drawer', 'cash_drawer.manage'],
  ['/cashier/menu-items', 'menu.manage'],
  ['/cashier/reservations', 'reservations.access'],
  ['/cashier/categories', 'menu.manage'],
  ['/cashier/customers', 'customers.access'],
  ['/cashier/reminders', 'customers.access'],
  ['/cashier/purchases', 'purchases.view'],
  ['/cashier/suppliers', 'suppliers.view'],
  ['/cashier/corrections', 'corrections.manage'],
  ['/cashier/recipes', 'menu.manage'],
  ['/cashier/inventory', 'inventory.manage'],
  ['/cashier/reviews', 'reviews.access'],
  ['/cashier/delivery', 'delivery.manage'],
  ['/cashier/payroll', 'payroll.view'],
  ['/cashier/expenses', 'expenses.manage'],
  ['/cashier/savings', 'savings.manage'],
  ['/cashier/settlements', 'bank.access'],
  ['/cashier/cash-book', 'general_ledger.view'],
  ['/cashier/bank-book', 'general_ledger.view'],
  ['/cashier/bank', 'bank.access'],
  ['/cashier/wastage', 'wastage.manage'],
  ['/cashier/reports', 'reports.view'],
  ['/cashier/dashboard', 'dashboard.view'],
  ['/cashier/billing', 'bills.access'],
  ['/cashier/bills', 'bills.access'],
  ['/cashier/bill', 'bills.access'],
  ['/cashier/kots', 'kot_history.access'],
  ['/cashier/orders', 'order_desk.access'],
  ['/cashier/pos', 'pos.access'],
  ['/cashier', 'order_desk.access'],
].sort((a, b) => b[0].length - a[0].length);

export function permissionForStaffPath(pathname) {
  if (!pathname?.startsWith('/cashier')) return null;
  const match = CASHIER_PAGE_RULES.find(([path]) => (
    pathname === path || (path !== '/cashier' && pathname.startsWith(`${path}/`))
  ));
  return match?.[1] || null;
}

export const CASHIER_PERMISSION_PATHS = Object.freeze(
  CASHIER_PAGE_RULES.map(([path, permission]) => ({ path, permission })),
);

const OPERATIONAL_PAGE_RULES = [
  ['/waiter/new-order', 'orders.create'],
  ['/waiter/reservations', 'reservations.access'],
  ['/waiter/requests', 'waiter_calls.access'],
  ['/waiter/bills', 'bills.access'],
  ['/waiter/kots', 'kot_history.access'],
  ['/waiter/order', 'orders.view'],
  ['/waiter', 'tables.view'],
  ['/kitchen/cancellations', 'cancellation_verifications.manage'],
  ['/kitchen/inventory', 'inventory.view'],
  ['/kitchen/recipes', 'recipes.view'],
  ['/kitchen/kots', 'kot_history.access'],
  ['/kitchen', 'kots.view'],
].sort((a, b) => b[0].length - a[0].length);

export function permissionForOperationalPath(pathname) {
  const match = OPERATIONAL_PAGE_RULES.find(([path]) => (
    pathname === path || pathname.startsWith(`${path}/`)
  ));
  return match?.[1] || null;
}

export const OPERATIONAL_PERMISSION_PATHS = Object.freeze(
  OPERATIONAL_PAGE_RULES.map(([path, permission]) => ({ path, permission })),
);
