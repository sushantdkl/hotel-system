import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getCmsContent, setCmsSection, CMS_SECTIONS } from '@/lib/cms.js';

/** GET /api/admin/cms — full CMS content (admin). */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cms.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const content = await getCmsContent(db);
    return NextResponse.json({ content, sections: CMS_SECTIONS });
  } catch (error) {
    return handleRouteError(error, 'Failed to load CMS content.');
  }
}

/** PUT /api/admin/cms — body: { section, data }. Updates one section. */
export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cms.manage' });
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const { section, data } = body || {};
    if (!section || !CMS_SECTIONS.includes(section)) {
      return NextResponse.json({ error: 'Invalid or missing section.' }, { status: 400 });
    }
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Missing section data.' }, { status: 400 });
    }
    const db = Database.getInstance();
    const saved = await setCmsSection(db, section, data, auth.user?.id || null);
    return NextResponse.json({ message: 'Saved.', section, data: saved });
  } catch (error) {
    return handleRouteError(error, 'Failed to save CMS content.');
  }
}
