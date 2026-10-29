import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import { createCsrfToken, setSessionCookies } from '@/lib/csrf.js';
import { logger } from '@/lib/logger.js';

export async function POST(request) {
  try {
    const ip = clientIp(request);
    try {
      const limited = await checkRateLimit({
        key: `login:${ip}`,
        limit: Number(process.env.RATE_LIMIT_LOGIN || 10),
        windowSeconds: 60,
      });
      if (!limited.ok) {
        return NextResponse.json(
          { success: false, error: 'Too many login attempts. Please wait a minute.' },
          { status: 429, headers: { 'Retry-After': String(limited.retryAfter || 60) } }
        );
      }
    } catch (rateErr) {
      // Don't block login if rate-limit table can't be created
      logger.warn('login_rate_limit_skipped', { message: rateErr?.message });
    }

    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = body.pin ?? body.password ?? '';
    const deviceId = body.deviceId;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const authService = new AuthService();
    const result = await authService.authenticate(username, password);

    if (!result.success) {
      logger.info('login_failed', { ip });
      return NextResponse.json({ success: false, error: result.error }, { status: 401 });
    }

    if (deviceId) {
      try {
        await authService.registerDevice(
          deviceId,
          result.user.id,
          result.user.role,
          ip
        );
      } catch {
        /* optional */
      }
    }

    const csrfToken = createCsrfToken();
    const response = NextResponse.json({
      success: true,
      user: result.user,
      token: result.token,
      csrfToken,
      must_change_password: result.user.must_change_password,
    });

    try {
      setSessionCookies(response, {
        sessionToken: result.token,
        csrfToken,
      });
    } catch (cookieErr) {
      // Token is still returned in JSON for localStorage clients
      logger.warn('login_cookie_set_failed', { message: cookieErr?.message });
    }

    logger.info('login_ok', { role: result.user.role });
    return response;
  } catch (error) {
    const detail = error?.cause?.message || error?.message;
    logger.error('login_error', { message: detail, code: error?.code });
    return NextResponse.json(
      {
        error: error?.message && error.status === 500
          ? error.message
          : 'Login failed',
        // Helps diagnose cPanel DB permission / session insert issues
        detail: detail || undefined,
      },
      { status: 500 }
    );
  }
}
