import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveUploadFile } from '@/lib/uploads';
import { logger } from '@/lib/logger.js';

export const runtime = 'nodejs';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * GET /api/media/menu/filename.jpg
 * Streams files from UPLOADS_DIR (or public/uploads fallback).
 */
export async function GET(_request, context) {
  try {
    const parts = (await context.params).path || [];
    if (!parts.length || parts.some((p) => p.includes('..') || p.includes('/') || p.includes('\\'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const urlPath = `/uploads/${parts.map(decodeURIComponent).join('/')}`;
    let filePath = resolveUploadFile(urlPath);

    if (!filePath) {
      const publicRoot = path.resolve(process.cwd(), 'public', 'uploads');
      const publicPath = path.resolve(path.join(publicRoot, ...parts.map(decodeURIComponent)));
      if (
        (publicPath === publicRoot || publicPath.startsWith(publicRoot + path.sep)) &&
        fs.existsSync(publicPath) &&
        fs.statSync(publicPath).isFile()
      ) {
        filePath = publicPath;
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.error('media_serve_failed', { message: error?.message });
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
