import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  addBusinessInvestment,
  businessFundingProfile,
  getOpeningCashMovementDetail,
  listOpeningCashMovements,
  transferOpeningReserveToFunding,
  updateBusinessInvestment,
} from '@/lib/business-funding.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'business_funding.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'funding';

    if (tab === 'opening_cash') {
      const journalId = Number(searchParams.get('journal_id') || 0);
      if (journalId > 0) {
        return NextResponse.json(await getOpeningCashMovementDetail(db, journalId));
      }
      return NextResponse.json(await listOpeningCashMovements(db, {
        from: searchParams.get('from') || null,
        to: searchParams.get('to') || null,
        reason: searchParams.get('reason') || null,
        direction: searchParams.get('direction') || null,
        q: searchParams.get('q') || null,
      }));
    }

    return NextResponse.json(await businessFundingProfile(db));
  } catch (error) {
    return handleRouteError(error, 'Could not load Business Funding. Run migration 057 first.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'business_funding.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    const db = Database.getInstance();

    if (data.action === 'transfer_opening_reserve') {
      const result = await transferOpeningReserveToFunding(db, {
        journalIds: data.journal_ids || data.journalIds || [],
        createdBy: auth.user?.id || null,
      });
      return NextResponse.json({
        message: `Moved Rs ${Number(result.total || 0).toFixed(2)} from Cash Reserve into Business Funding.`,
        ...result,
      }, { status: 201 });
    }

    const investment = await addBusinessInvestment(db, {
      amount: data.amount,
      date: data.date,
      note: data.note,
      createdBy: auth.user?.id || null,
    });
    return NextResponse.json({ message: 'Investment added to Business Funding.', investment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not complete that Business Funding action.');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'business_funding.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    const db = Database.getInstance();
    const investment = await updateBusinessInvestment(db, {
      id: data.id,
      date: data.date,
      note: data.note,
    });
    return NextResponse.json({ message: 'Investment date corrected.', investment });
  } catch (error) {
    return handleRouteError(error, 'Could not correct the investment date.');
  }
}
