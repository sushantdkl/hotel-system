import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard';
import { assertKotCancellationApprovalEnabled, listCancellationVerifications, verifyCancellation, cancellationVerificationHistory } from '@/lib/cancellation-verification';
import { readListParams } from '@/lib/paginate';
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin','kitchen'], permission: 'cancellation_verifications.manage' }); if (auth.error) return auth.error;
    const q = new URL(request.url).searchParams; const db = Database.getInstance();
    await assertKotCancellationApprovalEnabled(db);
    if (q.get('document_id')) return NextResponse.json({ history: await cancellationVerificationHistory(db,auth.user,'kot',q.get('document_id')) });
    return NextResponse.json(await listCancellationVerifications(db,auth.user,{ ...readListParams(q), documentType:'kot', status:q.get('status'), from:q.get('from'), to:q.get('to'), businessDayId:q.get('business_day_id') }));
  } catch(e) { return handleRouteError(e,'Could not load cancellation verification.'); }
}
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin','kitchen'], permission: 'cancellation_verifications.manage' }); if (auth.error) return auth.error;
    const db = Database.getInstance();
    await assertKotCancellationApprovalEnabled(db);
    const body = await request.json();
    const verification = await verifyCancellation(db,auth.user,{ ...body, document_type:'kot' });
    return NextResponse.json({ verification },{status:201});
  } catch(e) { return handleRouteError(e,'Could not verify cancellation.'); }
}
