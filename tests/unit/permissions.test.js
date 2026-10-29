import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { AuthService } from '../../lib/auth/auth.js';
import {
  PERMISSION_CATALOG,
  MANAGED_ROLES,
  ensurePermissionCache,
  invalidatePermissionCache,
  listRolePermissions,
  setRolePermissions,
  permissionAuditHistory,
} from '../../lib/permissions.js';
import {
  CASHIER_PERMISSION_PATHS,
  OPERATIONAL_PERMISSION_PATHS,
  permissionForOperationalPath,
  permissionForStaffPath,
} from '../../lib/staff-access-policy.js';

const dbPath = path.join(os.tmpdir(), `permissions-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const hasPermission = AuthService.prototype.hasPermission.bind({ db });
const admin = { id: 1, full_name: 'Admin One' };

test.after(() => {
  invalidatePermissionCache();
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('defaults reproduce today\'s hardcoded behavior before any admin edit', async () => {
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'orders.cancel'), true);
  assert.equal(hasPermission('waiter', 'orders.cancel'), true);
  assert.equal(hasPermission('kitchen', 'orders.cancel'), false);
  assert.equal(hasPermission('waiter', 'bills.void'), false);
  assert.equal(hasPermission('cashier', 'bills.void'), true);
  assert.equal(hasPermission('admin', 'bills.void'), true); // admin always allowed
  // Commit 317b991 deliberately widened the cashier catalog — "all defaulted on
  // so existing cashier access is unchanged until an admin edits it". These
  // assertions were left behind on the old defaults; they now record the
  // intended ones.
  assert.equal(hasPermission('cashier', 'purchases.view'), true);
  assert.equal(hasPermission('cashier', 'purchases.create'), true);
  assert.equal(hasPermission('cashier', 'purchases.import'), true);
  assert.equal(hasPermission('cashier', 'suppliers.manage'), true);
  assert.equal(hasPermission('cashier', 'payroll.view'), true);
  assert.equal(hasPermission('cashier', 'payroll.advances.create'), true);
  // Still withheld from every non-admin role, whatever else was granted.
  assert.equal(hasPermission('waiter', 'purchases.view'), false);
  assert.equal(hasPermission('kitchen', 'purchases.view'), false);
  assert.equal(hasPermission('waiter', 'payroll.view'), false);
});

test('every curated key has a default for every managed role', async () => {
  const { catalog, roles, matrix } = await listRolePermissions(db);
  assert.deepEqual(new Set(catalog.map((c) => c.key)), new Set(PERMISSION_CATALOG.map((c) => c.key)));
  assert.deepEqual(roles, MANAGED_ROLES);
  for (const role of roles) {
    for (const { key } of catalog) {
      assert.equal(typeof matrix[role][key], 'boolean');
    }
  }
});

test('admin can grant a role a previously-blocked action, and it takes effect immediately', async () => {
  invalidatePermissionCache();
  assert.equal(hasPermission('waiter', 'bills.void'), false); // cold-cache fallback matches default

  await setRolePermissions(db, [{ role: 'waiter', key: 'bills.void', allowed: true }], admin);
  await ensurePermissionCache(db);
  assert.equal(hasPermission('waiter', 'bills.void'), true);
});

test('admin can grant purchase access to a cashier without granting destructive actions', async () => {
  // The point of this test is isolation: granting the safe purchase actions
  // must not drag the destructive ones along. Since 317b991 the destructive
  // ones default ON, so the admin has to switch them off first — which is
  // exactly the edit an owner would make, and still proves the property.
  await setRolePermissions(db, [
    { role: 'cashier', key: 'purchases.view', allowed: true },
    { role: 'cashier', key: 'purchases.create', allowed: true },
    { role: 'cashier', key: 'purchases.import', allowed: true },
    { role: 'cashier', key: 'purchases.edit', allowed: false },
    { role: 'cashier', key: 'purchases.void', allowed: false },
    { role: 'cashier', key: 'suppliers.manage', allowed: false },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'purchases.view'), true);
  assert.equal(hasPermission('cashier', 'purchases.create'), true);
  assert.equal(hasPermission('cashier', 'purchases.import'), true);
  assert.equal(hasPermission('cashier', 'purchases.edit'), false);
  assert.equal(hasPermission('cashier', 'purchases.void'), false);
  assert.equal(hasPermission('cashier', 'suppliers.manage'), false);
});

test('admin can revoke a role\'s default access', async () => {
  await setRolePermissions(db, [{ role: 'cashier', key: 'kots.cancel', allowed: false }], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'kots.cancel'), false);
});

test('payroll actions are independently configurable', async () => {
  await setRolePermissions(db, [
    { role: 'cashier', key: 'payroll.view', allowed: true },
    { role: 'cashier', key: 'payroll.advances.create', allowed: true },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'payroll.view'), true);
  assert.equal(hasPermission('cashier', 'payroll.advances.create'), true);
  assert.equal(hasPermission('cashier', 'payroll.payments.create'), false);
  assert.equal(hasPermission('cashier', 'payroll.records.delete'), false);
});

test('every permission change writes an audit row with before/after values', async () => {
  const rows = await permissionAuditHistory(db);
  const grant = rows.find((r) => r.role === 'waiter' && r.permission_key === 'bills.void');
  assert.ok(grant);
  assert.equal(grant.previous_value, 0);
  assert.equal(grant.new_value, 1);
  assert.equal(grant.actor_name, admin.full_name);

  const revoke = rows.find((r) => r.role === 'cashier' && r.permission_key === 'kots.cancel');
  assert.ok(revoke);
  assert.equal(revoke.previous_value, 1); // default was true, no row existed yet
  assert.equal(revoke.new_value, 0);
});

test('saving the same value again does not write a duplicate audit row', async () => {
  const before = (await permissionAuditHistory(db)).length;
  await setRolePermissions(db, [{ role: 'waiter', key: 'bills.void', allowed: true }], admin); // already true
  const after = (await permissionAuditHistory(db)).length;
  assert.equal(after, before);
});

test('invalid role/key updates are silently ignored, valid ones in the same batch still apply', async () => {
  await setRolePermissions(db, [
    { role: 'not_a_role', key: 'bills.void', allowed: true },
    { role: 'waiter', key: 'not_a_key', allowed: true },
    { role: 'waiter', key: 'purchases.view', allowed: true },
    { role: 'kitchen', key: 'kots.cancel', allowed: true },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('kitchen', 'kots.cancel'), true);
  assert.equal(hasPermission('waiter', 'purchases.view'), false);
});

test('non-curated permission keys are unaffected by this system (static map still governs them)', async () => {
  assert.equal(hasPermission('cashier', 'business_days.open'), true);
  assert.equal(hasPermission('cashier', 'business_days.force_close'), false);
  assert.equal(hasPermission('kitchen', 'orders.view'), true); // kitchen's static 'orders.view'
});

test('individual cashier reports are independently configurable', async () => {
  await setRolePermissions(db, [
    { role: 'cashier', key: 'report.sales.view', allowed: false },
    { role: 'cashier', key: 'report.finance.view', allowed: true },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'reports.view'), true);
  assert.equal(hasPermission('cashier', 'report.sales.view'), false);
  assert.equal(hasPermission('cashier', 'report.finance.view'), true);
});

test('permission catalog contains no duplicate or hidden explicit authorization keys', () => {
  const catalogKeys = PERMISSION_CATALOG.map((entry) => entry.key);
  assert.equal(new Set(catalogKeys).size, catalogKeys.length, 'permission keys must be unique');

  const roots = ['app', 'components', 'lib'];
  const files = [];
  const visit = (entry) => {
    for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
      const full = path.join(entry, child.name);
      if (child.isDirectory()) visit(full);
      else if (/\.(?:js|jsx)$/.test(child.name)) files.push(full);
    }
  };
  roots.forEach(visit);

  const used = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:permission|requiredPermission)\s*:\s*['"]([^'"]+)['"]/g)) used.add(match[1]);
    for (const match of source.matchAll(/(?:hasPermission|isPermissionAllowedSync)\([^,]+,\s*['"]([^'"]+)['"]/g)) used.add(match[1]);
    for (const match of source.matchAll(/verifyAuth\(request,\s*['"]([^'"]+)['"]\)/g)) used.add(match[1]);
    for (const match of source.matchAll(/anyPermissions\s*:\s*\[([^\]]+)\]/g)) {
      for (const key of match[1].matchAll(/['"]([^'"]+)['"]/g)) used.add(key[1]);
    }
  }
  const hidden = [...used].filter((key) => !catalogKeys.includes(key));
  assert.deepEqual(hidden, [], `explicit permissions missing from catalog: ${hidden.join(', ')}`);
});

test('every cashier page policy points to a visible permission and respects segment boundaries', () => {
  const catalogKeys = new Set(PERMISSION_CATALOG.map((entry) => entry.key));
  for (const { path: routePath, permission } of CASHIER_PERMISSION_PATHS) {
    assert.ok(catalogKeys.has(permission), `${routePath} uses missing permission ${permission}`);
    assert.equal(permissionForStaffPath(routePath), permission);
  }
  assert.equal(permissionForStaffPath('/cashiered'), null);
  assert.equal(permissionForStaffPath('/cashier/new-unregistered-module'), null);
});

test('every cashier workspace page is registered in the page-access policy', () => {
  const pageFiles = [];
  const visit = (entry) => {
    for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
      const full = path.join(entry, child.name);
      if (child.isDirectory()) visit(full);
      else if (child.name === 'page.jsx' || child.name === 'page.js') pageFiles.push(full);
    }
  };
  visit(path.join('app', 'cashier'));
  for (const file of pageFiles) {
    const relative = path.relative('app', path.dirname(file)).replaceAll(path.sep, '/');
    const samplePath = `/${relative.replace(/\[[^\]]+\]/g, '1')}`;
    assert.ok(permissionForStaffPath(samplePath), `${file} has no cashier page permission`);
  }
});

test('every waiter and kitchen page is registered in the operational page policy', () => {
  const catalogKeys = new Set(PERMISSION_CATALOG.map((entry) => entry.key));
  for (const { path: routePath, permission } of OPERATIONAL_PERMISSION_PATHS) {
    assert.ok(catalogKeys.has(permission), `${routePath} uses missing permission ${permission}`);
  }
  for (const area of ['waiter', 'kitchen']) {
    const pageFiles = [];
    const visit = (entry) => {
      for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
        const full = path.join(entry, child.name);
        if (child.isDirectory()) visit(full);
        else if (child.name === 'page.jsx' || child.name === 'page.js') pageFiles.push(full);
      }
    };
    visit(path.join('app', area));
    for (const file of pageFiles) {
      const relative = path.relative('app', path.dirname(file)).replaceAll(path.sep, '/');
      const samplePath = `/${relative.replace(/\[[^\]]+\]/g, '1')}`;
      assert.ok(permissionForOperationalPath(samplePath), `${file} has no operational page permission`);
    }
  }
});
