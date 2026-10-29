import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';

/**
 * Change the signed-in admin username and/or PIN.
 * Clears `must_change_password` after a successful PIN update.
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const body = await request.json();
    const newUsername = String(body.newUsername || '').trim();
    const currentPassword = String(body.currentPassword || body.currentPin || '');
    const newPassword = body.newPassword != null && body.newPassword !== ''
      ? String(body.newPassword)
      : null;

    if (newUsername.length < 3) {
      return NextResponse.json({ error: 'Username must be at least 3 characters.' }, { status: 400 });
    }
    if (!currentPassword) {
      return NextResponse.json({ error: 'Enter your current PIN or password.' }, { status: 400 });
    }
    if (newPassword != null && newPassword.length < 4) {
      return NextResponse.json({ error: 'New PIN must be at least 4 characters.' }, { status: 400 });
    }

    const db = Database.getInstance();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [auth.user.id]);
    if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    let valid = false;
    try {
      valid = bcrypt.compareSync(currentPassword, user.password_hash);
    } catch {
      valid = false;
    }
    if (!valid) {
      return NextResponse.json({ error: 'Current PIN or password is incorrect.' }, { status: 401 });
    }

    if (newUsername.toLowerCase() !== String(user.username || '').toLowerCase()) {
      const taken = await db.get(
        'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?',
        [newUsername, user.id]
      );
      if (taken) {
        return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
      }
    }

    const mustChange = !!user.must_change_password;
    if (mustChange && !newPassword) {
      return NextResponse.json({ error: 'You must set a new PIN before continuing.' }, { status: 400 });
    }

    const hash = newPassword ? bcrypt.hashSync(newPassword, 10) : user.password_hash;
    await db.run(
      `UPDATE users SET
         username = ?,
         password_hash = ?,
         must_change_password = 0,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newUsername, hash, user.id]
    );

    // Refresh localStorage user shape for the client.
    const updated = {
      id: user.id,
      username: newUsername,
      full_name: user.full_name,
      role: user.role,
      email: user.email,
      phone: user.phone,
      must_change_password: false,
    };

    return NextResponse.json({
      success: true,
      message: newPassword ? 'Username and PIN updated.' : 'Username updated.',
      user: updated,
    });
  } catch (error) {
    return handleRouteError(error, 'Could not update credentials.');
  }
}
