import { NextResponse } from 'next/server';
import { saveReceiptUpload } from '@/lib/uploads';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';

export const runtime = 'nodejs';

/**
 * POST /api/uploads/receipts
 * multipart form field: "file"
 * Returns: { url: "/uploads/receipts/...." }
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter', 'kitchen'] });
    if (auth.error) return auth.error;

    const form = await request.formData();
    const file = form.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const url = await saveReceiptUpload(file);
    return NextResponse.json({ url });
  } catch (error) {
    if (error?.status === 400) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleRouteError(error, 'Failed to upload receipt');
  }
}
