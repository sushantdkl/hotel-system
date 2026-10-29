import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { getLeadsCounts } from '@/lib/leads.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'host_desk.manage' });
    if (auth.error) return auth.error;

    const counts = await getLeadsCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    console.error('Leads counts error:', error);
    return NextResponse.json({ error: 'Failed to load counts' }, { status: 500 });
  }
}
