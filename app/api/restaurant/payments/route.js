import { NextResponse } from 'next/server';
import { OrderRepository } from '@/lib/db/repositories/orders';
import { handleRouteError, requireAuth } from '@/lib/api-guard.js';

const orderRepo = new OrderRepository();

// Get payment history
export async function GET(request) {
  try {
    const auth = await requireAuth(request, {
      roles: ['admin', 'cashier'],
      permission: 'payments.access'
    });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const payments = await orderRepo.getAllPayments(startDate, endDate);

    // Parse notes field for each payment
    const enrichedPayments = payments.map(payment => {
      try {
        const notes = payment.notes ? JSON.parse(payment.notes) : {};
        return {
          ...payment,
          ...notes,
          notes: undefined // Remove raw notes field
        };
      } catch (e) {
        return payment;
      }
    });

    return NextResponse.json({
      success: true,
      payments: enrichedPayments
    });

  } catch (error) {
    return handleRouteError(error, 'Error fetching payment history');
  }
}
