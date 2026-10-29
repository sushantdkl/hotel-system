/**
 * Double-submit CSRF for cookie-authenticated mutations.
 * Bearer-token API clients (SPA localStorage) skip CSRF.
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { extractBearerToken } from '@/lib/api-guard.js';

export const CSRF_COOKIE = 'pos_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function createCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Require CSRF when the request authenticates via cookie (no Authorization bearer).
 */
export function assertCsrf(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return null; // SPA bearer path
  }
  const token = extractBearerToken(request);
  if (!token) return null; // unauthenticated; auth guard handles it

  const cookieToken = readCookie(request, CSRF_COOKIE);
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json(
      { error: 'Invalid or missing CSRF token. Refresh and try again.', code: 'csrf' },
      { status: 403 }
    );
  }
  return null;
}

export function setSessionCookies(response, { sessionToken, csrfToken, maxAgeSec = 86400 }) {
  const secure = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1';
  const common = {
    path: '/',
    maxAge: maxAgeSec,
    sameSite: 'strict',
    secure,
  };

  // NextResponse.cookies — works on cPanel/Node (Response.headers.append often throws)
  response.cookies.set('pos_session', sessionToken, {
    ...common,
    httpOnly: true,
  });
  response.cookies.set(CSRF_COOKIE, csrfToken, {
    ...common,
    httpOnly: false,
  });
  return response;
}

export function clearSessionCookies(response) {
  const secure = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1';
  const common = {
    path: '/',
    maxAge: 0,
    sameSite: 'strict',
    secure,
  };
  response.cookies.set('pos_session', '', { ...common, httpOnly: true });
  response.cookies.set(CSRF_COOKIE, '', { ...common, httpOnly: false });
  return response;
}
