// Printable hotel documents: final invoice (checkout statement), live folio,
// registration card and reservation confirmation. Pure HTML builders + print.
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (cents) => new Intl.NumberFormat('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cents) / 100);
const STYLE = `@page{size:A4;margin:16mm}body{font:14px Arial,sans-serif;color:#172b2a;max-width:820px;margin:32px auto;padding:20px}header{border-bottom:2px solid #245b4e;padding-bottom:16px;display:flex;justify-content:space-between;gap:16px}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px}.muted{color:#63706b;font-size:12px}.details{display:flex;justify-content:space-between;gap:24px;margin:20px 0;line-height:1.7}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e0e5e1;vertical-align:top}th{font-size:11px;text-transform:uppercase}.amount{text-align:right;white-space:nowrap}.totals{margin-left:auto;width:340px}.totals td{border:0;padding:4px 8px}.copy{border:1px solid #245b4e;padding:4px 10px;font-size:12px;font-weight:bold;height:fit-content}footer{margin-top:24px;border-top:1px solid #e0e5e1;padding-top:12px}tr{break-inside:avoid}.sign{display:flex;justify-content:space-between;margin-top:56px}.sign div{border-top:1px solid #172b2a;width:220px;padding-top:6px;font-size:12px}@media print{body{margin:0;padding:0}}`;
const KIND_LABEL = { charge: 'Charge', credit: 'Credit', payment: 'Payment', refund: 'Refund' };
const SIGN = { charge: '', refund: '', credit: '−', payment: '−' };

function seller(property) {
  return `<div><h1>${escape(property.name)}</h1>${property.address ? `<div class="muted">${escape(property.address)}</div>` : ''}${property.phone ? `<div class="muted">Phone ${escape(property.phone)}</div>` : ''}
    ${property.pan ? `<div class="muted">PAN ${escape(property.pan)}</div>` : ''}${property.vat ? `<div class="muted">VAT No. ${escape(property.vat)}</div>` : ''}</div>`;
}

/** Final hotel invoice. `copy` = 'ORIGINAL' for the first print, then 'DUPLICATE'. */
export function statementHtml(statement, { copy = 'ORIGINAL' } = {}) {
  const rows = statement.entries.map((entry) => `<tr><td>${escape(entry.service_date)}</td><td>${escape(entry.description)}${entry.room_number && entry.room_number !== statement.room ? ` <span class="muted">(room ${escape(entry.room_number)})</span>` : ''}${Number(entry.window_no || 1) > 1 ? ` <span class="muted">· window ${escape(entry.window_no)}</span>` : ''}</td><td>${escape(KIND_LABEL[entry.kind] || entry.kind)}</td><td class="amount">${SIGN[entry.kind] || ''}${money(entry.amount_cents)}</td></tr>`).join('');
  const t = statement.totals;
  const usage = (statement.packageUsage || []).map((u) => `<tr><td>${escape(u.usage_date)}</td><td>${escape(u.component_label)} · ${escape(String(u.outlet).replace('_', ' '))}${u.bill_number ? ` · bill ${escape(u.bill_number)}` : ''}</td><td class="amount">${money(u.amount_cents)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(statement.number)}</title><style>${STYLE}</style></head><body>
    <header>${seller(statement.property)}<div style="text-align:right"><div class="copy">${escape(copy)}</div><p><strong>TAX INVOICE</strong><br><span class="muted">${escape(statement.number)}<br>Stay ${escape(statement.reservationId)} · ${escape(statement.property.currency)}</span></p></div></header>
    <div class="details"><div><strong>${escape(statement.guest)}</strong>${statement.company ? `<br>${escape(statement.company)}` : ''}${statement.guestAddress ? `<br><span class="muted">${escape(statement.guestAddress)}</span>` : ''}${statement.guestPhone ? `<br><span class="muted">${escape(statement.guestPhone)}</span>` : ''}<br>Room ${escape(statement.room)}</div>
    <div>Arrival: ${escape(statement.arrival)}<br>Departure: ${escape(statement.departure)}<br>Reserved until: ${escape(statement.plannedDeparture)}</div></div>
    <table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="amount">NPR</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="totals"><tbody>
      <tr><td>Taxable amount</td><td class="amount">${money(t.net)}</td></tr><tr><td>Tax (VAT)</td><td class="amount">${money(t.tax)}</td></tr>
      <tr><td>Total charges</td><td class="amount">${money(t.charges - (t.credits || 0))}</td></tr>
      <tr><td>Deposits &amp; payments</td><td class="amount">−${money(t.payments)}</td></tr>${t.refunds ? `<tr><td>Refunds</td><td class="amount">${money(t.refunds)}</td></tr>` : ''}
      <tr><td><strong>Balance</strong></td><td class="amount"><strong>NPR ${money(t.balance)}</strong></td></tr></tbody></table>
    ${usage ? `<h2>Meal-plan allowance used</h2><table><thead><tr><th>Date</th><th>Meal</th><th class="amount">Covered by plan</th></tr></thead><tbody>${usage}</tbody></table><p class="muted">Covered by the room rate; not charged again.</p>` : ''}
    <div class="sign"><div>Guest signature</div><div>Cashier</div></div>
    <footer class="muted">Restaurant bills charged to the room appear once, as charges; amounts covered by the meal plan are shown separately and are not charged. Amounts in NPR.</footer></body></html>`;
}

function openPrint(html) {
  const popup = window.open('', '_blank', 'width=920,height=800');
  if (!popup) throw new Error('Allow popups for this site to print.');
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function printStatement(statement, options) { openPrint(statementHtml(statement, options)); }

/** Registration card for check-in (guest signs; ID details only if recorded). */
export function registrationCardHtml({ property, booking, guest }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Registration ${escape(booking.id)}</title><style>${STYLE}</style></head><body>
    <header>${seller(property)}<div><strong>GUEST REGISTRATION CARD</strong><br><span class="muted">${escape(booking.id)}</span></div></header>
    <table><tbody>
      <tr><th>Guest</th><td>${escape(booking.guest)}</td><th>Phone</th><td>${escape(guest?.phone || booking.phone || '')}</td></tr>
      <tr><th>Nationality</th><td>${escape(guest?.nationality || '')}</td><th>ID</th><td>${escape(guest?.idType || '')} ${escape(guest?.idNumber ? `···${String(guest.idNumber).slice(-4)}` : '')}</td></tr>
      <tr><th>Address</th><td colspan="3">${escape(guest?.address || '')}</td></tr>
      <tr><th>Room</th><td>${escape(booking.roomId)} · ${escape(booking.roomType || '')}</td><th>Guests</th><td>${escape(booking.adults)} adult(s), ${escape(booking.children)} child(ren)</td></tr>
      <tr><th>Arrival</th><td>${escape(booking.start)}</td><th>Departure</th><td>${escape(booking.end)}</td></tr>
      <tr><th>Rate plan</th><td>${escape(booking.meal)}</td><th>Rate</th><td>NPR ${escape(booking.rate)} / night</td></tr>
      <tr><th>Company</th><td>${escape(booking.company)}</td><th>Source</th><td>${escape(booking.source)}</td></tr>
      <tr><th>Requests</th><td colspan="3">${escape(booking.specialRequests)}</td></tr>
    </tbody></table>
    <p class="muted">Check-out time 12:00. I agree to settle all charges on departure. Valuables can be kept in the front-office safe.</p>
    <div class="sign"><div>Guest signature</div><div>Front desk</div></div></body></html>`;
}

export function reservationConfirmationHtml({ property, booking }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Confirmation ${escape(booking.id)}</title><style>${STYLE}</style></head><body>
    <header>${seller(property)}<div><strong>RESERVATION CONFIRMATION</strong><br><span class="muted">${escape(booking.id)}${booking.groupId ? ` · ${escape(booking.groupId)}` : ''}</span></div></header>
    <p>Dear ${escape(booking.guest)}, thank you for your reservation.</p>
    <table><tbody>
      <tr><th>Arrival</th><td>${escape(booking.start)}</td><th>Departure</th><td>${escape(booking.end)}</td></tr>
      <tr><th>Room</th><td>${escape(booking.roomType || '')} (${escape(booking.roomId)})</td><th>Guests</th><td>${escape(booking.adults)} adult(s), ${escape(booking.children)} child(ren)</td></tr>
      <tr><th>Rate plan</th><td>${escape(booking.meal)}</td><th>Status</th><td>${escape(booking.bookingType)}</td></tr>
      <tr><th>Stay value</th><td>NPR ${escape(booking.stayValue)}</td><th>Deposit held</th><td>NPR ${escape(booking.depositHeld)}</td></tr>
      ${booking.specialRequests ? `<tr><th>Requests</th><td colspan="3">${escape(booking.specialRequests)}</td></tr>` : ''}
    </tbody></table><footer class="muted">Prices in NPR including applicable taxes as shown on your final invoice.</footer></body></html>`;
}

export function folioHtml({ property, booking }) {
  const lines = [...booking.entries, ...booking.payments].sort((a, b) => a.id - b.id);
  const rows = lines.map((l) => `<tr><td>${escape(l.date)}</td><td>${escape(l.label)}${l.window > 1 ? ` <span class="muted">· window ${l.window}</span>` : ''}</td><td>${escape(KIND_LABEL[l.kind] || l.kind)}</td><td class="amount">${SIGN[l.kind] || ''}${money(Math.round(l.amount * 100))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Folio ${escape(booking.id)}</title><style>${STYLE}</style></head><body>
    <header>${seller(property)}<div><strong>GUEST FOLIO (interim)</strong><br><span class="muted">${escape(booking.id)} · room ${escape(booking.roomId)}</span></div></header>
    <p><strong>${escape(booking.guest)}</strong> · ${escape(booking.start)} to ${escape(booking.end)}</p>
    <table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="amount">NPR</th></tr></thead><tbody>${rows}</tbody></table>
    <h2 class="amount">Balance NPR ${money(Math.round(booking.balance * 100))}</h2><footer class="muted">Interim folio, not a tax invoice.</footer></body></html>`;
}

export const printHtml = openPrint;
