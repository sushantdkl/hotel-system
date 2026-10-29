#!/usr/bin/env node
/**
 * CLI health check — uses APP_URL or http://127.0.0.1:$PORT/api/health
 */
const base =
  process.env.APP_URL ||
  `http://127.0.0.1:${process.env.PORT || 3000}`;

const url = `${base.replace(/\/$/, '')}/api/health`;

try {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    console.error('UNHEALTHY', res.status, body);
    process.exit(1);
  }
  console.log('OK', body);
  process.exit(0);
} catch (err) {
  console.error('UNHEALTHY', err.message);
  process.exit(1);
}
