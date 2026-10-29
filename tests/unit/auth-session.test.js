/**
 * Regression: verifySession() used to base64-decode the token itself and
 * trust a `{username}` field found inside it as proof of identity whenever
 * no matching row existed in the sessions table ("self-healing"), with no
 * signature check. That let anyone log in as any known username —
 * Buffer.from(JSON.stringify({username:'admin'})).toString('base64') —
 * with zero credentials. The only valid session proof must be a live DB row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_NAME = `auth-session-test-${process.pid}-${Date.now()}.db`;
const dbFullPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'databases', process.env.DB_NAME);

const Database = (await import('../../lib/db/index.js')).default;
const { AuthService } = await import('../../lib/auth/auth.js');
const db = Database.getInstance();
const auth = new AuthService();

test.after(async () => {
  await Database.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbFullPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('a forged token naming a real, active username is rejected', async () => {
  const admin = await db.get(`SELECT id, username FROM users WHERE role='admin' LIMIT 1`);
  assert.ok(admin, 'seed data should include an admin user');

  const forged = Buffer.from(JSON.stringify({ id: admin.id, username: admin.username, role: 'admin', created: Date.now() })).toString('base64');
  const sessionRow = await db.get(`SELECT id FROM sessions WHERE token = ?`, [forged]);
  assert.equal(sessionRow, undefined); // never issued by login

  const result = await auth.verifySession(forged);
  assert.equal(result, null);

  // And it must not have been silently inserted as a "healed" session either.
  const stillNoRow = await db.get(`SELECT id FROM sessions WHERE token = ?`, [forged]);
  assert.equal(stillNoRow, undefined);
});

test('a real login-issued token still verifies', async () => {
  const admin = await db.get(`SELECT id, username, full_name, role FROM users WHERE role='admin' LIMIT 1`);
  const token = 'real-session-token-under-test';
  await db.run(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`,
    [admin.id, token]
  );
  const result = await auth.verifySession(token);
  assert.equal(result?.username, admin.username);
  assert.equal(result?.role, 'admin');
});

test('an unknown/garbage token is rejected', async () => {
  assert.equal(await auth.verifySession('not-a-real-token'), null);
  assert.equal(await auth.verifySession(''), null);
});
