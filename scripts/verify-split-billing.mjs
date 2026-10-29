import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3002';
let customerId;
let billId;
let orderId;
let token;

const phone = `98${String(Date.now()).slice(-8)}`;
const cents = (value) => Math.round(Number(value) * 100);

try {
  const admin = (await pool.query(
    "SELECT id, username, role FROM users WHERE role='admin' AND COALESCE(is_active,1)=1 ORDER BY id LIMIT 1"
  )).rows[0];
  if (!admin) throw new Error('No active Administrator is available for the integration test.');

  // AuthService deliberately supports self-healing base64 session tokens. The
  // verifier removes the temporary session in finally.
  token = Buffer.from(JSON.stringify({ ...admin, created: Date.now() })).toString('base64');
  customerId = (await pool.query(
    "INSERT INTO customers (name, phone, credit_limit, current_credit, created_at) VALUES ('Split Billing Verification',$1,5000,0,CURRENT_TIMESTAMP) RETURNING id",
    [phone]
  )).rows[0].id;

  const settingsRows = await pool.query(
    "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('vat_percentage','service_charge_percentage')"
  );
  const settings = Object.fromEntries(settingsRows.rows.map((row) => [row.setting_key, Number(row.setting_value || 0)]));
  const subtotal = 1000;
  const totalCents = Math.round((subtotal
    + subtotal * (settings.vat_percentage || 0) / 100
    + subtotal * (settings.service_charge_percentage || 0) / 100) * 100);
  const creditCents = totalCents - 75000;
  if (creditCents <= 0) throw new Error('Configured total is too low for the verification split.');

  const idempotencyKey = `split-verification-${Date.now()}`;
  const payload = {
    idempotency_key: idempotencyKey,
    customer_mode: 'customer',
    customer_name: 'Split Billing Verification',
    customer_phone: phone,
    items: [{ is_custom: true, name: 'Split Billing Verification Item', price: subtotal, quantity: 1 }],
    allocations: [
      { method: 'cash', amount: 400, cash_tendered: 500 },
      { method: 'qr', amount: 350, provider: 'Fonepay', reference: 'VERIFY-QR-REF' },
      { method: 'credit', amount: creditCents / 100, due_date: '2026-09-01' },
    ],
  };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const submit = () => fetch(`${baseUrl}/api/admin/billing`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });

  const response = await submit();
  const body = await response.json();
  if (!response.ok) throw new Error(`Sale failed (${response.status}): ${body.error}${body.details ? ` — ${body.details}` : ''}`);
  billId = body.billId;
  orderId = body.orderId;

  const retry = await submit();
  const retryBody = await retry.json();
  const row = (await pool.query(
    `SELECT b.grand_total, b.outstanding_amount, b.payment_status,
       (SELECT COALESCE(SUM(amount),0) FROM bill_payments WHERE bill_id=b.id) received,
       (SELECT COALESCE(SUM(amount),0) FROM bill_payment_allocations WHERE bill_id=b.id AND method='cash') cash,
       (SELECT COALESCE(SUM(amount),0) FROM bill_payment_allocations WHERE bill_id=b.id AND method='qr') qr,
       (SELECT COALESCE(SUM(amount),0) FROM bill_payment_allocations WHERE bill_id=b.id AND method='credit') credit,
       (SELECT COALESCE(SUM(debit-credit),0) FROM customer_ledger WHERE bill_id=b.id) customer_balance,
       (SELECT COUNT(*) FROM journal_entries WHERE source_type='bill' AND source_id=b.id) sale_journals,
       (SELECT COALESCE(SUM(jl.debit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id WHERE je.source_type='bill' AND je.source_id=b.id) journal_debits,
       (SELECT COALESCE(SUM(jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id WHERE je.source_type='bill' AND je.source_id=b.id) journal_credits,
       (SELECT COUNT(*) FROM bills WHERE idempotency_key=$2) bills_for_key
     FROM bills b WHERE b.id=$1`,
    [billId, idempotencyKey]
  )).rows[0];

  const assertions = {
    allocations_equal_total: cents(row.cash) + cents(row.qr) + cents(row.credit) === cents(row.grand_total),
    received_excludes_credit: cents(row.received) === cents(row.cash) + cents(row.qr),
    outstanding_equals_credit: cents(row.outstanding_amount) === cents(row.credit),
    customer_ledger_reconciles: cents(row.customer_balance) === cents(row.credit),
    journal_balanced: cents(row.journal_debits) === cents(row.journal_credits)
      && cents(row.journal_debits) === cents(row.grand_total),
    revenue_posted_once: Number(row.sale_journals) === 1,
    idempotent_retry: retry.ok && retryBody.idempotent === true && Number(row.bills_for_key) === 1,
    status_partially_paid: row.payment_status === 'partially_paid',
  };
  if (Object.values(assertions).some((passed) => !passed)) {
    throw new Error(`Reconciliation failed: ${JSON.stringify({ row, assertions })}`);
  }

  const collectionKey = `credit-collection-verification-${Date.now()}`;
  const collectionResponse = await fetch(`${baseUrl}/api/admin/bills/${billId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'complete_payment',
      amount: Number(row.credit),
      method: 'cash',
      allocations: [{ method: 'cash', amount: Number(row.credit), cash_tendered: Number(row.credit) + 50 }],
      idempotency_key: collectionKey,
    }),
  });
  const collectionBody = await collectionResponse.json();
  if (!collectionResponse.ok) {
    throw new Error(`Credit collection failed (${collectionResponse.status}): ${collectionBody.error}`);
  }
  const collection = (await pool.query(
    `SELECT b.outstanding_amount, b.payment_status, c.current_credit,
       (SELECT COALESCE(SUM(debit-credit),0) FROM customer_ledger WHERE bill_id=b.id) customer_balance,
       (SELECT COUNT(*) FROM journal_entries WHERE source_type='bill' AND source_id=b.id) sale_journals,
       (SELECT COUNT(*) FROM journal_entries je JOIN bill_payments bp ON bp.id=je.source_id WHERE je.source_type='credit_collection' AND bp.bill_id=b.id) collection_journals
     FROM bills b JOIN customers c ON c.id=b.customer_id WHERE b.id=$1`,
    [billId]
  )).rows[0];
  const collectionAssertions = {
    outstanding_cleared: cents(collection.outstanding_amount) === 0,
    customer_balance_cleared: cents(collection.customer_balance) === 0 && cents(collection.current_credit) === 0,
    bill_marked_paid: collection.payment_status === 'paid',
    collection_posted_once: Number(collection.collection_journals) === 1,
    collection_not_new_revenue: Number(collection.sale_journals) === 1,
  };
  if (Object.values(collectionAssertions).some((passed) => !passed)) {
    throw new Error(`Credit collection reconciliation failed: ${JSON.stringify({ collection, collectionAssertions })}`);
  }

  console.log(JSON.stringify({
    total: Number(row.grand_total),
    cash: Number(row.cash),
    qr: Number(row.qr),
    credit: Number(row.credit),
    received: Number(row.received),
    outstanding: Number(row.outstanding_amount),
    change: 100,
    saleJournals: Number(row.sale_journals),
    billsForIdempotencyKey: Number(row.bills_for_key),
    assertions,
    creditCollection: {
      collected: Number(row.credit),
      outstanding: Number(collection.outstanding_amount),
      saleJournalsAfterCollection: Number(collection.sale_journals),
      collectionJournals: Number(collection.collection_journals),
      assertions: collectionAssertions,
    },
  }, null, 2));
} finally {
  // Remove only records created by this verifier.
  if (billId) {
    await pool.query('DELETE FROM bill_audit WHERE bill_id=$1', [billId]);
    await pool.query('DELETE FROM customer_ledger WHERE bill_id=$1', [billId]);
    await pool.query('DELETE FROM bill_payment_allocations WHERE bill_id=$1', [billId]);
    await pool.query("DELETE FROM journal_lines WHERE journal_id IN (SELECT je.id FROM journal_entries je JOIN bill_payments bp ON bp.id=je.source_id WHERE je.source_type='credit_collection' AND bp.bill_id=$1)", [billId]);
    await pool.query("DELETE FROM journal_entries WHERE id IN (SELECT je.id FROM journal_entries je JOIN bill_payments bp ON bp.id=je.source_id WHERE je.source_type='credit_collection' AND bp.bill_id=$1)", [billId]);
    await pool.query('DELETE FROM bill_payments WHERE bill_id=$1', [billId]);
    await pool.query("DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journal_entries WHERE source_type='bill' AND source_id=$1)", [billId]);
    await pool.query("DELETE FROM journal_entries WHERE source_type='bill' AND source_id=$1", [billId]);
    await pool.query('DELETE FROM bills WHERE id=$1', [billId]);
  }
  if (orderId) {
    await pool.query('DELETE FROM order_items WHERE order_id=$1', [orderId]);
    await pool.query('DELETE FROM orders WHERE id=$1', [orderId]);
  }
  if (customerId) await pool.query('DELETE FROM customers WHERE id=$1', [customerId]);
  if (token) await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
  await pool.end();
}
