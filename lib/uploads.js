import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

/**
 * Local / cPanel file-manager image storage.
 *
 * Env:
 *   UPLOADS_DIR   – absolute or project-relative folder (default: ./uploads)
 *   IMAGES_PATH   – public URL prefix (default: /uploads)
 */

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 6000;

const MAGIC = [
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', ext: '.gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    mime: 'image/webp',
    ext: '.webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export function getUploadsDir() {
  const raw = process.env.UPLOADS_DIR || process.env.IMAGES_DIR || './uploads';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function getImagesPublicPath() {
  const p = process.env.IMAGES_PATH || process.env.UPLOADS_PUBLIC_PATH || '/uploads';
  return p.startsWith('/') ? p.replace(/\/$/, '') || '/uploads' : `/${p.replace(/\/$/, '')}`;
}

export function ensureUploadsDir(...subdirs) {
  const base = getUploadsDir();
  const dir = path.join(base, ...subdirs);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
  return dir;
}

export function sanitizeExt(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : null;
}

function detectImage(buffer) {
  for (const m of MAGIC) {
    if (m.test(buffer)) return m;
  }
  return null;
}

function roughPngDimensions(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function roughJpegDimensions(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Save a menu image buffer to disk after validation.
 * Returns public URL path stored in DB (e.g. /uploads/menu/abc.jpg).
 */
export async function saveMenuImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw Object.assign(new Error('No image file provided'), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error('Image must be under 5MB'), { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const magic = detectImage(buffer);
  if (!magic) {
    throw Object.assign(new Error('File is not a valid image (JPEG, PNG, GIF, or WebP).'), {
      status: 400,
    });
  }

  const claimedExt = sanitizeExt(file.name || file.filename || '') || magic.ext;
  if (claimedExt !== magic.ext && !(claimedExt === '.jpeg' && magic.ext === '.jpg')) {
    // Allow .jpeg ↔ .jpg; otherwise require magic match
    if (!(magic.ext === '.jpg' && claimedExt === '.jpeg')) {
      throw Object.assign(new Error('Image extension does not match file contents.'), { status: 400 });
    }
  }

  const dims =
    magic.mime === 'image/png'
      ? roughPngDimensions(buffer)
      : magic.mime === 'image/jpeg'
        ? roughJpegDimensions(buffer)
        : null;
  if (dims && (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION || dims.width < 1 || dims.height < 1)) {
    throw Object.assign(new Error('Image dimensions are not allowed.'), { status: 400 });
  }

  const dir = ensureUploadsDir('menu');
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${magic.ext}`;
  const diskPath = path.join(dir, filename);
  if (!diskPath.startsWith(dir)) {
    throw Object.assign(new Error('Invalid upload path'), { status: 400 });
  }

  fs.writeFileSync(diskPath, buffer, { mode: 0o640 });

  // Optional mirror for local static serving
  const publicMirror = path.join(process.cwd(), 'public', 'uploads', 'menu');
  if (path.resolve(dir) !== path.resolve(publicMirror)) {
    try {
      if (!fs.existsSync(publicMirror)) fs.mkdirSync(publicMirror, { recursive: true });
      fs.copyFileSync(diskPath, path.join(publicMirror, filename));
    } catch {
      /* mirror optional */
    }
  }

  return `/api/media/menu/${filename}`;
}

/**
 * Save a CMS/website image. Same hardened validation as saveMenuImage
 * (magic-byte sniff, extension match, dimension bounds, safe random filename,
 * path-traversal guard, persistent UPLOADS_DIR + public mirror) but stored
 * under the `cms` subdir. Returns { url, width, height, size, ext }.
 */
export async function saveCmsImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw Object.assign(new Error('No image file provided'), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error('Image must be under 5MB'), { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const magic = detectImage(buffer);
  if (!magic) {
    throw Object.assign(new Error('File is not a valid image (JPEG, PNG, GIF, or WebP).'), { status: 400 });
  }

  const claimedExt = sanitizeExt(file.name || file.filename || '') || magic.ext;
  if (claimedExt !== magic.ext && !(claimedExt === '.jpeg' && magic.ext === '.jpg')) {
    if (!(magic.ext === '.jpg' && claimedExt === '.jpeg')) {
      throw Object.assign(new Error('Image extension does not match file contents.'), { status: 400 });
    }
  }

  const dims =
    magic.mime === 'image/png'
      ? roughPngDimensions(buffer)
      : magic.mime === 'image/jpeg'
        ? roughJpegDimensions(buffer)
        : null;
  if (dims && (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION || dims.width < 1 || dims.height < 1)) {
    throw Object.assign(new Error('Image dimensions are not allowed.'), { status: 400 });
  }

  const dir = ensureUploadsDir('cms');
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${magic.ext}`;
  const diskPath = path.join(dir, filename);
  if (!diskPath.startsWith(dir)) {
    throw Object.assign(new Error('Invalid upload path'), { status: 400 });
  }

  fs.writeFileSync(diskPath, buffer, { mode: 0o640 });

  const publicMirror = path.join(process.cwd(), 'public', 'uploads', 'cms');
  if (path.resolve(dir) !== path.resolve(publicMirror)) {
    try {
      if (!fs.existsSync(publicMirror)) fs.mkdirSync(publicMirror, { recursive: true });
      fs.copyFileSync(diskPath, path.join(publicMirror, filename));
    } catch {
      /* mirror optional */
    }
  }

  return {
    url: `/api/media/cms/${filename}`,
    width: dims?.width || null,
    height: dims?.height || null,
    size: file.size,
    ext: magic.ext,
  };
}

const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_ALLOWED_EXT = new Set(['.mp4', '.webm']);
const VIDEO_MAGIC = [
  {
    mime: 'video/mp4',
    ext: '.mp4',
    test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp',
  },
  {
    mime: 'video/webm',
    ext: '.webm',
    test: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
];

function detectVideo(buffer) {
  for (const m of VIDEO_MAGIC) {
    if (m.test(buffer)) return m;
  }
  return null;
}

/**
 * Save a CMS/website video (MP4 or WebM). Magic-byte sniff, extension match,
 * 50MB cap, safe random filename under cms/. Returns { url, size, ext, mime }.
 */
export async function saveCmsVideo(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw Object.assign(new Error('No video file provided'), { status: 400 });
  }
  if (file.size > VIDEO_MAX_BYTES) {
    throw Object.assign(new Error('Video must be under 50MB'), { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const magic = detectVideo(buffer);
  if (!magic) {
    throw Object.assign(new Error('File is not a valid video (MP4 or WebM).'), { status: 400 });
  }

  const claimedExt = path.extname(file.name || file.filename || '').toLowerCase();
  if (claimedExt && !VIDEO_ALLOWED_EXT.has(claimedExt)) {
    throw Object.assign(new Error('Video extension must be .mp4 or .webm.'), { status: 400 });
  }
  if (claimedExt && claimedExt !== magic.ext) {
    throw Object.assign(new Error('Video extension does not match file contents.'), { status: 400 });
  }

  const dir = ensureUploadsDir('cms');
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${magic.ext}`;
  const diskPath = path.join(dir, filename);
  if (!diskPath.startsWith(dir)) {
    throw Object.assign(new Error('Invalid upload path'), { status: 400 });
  }

  fs.writeFileSync(diskPath, buffer, { mode: 0o640 });

  const publicMirror = path.join(process.cwd(), 'public', 'uploads', 'cms');
  if (path.resolve(dir) !== path.resolve(publicMirror)) {
    try {
      if (!fs.existsSync(publicMirror)) fs.mkdirSync(publicMirror, { recursive: true });
      fs.copyFileSync(diskPath, path.join(publicMirror, filename));
    } catch {
      /* mirror optional */
    }
  }

  return {
    url: `/api/media/cms/${filename}`,
    width: null,
    height: null,
    size: file.size,
    ext: magic.ext,
    mime: magic.mime,
  };
}

const RECEIPT_ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const RECEIPT_MAGIC = [
  ...MAGIC.filter((m) => m.mime !== 'image/gif' && m.mime !== 'image/webp'),
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

/**
 * Save a receipt/attachment for an expense (image or PDF). Mirrors
 * saveMenuImage's validation but allows PDFs and skips dimension checks.
 */
export async function saveReceiptUpload(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw Object.assign(new Error('No file provided'), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error('File must be under 5MB'), { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const magic = RECEIPT_MAGIC.find((m) => m.test(buffer));
  if (!magic) {
    throw Object.assign(new Error('File is not a valid receipt (JPEG, PNG, or PDF).'), { status: 400 });
  }

  const claimedExt = path.extname(file.name || file.filename || '').toLowerCase();
  const extOk = RECEIPT_ALLOWED_EXT.has(claimedExt) || !claimedExt;

  const dir = ensureUploadsDir('receipts');
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${magic.ext}`;
  const diskPath = path.join(dir, filename);
  if (!diskPath.startsWith(dir) || !extOk) {
    throw Object.assign(new Error('Invalid upload path'), { status: 400 });
  }

  fs.writeFileSync(diskPath, buffer, { mode: 0o640 });

  const publicMirror = path.join(process.cwd(), 'public', 'uploads', 'receipts');
  if (path.resolve(dir) !== path.resolve(publicMirror)) {
    try {
      if (!fs.existsSync(publicMirror)) fs.mkdirSync(publicMirror, { recursive: true });
      fs.copyFileSync(diskPath, path.join(publicMirror, filename));
    } catch {
      /* mirror optional */
    }
  }

  return `/api/media/receipts/${filename}`;
}

export function resolveUploadFile(urlPath) {
  if (!urlPath || typeof urlPath !== 'string') return null;
  const publicPrefix = getImagesPublicPath();
  let relative = urlPath;
  if (relative.startsWith('/api/media/')) {
    relative = relative.slice('/api/media/'.length);
  } else if (relative.startsWith(publicPrefix)) {
    relative = relative.slice(publicPrefix.length).replace(/^\//, '');
  } else if (relative.startsWith('/uploads/')) {
    relative = relative.slice('/uploads/'.length);
  } else {
    relative = relative.replace(/^\//, '');
  }

  const safe = path.normalize(relative).replace(/^(\.\.(\/|\\|))+/, '').replace(/^[/\\]+/, '');
  if (!safe || safe.includes('..')) return null;

  const root = path.resolve(getUploadsDir());
  const full = path.resolve(path.join(root, safe));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

/**
 * Public URL for uploaded files. Prefer `/api/media/...` so images work on
 * cPanel/Apache even when Next.js `/uploads` rewrites are not applied.
 * Leaves `/images/...` and absolute URLs untouched.
 */
export { toPublicImageUrl } from '@/lib/public-image-url.js';
