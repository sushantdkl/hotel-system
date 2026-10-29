/**
 * Browser + server safe public media URL helper.
 * Prefer `/api/media/...` so images work on cPanel even when Next `/uploads`
 * rewrites are not applied by Apache.
 */

export function toPublicImageUrl(imageUrl) {
  if (!imageUrl) return null;
  const raw = String(imageUrl).trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) {
    return raw;
  }
  if (raw.startsWith('/api/media/')) return raw;
  if (raw.startsWith('/images/')) return raw;
  if (raw.startsWith('/uploads/')) {
    return `/api/media/${raw.slice('/uploads/'.length)}`;
  }
  if (raw.startsWith('/')) return raw;
  return `/api/media/${raw.replace(/^\//, '')}`;
}
