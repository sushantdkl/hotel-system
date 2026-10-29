import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import bcrypt from 'bcryptjs';
import { getPrimaryAdminId, isPrimaryAdmin } from '@/lib/employees.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHrmSchema } from '@/lib/hrm.js';
import { ALL_ROLES, canManageAccount } from '@/lib/roles.js';
import { ensurePermissionsSchema, listCustomRoles, resolveRoleChoice } from '@/lib/permissions.js';

function employeeSelect(id) {
  return [
    `SELECT u.id, u.username, u.full_name, u.role, u.custom_role, u.email, u.phone, u.is_active, u.created_at,
            u.salary, u.hire_date, u.position, u.department_id, u.designation_id,
            dep.name AS department_name, des.name AS designation_name
     FROM users u
     LEFT JOIN departments dep ON dep.id = u.department_id
     LEFT JOIN designations des ON des.id = u.designation_id
     WHERE u.id = ?`,
    [id],
  ];
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employees.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureHrmSchema(db);

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    // "custom:<key>" picks a custom role: users.role = its base role, users.custom_role = key.
    await ensurePermissionsSchema(db);
    let customRole;
    if (data.role) ({ role: data.role, customRole } = await resolveRoleChoice(db, data.role));
    if (data.role && !ALL_ROLES.includes(data.role)) {
      return NextResponse.json({ error: 'Choose a valid staff role.' }, { status: 400 });
    }
    if (!canManageAccount(auth.user.role, existingUser.role) || !canManageAccount(auth.user.role, data.role)) {
      return NextResponse.json({ error: 'Only the owner can change admin or manager accounts.' }, { status: 403 });
    }

    const primary = await isPrimaryAdmin(db, id);

    if (primary) {
      if (data.role && data.role !== 'admin') {
        return NextResponse.json(
          {
            error: 'The main admin account must stay as Admin. Role cannot be changed.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }
      if (data.is_active === false || data.is_active === 0) {
        return NextResponse.json(
          {
            error: 'The main admin account cannot be deactivated.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }
    }

    const username = data.username ?? existingUser.username;
    const taken = await db.get(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username, id]
    );
    if (taken) {
      return NextResponse.json({ error: 'Username already exists.' }, { status: 400 });
    }

    const isActive = data.is_active === undefined
      ? existingUser.is_active
      : (data.is_active ? 1 : 0);

    const salary = data.salary === undefined ? existingUser.salary : (data.salary === '' || data.salary == null ? null : Number(data.salary));
    const hireDate = data.hire_date === undefined ? existingUser.hire_date : (data.hire_date || null);
    const position = data.position === undefined ? existingUser.position : (data.position || null);
    const departmentId = data.department_id === undefined ? existingUser.department_id : (data.department_id ? Number(data.department_id) : null);
    const designationId = data.designation_id === undefined ? existingUser.designation_id : (data.designation_id ? Number(data.designation_id) : null);

    if (data.pin) {
      const hashedPassword = bcrypt.hashSync(String(data.pin), 10);
      await db.run(
        `UPDATE users
         SET username = ?, full_name = ?, role = ?, password_hash = ?,
             email = ?, phone = ?, is_active = ?,
             salary = ?, hire_date = ?, position = ?, department_id = ?, designation_id = ?
         WHERE id = ?`,
        [
          username,
          data.full_name ?? existingUser.full_name,
          primary ? 'admin' : (data.role ?? existingUser.role),
          hashedPassword,
          data.email || null,
          data.phone || null,
          isActive,
          salary, hireDate, position, departmentId, designationId,
          id,
        ]
      );
    } else {
      await db.run(
        `UPDATE users
         SET username = ?, full_name = ?, role = ?,
             email = ?, phone = ?, is_active = ?,
             salary = ?, hire_date = ?, position = ?, department_id = ?, designation_id = ?
         WHERE id = ?`,
        [
          username,
          data.full_name ?? existingUser.full_name,
          primary ? 'admin' : (data.role ?? existingUser.role),
          data.email || null,
          data.phone || null,
          isActive,
          salary, hireDate, position, departmentId, designationId,
          id,
        ]
      );
    }
    if (data.role && !primary) await db.run('UPDATE users SET custom_role = ? WHERE id = ?', [customRole, id]);

    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);

    return NextResponse.json({
      message: 'Employee updated successfully.',
      employee,
    });
  } catch (error) {
    console.error('Update employee error:', error);
    return NextResponse.json(
      { error: 'Could not update this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employees.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureHrmSchema(db);

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    if (!canManageAccount(auth.user.role, existingUser.role)) {
      return NextResponse.json({ error: 'Only the owner can change admin or manager accounts.' }, { status: 403 });
    }

    if (data.action === 'activate' || data.action === 'deactivate' || data.is_active !== undefined) {
      const activate =
        data.action === 'activate'
          ? true
          : data.action === 'deactivate'
            ? false
            : !!data.is_active;

      if (!activate && (await isPrimaryAdmin(db, id))) {
        return NextResponse.json(
          {
            error: 'The main admin account cannot be deactivated.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }

      await db.run('UPDATE users SET is_active = ? WHERE id = ?', [activate ? 1 : 0, id]);
    }

    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);

    return NextResponse.json({
      message: Number(employee.is_active) === 1
        ? 'Employee activated successfully.'
        : 'Employee deactivated successfully.',
      employee,
    });
  } catch (error) {
    console.error('Patch employee error:', error);
    return NextResponse.json(
      { error: 'Could not update this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employees.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const userId = Number(id);
    const db = Database.getInstance();
    await ensureHrmSchema(db);

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    if (!canManageAccount(auth.user.role, existingUser.role)) {
      return NextResponse.json({ error: 'Only the owner can delete admin or manager accounts.' }, { status: 403 });
    }

    if (await isPrimaryAdmin(db, userId)) {
      return NextResponse.json(
        {
          error: 'The main admin account is protected and cannot be deleted.',
          code: 'primary_admin_protected',
        },
        { status: 403 }
      );
    }

    // Clear FK references first — live DBs often use NO ACTION (not SET NULL/CASCADE)
    await db.transaction(async () => {
      try { await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]); } catch { /* table may not exist */ }
      try { await db.run('DELETE FROM devices WHERE user_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE tables SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE orders SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE bills SET cashier_id = NULL WHERE cashier_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE kots SET prepared_by = NULL WHERE prepared_by = ?', [userId]); } catch { /* optional */ }

      await db.run('DELETE FROM users WHERE id = ?', [userId]);
    });

    return NextResponse.json({
      message: 'Employee deleted successfully.',
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    const msg = String(error?.message || '');
    if (/FOREIGN KEY|foreign key/i.test(msg)) {
      return NextResponse.json(
        {
          error: 'This employee is linked to past orders or bills, so they cannot be deleted. Deactivate them instead.',
          code: 'employee_in_use',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Could not delete this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employees.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    const primaryId = await getPrimaryAdminId(db);
    return NextResponse.json({
      employee: {
        ...employee,
        is_primary_admin: Number(employee.id) === Number(primaryId),
      },
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load employee.');
  }
}
