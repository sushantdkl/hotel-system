import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensurePermissionCache, isPermissionAllowedSync, listUserPermissions, setUserPermissions } from '../../lib/permissions.js';
import { permissionRole } from '../../lib/roles.js';
import { AuthService } from '../../lib/auth/auth.js';

const owner = { id: 1, role: 'admin', full_name: 'Owner' };
const manager = { id: 2, role: 'manager', full_name: 'Manager' };

test('per-user overrides: allow any permission, block role permissions, reset, guards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase11-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  try {
    const waiterId = Number((await db.run("INSERT INTO users (username, password_hash, full_name, role) VALUES ('w11', 'x', 'Waiter 11', 'waiter')")).lastInsertRowid);
    const otherId = Number((await db.run("INSERT INTO users (username, password_hash, full_name, role) VALUES ('w12', 'x', 'Waiter 12', 'waiter')")).lastInsertRowid);
    const mgrId = Number((await db.run("INSERT INTO users (username, password_hash, full_name, role) VALUES ('m11', 'x', 'Mgr', 'manager')")).lastInsertRowid);
    const waiter = { id: waiterId, role: 'waiter' };
    const other = { id: otherId, role: 'waiter' };
    await ensurePermissionCache(db);
    assert.equal(isPermissionAllowedSync(permissionRole(waiter), 'hotel.front_desk'), false);
    assert.equal(isPermissionAllowedSync(permissionRole(waiter), 'kot_history.access'), true);

    // A hotel permission outside the waiter role, and a block on a role default.
    const view = await setUserPermissions(db, manager, waiterId, [{ key: 'hotel.front_desk', value: 'allow' }, { key: 'kot_history.access', value: 'block' }, { key: 'nope', value: 'allow' }]);
    assert.deepEqual(view.permissions['hotel.front_desk'], { role: false, override: true });
    await ensurePermissionCache(db);
    assert.equal(isPermissionAllowedSync(permissionRole(waiter), 'hotel.front_desk'), true);
    assert.equal(isPermissionAllowedSync(permissionRole(waiter), 'kot_history.access'), false);
    assert.equal(isPermissionAllowedSync(permissionRole(other), 'hotel.front_desk'), false, 'other staff in the same role unchanged');
    // Static role map (non-catalog keys) still resolves the base role from a user subject.
    assert.equal(new AuthService().hasPermission(permissionRole(waiter), 'orders.create'), true);

    await setUserPermissions(db, owner, waiterId, [{ key: 'kot_history.access', value: 'role' }]);
    await ensurePermissionCache(db);
    assert.equal(isPermissionAllowedSync(permissionRole(waiter), 'kot_history.access'), true);
    assert.equal((await listUserPermissions(db, owner, waiterId)).permissions['kot_history.access'].override, null);

    await assert.rejects(setUserPermissions(db, waiter, otherId, [{ key: 'hotel.view', value: 'allow' }]), { status: 403 });
    await assert.rejects(setUserPermissions(db, manager, mgrId, [{ key: 'hotel.view', value: 'allow' }]), /every permission/);
    const audit = await db.all("SELECT * FROM permission_audit WHERE role = ?", [`user:${waiterId}`]);
    assert.equal(audit.length, 3);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
