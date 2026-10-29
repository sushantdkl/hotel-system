import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { getReservationAlerts, processAutoNoShows } from '@/lib/leads.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], anyPermissions: ['reservations.access', 'host_desk.manage'] });
    if (auth.error) return auth.error;
    const user = auth.user;

    try {
      await processAutoNoShows();
    } catch {
      /* non-fatal */
    }

    const data = await getReservationAlerts();
    // Waiters/cashiers only see arrived / VIP / special / arriving soon — not cancel tooling
    if (user.role === 'waiter' || user.role === 'cashier') {
      data.alerts = (data.alerts || []).filter((a) =>
        [
          'arriving_soon',
          'arrived',
          'vip_arrived',
          'special_request',
          'late',
          'occasion_today',
          'no_show_candidate',
        ].includes(a.type)
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Reservation alerts error:', error);
    return NextResponse.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
}
