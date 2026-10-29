import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { serialPkSql } from '@/lib/db/schema-helpers.js';
import { nepalDateString } from '@/lib/report-dates.js';

export async function ensureHistoricalActivitySchema(db) {
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS purchase_change_audit (
    ${pk},
    purchase_id INTEGER,
    action TEXT NOT NULL,
    effective_date DATE,
    business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
    performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    before_data TEXT,
    after_data TEXT,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await ensureSqliteTable(db, `CREATE INDEX IF NOT EXISTS idx_purchase_change_audit_effective
    ON purchase_change_audit(effective_date, created_at)`);
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export async function recordPurchaseActivity(db, {
  purchaseId,
  action,
  effectiveDate,
  businessDayId = null,
  performedBy = null,
  before = null,
  after = null,
  note = null,
}) {
  await ensureHistoricalActivitySchema(db);
  await db.run(
    `INSERT INTO purchase_change_audit
       (purchase_id, action, effective_date, business_day_id, performed_by, before_data, after_data, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [purchaseId, action, effectiveDate || null, businessDayId, performedBy, json(before), json(after), note]
  );
}

function parseJson(value) {
  if (!value || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
}

function actionDate(value) {
  try { return nepalDateString(value); } catch { return ''; }
}

/**
 * One read model for the Previous-day activity report:
 * - records: purchases and standalone expenses whose accounting date is before today
 * - changes: later actions that touched a purchase belonging to an earlier date
 */
export async function listHistoricalActivity(db, { from, to, limit = 500 } = {}) {
  await ensureHistoricalActivitySchema(db);
  const today = nepalDateString();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const conditions = ['effective_date < ?'];
  const params = [today];
  if (from) { conditions.push('effective_date >= ?'); params.push(from); }
  if (to) { conditions.push('effective_date <= ?'); params.push(to); }

  const records = await db.all(
    `SELECT * FROM (
       SELECT 'purchase' AS record_type, p.id AS record_id,
              COALESCE(p.invoice_date, CAST(p.created_at AS TEXT)) AS effective_date,
              COALESCE(p.invoice_number, 'Purchase #' || p.id) AS reference,
              COALESCE(s.name, p.supplier, 'No supplier') AS party,
              p.total AS amount, p.status, COALESCE(e.payment_method, 'cash') AS payment_method,
              p.created_at, p.created_at AS updated_at
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN expenses e ON e.source_type = 'purchase' AND e.source_id = p.id
       UNION ALL
       SELECT 'expense' AS record_type, e.id AS record_id, e.purchase_date AS effective_date,
              'Expense #' || e.id AS reference, COALESCE(e.supplier, e.description, 'Expense') AS party,
              e.amount, e.status, e.payment_method, e.created_at, e.updated_at
         FROM expenses e
        WHERE COALESCE(e.source_type, 'manual') <> 'purchase'
     ) historical_records
     WHERE ${conditions.join(' AND ')}
     ORDER BY effective_date DESC, created_at DESC
     LIMIT ${cappedLimit}`,
    params
  );

  const auditRows = await db.all(
    `SELECT a.*, u.full_name AS by_name
       FROM purchase_change_audit a
       LEFT JOIN users u ON u.id = a.performed_by
      WHERE ${conditions.map((condition) => condition.replaceAll('effective_date', 'a.effective_date')).join(' AND ')}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${cappedLimit}`,
    params
  );

  const paymentRows = await db.all(
    `SELECT je.id, je.created_at, je.memo AS note, je.created_by AS performed_by,
            je.source_type, e.purchase_date AS effective_date, e.source_type AS expense_source_type,
            e.source_id, e.id AS expense_id, e.amount, u.full_name AS by_name,
            p.invoice_number
       FROM journal_entries je
       JOIN expenses e
         ON (
           (je.source_type = 'expense_payment_method_correction'
            AND je.external_ref LIKE ('expense-payment-method:' || CAST(e.id AS TEXT) || ':%'))
           OR
           (je.source_type = 'expense_edit_correction'
            AND je.external_ref LIKE ('expense-edit:' || CAST(e.id AS TEXT) || ':%'))
         )
       LEFT JOIN purchases p ON e.source_type = 'purchase' AND p.id = e.source_id
       LEFT JOIN users u ON u.id = je.created_by
      WHERE je.source_type IN ('expense_payment_method_correction','expense_edit_correction')
        AND ${conditions.map((condition) => condition.replaceAll('effective_date', 'e.purchase_date')).join(' AND ')}
      ORDER BY je.created_at DESC, je.id DESC
      LIMIT ${cappedLimit}`,
    params
  );

  // Backfill visibility for records created before the audit table existed,
  // and for standalone expenses whose lifecycle is still stored on the row.
  const legacyRows = await db.all(
    `SELECT * FROM (
       SELECT 'purchase' AS record_type, p.id AS record_id, p.invoice_date AS effective_date,
              p.created_at, p.received_by AS performed_by, u.full_name AS by_name,
              'created' AS action, COALESCE(p.invoice_number, 'Purchase #' || p.id) AS reference,
              p.total AS amount, NULL AS note
         FROM purchases p
         LEFT JOIN users u ON u.id = p.received_by
        WHERE NOT EXISTS (
          SELECT 1 FROM purchase_change_audit a
           WHERE a.purchase_id = p.id AND a.action = 'created'
        )
       UNION ALL
       SELECT 'expense' AS record_type, e.id AS record_id, e.purchase_date AS effective_date,
              e.created_at, e.logged_by AS performed_by, u.full_name AS by_name,
              'created' AS action, 'Expense #' || e.id AS reference,
              e.amount, COALESCE(e.description, e.category) AS note
         FROM expenses e
         LEFT JOIN users u ON u.id = e.logged_by
        WHERE COALESCE(e.source_type, 'manual') <> 'purchase'
       UNION ALL
       SELECT 'expense' AS record_type, e.id AS record_id, e.purchase_date AS effective_date,
              e.voided_at AS created_at, e.voided_by AS performed_by, u.full_name AS by_name,
              'voided' AS action, 'Expense #' || e.id AS reference,
              e.amount, e.void_reason AS note
         FROM expenses e
         LEFT JOIN users u ON u.id = e.voided_by
        WHERE COALESCE(e.source_type, 'manual') <> 'purchase' AND e.voided_at IS NOT NULL
     ) legacy_changes
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ${cappedLimit}`,
    params
  );

  const changes = auditRows
    .filter((row) => row.effective_date && row.effective_date < actionDate(row.created_at))
    .map((row) => ({
      ...row,
      change_id: `purchase-${row.id}`,
      record_type: 'purchase',
      reference: `Purchase #${row.purchase_id}`,
      before_data: parseJson(row.before_data),
      after_data: parseJson(row.after_data),
    }));

  for (const row of paymentRows) {
    if (!row.effective_date || row.effective_date >= actionDate(row.created_at)) continue;
    const isEdit = row.source_type === 'expense_edit_correction';
    changes.push({
      ...row,
      change_id: `${isEdit ? 'edit' : 'payment'}-${row.id}`,
      action: isEdit ? 'amount corrected' : 'payment corrected',
      record_type: row.expense_source_type === 'purchase' ? 'purchase' : 'expense',
      purchase_id: row.expense_source_type === 'purchase' ? row.source_id : null,
      reference: row.invoice_number || (row.expense_source_type === 'purchase'
        ? `Purchase #${row.source_id}`
        : `Expense #${row.expense_id}`),
    });
  }
  for (const row of legacyRows) {
    if (!row.effective_date || row.effective_date >= actionDate(row.created_at)) continue;
    changes.push({
      ...row,
      change_id: `legacy-${row.record_type}-${row.action}-${row.record_id}-${row.created_at}`,
    });
  }
  changes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  return {
    records,
    changes: changes.slice(0, cappedLimit),
    today,
    truncated: records.length >= cappedLimit || changes.length >= cappedLimit,
  };
}
