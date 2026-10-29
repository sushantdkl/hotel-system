/**
 * Restaurant floor / order lifecycle.
 *
 * Order:  pending → preparing → ready → dining → awaiting_payment → completed
 * Table mirrors order until payment frees it.
 */

import { parseDbDate } from '@/lib/time-utils';

export const ORDER_STATUS = {
  PENDING: 'pending',
  PREPARING: 'preparing',
  READY: 'ready',
  DINING: 'dining',
  /** @deprecated prefer dining — kept for older rows */
  SERVED: 'served',
  AWAITING_PAYMENT: 'awaiting_payment',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const TABLE_STATUS = {
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  COOKING: 'cooking',
  READY: 'ready',
  DINING: 'dining',
  AWAITING_PAYMENT: 'awaiting_payment',
  CLEANING: 'cleaning',
  RESERVED: 'reserved',
};

/** Map order status → table status (while table still linked) */
export function tableStatusFromOrder(orderStatus) {
  switch (orderStatus) {
    case ORDER_STATUS.PENDING:
      return TABLE_STATUS.OCCUPIED;
    case ORDER_STATUS.PREPARING:
      return TABLE_STATUS.COOKING;
    case ORDER_STATUS.READY:
      return TABLE_STATUS.READY;
    case ORDER_STATUS.DINING:
    case ORDER_STATUS.SERVED:
      return TABLE_STATUS.DINING;
    case ORDER_STATUS.AWAITING_PAYMENT:
      return TABLE_STATUS.AWAITING_PAYMENT;
    case ORDER_STATUS.COMPLETED:
    case ORDER_STATUS.CANCELLED:
      return TABLE_STATUS.AVAILABLE;
    default:
      return TABLE_STATUS.OCCUPIED;
  }
}

export function normalizeOrderStatus(status) {
  if (status === ORDER_STATUS.SERVED) return ORDER_STATUS.DINING;
  return status;
}

export function isOpenOrder(status) {
  const s = normalizeOrderStatus(status);
  return ![ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED].includes(s);
}

export function canAddItems(status) {
  const s = normalizeOrderStatus(status);
  return ![
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.AWAITING_PAYMENT,
  ].includes(s);
}

export function canRequestPayment(status) {
  const s = normalizeOrderStatus(status);
  return [ORDER_STATUS.DINING, ORDER_STATUS.READY, ORDER_STATUS.PREPARING, ORDER_STATUS.PENDING].includes(s);
}

export function canCashierBill(status) {
  const s = normalizeOrderStatus(status);
  return [
    ORDER_STATUS.DINING,
    ORDER_STATUS.SERVED,
    ORDER_STATUS.AWAITING_PAYMENT,
    ORDER_STATUS.READY,
  ].includes(s);
}

/** UI meta for table / floor cards */
export const TABLE_STATUS_UI = {
  available: {
    label: 'Available',
    short: 'Free',
    color: 'emerald',
    bg: 'bg-emerald-500',
    soft: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    badge: 'bg-emerald-100 text-emerald-800',
    ring: 'ring-emerald-400',
  },
  occupied: {
    label: 'Occupied',
    short: 'Seated',
    color: 'sky',
    bg: 'bg-sky-500',
    soft: 'bg-sky-50 border-sky-200',
    text: 'text-sky-800',
    badge: 'bg-sky-100 text-sky-800',
    ring: 'ring-sky-400',
  },
  cooking: {
    label: 'Cooking',
    short: 'Kitchen',
    color: 'blue',
    bg: 'bg-blue-500',
    soft: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    badge: 'bg-blue-100 text-blue-800',
    ring: 'ring-blue-400',
  },
  ready: {
    label: 'Ready to Serve',
    short: 'Ready',
    color: 'blue',
    bg: 'bg-blue-500',
    soft: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    badge: 'bg-blue-100 text-blue-800',
    ring: 'ring-blue-400',
  },
  dining: {
    label: 'Dining',
    short: 'Dining',
    color: 'blue',
    bg: 'bg-blue-500',
    soft: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    badge: 'bg-blue-100 text-blue-800',
    ring: 'ring-blue-400',
  },
  awaiting_payment: {
    label: 'Awaiting Payment',
    short: 'Bill',
    color: 'blue',
    bg: 'bg-blue-500',
    soft: 'bg-blue-50 border-blue-200',
    text: 'text-blue-900',
    badge: 'bg-blue-100 text-blue-900',
    ring: 'ring-blue-400',
  },
  cleaning: {
    label: 'Cleaning',
    short: 'Clean',
    color: 'slate',
    bg: 'bg-slate-500',
    soft: 'bg-slate-50 border-slate-200',
    text: 'text-slate-800',
    badge: 'bg-slate-100 text-slate-800',
    ring: 'ring-slate-400',
  },
  reserved: {
    label: 'Reserved Soon',
    short: 'Soon',
    color: 'red',
    bg: 'bg-red-500',
    soft: 'bg-red-50 border-red-200',
    text: 'text-red-900',
    badge: 'bg-red-100 text-red-900',
    ring: 'ring-red-400',
  },
  reserved_arrived: {
    label: 'Guest Arrived',
    short: 'Arrived',
    color: 'red',
    bg: 'bg-red-500',
    soft: 'bg-red-50 border-red-200',
    text: 'text-red-900',
    badge: 'bg-red-100 text-red-900',
    ring: 'ring-red-400',
  },
};

export const ORDER_STATUS_UI = {
  pending: { label: 'New', badge: 'bg-sky-100 text-sky-800' },
  preparing: { label: 'Cooking', badge: 'bg-orange-100 text-orange-800' },
  ready: { label: 'Ready', badge: 'bg-violet-100 text-violet-800' },
  dining: { label: 'Dining', badge: 'bg-blue-100 text-blue-800' },
  served: { label: 'Dining', badge: 'bg-blue-100 text-blue-800' },
  awaiting_payment: { label: 'Awaiting Payment', badge: 'bg-amber-100 text-amber-900' },
  completed: { label: 'Paid', badge: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', badge: 'bg-red-100 text-red-700' },
};

export function formatElapsed(fromIso) {
  if (!fromIso) return '—';
  const start = parseDbDate(fromIso);
  if (!start) return '—';
  const ms = Date.now() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0m';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function urgencyFromCreatedAt(fromIso) {
  if (!fromIso) return 'normal';
  const start = parseDbDate(fromIso);
  if (!start) return 'normal';
  const mins = (Date.now() - start.getTime()) / 60000;
  if (mins >= 30) return 'critical';
  if (mins >= 15) return 'late';
  return 'normal';
}
