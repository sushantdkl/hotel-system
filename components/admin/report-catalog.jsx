import {
  Calendar, ChefHat, ClipboardCheck, Contact, DollarSign, Layers, LayoutGrid,
  ReceiptText, ShoppingCart, Truck, Undo2, Users, Wallet, Warehouse,
} from 'lucide-react';

export const REPORT_CATALOG = [
  { id: 'sales', label: 'Sales Report', shortLabel: 'Sales', blurb: 'Invoices, payment splits, categories and daily sales records.', icon: DollarSign, chip: 'bg-emerald-50 text-emerald-600', accent: 'border-t-emerald-400' },
  { id: 'finance', label: 'Finance Report', shortLabel: 'Finance', blurb: 'Expenses, daily profit, tax and VAT records.', icon: Wallet, chip: 'bg-indigo-50 text-indigo-600', accent: 'border-t-indigo-400' },
  { id: 'expenses', label: 'Expenses Report', shortLabel: 'Expenses', blurb: 'Every operating expense with payee, category, payment method, receipt and source details.', icon: ReceiptText, chip: 'bg-rose-50 text-rose-600', accent: 'border-t-rose-400' },
  { id: 'purchases', label: 'Purchases Report', shortLabel: 'Purchases', blurb: 'Received invoices with suppliers, payment methods, item lines, quantities and costs.', icon: ShoppingCart, chip: 'bg-amber-50 text-amber-600', accent: 'border-t-amber-400' },
  { id: 'suppliers', label: 'Suppliers Report', shortLabel: 'Suppliers', blurb: 'Purchase history and supplier-level spending records.', icon: Truck, chip: 'bg-slate-100 text-slate-600', accent: 'border-t-slate-400' },
  { id: 'orders', label: 'Orders Report', shortLabel: 'Orders', blurb: 'Order progress, kitchen cancellations and voided bill records.', icon: ClipboardCheck, chip: 'bg-cyan-50 text-cyan-600', accent: 'border-t-cyan-400' },
  { id: 'changes', label: 'Cancellations & Changes Report', shortLabel: 'Changes', blurb: 'Cancelled orders and items, voids, refunds, revisions and discounts.', icon: Undo2, chip: 'bg-red-50 text-red-600', accent: 'border-t-red-400' },
  { id: 'inventory', label: 'Inventory Report', shortLabel: 'Inventory', blurb: 'Current stock, movements, purchases and low-stock records.', icon: Warehouse, chip: 'bg-lime-50 text-lime-700', accent: 'border-t-lime-400' },
  { id: 'employees', label: 'Employees Report', shortLabel: 'Employees', blurb: 'Employee service and settlement performance records.', icon: Users, chip: 'bg-fuchsia-50 text-fuchsia-600', accent: 'border-t-fuchsia-400' },
  { id: 'tables', label: 'Tables Report', shortLabel: 'Tables', blurb: 'Table performance and served-order records.', icon: LayoutGrid, chip: 'bg-sky-50 text-sky-600', accent: 'border-t-sky-400' },
  { id: 'reservations', label: 'Reservations Report', shortLabel: 'Reservations', blurb: 'Reservation, guest, status, table and waiting-time records.', icon: Calendar, chip: 'bg-violet-50 text-violet-600', accent: 'border-t-violet-400' },
  { id: 'menu', label: 'Menu Report', shortLabel: 'Menu', blurb: 'Item sales, food cost, profit and margin records.', icon: ChefHat, chip: 'bg-orange-50 text-orange-600', accent: 'border-t-orange-400' },
  { id: 'categories', label: 'Category Report', shortLabel: 'Categories', blurb: 'Sales, profit and share by category and master category.', icon: Layers, chip: 'bg-teal-50 text-teal-600', accent: 'border-t-teal-400' },
  { id: 'customers', label: 'Customers Report', shortLabel: 'Customers', blurb: 'Customer visits, spending and lifetime-value records.', icon: Contact, chip: 'bg-pink-50 text-pink-600', accent: 'border-t-pink-400' },
];

export const REPORT_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom dates' },
];

export const reportMeta = (id) => REPORT_CATALOG.find((report) => report.id === id) || REPORT_CATALOG[0];
