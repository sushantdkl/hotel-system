// Display helpers shared by hotel screens. Pure: no database access.
export const money = (amount) => new Intl.NumberFormat('en-NP', { style: 'currency', currency: 'NPR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
export const shortDate = (date) => new Date(`${date}T12:00:00+05:45`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' });
export const nightsBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
export const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart;

export const ROOM_STATES = {
  available: { label: 'Ready', tone: 'green' },
  occupied: { label: 'Occupied', tone: 'blue' },
  departure: { label: 'Due out', tone: 'amber' },
  dirty: { label: 'Needs cleaning', tone: 'rose' },
  cleaning: { label: 'Cleaning', tone: 'violet' },
  inspection: { label: 'Inspection', tone: 'amber' },
  blocked: { label: 'Out of order', tone: 'gray' },
  service: { label: 'Out of service', tone: 'gray' },
};

// Folio balance from the server (charges + refunds - payments - credits).
export const balance = (booking) => (typeof booking.balance === 'number' ? booking.balance
  : Math.round((booking.entries.reduce((sum, line) => sum + (line.kind === 'credit' ? -1 : 1) * line.amount, 0) - booking.payments.reduce((sum, line) => sum + (line.kind === 'refund' ? -1 : 1) * line.amount, 0)) * 100) / 100);

export const HK_LABEL = { ready: 'Inspected', inspection: 'Clean · inspect', cleaning: 'Cleaning', dirty: 'Dirty' };
export const SOURCE_LABEL = { ROOM: 'Room', RESTAURANT: 'Restaurant', ROOM_SERVICE: 'Room service', LAUNDRY: 'Laundry', MINIBAR: 'Minibar', TRANSPORT: 'Transport', EARLY_CHECKIN: 'Early check-in', LATE_CHECKOUT: 'Late checkout', EXTRA_BED: 'Extra bed', DAMAGE: 'Damage', EVENT: 'Event', OTHER: 'Other', PAYMENT: 'Payment', DEPOSIT: 'Deposit', REFUND: 'Refund' };
export const BOOKING_TYPE_LABEL = { tentative: 'Tentative', confirmed: 'Confirmed', guaranteed: 'Guaranteed', waitlist: 'Waitlist' };
/** Occupancy state separate from housekeeping: vacant / reserved / occupied / due out / out of order / out of service. */
export function occupancyState(state, room) {
  if (room.blocked) return room.blockKind === 'out_of_service' ? 'Out of service' : 'Out of order';
  const stay = activeStay(state, room.id);
  if (stay) return stay.end <= state.businessDate ? 'Due out' : 'Occupied';
  return state.bookings.some((b) => b.roomId === room.id && b.status === 'confirmed' && b.start === state.businessDate) ? 'Reserved' : 'Vacant';
}
export const activeStay = (state, roomId) => state.bookings.find((b) => b.roomId === roomId && b.status === 'in_house');
export function roomState(state, room) {
  if (room.blocked) return room.blockKind === 'out_of_service' ? 'service' : 'blocked';
  const stay = activeStay(state, room.id);
  if (stay) return stay.end <= state.businessDate ? 'departure' : 'occupied';
  return room.cleaning === 'ready' ? 'available' : room.cleaning;
}
export function roomAvailable(state, roomId, start, end, exceptId) {
  const room = state.rooms.find((r) => r.id === roomId);
  return Boolean(room && !room.blocked && !state.bookings.some((b) => b.id !== exceptId && b.roomId === roomId && ['confirmed', 'in_house'].includes(b.status) && b.bookingType !== 'waitlist' && (overlaps(start, end, b.start, b.end) || (b.status === 'in_house' && b.end <= state.businessDate))));
}
