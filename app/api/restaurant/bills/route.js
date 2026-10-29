import { NextResponse } from 'next/server';
import { BillRepository } from '@/lib/db/repositories/bills.js';
import { requireAuth } from '@/lib/api-guard.js';
import { nepalDateString } from '@/lib/report-dates.js';
import Database from '@/lib/db/index.js';
import { completeBillPayment } from '@/lib/bills-admin.js';

const billRepo = new BillRepository();

// Middleware to verify authentication
async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  return auth.error ? null : auth.user;
}

// GET - Get bill by ID or today's bills or sales summary
export async function GET(request) {
  try {
    const session = await verifyAuth(request, 'bills.view');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type'); // 'today' or 'summary'
    const date = searchParams.get('date');
    
    // Get specific bill with full details
    if (id) {
      const bill = await billRepo.getById(parseInt(id));
      
      if (!bill) {
        return NextResponse.json(
          { error: 'Bill not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        bill
      });
    }
    
    // Get today's bills
    if (type === 'today') {
      const bills = await billRepo.getTodaysBills();
      
      return NextResponse.json({
        success: true,
        bills,
        count: bills.length
      });
    }
    
    // Get sales summary
    if (type === 'summary') {
      const summary = await billRepo.getSalesSummary(date || nepalDateString());
      
      return NextResponse.json({
        success: true,
        summary
      });
    }
    
    return NextResponse.json(
      { error: 'Invalid request. Provide id, type=today, or type=summary' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('Bills GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bills' },
      { status: 500 }
    );
  }
}

// POST - Create new bill or add payment
export async function POST(request) {
  try {
    const session = await verifyAuth(request, 'bills.request');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { action, bill_id, ...billData } = body;
    
    // Add payment to existing bill
    if (action === 'add-payment') {
      const paymentAuth = await requireAuth(request, { permission: 'bills.pay' });
      if (paymentAuth.error) return paymentAuth.error;
      const { payment_method, amount } = body;
      
      if (!bill_id || !payment_method || !amount) {
        return NextResponse.json(
          { error: 'Missing required fields: bill_id, payment_method, amount' },
          { status: 400 }
        );
      }
      
      const payment = await completeBillPayment(Database.getInstance(), {
        billId: bill_id,
        method: payment_method,
        amount,
        requestKey: body.idempotency_key || `restaurant-bill-payment-${bill_id}-${Date.now()}`,
        actorId: session.id,
        actorRole: session.role,
      });
      
      const bill = await billRepo.getById(bill_id);
      
      return NextResponse.json({
        success: true,
        message: 'Payment added successfully',
        payment,
        bill
      });
    }
    
    // Create new bill
    const {
      order_id,
      customer_id,
      table_id,
      items,
      subtotal,
      service_charge_percentage,
      tax_percentage,
      discount_amount,
      discount_reason
    } = billData;

    if (Number(discount_amount || 0) > 0) {
      const discountAuth = await requireAuth(request, { permission: 'bills.discount' });
      if (discountAuth.error) return discountAuth.error;
    }
    
    // Validate required fields
    if (!order_id || !items || subtotal === undefined || subtotal === null) {
      return NextResponse.json(
        { error: 'Missing required fields: order_id, items, subtotal' },
        { status: 400 }
      );
    }
    
    const { calculateBillTotals } = await import('@/lib/billing-totals.js');
    // Prefer client-provided rates; otherwise load live settings (0% is valid)
    let servicePct = service_charge_percentage;
    let taxPct = tax_percentage;
    if (servicePct == null || taxPct == null) {
      const Database = (await import('@/lib/db/index.js')).default;
      const { parseSettingsRates } = await import('@/lib/billing-totals.js');
      const db = Database.getInstance();
      const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
      const settings = {};
      for (const row of rows || []) settings[row.setting_key] = row.setting_value;
      const rates = parseSettingsRates(settings);
      if (servicePct == null) servicePct = rates.servicePercent;
      if (taxPct == null) taxPct = rates.vatPercent;
    }

    const totals = calculateBillTotals(Number(subtotal), {
      discountAmount: Number(discount_amount || 0),
      vatPercent: Number(taxPct ?? 0),
      servicePercent: Number(servicePct ?? 0),
    });

    const billId = await billRepo.create({
      order_id,
      customer_id: customer_id || null,
      table_id: table_id || null,
      items,
      subtotal: totals.subtotal,
      service_charge_percent: totals.servicePercent,
      tax_percent: totals.taxPercent,
      service_charge: totals.serviceCharge,
      tax: totals.tax,
      discount_amount: totals.discount,
      discount_reason: discount_reason || null,
      grand_total: totals.total,
      cashier_id: session.id,
      created_by: session.id
    });
    
    // Get the created bill with full details
    const bill = await billRepo.getById(billId);
    
    return NextResponse.json({
      success: true,
      message: 'Bill created successfully',
      bill
    }, { status: 201 });
    
  } catch (error) {
    console.error('Bills POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create bill or add payment' },
      { status: 500 }
    );
  }
}

// PATCH - Mark bill as paid
export async function PATCH(request) {
  try {
    const session = await verifyAuth(request, 'bills.pay');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { id } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing bill ID' },
        { status: 400 }
      );
    }
    
    const updated = await billRepo.markAsPaid(id);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Bill not found or already paid' },
        { status: 404 }
      );
    }
    
    const bill = await billRepo.getById(id);
    
    return NextResponse.json({
      success: true,
      message: 'Bill marked as paid',
      bill
    });
    
  } catch (error) {
    console.error('Bills PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update bill' },
      { status: 500 }
    );
  }
}
