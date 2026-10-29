import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { serialPkSql } from '@/lib/db/schema-helpers.js';
import { ensureAccountingSchema, postJournal, accountBalance, currentDrawerId, primaryBankAccountId } from '@/lib/accounting.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { nepalDateString } from '@/lib/report-dates.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export async function ensureSavingsSchema(db) {
  await ensureAccountingSchema(db);
  const existing = await db.get(`SELECT id FROM accounts WHERE code='1040'`);
  if (!existing) {
    await db.run(`INSERT INTO accounts (code,name,type,subtype,parent_id,is_active,is_system)
      VALUES ('1040','Savings & Deposits','asset','savings',(SELECT id FROM accounts WHERE code='1000'),1,1)`);
  }
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS savings_deposits (
    ${pk}, deposit_date DATE NOT NULL DEFAULT CURRENT_DATE, deposit_type TEXT NOT NULL DEFAULT 'bank',
    destination_name TEXT NOT NULL, source_account TEXT NOT NULL, amount REAL NOT NULL,
    reference_number TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'active', journal_id INTEGER,
    business_day_id INTEGER, created_by INTEGER, voided_by INTEGER, voided_at DATETIME,
    void_reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
}

export async function createSavingsDeposit(db, data, actorId) {
  await ensureSavingsSchema(db);
  const amount = round2(data.amount);
  const source = String(data.source_account || '').toLowerCase();
  const destination = String(data.destination_name || '').trim();
  if (!(amount > 0)) fail('Enter a deposit amount greater than zero.');
  if (!['cash', 'online'].includes(source)) fail('Choose cash or online as the source account.');
  if (!destination) fail('Enter the bank or Sahakari name.');
  const sourceCode = source === 'cash' ? '1010' : '1020';
  const available = await accountBalance(db, sourceCode);
  if (amount > round2(available) + 0.001) fail(`Not enough ${source === 'cash' ? 'cash' : 'online/bank balance'} (available Rs ${round2(available).toFixed(2)}).`);
  const businessDayId = await currentBusinessDayId(db, { required: true });
  return db.transaction(async (tx) => {
    const inserted = await tx.run(`INSERT INTO savings_deposits
      (deposit_date,deposit_type,destination_name,source_account,amount,reference_number,notes,business_day_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`, [data.deposit_date || nepalDateString(), data.deposit_type || 'bank', destination,
      source, amount, String(data.reference_number || '').trim() || null, String(data.notes || '').trim() || null,
      businessDayId, actorId || null]);
    const id = inserted.lastInsertRowid;
    const drawerId = source === 'cash' ? await currentDrawerId(tx) : null;
    const bankAccountId = source === 'online' ? await primaryBankAccountId(tx) : null;
    const journalId = await postJournal(tx, {
      entry_date: data.deposit_date || nepalDateString(), memo: `Savings deposit to ${destination}`,
      source_type: 'savings_deposit', source_id: id, created_by: actorId || null, business_day_id: businessDayId,
      lines: [
        { code: '1040', debit: amount, credit: 0, memo: destination },
        { code: sourceCode, debit: 0, credit: amount, drawer_id: drawerId, bank_account_id: bankAccountId, memo: `From ${source}` },
      ],
    });
    await tx.run(`UPDATE savings_deposits SET journal_id=? WHERE id=?`, [journalId, id]);
    return tx.get(`SELECT * FROM savings_deposits WHERE id=?`, [id]);
  });
}

export async function voidSavingsDeposit(db, id, reason, actorId) {
  await ensureSavingsSchema(db);
  const row = await db.get(`SELECT * FROM savings_deposits WHERE id=?`, [id]);
  if (!row) fail('Savings deposit not found.', 404);
  if (row.status === 'voided') fail('This savings deposit is already voided.', 409);
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) fail('Enter a reason for voiding this deposit.');
  const sourceCode = row.source_account === 'cash' ? '1010' : '1020';
  return db.transaction(async (tx) => {
    const drawerId = row.source_account === 'cash' ? await currentDrawerId(tx) : null;
    const bankAccountId = row.source_account === 'online' ? await primaryBankAccountId(tx) : null;
    await postJournal(tx, { entry_date: nepalDateString(), memo: `Void savings deposit #${row.id}: ${cleanReason}`,
      source_type: 'savings_deposit_void', source_id: row.id, created_by: actorId || null,
      lines: [
        { code: sourceCode, debit: row.amount, credit: 0, drawer_id: drawerId, bank_account_id: bankAccountId, memo: 'Returned to source' },
        { code: '1040', debit: 0, credit: row.amount, memo: 'Savings deposit reversed' },
      ] });
    await tx.run(`UPDATE savings_deposits SET status='voided',voided_by=?,voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=?`, [actorId || null, cleanReason, id]);
    return tx.get(`SELECT * FROM savings_deposits WHERE id=?`, [id]);
  });
}
