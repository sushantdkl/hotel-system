import test from 'node:test';
import assert from 'node:assert/strict';
import { pgRun } from '../../lib/db/postgres.js';

const capture = () => {
  const sent = [];
  return { sent, client: { query: async (text) => { sent.push(text); return { rows: [], rowCount: 1 }; } } };
};

test('pgRun adds RETURNING id to normal inserts', async () => {
  const { sent, client } = capture();
  await pgRun('INSERT INTO expenses (amount) VALUES (?)', [10], client);
  assert.match(sent[0], /RETURNING id$/);
});

test('pgRun leaves role_permissions inserts alone (no id column, PK is role + key)', async () => {
  const { sent, client } = capture();
  await pgRun(
    `INSERT INTO role_permissions (role, permission_key, allowed, updated_by, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (role, permission_key) DO UPDATE SET allowed = excluded.allowed`,
    ['cashier', 'bills.void', 1, 1],
    client
  );
  assert.doesNotMatch(sent[0], /RETURNING/);
});
