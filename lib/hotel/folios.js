/**
 * Guest folio engine. Every row belongs to a stay (hotel_reservations.id), never
 * to a room number; the room is stored only as a snapshot, so charges stay with
 * the guest through room moves. Posted rows are never edited: corrections are a
 * reversal (credit row with reversal_of) plus a new corrected charge.
 *
 * Accounting (existing double-entry engine, account codes not ids):
 *   charge (hotel service)  Dr 1320 Guest receivable / Cr revenue (by source) + 2020 tax [+ 2160 package part of a room night]
 *   charge (restaurant)     no journal: the restaurant sale journal already did Dr 1320 / Cr 4010 (revenue once)
 *   charge/credit transfer  no journal: receivable moves between guest folios (not revenue)
 *   payment                 Dr Cash 1010 / Bank 1020 / City ledger 1330, Cr 1320
 *   deposit (before arrival)Dr Cash/Bank, Cr 2150 Guest Advance Deposits (liability, not revenue)
 *   deposit application     Dr 2150, Cr 1320 (at checkout / cancellation / on demand)
 *   refund                  Dr 1320 (overpayment) or 2150 (unapplied deposit), Cr Cash/Bank
 *   reversal / adjustment   mirror of the original lines / Dr revenue + 2020, Cr 1320
 */
import { randomUUID } from 'node:crypto';
import { ensureAccountingSchema, postJournal, primaryBankAccountId } from '../accounting.js';
import { ensureBusinessDaySchema } from '../business-days.js';
import { dueRoomNights, folioTotals, splitPackage, taxedAmount } from './folio-math.js';
import { nightRate, stayDates } from './rates.js';
import { createCleaningTask } from './operations.js';
import { nightPackageCents, settlePackage } from './packages.js';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
export const HOTEL_ACCOUNTS = [
  ['1320', 'Hotel Guest Receivables', 'asset', 'hotel_receivable', '1000'],
  ['1330', 'Corporate & Agent Receivables', 'asset', 'city_ledger', '1000'],
  ['2150', 'Guest Advance Deposits', 'liability', 'guest_deposits', '2000'],
  ['2160', 'Package Allowance Liability', 'liability', 'package_allowance', '2000'],
  ['4030', 'Hotel Room Revenue', 'income', 'hotel_rooms', '4000'],
  ['4040', 'Hotel Service Revenue', 'income', 'hotel_services', '4000'],
  ['4041', 'Laundry Revenue', 'income', 'hotel_laundry', '4000'],
  ['4042', 'Minibar Revenue', 'income', 'hotel_minibar', '4000'],
  ['4043', 'Transport Revenue', 'income', 'hotel_transport', '4000'],
  ['4045', 'Package Breakage Revenue', 'income', 'hotel_package_breakage', '4000'],
];

/**
 * Folio source types. `account` is the revenue account; `linked` sources are
 * posted by another module that already recognized the revenue (no journal here).
 * Department is used by departmental reporting.
 */
export const FOLIO_SOURCES = {
  ROOM: { label: 'Room night', account: '4030', category: 'room', department: 'ROOMS' },
  EARLY_CHECKIN: { label: 'Early check-in', account: '4030', category: 'service', department: 'ROOMS' },
  LATE_CHECKOUT: { label: 'Late checkout', account: '4030', category: 'service', department: 'ROOMS' },
  EXTRA_BED: { label: 'Extra bed', account: '4030', category: 'service', department: 'ROOMS' },
  LAUNDRY: { label: 'Laundry', account: '4041', category: 'service', department: 'LAUNDRY' },
  MINIBAR: { label: 'Minibar', account: '4042', category: 'service', department: 'MINIBAR' },
  TRANSPORT: { label: 'Transport', account: '4043', category: 'service', department: 'TRANSPORT' },
  DAMAGE: { label: 'Damage', account: '4040', category: 'service', department: 'OTHER' },
  EVENT: { label: 'Event', account: '4040', category: 'service', department: 'BANQUETS' },
  OTHER: { label: 'Other service', account: '4040', category: 'service', department: 'OTHER' },
  RESTAURANT: { label: 'Restaurant', linked: true, category: 'service', department: 'FOOD_BEVERAGE' },
  ROOM_SERVICE: { label: 'Room service', linked: true, category: 'service', department: 'FOOD_BEVERAGE' },
};
export const MANUAL_CHARGE_SOURCES = ['EARLY_CHECKIN', 'LATE_CHECKOUT', 'EXTRA_BED', 'LAUNDRY', 'MINIBAR', 'TRANSPORT', 'DAMAGE', 'OTHER'];
export const PAYMENT_METHODS = ['Cash', 'Online', 'Card', 'Bank', 'City Ledger'];

export async function prepareHotelAccounting(db) {
  // Setup finishes before the business transaction so a rollback never leaves
  // an in-process schema flag claiming uncommitted setup was installed.
  await ensureAccountingSchema(db);
  await ensureBusinessDaySchema(db);
  for (const [code, name, type, subtype, parent] of HOTEL_ACCOUNTS) {
    await db.run(
      `INSERT INTO accounts (code, name, type, subtype, parent_id, is_system)
       VALUES (?, ?, ?, ?, (SELECT id FROM accounts WHERE code = ?), 1) ON CONFLICT(code) DO NOTHING`,
      [code, name, type, subtype, parent]
    );
    const account = await db.get('SELECT type, subtype FROM accounts WHERE code = ?', [code]);
    if (account?.type !== type || account?.subtype !== subtype) fail(`Account ${code} is already used for another purpose. Resolve its hotel account mapping before posting.`);
  }
}

export async function postingDay(tx, today) {
  const day = await tx.get(`SELECT id, business_date FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1${tx.driver === 'postgres' ? ' FOR UPDATE' : ''}`);
  if (!day || String(day.business_date).slice(0, 10) !== today) fail('Open today’s business day in Opening & Closing before posting hotel charges or payments.');
  const session = await tx.get(`SELECT s.id, ds.drawer_id FROM business_day_sessions s
    JOIN drawer_sessions ds ON ds.id = s.drawer_session_id AND ds.status = 'open'
    WHERE s.business_day_id = ? AND s.status = 'open' ORDER BY s.session_number DESC LIMIT 1`, [day.id]);
  if (!session) fail('Reopen the business session in Opening & Closing before posting hotel charges or payments.');
  return { id: day.id, drawerId: session.drawer_id };
}

export async function loadFolio(tx, reservationId) {
  return tx.all('SELECT * FROM hotel_folio_entries WHERE reservation_id = ? ORDER BY id', [reservationId]);
}

export async function loadStay(tx, id) {
  return tx.get("SELECT b.*, r.room_number, r.room_type, r.cleaning_status, r.blocked FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.id = ? AND b.property_id = 'main'", [id]);
}

const isOpenStay = (stay) => stay && ['confirmed', 'in_house'].includes(stay.status) && !stay.checked_out_at;

/** Where a charge of `sourceType` for `booking` lands: routing rules first. */
export async function routeCharge(tx, booking, sourceType, window = null) {
  if (window) return { stay: booking, window };
  const rules = await tx.all('SELECT * FROM hotel_routing_rules WHERE reservation_id = ? AND active = 1 ORDER BY created_at, id', [booking.id]);
  for (const rule of rules) {
    const types = String(rule.source_types).split(',').map((t) => t.trim());
    if (!types.includes('*') && !types.includes(sourceType)) continue;
    const target = rule.target_reservation_id === booking.id ? booking : await loadStay(tx, rule.target_reservation_id);
    if (isOpenStay(target)) return { stay: target, window: Number(rule.target_window), routed: target.id !== booking.id };
  }
  return { stay: booking, window: 1 };
}

const moneyAccount = async (tx, method, day) => {
  if (!PAYMENT_METHODS.includes(method)) fail(`Choose ${PAYMENT_METHODS.join(', ')}.`, 400);
  if (method === 'Cash') return { code: '1010', drawer_id: day.drawerId };
  if (method === 'City Ledger') return { code: '1330' };
  const bankId = await primaryBankAccountId(tx);
  if (!bankId) fail('Configure an active Primary Bank before recording a non-cash guest payment or refund.');
  return { code: '1020', bank_account_id: bankId };
};

async function insertRow(tx, row) {
  const cols = ['reservation_id', 'kind', 'category', 'description', 'service_date', 'net_cents', 'tax_cents', 'amount_cents', 'payment_method', 'source_key', 'journal_id', 'business_day_id', 'created_by',
    'source_type', 'source_id', 'room_number', 'quantity', 'unit_cents', 'discount_cents', 'package_cents', 'window_no', 'reversal_of', 'transfer_ref', 'reason', 'city_ledger_account'];
  const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
  for (const [c, d] of [['quantity', 1], ['discount_cents', 0], ['package_cents', 0], ['window_no', 1], ['source_type', 'OTHER']]) if (values[cols.indexOf(c)] == null) values[cols.indexOf(c)] = d;
  const inserted = await tx.run(`INSERT INTO hotel_folio_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, values);
  const id = inserted.lastInsertRowid || (await tx.get('SELECT id FROM hotel_folio_entries WHERE source_key = ?', [row.source_key])).id;
  return Number(id);
}

const journalFor = async (tx, entryId, { today, actor, day, sourceType, memo, key, lines }) => {
  const journalId = await postJournal(tx, { entry_date: today, source_type: sourceType, source_id: entryId, external_ref: `hotel:${key}`, memo, created_by: actor.id, business_day_id: day?.id || null, lines });
  await tx.run('UPDATE hotel_folio_entries SET journal_id = ? WHERE id = ?', [journalId, entryId]);
  return journalId;
};

/**
 * Post a charge to a stay's folio (routing rules applied). Idempotent on `key`.
 * `linked` sources pass `journalId` of the journal that already recognized revenue.
 */
export async function postCharge(tx, { booking, actor, day, today, sourceType = 'OTHER', description, netCents, taxBps = null, taxCents = null, quantity = 1, unitCents = null, discountCents = 0, key, date = null, sourceId = null, packageCents = 0, window = null, reason = null, journalId = null, skipLimits = false }) {
  const source = FOLIO_SOURCES[sourceType];
  if (!source) fail(`Unknown folio source ${sourceType}.`, 400);
  const prior = await tx.get('SELECT id, reservation_id FROM hotel_folio_entries WHERE source_key = ?', [key]);
  if (prior) return { id: Number(prior.id), stayId: prior.reservation_id, duplicate: true };
  const { stay, window: windowNo, routed } = await routeCharge(tx, booking, sourceType, window);
  const tax = taxCents ?? Math.round(netCents * Number(taxBps ?? booking.room_tax_bps ?? 0) / 10000);
  const total = netCents + tax;
  if (!skipLimits && stay.credit_limit_cents != null) {
    const balance = folioTotals(await loadFolio(tx, stay.id)).balance;
    if (balance + total > Number(stay.credit_limit_cents)) fail(`This charge would take ${stay.guest_name}'s folio over its credit limit of NPR ${(Number(stay.credit_limit_cents) / 100).toFixed(2)}. Collect a payment first or ask a manager to raise the limit.`);
  }
  const text = routed ? `Room ${booking.room_number} · ${description}` : description;
  const id = await insertRow(tx, {
    reservation_id: stay.id, kind: 'charge', category: source.category, description: text, service_date: date || today,
    net_cents: netCents, tax_cents: tax, amount_cents: total, source_key: key, journal_id: journalId, business_day_id: day?.id || null, created_by: actor.id,
    source_type: sourceType, source_id: sourceId, room_number: booking.room_number, quantity, unit_cents: unitCents, discount_cents: discountCents,
    package_cents: source.linked ? 0 : packageCents, window_no: windowNo, reason,
  });
  if (!source.linked && total > 0) {
    const { roomNet, roomTax, pkg } = splitPackage({ net: netCents, tax, packageCents });
    await journalFor(tx, id, { today, actor, day, sourceType: 'hotel_charge', key, memo: `${stay.id} · ${text}`, lines: [
      { code: '1320', debit: total / 100 },
      { code: source.account, credit: roomNet / 100 },
      ...(roomTax ? [{ code: '2020', credit: roomTax / 100 }] : []),
      ...(pkg ? [{ code: '2160', credit: pkg / 100, memo: 'Meal-plan allowance deferred until consumed' }] : []),
    ] });
  }
  return { id, stayId: stay.id, routed };
}

/** Credit (reversal/adjustment/transfer) row without money. */
async function postCredit(tx, row) {
  return insertRow(tx, { kind: 'credit', payment_method: null, ...row });
}

export async function unappliedDeposit(tx, reservationId) {
  const rows = await tx.get(`SELECT
      COALESCE(SUM(CASE WHEN kind = 'payment' AND category = 'deposit' THEN amount_cents ELSE 0 END), 0) AS received,
      COALESCE(SUM(CASE WHEN kind = 'refund' AND category = 'deposit' THEN amount_cents ELSE 0 END), 0) AS refunded
    FROM hotel_folio_entries WHERE reservation_id = ?`, [reservationId]);
  const applied = await tx.get('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM hotel_deposit_applications WHERE reservation_id = ?', [reservationId]);
  return Number(rows.received) - Number(rows.refunded) - Number(applied.c);
}

/** Move unapplied deposit from the liability to the guest receivable. */
export async function applyDeposits(tx, { booking, actor, day, today, key }) {
  const amount = await unappliedDeposit(tx, booking.id);
  if (amount <= 0) return 0;
  const id = randomUUID();
  const sourceKey = `deposit-apply:${booking.id}:${key}`;
  const journalId = await postJournal(tx, {
    entry_date: today, source_type: 'hotel_deposit', source_id: null, external_ref: `hotel:${sourceKey}`,
    memo: `${booking.id} · advance deposit applied to guest balance`, created_by: actor.id, business_day_id: day.id,
    lines: [{ code: '2150', debit: amount / 100 }, { code: '1320', credit: amount / 100 }],
  });
  await tx.run('INSERT INTO hotel_deposit_applications (id, reservation_id, amount_cents, journal_id, business_day_id, source_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, booking.id, amount, journalId, day.id, sourceKey, actor.id]);
  return amount;
}

async function audit(tx, actor, action, entityId, message, { reason = null, today = null, details = {} } = {}) {
  await tx.run("INSERT INTO hotel_audit_events (id, property_id, actor_id, action, entity_id, details, reason, business_date) VALUES (?, 'main', ?, ?, ?, ?, ?, ?)",
    [randomUUID(), actor.id, action, entityId, JSON.stringify({ message, ...details }), reason, today]);
}

async function ownerAlert(tx, actor, severity, title, message, link) {
  await tx.run('INSERT INTO owner_alerts (created_by, severity, category, title, message, link_label) VALUES (?, ?, ?, ?, ?, ?)', [actor.id, severity, 'Other', title, message, link || null]);
}
export const LARGE_ADJUSTMENT_CENTS = 500000; // NPR 5,000: refunds/adjustments above this alert the owner

/**
 * Dates already posted for a stay. Nights are keyed night:<stay>:<date>, so a
 * night routed to a master folio still counts as posted for its own stay.
 */
export async function postedNightDates(tx, stayId) {
  const rows = await tx.all("SELECT source_key FROM hotel_folio_entries WHERE source_key LIKE ? AND kind = 'charge'", [`night:${stayId}:%`]);
  return new Set(rows.map((r) => String(r.source_key).slice(-10)));
}

/** Room nights due and not yet posted (night audit + manual post). Idempotent per night. */
export async function postDueNights(tx, booking, actor, today, day = null) {
  const posted = await postedNightDates(tx, booking.id);
  const unposted = dueRoomNights(booking.arrival_date, today).filter((date) => !posted.has(date));
  if (!unposted.length) return 0;
  const postDay = day || await postingDay(tx, today);
  const pkgPerNight = await nightPackageCents(tx, booking);
  let count = 0;
  for (const date of unposted) {
    const { net, tax } = taxedAmount(nightRate(booking, date), Number(booking.room_tax_bps));
    const result = await postCharge(tx, {
      booking, actor, day: postDay, today, sourceType: 'ROOM', description: `Room ${booking.room_number} · night of ${date}`, date,
      netCents: net, taxCents: tax, unitCents: net, key: `night:${booking.id}:${date}`, packageCents: pkgPerNight, skipLimits: true,
    });
    if (!result.duplicate) count += 1;
  }
  return count;
}

export async function processFolioCommand(tx, action, actor, requestKey, today, { may = () => true } = {}) {
  const booking = await loadStay(tx, action.id);
  if (!booking) fail('Stay not found.', 404);
  // Deposits, refunds and fees (e.g. cancellation) also work before arrival.
  const beforeArrival = ['payment', 'refund', 'charge', 'apply_deposit'].includes(action.type) && booking.status === 'confirmed';
  if ((booking.status !== 'in_house' && !beforeArrival) || booking.checked_out_at) fail('This action requires an active in-house stay or a confirmed reservation.');
  const entries = await loadFolio(tx, booking.id);
  const totals = folioTotals(entries);
  const revisionOk = () => action.revision === entries.length;

  if (action.type === 'post_nights') {
    const count = await postDueNights(tx, booking, actor, today);
    return { id: booking.id, message: count ? `${count} room night(s) posted to ${booking.id}.` : 'All due room nights are already posted.' };
  }
  if (action.type === 'charge') {
    if (!action.description || action.description.length > 120) fail('Enter a charge description (up to 120 characters).', 400);
    const sourceType = action.sourceType || 'OTHER';
    if (!MANUAL_CHARGE_SOURCES.includes(sourceType)) fail('Choose a charge type.', 400);
    const quantity = action.quantity || 1;
    const day = await postingDay(tx, today);
    await postCharge(tx, { booking, actor, day, today, sourceType, description: quantity > 1 ? `${action.description} x${quantity}` : action.description, netCents: action.amountCents * quantity, quantity, unitCents: action.amountCents, key: `charge:${requestKey}`, window: action.window || null });
    return { id: booking.id, message: `${FOLIO_SOURCES[sourceType].label} charge posted.` };
  }
  if (action.type === 'payment') {
    const method = action.method;
    if (!PAYMENT_METHODS.includes(method)) fail(`Choose ${PAYMENT_METHODS.join(', ')}.`, 400);
    if (!revisionOk()) fail('The folio changed. Refresh and review the balance before collecting payment.');
    const window = Number(action.window || 1);
    if (beforeArrival) {
      if (method === 'City Ledger') fail('A deposit must be received in cash or to the bank.', 400);
      // Advance deposit: up to the reserved stay's value plus posted charges.
      const stayValue = stayDates(booking.arrival_date, booking.departure_date).reduce((sum, date) => sum + taxedAmount(nightRate(booking, date), Number(booking.room_tax_bps)).total, 0);
      if (action.amountCents > stayValue + totals.balance) fail('A deposit cannot exceed the reserved stay value less deposits already received.');
    } else if (action.amountCents > (totals.windows[window] || 0)) fail(`Payment exceeds the posted balance of window ${window}. Post due charges first, or enter a smaller payment.`);
    if (method === 'City Ledger' && !action.account) fail('Enter the company or agent account the balance is billed to.', 400);
    const day = await postingDay(tx, today);
    const money = await moneyAccount(tx, method, day);
    const key = `payment:${requestKey}`;
    const id = await insertRow(tx, {
      reservation_id: booking.id, kind: 'payment', category: beforeArrival ? 'deposit' : 'payment', source_type: beforeArrival ? 'DEPOSIT' : 'PAYMENT',
      description: beforeArrival ? `Advance deposit · ${method}` : method === 'City Ledger' ? `Billed to ${action.account} (city ledger)` : `Payment received · ${method}`,
      service_date: today, net_cents: action.amountCents, tax_cents: 0, amount_cents: action.amountCents, payment_method: method, source_key: key,
      business_day_id: day.id, created_by: actor.id, room_number: booking.room_number, window_no: window, city_ledger_account: method === 'City Ledger' ? action.account : null,
    });
    await journalFor(tx, id, { today, actor, day, sourceType: 'hotel_payment', key, memo: `${booking.id} · ${beforeArrival ? 'advance deposit' : 'guest payment'} · ${method}`, lines: [
      { ...money, debit: action.amountCents / 100, memo: method === 'City Ledger' ? `City ledger: ${action.account}` : undefined },
      { code: beforeArrival ? '2150' : '1320', credit: action.amountCents / 100 },
    ] });
    return { id: booking.id, message: beforeArrival ? 'Advance deposit recorded as a guest deposit (liability).' : method === 'City Ledger' ? `Balance transferred to ${action.account} on the city ledger.` : 'Guest payment recorded in the folio and ledger.' };
  }
  if (action.type === 'refund') {
    if (!['Cash', 'Online', 'Card', 'Bank'].includes(action.method)) fail('Choose Cash, Online, Card or Bank.', 400);
    if (!revisionOk()) fail('The folio changed. Refresh and review the balance before refunding.');
    if (action.amountCents > -totals.balance) fail('A refund cannot exceed the guest’s credit balance.');
    if (!action.reason) fail('Enter the reason for the refund.', 400);
    const held = await unappliedDeposit(tx, booking.id);
    const deposit = Math.min(action.amountCents, held);
    if (deposit && deposit !== action.amountCents) fail(`Refund the advance deposit (NPR ${(held / 100).toFixed(2)}) and any overpayment as separate refunds.`, 400);
    const day = await postingDay(tx, today);
    const money = await moneyAccount(tx, action.method, day);
    const key = `refund:${requestKey}`;
    const id = await insertRow(tx, {
      reservation_id: booking.id, kind: 'refund', category: deposit === action.amountCents ? 'deposit' : 'payment', source_type: 'REFUND',
      description: `Refund to guest · ${action.method}`, service_date: today, net_cents: action.amountCents, tax_cents: 0, amount_cents: action.amountCents,
      payment_method: action.method, source_key: key, business_day_id: day.id, created_by: actor.id, room_number: booking.room_number, reason: action.reason,
    });
    // Deposit still held as a liability is refunded from 2150; any overpayment from 1320.
    await journalFor(tx, id, { today, actor, day, sourceType: 'hotel_payment', key, memo: `${booking.id} · refund · ${action.reason}`, lines: [
      ...(deposit ? [{ code: '2150', debit: deposit / 100 }] : []),
      ...(action.amountCents - deposit ? [{ code: '1320', debit: (action.amountCents - deposit) / 100 }] : []),
      { ...money, credit: action.amountCents / 100 },
    ] });
    if (action.amountCents >= LARGE_ADJUSTMENT_CENTS) await ownerAlert(tx, actor, 'medium', `Hotel refund: ${booking.guest_name}`, `NPR ${(action.amountCents / 100).toFixed(2)} refunded on ${booking.id} (${action.method}). Reason: ${action.reason}.`, `Room ${booking.room_number}`);
    await audit(tx, actor, 'folio_refund', booking.id, `Refund NPR ${(action.amountCents / 100).toFixed(2)} on ${booking.id}.`, { reason: action.reason, today });
    return { id: booking.id, message: 'Refund recorded in the folio and ledger.' };
  }
  if (action.type === 'apply_deposit') {
    const day = await postingDay(tx, today);
    const applied = await applyDeposits(tx, { booking, actor, day, today, key: requestKey });
    return { id: booking.id, message: applied ? `NPR ${(applied / 100).toFixed(2)} deposit applied to the guest balance.` : 'No unapplied deposit on this stay.' };
  }
  if (action.type === 'reverse') {
    if (!may('hotel.folio_adjust')) fail('Your role cannot reverse folio transactions.', 403);
    if (!action.reason) fail('Enter the reason for the reversal.', 400);
    const original = entries.find((e) => Number(e.id) === Number(action.entryId));
    if (!original || original.kind !== 'charge') fail('Choose a posted charge on this folio to reverse.', 400);
    if (FOLIO_SOURCES[original.source_type]?.linked) fail('This is a restaurant bill. Void or refund it in the restaurant; the folio follows automatically.');
    if (original.transfer_ref) fail('This charge was transferred in. Transfer it back instead of reversing it.');
    if (entries.some((e) => Number(e.reversal_of) === Number(original.id))) fail('This charge was already reversed or transferred.');
    const day = await postingDay(tx, today);
    const key = `reverse:${original.id}`;
    const id = await postCredit(tx, {
      reservation_id: booking.id, category: 'adjustment', description: `Reversal of #${original.id} · ${original.description}`, service_date: today,
      net_cents: Number(original.net_cents), tax_cents: Number(original.tax_cents), amount_cents: Number(original.amount_cents), source_key: key,
      business_day_id: day.id, created_by: actor.id, source_type: original.source_type, source_id: original.source_id, room_number: original.room_number,
      window_no: Number(original.window_no), reversal_of: Number(original.id), reason: action.reason,
    });
    if (original.journal_id) {
      const lines = await tx.all('SELECT l.debit, l.credit, l.account_id FROM journal_lines l WHERE l.journal_id = ?', [original.journal_id]);
      await journalFor(tx, id, { today, actor, day, sourceType: 'hotel_reversal', key, memo: `${booking.id} · reversal of folio #${original.id} · ${action.reason}`,
        lines: lines.map((l) => ({ account_id: l.account_id, debit: Number(l.credit), credit: Number(l.debit) })) });
    }
    await audit(tx, actor, 'folio_reversal', booking.id, `Folio #${original.id} reversed (${original.description}).`, { reason: action.reason, today, details: { entryId: Number(original.id), amount: Number(original.amount_cents) / 100 } });
    if (Number(original.amount_cents) >= LARGE_ADJUSTMENT_CENTS) await ownerAlert(tx, actor, 'medium', `Folio reversal: ${booking.guest_name}`, `NPR ${(Number(original.amount_cents) / 100).toFixed(2)} reversed on ${booking.id}: ${original.description}. Reason: ${action.reason}.`, `Room ${booking.room_number}`);
    return { id: booking.id, message: `Charge #${original.id} reversed. Post the corrected charge if needed.` };
  }
  if (action.type === 'adjust') {
    if (!may('hotel.folio_adjust')) fail('Your role cannot post folio allowances or adjustments.', 403);
    if (!action.reason) fail('Enter the reason for the adjustment.', 400);
    const sourceType = action.sourceType || 'OTHER';
    const source = FOLIO_SOURCES[sourceType];
    if (!source || source.linked) fail('Choose the charge type the allowance applies to.', 400);
    if (action.amountCents > totals.balance) fail('An allowance cannot exceed the open balance.');
    const day = await postingDay(tx, today);
    const bps = Number(booking.room_tax_bps || 0);
    const tax = Math.round(action.amountCents * bps / (10000 + bps));
    const key = `adjust:${requestKey}`;
    const id = await postCredit(tx, {
      reservation_id: booking.id, category: 'adjustment', description: `Allowance · ${source.label} · ${action.reason}`, service_date: today,
      net_cents: action.amountCents - tax, tax_cents: tax, amount_cents: action.amountCents, source_key: key, business_day_id: day.id, created_by: actor.id,
      source_type: sourceType, room_number: booking.room_number, window_no: Number(action.window || 1), reason: action.reason,
    });
    await journalFor(tx, id, { today, actor, day, sourceType: 'hotel_reversal', key, memo: `${booking.id} · allowance · ${action.reason}`, lines: [
      { code: source.account, debit: (action.amountCents - tax) / 100 }, ...(tax ? [{ code: '2020', debit: tax / 100 }] : []), { code: '1320', credit: action.amountCents / 100 },
    ] });
    await audit(tx, actor, 'folio_adjustment', booking.id, `Allowance NPR ${(action.amountCents / 100).toFixed(2)} on ${booking.id}.`, { reason: action.reason, today });
    await ownerAlert(tx, actor, action.amountCents >= LARGE_ADJUSTMENT_CENTS ? 'urgent' : 'low', `Folio allowance: ${booking.guest_name}`, `NPR ${(action.amountCents / 100).toFixed(2)} ${source.label.toLowerCase()} allowance on ${booking.id}. Reason: ${action.reason}.`, `Room ${booking.room_number}`);
    return { id: booking.id, message: 'Allowance posted.' };
  }
  if (action.type === 'transfer') {
    if (!may('hotel.folio_transfer')) fail('Your role cannot transfer folio charges.', 403);
    if (!action.reason) fail('Enter the reason for the transfer.', 400);
    const original = entries.find((e) => Number(e.id) === Number(action.entryId));
    if (!original || original.kind !== 'charge') fail('Choose a charge on this folio to transfer.', 400);
    if (entries.some((e) => Number(e.reversal_of) === Number(original.id))) fail('This charge was already reversed or transferred.');
    const target = action.targetId && action.targetId !== booking.id ? await loadStay(tx, action.targetId) : booking;
    if (!isOpenStay(target)) fail('Transfer to an open stay (confirmed or in-house).');
    const window = Number(action.window || 1);
    if (target.id === booking.id && window === Number(original.window_no)) fail('Choose a different window or stay.', 400);
    const ref = `T-${randomUUID().slice(0, 8).toUpperCase()}`;
    const day = await postingDay(tx, today);
    const base = { net_cents: Number(original.net_cents), tax_cents: Number(original.tax_cents), amount_cents: Number(original.amount_cents), service_date: original.service_date, business_day_id: day.id, created_by: actor.id, source_type: original.source_type, source_id: original.source_id, room_number: original.room_number, transfer_ref: ref, reason: action.reason };
    await postCredit(tx, { ...base, reservation_id: booking.id, category: 'transfer', description: `Transferred to ${target.id === booking.id ? `window ${window}` : `room ${target.room_number} (${target.guest_name})`} · ${original.description}`, source_key: `transfer-out:${original.id}`, window_no: Number(original.window_no), reversal_of: Number(original.id) });
    await insertRow(tx, { ...base, reservation_id: target.id, kind: 'charge', category: 'transfer', description: `${target.id === booking.id ? '' : `From room ${booking.room_number} · `}${original.description}`, source_key: `transfer-in:${original.id}`, window_no: window, journal_id: null });
    await audit(tx, actor, 'folio_transfer', booking.id, `Folio #${original.id} transferred to ${target.id} window ${window} (${ref}).`, { reason: action.reason, today, details: { entryId: Number(original.id), target: target.id, window } });
    return { id: booking.id, message: `Charge moved to ${target.id === booking.id ? `window ${window}` : `room ${target.room_number}`}. No revenue was posted; the guest receivable moved.` };
  }
  if (action.type === 'window') {
    const window = Number(action.window);
    if (!(window >= 1 && window <= 4)) fail('Choose window 1 to 4.', 400);
    if (!['guest', 'company', 'agent', 'master'].includes(action.payerType)) fail('Choose who pays this window.', 400);
    await tx.run(`INSERT INTO hotel_folio_windows (reservation_id, window_no, payer_type, payer_name) VALUES (?, ?, ?, ?)
      ON CONFLICT (reservation_id, window_no) DO UPDATE SET payer_type = excluded.payer_type, payer_name = excluded.payer_name`, [booking.id, window, action.payerType, action.payerName || '']);
    return { id: booking.id, message: `Window ${window} is billed to ${action.payerName || action.payerType}.` };
  }
  if (action.type === 'route') {
    if (!may('hotel.folio_transfer')) fail('Your role cannot set up billing routing.', 403);
    const target = await loadStay(tx, action.targetId || booking.id);
    if (!isOpenStay(target)) fail('Route charges to an open stay.');
    const types = action.sourceTypes?.length ? action.sourceTypes : ['*'];
    if (types.some((t) => t !== '*' && !FOLIO_SOURCES[t])) fail('Choose valid charge types.', 400);
    await tx.run('UPDATE hotel_routing_rules SET active = 0 WHERE reservation_id = ?', [booking.id]);
    if (!action.clear) await tx.run('INSERT INTO hotel_routing_rules (id, reservation_id, source_types, target_reservation_id, target_window, created_by) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), booking.id, types.join(','), target.id, Number(action.window || 1), actor.id]);
    return { id: booking.id, message: action.clear ? 'Charges post to this room again.' : `${types.includes('*') ? 'All charges' : types.join(', ')} now post to ${target.id === booking.id ? 'this folio' : `room ${target.room_number}`} window ${Number(action.window || 1)}.` };
  }

  // Checkout.
  if (!revisionOk()) fail('The folio changed. Refresh and review the statement before checkout.');
  const postedDates = await postedNightDates(tx, booking.id);
  const unposted = dueRoomNights(booking.arrival_date, today).filter((date) => !postedDates.has(date));
  if (unposted.length) fail('Post all due room nights before checkout.');
  const open = Object.entries(totals.windows).filter(([, cents]) => cents !== 0);
  if (open.length) fail(`Settle every folio window before checkout (open: ${open.map(([w, c]) => `window ${w} NPR ${(c / 100).toFixed(2)}`).join(', ')}).`);
  const routedIn = await tx.get(`SELECT b.id, r.room_number FROM hotel_routing_rules x JOIN hotel_reservations b ON b.id = x.reservation_id JOIN hotel_rooms r ON r.id = b.room_id
    WHERE x.target_reservation_id = ? AND x.reservation_id <> ? AND x.active = 1 AND b.status = 'in_house' AND b.checked_out_at IS NULL LIMIT 1`, [booking.id, booking.id]);
  if (routedIn) fail(`Room ${routedIn.room_number} still routes its charges to this folio. Check that room out first (or remove its routing).`);
  const day = await postingDay(tx, today);
  await applyDeposits(tx, { booking, actor, day, today, key: 'checkout' });
  const pkg = await settlePackage(tx, { booking, actor, day, today });
  const property = await tx.get("SELECT name, currency, timezone FROM hotel_properties WHERE id = 'main'");
  // Seller identity for the tax invoice (same settings the restaurant bill prints).
  const settings = await tx.all("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('pan_number', 'vat_number', 'restaurant_address', 'restaurant_phone')").catch(() => []);
  const setting = Object.fromEntries(settings.map((s) => [s.setting_key, s.setting_value]));
  Object.assign(property, { pan: setting.pan_number || '', vat: setting.vat_number || '', address: setting.restaurant_address || '', phone: setting.restaurant_phone || '' });
  const guestProfile = booking.guest_id ? await tx.get('SELECT full_name, phone, address, email FROM hotel_guests WHERE id = ?', [booking.guest_id]) : null;
  const windowPayers = await tx.all('SELECT window_no, payer_type, payer_name FROM hotel_folio_windows WHERE reservation_id = ?', [booking.id]);
  const finalEntries = await loadFolio(tx, booking.id);
  const usage = await tx.all('SELECT component_label, usage_date, outlet, bill_number, amount_cents FROM hotel_package_usage WHERE reservation_id = ? AND reversed = 0 ORDER BY usage_date, created_at', [booking.id]);
  const number = `HS-${today.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const snapshot = { number, property, guest: booking.guest_name, room: booking.room_number, reservationId: booking.id, arrival: booking.arrival_date, plannedDeparture: booking.departure_date, departure: today, taxBps: Number(booking.room_tax_bps), entries: finalEntries, totals: folioTotals(finalEntries), packageUsage: usage, package: pkg, finalizedBy: actor.id,
    guestAddress: guestProfile?.address || '', guestPhone: guestProfile?.phone || booking.guest_phone || '', company: booking.company || '', windows: windowPayers };
  await tx.run('INSERT INTO hotel_checkout_statements (reservation_id, statement_number, snapshot_json, created_by) VALUES (?, ?, ?, ?)', [booking.id, number, JSON.stringify(snapshot), actor.id]);
  await tx.run('UPDATE hotel_reservations SET checked_out_at = CURRENT_TIMESTAMP WHERE id = ?', [booking.id]);
  await tx.run('UPDATE hotel_routing_rules SET active = 0 WHERE reservation_id = ? OR target_reservation_id = ?', [booking.id, booking.id]);
  await tx.run("UPDATE hotel_rooms SET cleaning_status = 'dirty', hk_flag = '', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [booking.room_id]);
  await createCleaningTask(tx, { roomId: booking.room_id, reservationId: booking.id, note: `Checkout · ${booking.guest_name}`, actorId: actor.id, today, taskType: 'checkout' });
  return { id: booking.id, message: `Room ${booking.room_number} checked out. Invoice ${number} finalized and cleaning task created.` };
}

/**
 * Before a reservation is cancelled or marked no-show: any deposit kept as a
 * fee is applied, and the stay's folio must be zero.
 */
export async function closeUnarrivedFolio(tx, booking, actor, today, key) {
  const totals = folioTotals(await loadFolio(tx, booking.id));
  if (totals.balance !== 0) return { ok: false, balance: totals.balance };
  if (await unappliedDeposit(tx, booking.id) > 0) {
    const day = await postingDay(tx, today);
    await applyDeposits(tx, { booking, actor, day, today, key });
  }
  return { ok: true };
}

export async function processCleaningCommand(tx, action, actor) {
  const task = await tx.get('SELECT t.*, r.room_number, r.cleaning_status, r.blocked FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id WHERE t.id = ?', [action.id]);
  if (!task) fail('Cleaning task not found.', 404);
  if (task.task_type === 'stayover') {
    const next = { dirty: 'cleaning', cleaning: 'ready' }[task.status];
    if (!next || Number(task.version) !== action.version) fail('This task changed or was already completed. Refresh before continuing.');
    await tx.run(`UPDATE hotel_housekeeping_tasks SET status = ?, version = version + 1, updated_by = ?, started_at = COALESCE(started_at, CASE WHEN ? = 'cleaning' THEN CURRENT_TIMESTAMP END), completed_at = CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`, [next, actor.id, next, next, task.id]);
    if (next === 'ready') await tx.run("UPDATE hotel_rooms SET hk_flag = '', version = version + 1 WHERE id = ? AND hk_flag = 'pickup'", [task.room_id]);
    return { id: task.id, message: `Room ${task.room_number}: stayover service ${next === 'ready' ? 'done' : 'started'}.` };
  }
  const next = { dirty: 'cleaning', cleaning: 'inspection', inspection: 'ready' }[task.status];
  if (!next || Number(task.version) !== action.version) fail('This task changed or was already completed. Refresh before continuing.');
  if (task.blocked || task.status !== task.cleaning_status) fail('This room is blocked or its readiness changed. Review it in Hotel setup.');
  const occupied = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [task.room_id]);
  if (occupied) fail('An occupied room cannot be turned over.');
  await tx.run(`UPDATE hotel_housekeeping_tasks SET status = ?, version = version + 1, updated_by = ?, started_at = COALESCE(started_at, CASE WHEN ? = 'cleaning' THEN CURRENT_TIMESTAMP END), completed_at = CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`, [next, actor.id, next, next, task.id]);
  await tx.run('UPDATE hotel_rooms SET cleaning_status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [next, task.room_id]);
  return { id: task.id, message: `Room ${task.room_number}: ${next === 'ready' ? 'inspected and ready' : next === 'inspection' ? 'clean, awaiting inspection' : next}.` };
}
