import { NextResponse } from 'next/server';
import { LEGACY_ROLE_ROUTES, PRIMARY_ROUTE, FEATURES } from './lib/deployment.js';

/**
 * Security headers + landing rewrite + legacy-role route guard.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Disabled staff-role surfaces (waiter/kitchen/cashier) are not reachable in
  // this single-admin deployment. Redirect them to the counter sale screen.
  if (
    !FEATURES.staffRoleLogin &&
    LEGACY_ROLE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  ) {
    return NextResponse.redirect(new URL(PRIMARY_ROUTE, request.url));
  }

  // The public landing is served by the route-group page at app/(public)/page.jsx.
  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('X-XSS-Protection', '0');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  // CCTV pages embed the MediaMTX WebRTC player from CCTV_STREAM_BASE_URL.
  let cctvOrigin = '';
  try { cctvOrigin = process.env.CCTV_STREAM_BASE_URL ? new URL(process.env.CCTV_STREAM_BASE_URL).origin : ''; } catch { cctvOrigin = ''; }

  // Allow landing page images, fonts, Google Maps, and Vercel Live feedback script / analytics
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self' https://vercel.live https://*.vercel.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel.com https://*.vercel-insights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://vercel.live https://*.vercel.com",
      "img-src 'self' data: blob: https: https://vercel.live https://*.vercel.com",
      "font-src 'self' data: https://fonts.gstatic.com https://vercel.live https://*.vercel.com",
      "connect-src 'self' https://vercel.live https://*.vercel.com https://*.vercel-insights.com https://vitals.vercel-insights.com wss://*.vercel.com",
      `frame-src 'self' https://www.google.com https://maps.google.com https://*.google.com https://www.youtube-nocookie.com https://player.vimeo.com https://vercel.live https://*.vercel.com${cctvOrigin ? ` ${cctvOrigin}` : ''}`,
      "frame-ancestors 'self' https://vercel.live https://*.vercel.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  return response;
}

export const config = {
  // Skip Next internals + static public assets (icons/images/html/manifest).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|html|txt|xml|webmanifest|js|css|map|woff2?)$).*)',
  ],
};
