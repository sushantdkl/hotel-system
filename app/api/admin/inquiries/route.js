import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { listInquiries, updateInquiry, markInquiryViewed, getLeadsCounts } from '@/lib/leads.js';

async function requireAdmin(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'host_desk.manage' });
  return auth.error ? null : auth.user;
}

export async function GET(request) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const inquiries = await listInquiries({ status });
    const counts = await getLeadsCounts();
    return NextResponse.json({ inquiries, counts });
  } catch (error) {
    console.error('Admin inquiries GET:', error);
    return NextResponse.json({ error: 'Failed to load inquiries' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: 'Missing inquiry id' }, { status: 400 });
    }

    if (body.action === 'mark_viewed') {
      await markInquiryViewed(body.id);
      return NextResponse.json({ success: true });
    }

    const inquiry = await updateInquiry(body.id, {
      status: body.status,
      admin_notes: body.admin_notes,
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, inquiry });
  } catch (error) {
    console.error('Admin inquiries PATCH:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update inquiry' },
      { status: 500 }
    );
  }
}
