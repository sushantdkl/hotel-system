import { getPurchase } from './purchases.js';
import { foodGroupSql, foodGroupLabel } from './food-groups.js';
import { countedBillSql } from './report-scope.js';

const n = (value) => Number(value || 0);
const money = (value) => ({ value: n(value), format: 'currency' });

function field(label, value, format = 'text', link = null) {
  return { label, value: value == null || value === '' ? null : value, format, ...(link ? { link } : {}) };
}

function section(title, items) {
  return { type: 'fields', title, items: items.filter((item) => item.value != null) };
}

function table(title, columns, rows, empty = 'No linked records were found.') {
  return { type: 'table', title, columns, rows: rows || [], empty };
}

async function findBillAndOrder(db, row) {
  if (row._bill_id || row.bill_id) {
    return db.get(
      `SELECT b.*, o.order_number, o.order_type, o.status AS order_status, o.table_number,
              o.customer_id AS order_customer_id, o.customer_name, o.customer_phone, o.notes AS order_notes,
              o.created_at AS ordered_at, o.waiter_id, o.id AS resolved_order_id,
              w.full_name AS waiter_name, c.full_name AS cashier_name,
              cu.name AS customer_profile_name, cu.phone AS customer_profile_phone
       FROM bills b JOIN orders o ON o.id=b.order_id
       LEFT JOIN users w ON w.id=o.waiter_id
       LEFT JOIN users c ON c.id=b.cashier_id
       LEFT JOIN customers cu ON cu.id=COALESCE(b.customer_id,o.customer_id)
       WHERE b.id=? LIMIT 1`,
      [row._bill_id || row.bill_id]
    );
  }
  if (row._order_id || row.order_id) {
    return db.get(
      `SELECT b.*, o.order_number, o.order_type, o.status AS order_status, o.table_number,
              o.customer_id AS order_customer_id, o.customer_name, o.customer_phone, o.notes AS order_notes,
              o.created_at AS ordered_at, o.waiter_id, o.id AS resolved_order_id,
              w.full_name AS waiter_name, c.full_name AS cashier_name,
              cu.name AS customer_profile_name, cu.phone AS customer_profile_phone
       FROM orders o LEFT JOIN bills b ON b.order_id=o.id
       LEFT JOIN users w ON w.id=o.waiter_id
       LEFT JOIN users c ON c.id=b.cashier_id
       LEFT JOIN customers cu ON cu.id=COALESCE(b.customer_id,o.customer_id)
       WHERE o.id=? ORDER BY b.id DESC LIMIT 1`,
      [row._order_id || row.order_id]
    );
  }
  if (row.bill_number && row.bill_number !== '—') {
    return db.get(
      `SELECT b.*, o.order_number, o.order_type, o.status AS order_status, o.table_number,
              o.customer_id AS order_customer_id, o.customer_name, o.customer_phone, o.notes AS order_notes,
              o.created_at AS ordered_at, o.waiter_id, o.id AS resolved_order_id,
              w.full_name AS waiter_name, c.full_name AS cashier_name,
              cu.name AS customer_profile_name, cu.phone AS customer_profile_phone
       FROM bills b JOIN orders o ON o.id=b.order_id
       LEFT JOIN users w ON w.id=o.waiter_id
       LEFT JOIN users c ON c.id=b.cashier_id
       LEFT JOIN customers cu ON cu.id=COALESCE(b.customer_id,o.customer_id)
       WHERE b.bill_number=? LIMIT 1`,
      [row.bill_number]
    );
  }
  if (row.order_number && row.order_number !== '—') {
    return db.get(
      `SELECT b.*, o.order_number, o.order_type, o.status AS order_status, o.table_number,
              o.customer_id AS order_customer_id, o.customer_name, o.customer_phone, o.notes AS order_notes,
              o.created_at AS ordered_at, o.waiter_id, o.id AS resolved_order_id,
              w.full_name AS waiter_name, c.full_name AS cashier_name,
              cu.name AS customer_profile_name, cu.phone AS customer_profile_phone
       FROM orders o LEFT JOIN bills b ON b.order_id=o.id
       LEFT JOIN users w ON w.id=o.waiter_id
       LEFT JOIN users c ON c.id=b.cashier_id
       LEFT JOIN customers cu ON cu.id=COALESCE(b.customer_id,o.customer_id)
       WHERE o.order_number=? ORDER BY b.id DESC LIMIT 1`,
      [row.order_number]
    );
  }
  return null;
}

async function orderDetails(db, row) {
  const record = await findBillAndOrder(db, row);
  if (!record?.resolved_order_id) return null;
  const orderId = record.resolved_order_id;
  const [items, kots, payments, customerLedger] = await Promise.all([
    db.all(
      `SELECT oi.id, COALESCE(oi.item_name,mi.name,'Item') AS item_name,
              COALESCE(CAST(mi.id AS TEXT),CAST(oi.item_id AS TEXT),'—') AS item_code,
              oi.quantity, oi.price, oi.subtotal, oi.status, oi.special_instructions,
              COALESCE(mc.name,'Uncategorised') AS category
       FROM order_items oi
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE oi.order_id=? ORDER BY oi.id`,
      [orderId]
    ),
    db.all(
      `SELECT k.id, COALESCE(k.kot_number,'KOT-' || k.id) AS kot_number, k.station, k.status,
              k.printed_at, k.started_at, k.completed_at, COUNT(ki.id) AS lines,
              COALESCE(SUM(ki.quantity),0) AS quantity
       FROM kots k LEFT JOIN kot_items ki ON ki.kot_id=k.id
       WHERE k.order_id=?
       GROUP BY k.id,k.kot_number,k.station,k.status,k.printed_at,k.started_at,k.completed_at
       ORDER BY k.printed_at`,
      [orderId]
    ),
    record.id ? db.all(
      `SELECT method, amount, provider, reference_number, verification_status, settlement_status,
              due_date, created_at
       FROM bill_payment_allocations WHERE bill_id=?
       UNION ALL
       SELECT payment_method AS method, amount, provider, reference_number, verification_status,
              settlement_status, due_date, created_at
       FROM bill_payments bp WHERE bill_id=?
         AND NOT EXISTS (SELECT 1 FROM bill_payment_allocations a WHERE a.bill_id=bp.bill_id)
       ORDER BY created_at`,
      [record.id, record.id]
    ) : Promise.resolve([]),
    record.id ? db.all(
      `SELECT entry_type,debit,credit,due_date,note,created_at
       FROM customer_ledger WHERE bill_id=? ORDER BY created_at,id`,
      [record.id]
    ).catch(() => []) : Promise.resolve([]),
  ]);

  const title = record.bill_number ? `Invoice ${record.bill_number}` : `Order ${record.order_number}`;
  const linkedItems = items.map((item) => ({
    ...item,
    _links: item.item_code && item.item_code !== '—' ? { item_code: { type: 'menu', id: item.item_code } } : {},
  }));
  const linkedKots = kots.map((kot) => ({
    ...kot,
    _links: {
      kot_number: { type: 'kot', id: kot.id, label: kot.kot_number },
    },
  }));
  return {
    eyebrow: record.bill_number ? 'Sale & order record' : 'Order record',
    title,
    subtitle: `${record.order_number || 'Order'} · ${record.table_number ? `Table ${record.table_number}` : String(record.order_type || 'order').replace(/_/g, ' ')}`,
    status: record.payment_status || record.status || record.order_status,
    summary: [
      field('Grand total', money(record.grand_total).value, 'currency'),
      field('Paid', payments.reduce((sum, p) => sum + n(p.amount), 0), 'currency'),
      field('Items', items.reduce((sum, item) => sum + n(item.quantity), 0), 'number'),
      field('KOTs', kots.length, 'number'),
    ],
    sections: [
      section('Order & customer', [
        field('Order number', record.order_number, 'text', { type: 'order', id: orderId }), field('Order type', String(record.order_type || '').replace(/_/g, ' ')),
        field('Table', record.table_number), field('Waiter', record.waiter_name),
        field('Customer', record.customer_profile_name || record.customer_name || 'Walk-in'),
        field('Phone', record.customer_profile_phone || record.customer_phone), field('Ordered at', record.ordered_at, 'datetime'),
        field('Order notes', record.order_notes),
      ]),
      table('Items in this order', [
        { key: 'item_code', label: 'Code' }, { key: 'item_name', label: 'Item' }, { key: 'category', label: 'Category' },
        { key: 'quantity', label: 'Qty', format: 'number', align: 'right' }, { key: 'price', label: 'Rate', format: 'currency', align: 'right' },
        { key: 'subtotal', label: 'Line total', format: 'currency', align: 'right' }, { key: 'status', label: 'Status', format: 'status' },
        { key: 'special_instructions', label: 'Instructions' },
      ], linkedItems, 'This order has no saved item lines.'),
      table('Kitchen tickets (KOT)', [
        { key: 'kot_number', label: 'KOT' }, { key: 'station', label: 'Station' }, { key: 'status', label: 'Status', format: 'status' },
        { key: 'quantity', label: 'Qty', format: 'number', align: 'right' }, { key: 'printed_at', label: 'Printed', format: 'datetime' },
        { key: 'started_at', label: 'Started', format: 'datetime' }, { key: 'completed_at', label: 'Completed', format: 'datetime' },
      ], linkedKots, 'No KOT was generated for this order.'),
      table('Payments & settlement', [
        { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', format: 'currency', align: 'right' },
        { key: 'provider', label: 'Provider' }, { key: 'reference_number', label: 'Reference' },
        { key: 'verification_status', label: 'Verification', format: 'status' }, { key: 'settlement_status', label: 'Settlement', format: 'status' },
        { key: 'due_date', label: 'Due date' }, { key: 'created_at', label: 'Received', format: 'datetime' },
      ], payments, 'No payment allocation has been recorded yet.'),
      ...(customerLedger.length ? [table('Customer credit ledger', [
        { key: 'entry_type', label: 'Entry' }, { key: 'debit', label: 'Debit', format: 'currency', align: 'right' },
        { key: 'credit', label: 'Credit', format: 'currency', align: 'right' }, { key: 'due_date', label: 'Due' },
        { key: 'note', label: 'Note' }, { key: 'created_at', label: 'Created', format: 'datetime' },
      ], customerLedger)] : []),
      ...(record.bill_number ? [section('Invoice totals', [
        field('Invoice number', record.bill_number, 'text', { type: 'bill', id: record.id }), field('Cashier', record.cashier_name),
        field('Subtotal', record.subtotal, 'currency'), field('Discount', record.discount_amount, 'currency'),
        field('Service charge', record.service_charge, 'currency'), field('VAT / tax', n(record.vat_amount) || n(record.tax), 'currency'),
        field('Grand total', record.grand_total, 'currency'), field('Outstanding', record.outstanding_amount, 'currency'),
        field('Billed at', record.created_at, 'datetime'), field('Paid at', record.paid_at, 'datetime'),
        field('Discount reason', record.discount_reason), field('Void reason', record.void_reason),
      ])] : []),
    ],
  };
}

async function purchaseDetails(db, expense) {
  if (expense?.source_type === 'purchase' && expense.source_id) {
    const purchase = await getPurchase(db, expense.source_id);
    if (purchase) {
      const linkedPurchaseItems = (purchase.items || []).map((item) => ({
        ...item,
        _links: item.inventory_item_id ? {
          inventory_item_id: { type: 'inventory', id: item.inventory_item_id },
          item_name: { type: 'inventory', id: item.inventory_item_id },
        } : {},
      }));
      return {
        eyebrow: 'Purchase & stock receipt',
        title: purchase.invoice_number ? `Purchase ${purchase.invoice_number}` : `Purchase #${purchase.id}`,
        subtitle: `${purchase.supplier_name || purchase.supplier || 'Unattributed supplier'} · ${purchase.invoice_date || String(purchase.created_at).slice(0, 10)}`,
        status: purchase.status,
        summary: [field('Total', purchase.total, 'currency'), field('Paid by', purchase.expense?.payment_method || 'cash'), field('Items', purchase.items?.length || 0, 'number'), field('Received by', purchase.received_by_name)],
        sections: [
          section('Purchase details', [
            field('Supplier', purchase.supplier_name || purchase.supplier),
            field('Invoice date', purchase.invoice_date), field('Expected delivery', purchase.expected_delivery_date),
            field('Received at', purchase.created_at, 'datetime'), field('Received by', purchase.received_by_name),
            field('Receipt / attachment', purchase.attachment_url || purchase.expense?.receipt_url),
            field('Notes', purchase.notes || purchase.expense?.notes), field('Void reason', purchase.void_reason),
          ]),
          table('Items received', [
            { key: 'item_name', label: 'Item' },
            { key: 'quantity_received', label: 'Received', format: 'number', align: 'right' },
            { key: 'purchase_unit', label: 'Unit' }, { key: 'unit_cost', label: 'Unit cost', format: 'currency', align: 'right' },
            { key: 'line_total', label: 'Line total', format: 'currency', align: 'right' },
          ], linkedPurchaseItems, 'No purchase lines were saved.'),
        ],
      };
    }
  }
  return null;
}

async function expenseDetails(db, row) {
  let expense = null;
  if (row._record_id) expense = await db.get(`SELECT e.*,u.full_name AS logged_by_name FROM expenses e LEFT JOIN users u ON u.id=e.logged_by WHERE e.id=?`, [row._record_id]);
  if (!expense && row.description) expense = await db.get(
    `SELECT e.*,u.full_name AS logged_by_name FROM expenses e LEFT JOIN users u ON u.id=e.logged_by
     WHERE COALESCE(e.purchase_date,CAST(e.expense_date AS TEXT))=? AND COALESCE(e.description,'')=?
     ORDER BY e.id DESC LIMIT 1`, [row.spent_on || row.date, row.description === '—' ? '' : row.description]
  );
  if (!expense) return null;
  const purchase = await purchaseDetails(db, expense);
  if (purchase) return purchase;
  const sourceLink = expense.source_type && expense.source_id
    ? { type: expense.source_type, id: expense.source_id }
    : null;
  return {
    eyebrow: 'Expense record', title: expense.description || `Expense #${expense.id}`,
    subtitle: `${expense.category || 'Other'} · ${expense.purchase_date || expense.expense_date}`,
    status: expense.status || 'active',
    summary: [field('Amount', expense.amount, 'currency'), field('Paid by', expense.payment_method || 'cash'), field('Supplier / payee', expense.supplier || '—'), field('Logged by', expense.logged_by_name || 'System')],
    sections: [section('Expense details', [
      field('Expense code', `EXP-${expense.id}`),
      field('Date', expense.purchase_date || expense.expense_date),
      field('Category', String(expense.category || '').replace(/_/g, ' ')),
      field('Payment method', String(expense.payment_method || 'cash').replace(/_/g, ' ')),
      field('Origin', expense.source_type ? `Generated from ${String(expense.source_type).replace(/_/g, ' ')} #${expense.source_id}` : 'Entered manually', 'text', sourceLink),
      field('Receipt', expense.receipt_url), field('Notes', expense.notes),
      field('Created', expense.created_at, 'datetime'),
    ])],
  };
}

async function kotDetails(db, row) {
  if (!row.kot_number) return null;
  const kot = await db.get(`SELECT k.*,o.order_number,o.table_number FROM kots k JOIN orders o ON o.id=k.order_id WHERE COALESCE(k.kot_number,'KOT-' || k.id)=? LIMIT 1`, [row.kot_number]);
  if (!kot) return null;
  const items = await db.all(`SELECT COALESCE(oi.item_name,mi.name,'Item') AS item_name,ki.quantity,ki.status,ki.special_instructions FROM kot_items ki LEFT JOIN order_items oi ON oi.id=ki.order_item_id LEFT JOIN menu_items mi ON mi.id=ki.menu_item_id WHERE ki.kot_id=? ORDER BY ki.id`, [kot.id]);
  return {
    eyebrow: 'Kitchen ticket', title: row.kot_number, subtitle: `${kot.order_number} · ${kot.table_number ? `Table ${kot.table_number}` : kot.station || 'Kitchen'}`, status: kot.status,
    summary: [field('Items', items.reduce((sum, item) => sum + n(item.quantity), 0), 'number'), field('Station', kot.station), field('Printed', kot.printed_at, 'datetime'), field('Completed', kot.completed_at, 'datetime')],
    sections: [section('Ticket timeline', [field('KOT', row.kot_number, 'text', { type: 'kot', id: kot.id, label: row.kot_number }), field('Order', kot.order_number, 'text', { type: 'order', id: kot.order_id }), field('Table', kot.table_number), field('Station', kot.station), field('Printed', kot.printed_at, 'datetime'), field('Started', kot.started_at, 'datetime'), field('Completed', kot.completed_at, 'datetime'), field('Reason', kot.cancel_reason || kot.void_reason), field('Order notes', kot.order_notes)]), table('KOT items', [{ key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'Qty', format: 'number', align: 'right' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'special_instructions', label: 'Instructions' }], items)],
  };
}

async function entityDetails(db, tab, tableId, row, range) {
  if (tab === 'sales' && tableId === 'payment-summary' && row.method && range?.start && range?.end) {
    const payments = await db.all(
      `SELECT p.created_at,b.id AS bill_id,b.bill_number,o.id AS order_id,o.order_number,o.customer_name,p.method,p.amount,p.provider,p.reference_number
       FROM (
         SELECT bp.bill_id,bp.payment_method AS method,bp.amount,bp.provider,bp.reference_number,bp.created_at FROM bill_payments bp
         WHERE NOT EXISTS (SELECT 1 FROM bill_payment_allocations a WHERE a.bill_id=bp.bill_id)
         UNION ALL
         SELECT bill_id,method,amount,provider,reference_number,created_at FROM bill_payment_allocations a
       ) p JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id
       WHERE LOWER(p.method)=? AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?
       ORDER BY p.created_at DESC LIMIT 100`,
      [String(row.method).toLowerCase().replace(/ /g, '_'), range.start, range.end]
    );
    const linkedPayments = payments.map((payment) => ({ ...payment, _links: { bill_number: { type: 'bill', id: payment.bill_id }, order_number: { type: 'order', id: payment.order_id } } }));
    return { eyebrow: 'Payment-method breakdown', title: row.method, subtitle: `${range.start} to ${range.end}`, summary: [field('Transactions', payments.length, 'number'), field('Amount received', payments.reduce((sum, payment) => sum + n(payment.amount), 0), 'currency')], sections: [table('Bills paid this way', [{ key: 'created_at', label: 'Received', format: 'datetime' }, { key: 'bill_number', label: 'Bill' }, { key: 'order_number', label: 'Order' }, { key: 'customer_name', label: 'Customer' }, { key: 'amount', label: 'Amount', format: 'currency', align: 'right' }, { key: 'provider', label: 'Provider' }, { key: 'reference_number', label: 'Reference' }], linkedPayments)] };
  }
  if (tab === 'sales' && tableId === 'master-category-summary' && row.category && range?.start && range?.end) {
    const lines = await db.all(
      `SELECT oi.created_at,COALESCE(oi.item_name,mi.name,'Item') AS item_name,mi.id AS item_code,
              COALESCE(mc.name,'Uncategorised') AS category,COALESCE(mc.food_group,'other') AS master_category,
              oi.quantity,oi.price,oi.subtotal,o.id AS order_id,o.order_number,b.id AS bill_id,b.bill_number,o.table_number
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN bills b ON b.order_id=o.id
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?
       ORDER BY oi.created_at DESC LIMIT 500`, [range.start, range.end]
    );
    const wanted = String(row.category).toLowerCase();
    const matching = lines.filter((line) => [line.category, line.master_category].some((value) => String(value || '').toLowerCase().replace(/_/g, ' ') === wanted)).map((line) => ({ ...line, _links: { item_code: { type: 'menu', id: line.item_code }, item_name: { type: 'menu', id: line.item_code }, order_number: { type: 'order', id: line.order_id }, bill_number: { type: 'bill', id: line.bill_id } } }));
    return { eyebrow: 'Sales category breakdown', title: row.category, subtitle: `${range.start} to ${range.end}`, summary: [field('Quantity sold', matching.reduce((sum, line) => sum + n(line.quantity), 0), 'number'), field('Sales value', matching.reduce((sum, line) => sum + n(line.subtotal), 0), 'currency'), field('Order lines', matching.length, 'number')], sections: [table('Items sold in this category', [{ key: 'created_at', label: 'Ordered', format: 'datetime' }, { key: 'item_code', label: 'Code' }, { key: 'item_name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'order_number', label: 'Order' }, { key: 'bill_number', label: 'Bill' }, { key: 'table_number', label: 'Table' }, { key: 'quantity', label: 'Qty', format: 'number', align: 'right' }, { key: 'price', label: 'Rate', format: 'currency', align: 'right' }, { key: 'subtotal', label: 'Total', format: 'currency', align: 'right' }], matching)] };
  }
  if (tab === 'categories' && (tableId === 'category-summary' || tableId === 'master-category-summary') && range?.start && range?.end) {
    const isMaster = tableId === 'master-category-summary';
    const target = isMaster ? String(row.master_category || '') : String(row.category || '');
    const lines = await db.all(
      `SELECT oi.created_at, COALESCE(oi.item_name,mi.name,'Item') AS item_name, mi.id AS item_code,
              COALESCE(mc.name,'Uncategorised') AS category, ${foodGroupSql('mc')} AS group_id,
              oi.quantity, oi.price, oi.subtotal, o.id AS order_id, o.order_number, b.id AS bill_id, b.bill_number, o.table_number
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN bills b ON b.order_id=o.id
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?
         AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
       ORDER BY oi.created_at DESC LIMIT 500`, [range.start, range.end]
    );
    const matching = lines
      .filter((line) => (isMaster ? foodGroupLabel(line.group_id) === target : String(line.category || '') === target))
      .map((line) => ({ ...line, _links: { item_code: { type: 'menu', id: line.item_code }, item_name: { type: 'menu', id: line.item_code }, order_number: { type: 'order', id: line.order_id }, bill_number: { type: 'bill', id: line.bill_id } } }));
    return {
      eyebrow: isMaster ? 'Master category breakdown' : 'Category breakdown',
      title: target,
      subtitle: `${range.start} to ${range.end}`,
      summary: [
        field('Quantity sold', matching.reduce((sum, line) => sum + n(line.quantity), 0), 'number'),
        field('Sales value', matching.reduce((sum, line) => sum + n(line.subtotal), 0), 'currency'),
        field('Order lines', matching.length, 'number'),
      ],
      sections: [table('Items sold in this category', [
        { key: 'created_at', label: 'Ordered', format: 'datetime' },
        { key: 'item_name', label: 'Item' },
        { key: 'category', label: 'Category' },
        { key: 'order_number', label: 'Order' },
        { key: 'bill_number', label: 'Bill' },
        { key: 'table_number', label: 'Table' },
        { key: 'quantity', label: 'Qty', format: 'number', align: 'right' },
        { key: 'price', label: 'Rate', format: 'currency', align: 'right' },
        { key: 'subtotal', label: 'Total', format: 'currency', align: 'right' },
      ], matching)],
    };
  }
  if (tab === 'customers' && row.name) {
    const customer = await db.get(`SELECT * FROM customers WHERE id=? OR (name=? AND COALESCE(phone,'')=?) ORDER BY id DESC LIMIT 1`, [row._record_id || -1, row.name, row.phone === '—' ? '' : row.phone || '']);
    if (customer) {
      const orders = await db.all(`SELECT o.id AS order_id,o.order_number,b.id AS bill_id,b.bill_number,o.order_type,o.table_number,b.grand_total,b.payment_status,b.created_at FROM orders o LEFT JOIN bills b ON b.order_id=o.id WHERE o.customer_id=? OR b.customer_id=? ORDER BY COALESCE(b.created_at,o.created_at) DESC LIMIT 100`, [customer.id, customer.id]);
      const linkedOrders = orders.map((order) => ({ ...order, _links: { order_number: { type: 'order', id: order.order_id }, ...(order.bill_id ? { bill_number: { type: 'bill', id: order.bill_id } } : {}) } }));
      const ledger = await db.all(`SELECT entry_type,debit,credit,due_date,note,created_at FROM customer_ledger WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 100`, [customer.id]).catch(() => []);
      return { eyebrow: 'Customer record', title: customer.name, subtitle: customer.phone || 'No phone recorded', status: n(customer.is_vip) ? 'VIP' : 'Regular', summary: [field('Lifetime spend', customer.total_spent, 'currency'), field('Visits', customer.total_visits, 'number'), field('Current credit', customer.current_credit, 'currency'), field('Orders found', orders.length, 'number')], sections: [section('Profile', [field('Customer code', `CUS-${customer.id}`, 'text', { type: 'customer', id: customer.id }), field('Phone', customer.phone), field('Email', customer.email), field('Address', customer.address), field('Credit limit', customer.credit_limit, 'currency'), field('Notes', customer.notes), field('Customer since', customer.created_at, 'datetime')]), table('Orders & invoices', [{ key: 'created_at', label: 'Date', format: 'datetime' }, { key: 'order_number', label: 'Order' }, { key: 'bill_number', label: 'Bill' }, { key: 'order_type', label: 'Type' }, { key: 'table_number', label: 'Table' }, { key: 'payment_status', label: 'Payment', format: 'status' }, { key: 'grand_total', label: 'Amount', format: 'currency', align: 'right' }], linkedOrders), ...(ledger.length ? [table('Credit history', [{ key: 'created_at', label: 'Date', format: 'datetime' }, { key: 'entry_type', label: 'Entry' }, { key: 'debit', label: 'Debit', format: 'currency', align: 'right' }, { key: 'credit', label: 'Credit', format: 'currency', align: 'right' }, { key: 'due_date', label: 'Due' }, { key: 'note', label: 'Note' }], ledger)] : [])] };
    }
  }
  if (tab === 'reservations' && row._record_id) {
    const r = await db.get(`SELECT r.*,t.table_number,o.order_number FROM reservations r LEFT JOIN tables t ON t.id=r.table_id LEFT JOIN orders o ON o.id=r.order_id WHERE r.id=?`, [row._record_id]);
    if (r) return { eyebrow: 'Reservation record', title: r.name, subtitle: `${r.date} at ${r.time || 'time not set'} · ${r.party_size || r.guests || 0} guests`, status: r.status, summary: [field('Guests', r.party_size || r.guests, 'number'), field('Table', r.table_number || 'Unassigned'), field('Deposit', r.deposit_amount, 'currency'), field('Source', r.source)], sections: [section('Booking & guest details', [field('Reservation code', `RES-${r.id}`, 'text', { type: 'reservation', id: r.id }), field('Phone', r.phone), field('Occasion', r.occasion), field('Preferences', r.preferences), field('Guest message', r.message), field('Admin notes', r.admin_notes), field('Order', r.order_number, 'text', r.order_id ? { type: 'order', id: r.order_id } : null), field('Expected end', r.expected_end_at), field('Deposit required', n(r.deposit_required) ? 'Yes' : 'No'), field('Deposit paid', n(r.deposit_paid) ? 'Yes' : 'No'), field('Checked in', r.checked_in_at, 'datetime'), field('Seated', r.seated_at, 'datetime'), field('Completed', r.completed_at, 'datetime'), field('Cancellation reason', r.cancel_reason)])] };
  }
  if (tab === 'menu' && (row.id || row._record_id || row.name)) {
    // Use the ID saved on the analytics row. A menu item can be deleted and
    // recreated with the same name, in which case the current item has a new
    // ID while historic order lines still point to the original one.
    const soldMenuItemId = Number(row.id || row._record_id) || null;
    const item = await db.get(
      `SELECT mi.*,COALESCE(mc.name,'Uncategorised') AS category_name
       FROM menu_items mi LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE mi.id=? OR mi.name=? ORDER BY mi.id DESC LIMIT 1`,
      [row.id || row._record_id || -1, row.name || '']
    );
    if (item) {
      const rangeFilter = range?.start && range?.end
        ? " AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?"
        : '';
      const sales = await db.all(
        `SELECT b.id AS id,b.id AS bill_id,b.bill_number,o.id AS order_id,o.order_number,o.order_type,o.table_number,
                o.customer_name,b.payment_status,b.grand_total,b.created_at,
                SUM(oi.quantity) AS quantity,SUM(COALESCE(oi.subtotal,oi.quantity * COALESCE(oi.price,0))) AS item_revenue
         FROM order_items oi JOIN orders o ON o.id=oi.order_id
         JOIN bills b ON b.order_id=o.id
         WHERE COALESCE(oi.menu_item_id,oi.item_id)=?
           AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
           AND ${countedBillSql('b')}${rangeFilter}
         GROUP BY b.id,b.bill_number,o.id,o.order_number,o.order_type,o.table_number,o.customer_name,b.payment_status,b.grand_total,b.created_at
         ORDER BY b.created_at DESC LIMIT 500`,
        [soldMenuItemId || item.id, ...(rangeFilter ? [range.start, range.end] : [])]
      );
      const linkedSales = sales.map((sale) => ({ ...sale, _links: { bill_number: { type: 'bill', id: sale.bill_id }, order_number: { type: 'order', id: sale.order_id } } }));
      return {
        eyebrow: 'Menu item record', title: item.name, subtitle: item.category_name,
        status: n(item.is_available) ? 'available' : 'unavailable',
        summary: [field('Menu price', item.base_price, 'currency'), field('Bills', sales.length, 'number'), field('Quantity sold', sales.reduce((sum, sale) => sum + n(sale.quantity), 0), 'number'), field('Item sales', sales.reduce((sum, sale) => sum + n(sale.item_revenue), 0), 'currency')],
        sections: [
          section('Menu setup', [field('Item code', `MENU-${item.id}`), field('Description', item.description), field('Category', item.category_name), field('Vegetarian', n(item.is_vegetarian) ? 'Yes' : 'No'), field('Vegan', n(item.is_vegan) ? 'Yes' : 'No'), field('Spice level', item.spice_level, 'number'), field('Allergens', item.allergens), field('Tags', item.tags), field('Calories', item.calories, 'number')]),
          table('Bills containing this item', [{ key: 'created_at', label: 'Billed', format: 'datetime' }, { key: 'bill_number', label: 'Bill' }, { key: 'order_number', label: 'Order' }, { key: 'customer_name', label: 'Customer' }, { key: 'table_number', label: 'Table' }, { key: 'payment_status', label: 'Payment', format: 'status' }, { key: 'quantity', label: 'Item qty', format: 'number', align: 'right' }, { key: 'item_revenue', label: 'Item total', format: 'currency', align: 'right' }, { key: 'grand_total', label: 'Bill total', format: 'currency', align: 'right' }], linkedSales, 'No settled bills contain this item in the selected period.'),
        ],
      };
    }
  }
  if (tab === 'employees' && row._record_id) {
    const employee = await db.get(`SELECT id,full_name,username,role,is_active,created_at FROM users WHERE id=?`, [row._record_id]);
    if (employee) {
      const [served, settled, tickets] = await Promise.all([
        db.all(`SELECT o.id AS order_id,o.order_number,o.order_type,o.table_number,o.status,b.id AS bill_id,b.bill_number,b.grand_total,o.created_at FROM orders o LEFT JOIN bills b ON b.order_id=o.id WHERE o.waiter_id=? ORDER BY o.created_at DESC LIMIT 100`, [employee.id]),
        db.all(`SELECT b.id AS bill_id,b.bill_number,o.id AS order_id,o.order_number,b.payment_status,b.grand_total,b.created_at FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.cashier_id=? ORDER BY b.created_at DESC LIMIT 100`, [employee.id]),
        db.all(`SELECT k.id AS kot_id,k.kot_number,o.id AS order_id,o.order_number,k.station,k.status,k.printed_at,k.completed_at FROM kots k JOIN orders o ON o.id=k.order_id WHERE k.prepared_by=? ORDER BY k.printed_at DESC LIMIT 100`, [employee.id]).catch(() => []),
      ]);
      const linkOrderRows = (rows) => rows.map((record) => ({ ...record, _links: { ...(record.order_id ? { order_number: { type: 'order', id: record.order_id } } : {}), ...(record.bill_id ? { bill_number: { type: 'bill', id: record.bill_id } } : {}), ...(record.kot_id ? { kot_number: { type: 'kot', id: record.kot_id, label: record.kot_number } } : {}) } }));
      return { eyebrow: 'Employee activity', title: employee.full_name || employee.username, subtitle: employee.role, status: n(employee.is_active) ? 'active' : 'inactive', summary: [field('Orders served', served.length, 'number'), field('Served value', served.reduce((s, r) => s + n(r.grand_total), 0), 'currency'), field('Bills settled', settled.length, 'number'), field('KOTs prepared', tickets.length, 'number')], sections: [section('Employee record', [field('Employee code', `EMP-${employee.id}`, 'text', { type: 'employee', id: employee.id }), field('Username', employee.username), field('Role', employee.role), field('Joined', employee.created_at, 'datetime')]), table('Orders served', [{ key: 'created_at', label: 'Placed', format: 'datetime' }, { key: 'order_number', label: 'Order' }, { key: 'bill_number', label: 'Bill' }, { key: 'order_type', label: 'Type' }, { key: 'table_number', label: 'Table' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'grand_total', label: 'Amount', format: 'currency', align: 'right' }], linkOrderRows(served)), table('Bills settled', [{ key: 'created_at', label: 'Billed', format: 'datetime' }, { key: 'bill_number', label: 'Bill' }, { key: 'order_number', label: 'Order' }, { key: 'payment_status', label: 'Payment', format: 'status' }, { key: 'grand_total', label: 'Amount', format: 'currency', align: 'right' }], linkOrderRows(settled)), ...(tickets.length ? [table('Kitchen tickets prepared', [{ key: 'printed_at', label: 'Printed', format: 'datetime' }, { key: 'kot_number', label: 'KOT' }, { key: 'order_number', label: 'Order' }, { key: 'station', label: 'Station' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'completed_at', label: 'Completed', format: 'datetime' }], linkOrderRows(tickets))] : [])] };
    }
  }
  if (tab === 'tables' && (row._record_id || row.table_number)) {
    const diningTable = await db.get(`SELECT * FROM tables WHERE id=? OR table_number=? ORDER BY id DESC LIMIT 1`, [row._record_id || -1, row.table_number || '']);
    if (diningTable) {
      const orders = await db.all(`SELECT o.created_at,o.id AS order_id,o.order_number,o.party_label,o.order_type,o.status,u.full_name AS waiter_name,b.id AS bill_id,b.bill_number,b.payment_status,b.grand_total,b.paid_at FROM orders o LEFT JOIN bills b ON b.order_id=o.id LEFT JOIN users u ON u.id=o.waiter_id WHERE o.table_id=? OR o.table_number=? ORDER BY o.created_at DESC LIMIT 100`, [diningTable.id, diningTable.table_number]);
      const linkedOrders = orders.map((record) => ({ ...record, _links: { order_number: { type: 'order', id: record.order_id }, ...(record.bill_id ? { bill_number: { type: 'bill', id: record.bill_id } } : {}) } }));
      return { eyebrow: 'Table record', title: `Table ${diningTable.table_number}`, subtitle: diningTable.section || 'Restaurant floor', status: diningTable.status, summary: [field('Capacity', diningTable.capacity, 'number'), field('Recent orders', orders.length, 'number'), field('Recent revenue', orders.reduce((s, r) => s + n(r.grand_total), 0), 'currency'), field('Section', diningTable.section)], sections: [section('Table setup', [field('Table code', `TABLE-${diningTable.id}`, 'text', { type: 'table', id: diningTable.id }), field('Table number', diningTable.table_number), field('Capacity', diningTable.capacity, 'number'), field('Section', diningTable.section), field('Type', diningTable.table_type), field('Floor', diningTable.floor)]), table('Orders served here', [{ key: 'created_at', label: 'Placed', format: 'datetime' }, { key: 'order_number', label: 'Order' }, { key: 'bill_number', label: 'Bill' }, { key: 'party_label', label: 'Party' }, { key: 'order_type', label: 'Type' }, { key: 'waiter_name', label: 'Waiter' }, { key: 'status', label: 'Order', format: 'status' }, { key: 'payment_status', label: 'Payment', format: 'status' }, { key: 'grand_total', label: 'Amount', format: 'currency', align: 'right' }], linkedOrders)] };
    }
  }
  const inventoryName = row.item_name || (tab === 'menu' ? row.name : null);
  if (inventoryName && tab === 'inventory') {
    const item = await db.get(`SELECT * FROM inventory_items WHERE COALESCE(item_name,name)=? ORDER BY id DESC LIMIT 1`, [inventoryName]);
    if (item) {
      const movements = await db.all(`SELECT sm.created_at,sm.change_type,sm.quantity_changed,sm.balance_after,sm.unit_cost,sm.reason,u.full_name AS performed_by FROM stock_movements sm LEFT JOIN users u ON u.id=sm.performed_by WHERE sm.inventory_item_id=? ORDER BY sm.created_at DESC,sm.id DESC LIMIT 100`, [item.id]);
      const purchases = await db.all(`SELECT p.id AS purchase_id,p.invoice_number,p.invoice_date,p.supplier,pi.quantity_received,pi.unit_cost,pi.line_total,p.status,p.created_at FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE pi.inventory_item_id=? ORDER BY p.created_at DESC LIMIT 100`, [item.id]);
      const linkedPurchases = purchases.map((purchase) => ({ ...purchase, _links: { invoice_number: { type: 'purchase', id: purchase.purchase_id } } }));
      return { eyebrow: 'Inventory item', title: inventoryName, subtitle: item.supplier || 'No supplier assigned', status: n(item.quantity) <= 0 ? 'out of stock' : n(item.quantity) <= n(item.min_level) ? 'low' : 'ok', summary: [field('On hand', item.quantity, 'number'), field('Unit', item.unit || item.consumption_unit), field('Unit cost', item.cost_per_unit, 'currency'), field('Stock value', n(item.quantity) * n(item.cost_per_unit), 'currency')], sections: [section('Item setup', [field('Item code', `INV-${item.id}`, 'text', { type: 'inventory', id: item.id }), field('Purchase unit', item.purchase_unit), field('Consumption unit', item.consumption_unit), field('Conversion factor', item.conversion_factor, 'number'), field('Minimum level', item.min_level, 'number'), field('Supplier', item.supplier), field('Last restocked', item.last_restocked, 'datetime')]), table('Recent stock movements', [{ key: 'created_at', label: 'When', format: 'datetime' }, { key: 'change_type', label: 'Type' }, { key: 'quantity_changed', label: 'Change', format: 'number', align: 'right' }, { key: 'balance_after', label: 'Balance', format: 'number', align: 'right' }, { key: 'unit_cost', label: 'Unit cost', format: 'currency', align: 'right' }, { key: 'performed_by', label: 'By' }, { key: 'reason', label: 'Reason' }], movements), table('Purchase history', [{ key: 'invoice_date', label: 'Date' }, { key: 'invoice_number', label: 'Invoice' }, { key: 'supplier', label: 'Supplier' }, { key: 'quantity_received', label: 'Qty', format: 'number', align: 'right' }, { key: 'unit_cost', label: 'Unit cost', format: 'currency', align: 'right' }, { key: 'line_total', label: 'Total', format: 'currency', align: 'right' }, { key: 'status', label: 'Status', format: 'status' }], linkedPurchases)] };
    }
  }
  if (tab === 'suppliers' && row.supplier) {
    const expenses = await db.all(`SELECT id,COALESCE(purchase_date,CAST(expense_date AS TEXT)) AS spent_on,description,category,payment_method,amount,source_type,source_id FROM expenses WHERE COALESCE(NULLIF(TRIM(supplier),''),'Unattributed')=? AND LOWER(COALESCE(status,'active'))<>'voided' ORDER BY spent_on DESC,id DESC LIMIT 100`, [row.supplier]);
    const items = await db.all(`SELECT id,item_name,quantity,unit,cost_per_unit FROM inventory_items WHERE COALESCE(NULLIF(TRIM(supplier),''),'Unattributed')=? ORDER BY item_name`, [row.supplier]);
    const linkedExpenses = expenses.map((expense) => ({ ...expense, _links: { id: expense.source_type === 'purchase' && expense.source_id ? { type: 'purchase', id: expense.source_id } : { type: 'expense', id: expense.id }, description: expense.source_type === 'purchase' && expense.source_id ? { type: 'purchase', id: expense.source_id } : { type: 'expense', id: expense.id } } }));
    const linkedItems = items.map((item) => ({ ...item, _links: { id: { type: 'inventory', id: item.id }, item_name: { type: 'inventory', id: item.id } } }));
    return { eyebrow: 'Supplier record', title: row.supplier, subtitle: `${expenses.length} recent purchase / expense records`, summary: [field('Recent spend', expenses.reduce((sum, e) => sum + n(e.amount), 0), 'currency'), field('Records', expenses.length, 'number'), field('Stock items', items.length, 'number'), field('Stock on hand', items.reduce((sum, i) => sum + n(i.quantity) * n(i.cost_per_unit), 0), 'currency')], sections: [table('Purchases & payments', [{ key: 'spent_on', label: 'Date' }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'payment_method', label: 'Paid by' }, { key: 'amount', label: 'Amount', format: 'currency', align: 'right' }], linkedExpenses), table('Items supplied', [{ key: 'id', label: 'Code' }, { key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'On hand', format: 'number', align: 'right' }, { key: 'unit', label: 'Unit' }, { key: 'cost_per_unit', label: 'Unit cost', format: 'currency', align: 'right' }], linkedItems)] };
  }
  return null;
}

async function dateDetails(db, row) {
  const date = row.date || row.spent_on;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const [bills, expenses] = await Promise.all([
    db.all(`SELECT b.id AS bill_id,b.bill_number,o.id AS order_id,o.order_number,o.table_number,o.customer_id,o.customer_name,b.payment_status,b.grand_total,b.created_at FROM bills b JOIN orders o ON o.id=b.order_id WHERE date(b.created_at,'+5 hours','+45 minutes')=? ORDER BY b.created_at DESC LIMIT 100`, [date]),
    db.all(`SELECT id,description,category,supplier,payment_method,amount,source_type,source_id FROM expenses WHERE COALESCE(purchase_date,CAST(expense_date AS TEXT))=? AND LOWER(COALESCE(status,'active'))<>'voided' ORDER BY id DESC LIMIT 100`, [date]),
  ]);
  const linkedBills = bills.map((bill) => ({ ...bill, _links: { bill_number: { type: 'bill', id: bill.bill_id }, order_number: { type: 'order', id: bill.order_id }, ...(bill.customer_id ? { customer_name: { type: 'customer', id: bill.customer_id } } : {}) } }));
  const linkedExpenses = expenses.map((expense) => ({ ...expense, _links: { id: expense.source_type === 'purchase' && expense.source_id ? { type: 'purchase', id: expense.source_id } : { type: 'expense', id: expense.id }, description: expense.source_type === 'purchase' && expense.source_id ? { type: 'purchase', id: expense.source_id } : { type: 'expense', id: expense.id } } }));
  return { eyebrow: 'Daily record breakdown', title: date, subtitle: 'Sales, payments, purchases and operating expenses recorded on this date', summary: [field('Bills', bills.length, 'number'), field('Billed total', bills.reduce((s, b) => s + n(b.grand_total), 0), 'currency'), field('Expense records', expenses.length, 'number'), field('Expenses & purchases', expenses.reduce((s, e) => s + n(e.amount), 0), 'currency')], sections: [table('Invoices & orders', [{ key: 'created_at', label: 'Time', format: 'datetime' }, { key: 'bill_number', label: 'Invoice' }, { key: 'order_number', label: 'Order' }, { key: 'table_number', label: 'Table' }, { key: 'customer_name', label: 'Customer' }, { key: 'payment_status', label: 'Payment', format: 'status' }, { key: 'grand_total', label: 'Amount', format: 'currency', align: 'right' }], linkedBills), table('Purchases & operating expenses', [{ key: 'id', label: 'Code' }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'supplier', label: 'Supplier' }, { key: 'payment_method', label: 'Paid by' }, { key: 'amount', label: 'Amount', format: 'currency', align: 'right' }], linkedExpenses)] };
}

export async function buildReportRecordDetails(db, { tab, tableId, row = {}, range = null }) {
  const kot = await kotDetails(db, row);
  if (kot) return kot;
  if (tab === 'inventory' && tableId === 'purchases' && row._purchase_id) {
    const purchase = await purchaseDetails(db, { source_type: 'purchase', source_id: row._purchase_id });
    if (purchase) return purchase;
  }
  const direct = await orderDetails(db, row);
  if (direct) return direct;
  if (tab === 'finance' || tab === 'expenses' || (tab === 'suppliers' && tableId === 'purchase-history')) {
    const expense = await expenseDetails(db, row);
    if (expense) return expense;
  }
  if (tab === 'purchases' && row._record_id) {
    const purchase = await purchaseDetails(db, { source_type: 'purchase', source_id: row._record_id });
    if (purchase) return purchase;
  }
  const entity = await entityDetails(db, tab, tableId, row, range);
  if (entity) return entity;
  const dated = await dateDetails(db, row);
  if (dated) return dated;
  return {
    eyebrow: 'Report breakdown', title: tableId ? String(tableId).replace(/-/g, ' ') : 'Record details',
    subtitle: 'All information available for this report row',
    summary: [],
    sections: [section('Recorded information', Object.entries(row).filter(([key]) => !key.startsWith('_')).map(([key, value]) => field(key.replace(/_/g, ' '), value)))],
  };
}
