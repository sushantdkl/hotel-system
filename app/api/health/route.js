import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { isPostgresUrl } from '@/lib/db/sql.js';
import { logger } from '@/lib/logger.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — liveness + DB check for cPanel / uptime monitors.
 */
export async function GET() {
  const started = Date.now();
  const payload = {
    ok: true,
    service: 'pos-restaurant',
    env: process.env.NODE_ENV || 'unknown',
    driver: isPostgresUrl() ? 'postgres' : 'sqlite',
    time: new Date().toISOString(),
  };

  try {
    const db = Database.getInstance();
    await db.get('SELECT 1 AS ok');
    payload.database = 'up';
    payload.latency_ms = Date.now() - started;
    return NextResponse.json(payload);
  } catch (error) {
    logger.error('health_db_down', { message: error?.message });
    return NextResponse.json(
      {
        ...payload,
        ok: false,
        database: 'down',
        latency_ms: Date.now() - started,
      },
      { status: 503 }
    );
  }
}
