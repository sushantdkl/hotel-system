import Database from '../index.js';
import { BILL_NUMBER_PATTERN, nextDocumentNumber } from '../../document-numbers.js';
import { currentBusinessDayId } from '../../business-days.js';

export class BillRepository {
  constructor() {
    this.db = Database.getInstance();
  }
  
  async create(bill) {
    const incomingNumber = String(bill.bill_number || '').trim();
    // The channel decides the prefix (T / TW / D), so the order this bill
    // belongs to has to be read before the number is minted.
    const billOrder = bill.order_id
      ? await this.db.get('SELECT order_type, table_id, table_number, business_day_id, created_at FROM orders WHERE id = ?', [bill.order_id])
      : null;
    const businessDayId = bill.business_day_id || billOrder?.business_day_id || await currentBusinessDayId(this.db, { required: true, allowStale: true });
    const billNumber = BILL_NUMBER_PATTERN.test(incomingNumber)
      ? incomingNumber.toUpperCase()
      : await nextDocumentNumber(this.db, { type: 'bill', prefix: 'BILL', order: billOrder || bill });
    const result = await this.db.run(`
      INSERT INTO bills (
        bill_number, order_id, table_id, subtotal,
        service_charge, service_charge_percent,
        tax, tax_percent, discount_amount, discount_type,
        discount_reason, grand_total, cashier_id, business_day_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `, [
      billNumber,
      bill.order_id,
      bill.table_id,
      bill.subtotal,
      bill.service_charge || 0,
      bill.service_charge_percent ?? 0,
      bill.tax || 0,
      bill.tax_percent ?? 0,
      bill.discount_amount || 0,
      bill.discount_type || null,
      bill.discount_reason || null,
      bill.grand_total,
      bill.cashier_id,
      businessDayId,
      billOrder?.created_at || null,
    ]);
    
    return result.lastInsertRowid;
  }
  
  async getById(id) {
    const bill = await this.db.get(`
      SELECT b.*, o.order_number, t.table_number,
             u.full_name as cashier_name
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      LEFT JOIN tables t ON b.table_id = t.id
      LEFT JOIN users u ON b.cashier_id = u.id
      WHERE b.id = ?
    `, [id]);
    
    if (bill) {
      bill.payments = await this.db.all(`
        SELECT * FROM bill_payments 
        WHERE bill_id = ?
      `, [id]);
      
      bill.items = await this.db.all(`
        SELECT oi.*, mi.name as item_name
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ?
      `, [bill.order_id]);
    }
    
    return bill;
  }
  
  async addPayment(billId, payment) {
    // Keep legacy callers on the same guarded path as the admin bill screen:
    // caps at the remaining balance, handles customer credit correctly, blocks
    // voided bills and records journals/allocations atomically.
    const { completeBillPayment } = await import('../../bills-admin.js');
    return completeBillPayment(this.db, {
      billId,
      amount: payment.amount,
      method: payment.payment_method,
      reference: payment.reference_number,
      requestKey: payment.idempotency_key || `legacy-bill-payment-${billId}-${Date.now()}`,
      actorId: payment.processed_by || null,
      actorRole: payment.actor_role || 'admin',
    });
  }
  
  async markAsPaid(id) {
    return await this.db.run(`
      UPDATE bills 
      SET status = 'paid', paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  }
  
  async getTodaysBills() {
    const businessDayId = await currentBusinessDayId(this.db);
    if (!businessDayId) return [];
    return await this.db.all(`
      SELECT b.*, o.order_number, t.table_number,
             u.full_name as cashier_name
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      LEFT JOIN tables t ON b.table_id = t.id
      LEFT JOIN users u ON b.cashier_id = u.id
      WHERE b.business_day_id = ?
      ORDER BY b.created_at DESC
    `, [businessDayId]);
  }
  
  async getSalesSummary(startDate, endDate) {
    return await this.db.get(`
      SELECT 
        COUNT(*) as total_bills,
        SUM(grand_total) as total_sales,
        AVG(grand_total) as average_bill,
        SUM(CASE WHEN status = 'paid' THEN grand_total ELSE 0 END) as paid_amount,
        SUM(CASE WHEN status = 'unpaid' THEN grand_total ELSE 0 END) as pending_amount
      FROM bills
      WHERE date(created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?
    `, [startDate, endDate]);
  }
}
