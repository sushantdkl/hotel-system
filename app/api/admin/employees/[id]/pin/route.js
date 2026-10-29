import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/api-guard.js';
import { canManageAccount } from '@/lib/roles.js';

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employees.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const body = await request.json();
    
    const new_pin = body.new_pin || body.pin || body.newPin;

    // Validate PIN exists
    if (!new_pin && new_pin !== 0) {
      return NextResponse.json(
        { error: 'PIN is required' },
        { status: 400 }
      );
    }

    // Convert to string if it's a number
    const pinString = String(new_pin);

    // Validate PIN length (4-6 digits)
    if (pinString.length < 4 || pinString.length > 6) {
      return NextResponse.json(
        { error: 'PIN must be 4-6 digits' },
        { status: 400 }
      );
    }

    // Validate PIN contains only numbers
    if (!/^\d+$/.test(pinString)) {
      return NextResponse.json(
        { error: 'PIN must contain only numbers' },
        { status: 400 }
      );
    }

    // Hash the PIN using bcrypt
    const hashedPassword = bcrypt.hashSync(pinString, 10);

    const db = Database.getInstance();
    const target = await db.get('SELECT role FROM users WHERE id = ?', [id]);
    if (!canManageAccount(auth.user.role, target?.role)) {
      return NextResponse.json({ error: 'Only the owner can reset an admin or manager PIN.' }, { status: 403 });
    }
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, id]);

    return NextResponse.json({ 
      message: 'PIN updated successfully' 
    });
  } catch (error) {
    console.error('Update PIN error:', error);
    return NextResponse.json(
      { error: 'Failed to update PIN' },
      { status: 500 }
    );
  }
}
