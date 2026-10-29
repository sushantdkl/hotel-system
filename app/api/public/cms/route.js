import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { handleRouteError } from '@/lib/api-guard.js';
import { getCmsContent } from '@/lib/cms.js';

/**
 * GET /api/public/cms — published website content for the public site.
 * No auth (read-only public content). Internal _meta fields are stripped.
 */
export async function GET() {
  try {
    const db = Database.getInstance();
    const content = await getCmsContent(db);
    // Strip editorial metadata before exposing publicly.
    const clean = JSON.parse(JSON.stringify(content), (k, v) => (k.startsWith('_') ? undefined : v));
    // Only show gallery items marked visible.
    if (clean.gallery?.items) {
      clean.gallery.items = clean.gallery.items
        .filter((i) => i.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    if (clean.festive?.items) {
      clean.festive.items = clean.festive.visible === false
        ? []
        : clean.festive.items
          .filter((item) => item.visible !== false && item.image)
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    }
    return NextResponse.json({ content: clean }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  } catch (error) {
    return handleRouteError(error, 'Failed to load content.');
  }
}
