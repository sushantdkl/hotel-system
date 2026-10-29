export const previousDate = (date) => new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
export const nextDate = (date) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);

// First reserved night is charged on arrival; subsequent nights become due
// after they have elapsed. Early departure has a one-night minimum. Overstay
// nights use the agreed nightly rate, not the room's current tariff.
export function dueRoomNights(arrival, today) {
  if (arrival > today) return [];
  const last = arrival > previousDate(today) ? arrival : previousDate(today);
  const count = Math.floor((Date.parse(last) - Date.parse(arrival)) / 86400000) + 1;
  if (!Number.isFinite(count) || count > 1000) throw new Error('This stay needs a historical charge review before posting room nights.');
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(arrival) + index * 86400000).toISOString().slice(0, 10));
}

/** Tax on a net amount, integer cents (no floating-point money). */
export const taxedAmount = (netCents, taxBps) => ({ net: netCents, tax: Math.round(netCents * taxBps / 10000), total: netCents + Math.round(netCents * taxBps / 10000) });

/**
 * Folio row kinds and their effect on what the guest owes:
 *   charge  +  service supplied (room night, laundry, restaurant bill, transfer in)
 *   refund  +  money paid back to the guest
 *   payment -  money received (or a deposit, or city-ledger transfer)
 *   credit  -  no money: reversal, allowance/adjustment, transfer out
 */
export const FOLIO_SIGN = { charge: 1, refund: 1, payment: -1, credit: -1 };
export const FOLIO_BALANCE_SQL = "CASE WHEN kind IN ('charge', 'refund') THEN amount_cents ELSE -amount_cents END";

export const folioTotals = (entries) => {
  const out = { charges: 0, credits: 0, payments: 0, refunds: 0, deposits: 0, balance: 0, net: 0, tax: 0, windows: {} };
  for (const entry of entries) {
    const amount = Number(entry.amount_cents);
    const kind = entry.kind;
    const window = Number(entry.window_no || 1);
    out.windows[window] = (out.windows[window] || 0) + (FOLIO_SIGN[kind] || 0) * amount;
    if (kind === 'charge') {
      out.charges += amount;
      out.net += Number(entry.net_cents);
      out.tax += Number(entry.tax_cents);
    } else if (kind === 'credit') {
      out.credits += amount;
      out.net -= Number(entry.net_cents);
      out.tax -= Number(entry.tax_cents);
    } else if (kind === 'payment') {
      out.payments += amount;
      if (entry.category === 'deposit') out.deposits += amount;
    } else if (kind === 'refund') {
      out.refunds += amount;
      if (entry.category === 'deposit') out.deposits -= amount;
    }
  }
  out.balance = out.charges + out.refunds - out.payments - out.credits;
  return out;
};

/**
 * Split a posted night into room and package parts. The package part (meal
 * allowance) is deferred to the Package Allowance Liability until the guest
 * consumes it in the restaurant; the room part is room revenue now. Tax is
 * split in proportion so lines always sum to the folio row total.
 */
export function splitPackage({ net, tax, packageCents }) {
  const total = net + tax;
  const pkg = Math.max(0, Math.min(total, Math.round(packageCents || 0)));
  if (!pkg) return { roomNet: net, roomTax: tax, pkg: 0 };
  const pkgTax = total ? Math.round(tax * pkg / total) : 0;
  const roomTax = tax - pkgTax;
  return { roomNet: total - pkg - roomTax, roomTax, pkg };
}
