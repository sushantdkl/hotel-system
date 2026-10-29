/**
 * Public base URL for customer-facing links (table QR, etc.).
 * Prefer APP_URL — never bake HOSTNAME=0.0.0.0 into QR codes.
 */

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  return !h || h === '0.0.0.0' || h === '127.0.0.1' || h === 'localhost' || h === '::' || h === '::1';
}

/**
 * @param {Request} [request]
 * @returns {string} origin without trailing slash
 */
export function getPublicAppUrl(request) {
  const fromEnv = stripTrailingSlash(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '');
  if (fromEnv) {
    try {
      const u = new URL(fromEnv);
      if (!isLoopbackHost(u.hostname) || process.env.NODE_ENV !== 'production') {
        return stripTrailingSlash(u.origin);
      }
    } catch {
      /* fall through */
    }
    if (fromEnv.startsWith('http')) return fromEnv;
  }

  if (request?.headers) {
    const xfHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (xfHost && !isLoopbackHost(xfHost)) {
      const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      return `${proto}://${xfHost.split(',')[0].trim()}`;
    }
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const u = new URL(origin);
        if (!isLoopbackHost(u.hostname)) return stripTrailingSlash(u.origin);
      } catch {
        /* ignore */
      }
    }
  }

  if (request?.url) {
    try {
      const u = new URL(request.url);
      if (!isLoopbackHost(u.hostname)) return stripTrailingSlash(u.origin);
    } catch {
      /* ignore */
    }
  }

  return fromEnv || '';
}
