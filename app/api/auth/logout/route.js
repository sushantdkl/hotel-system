import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { extractBearerToken } from '@/lib/api-guard.js';
import { clearSessionCookies } from '@/lib/csrf.js';

export async function POST(request) {
  try {
    let token = extractBearerToken(request);
    try {
      const body = await request.json();
      if (body?.token) token = body.token;
    } catch {
      /* no body */
    }

    const authService = new AuthService();
    if (token) await authService.logout(token);

    const response = NextResponse.json({ success: true });
    clearSessionCookies(response);
    return response;
  } catch {
    const response = NextResponse.json({ error: 'Logout failed' }, { status: 500 });
    clearSessionCookies(response);
    return response;
  }
}
