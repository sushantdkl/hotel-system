import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { saveCmsImage, saveCmsVideo } from '@/lib/uploads.js';
import { listMedia, addMedia, deleteMedia, getCmsContent } from '@/lib/cms.js';
import { logger } from '@/lib/logger.js';

export const runtime = 'nodejs';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

function isVideoFile(file) {
  const mime = String(file.type || '').toLowerCase();
  if (VIDEO_MIME.has(mime)) return true;
  const ext = path.extname(file.name || file.filename || '').toLowerCase();
  return VIDEO_EXT.has(ext);
}

/** Recursively list files under public/images as media-library entries. */
function listPublicImages() {
  const root = path.join(process.cwd(), 'public', 'images');
  if (!fs.existsSync(root)) return [];
  const out = [];

  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip favicon pack noise in the library grid.
        if (ent.name === 'favicon') continue;
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const rel = path.relative(path.join(process.cwd(), 'public'), full).split(path.sep).join('/');
      const url = `/${rel}`;
      let size = null;
      try { size = fs.statSync(full).size; } catch { /* ignore */ }
      out.push({
        id: `site:${url}`,
        url,
        title: path.basename(ent.name, ext).replace(/[-_]/g, ' '),
        alt: path.basename(ent.name, ext).replace(/[-_]/g, ' '),
        section: rel.startsWith('images/brand') ? 'brand' : 'site',
        width: null,
        height: null,
        size,
        source: 'site',
        created_at: null,
      });
    }
  };

  walk(root);
  out.sort((a, b) => a.url.localeCompare(b.url));
  return out;
}

/** URLs currently referenced in CMS JSON (so we can badge "in use"). */
async function referencedUrls(db) {
  try {
    const content = await getCmsContent(db);
    const json = JSON.stringify(content);
    const found = new Set();
    const re = /\/(?:images|uploads|api\/media)\/[^"'\s\\]+/g;
    let m;
    while ((m = re.exec(json))) found.add(m[0]);
    return found;
  } catch {
    return new Set();
  }
}

/** GET /api/admin/cms/media?section= — uploads + site images under public/images. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cms.manage' });
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const section = searchParams.get('section') || null;
    const db = Database.getInstance();
    const [uploads, site, used] = await Promise.all([
      // A missing cms_media table (migration 071 not run) must not hide the site images.
      listMedia(db, { section }).catch((error) => {
        logger.error('cms_media_list_failed', { message: error.message });
        return [];
      }),
      Promise.resolve(listPublicImages()),
      referencedUrls(db),
    ]);

    const uploadRows = (uploads || []).map((row) => ({
      ...row,
      source: 'upload',
      in_use: used.has(row.url),
    }));

    const uploadUrls = new Set(uploadRows.map((r) => r.url));
    let siteRows = site
      .filter((r) => !uploadUrls.has(r.url))
      .map((r) => ({ ...r, in_use: used.has(r.url) }));

    if (section) {
      siteRows = siteRows.filter((r) => r.section === section || section === 'site');
    }

    return NextResponse.json({
      media: [...uploadRows, ...siteRows],
      counts: { uploads: uploadRows.length, site: siteRows.length },
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load media.');
  }
}

/**
 * POST /api/admin/cms/media — multipart upload (image or video).
 * fields: file, title?, alt?, section?
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cms.manage' });
    if (auth.error) return auth.error;

    const form = await request.formData();
    const file = form.get('file') || form.get('image') || form.get('video');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No media file provided.' }, { status: 400 });
    }

    const video = isVideoFile(file);
    const saved = video ? await saveCmsVideo(file) : await saveCmsImage(file);
    // The file is already saved and its URL works; a failed library entry must not lose the upload.
    const row = await addMedia(Database.getInstance(), {
      url: saved.url,
      title: (form.get('title') || '').toString().slice(0, 200) || null,
      alt: (form.get('alt') || '').toString().slice(0, 300) || null,
      section: (form.get('section') || '').toString().slice(0, 40) || null,
      width: saved.width,
      height: saved.height,
      size: saved.size,
      uploaded_by: auth.user?.id || null,
    }).catch((error) => {
      logger.error('cms_media_record_failed', { url: saved.url, message: error.message });
      return null;
    });
    return NextResponse.json(
      {
        message: 'Uploaded.',
        media: row || { url: saved.url, size: saved.size },
        url: saved.url,
        kind: video ? 'video' : 'image',
      },
      { status: 201 }
    );
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    return handleRouteError(error, 'Failed to upload media.');
  }
}

/** DELETE /api/admin/cms/media?id=&force=1 */
export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cms.manage' });
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Missing media id.' }, { status: 400 });
    const force = searchParams.get('force') === '1';
    const db = Database.getInstance();
    const res = await deleteMedia(db, id, { force });
    return NextResponse.json({ message: 'Deleted.', ...res });
  } catch (error) {
    if (error?.status === 409) {
      return NextResponse.json({ error: error.message, referenced: true }, { status: 409 });
    }
    if (error?.status === 404) return NextResponse.json({ error: error.message }, { status: 404 });
    return handleRouteError(error, 'Failed to delete image.');
  }
}
