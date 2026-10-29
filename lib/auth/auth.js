import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Database from '../db/index.js';
import { logger } from '../logger.js';
import { DYNAMIC_PERMISSION_KEYS, baseRoleOf, isPermissionAllowedSync } from '../permissions.js';
import { isAdminLike } from '../roles.js';

function sessionExpirySqlValue() {
  // Postgres-friendly timestamp without trailing Z
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export class AuthService {
  constructor() {
    this.db = Database.getInstance();
  }

  async authenticate(username, password) {
    const user = await this.db.get(
      `
      SELECT * FROM users 
      WHERE TRIM(username) = ? AND COALESCE(is_active, 1) = 1
    `,
      [username]
    );

    // Generic error — do not reveal which field failed
    const fail = { success: false, error: 'Invalid username or password' };

    if (!user || !user.password_hash || !password || typeof password !== 'string') {
      return fail;
    }

    let isValidPassword = false;
    try {
      isValidPassword = bcrypt.compareSync(password, user.password_hash);
    } catch {
      return fail;
    }

    if (!isValidPassword) {
      return fail;
    }

    // Generate a self-healing stateless session token
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      created: Date.now(),
    };
    const sessionToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    const expiresAt = sessionExpirySqlValue();

    try {
      await this.db.run(
        `
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (?, ?, ?)
      `,
        [user.id, sessionToken, expiresAt]
      );
    } catch (err) {
      logger.error('session_insert_failed', { message: err?.message, code: err?.code });
      const e = new Error('Could not create session. Please try again.');
      e.status = 500;
      e.cause = err;
      throw e;
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        custom_role: user.custom_role || null,
        email: user.email,
        phone: user.phone,
        must_change_password: !!user.must_change_password,
      },
      token: sessionToken,
    };
  }

  async verifySession(token) {
    if (!token) return null;

    // Session tokens are opaque — the ONLY valid proof of identity is a live
    // row in the sessions table. Never decode/trust the token's own bytes:
    // it used to fall back to base64-decoding {username} out of the token
    // and logging the caller in as whoever that named user was, with no
    // signature check — i.e. anyone could forge
    // Buffer.from(JSON.stringify({username:'admin'})).toString('base64')
    // and get an admin session. Do not reintroduce that.
    const session = await this.db.get(
      `
      SELECT s.*, u.id as user_id, u.username, u.full_name, u.role, u.email, u.phone,
             u.is_active, u.must_change_password
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
    `,
      [token]
    );

    if (session && session.is_active) {
      // Separate, failure-tolerant read: a database without the custom_role
      // column (PostgreSQL before migration 084) must still sign people in.
      const custom = await this.db.get('SELECT custom_role FROM users WHERE id = ?', [session.user_id]).catch(() => null);
      session.custom_role = custom?.custom_role || null;
      return {
        id: session.user_id,
        username: session.username,
        full_name: session.full_name,
        role: session.role,
        custom_role: session.custom_role || null,
        email: session.email,
        phone: session.phone,
        must_change_password: !!session.must_change_password,
      };
    }

    return null;
  }

  async logout(token) {
    if (!token) return;
    return this.db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  }

  async logoutAllForUser(userId) {
    return this.db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  }

  hasPermission(userRole, permission) {
    if (isAdminLike(userRole)) return true;
    // Curated actions (cancel order/KOT, void/refund/reopen a bill, ...) are
    // admin-configurable at runtime — see lib/permissions.js and
    // /admin/permissions. Everything else keeps this static role map.
    if (DYNAMIC_PERMISSION_KEYS.has(permission)) return isPermissionAllowedSync(userRole, permission);

    const permissions = {
      admin: ['*'],
      cashier: [
        'bills.*', 'payments.*',
        'orders.*',
        'tables.view', 'menu.view',
        'kots.create', 'kots.update', 'kots.view', 'kots.reprint',
        'business_days.view', 'business_days.open', 'business_days.close',
      ],
      waiter: [
        'orders.*', 'tables.*', 'menu.view',
        'kots.create', 'kots.update', 'kots.reprint', 'kots.view',
        'bills.view', 'bills.request',
        'business_days.view',
      ],
      kitchen: ['kots.*', 'orders.view', 'orders.update'],
    };

    const userPermissions = permissions[baseRoleOf(userRole)] || [];
    if (userPermissions.includes('*')) return true;

    return userPermissions.some((p) => {
      if (p.endsWith('.*')) {
        return permission.startsWith(p.slice(0, -2));
      }
      return p === permission;
    });
  }

  async registerDevice(deviceId, userId, deviceType, ipAddress) {
    try {
      if (this.db.driver === 'postgres') {
        return await this.db.run(
          `
          INSERT INTO devices (device_id, user_id, device_type, ip_address, last_seen)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (device_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            device_type = EXCLUDED.device_type,
            ip_address = EXCLUDED.ip_address,
            last_seen = CURRENT_TIMESTAMP
        `,
          [deviceId, userId, deviceType, ipAddress]
        );
      }
      return await this.db.run(
        `
        INSERT OR REPLACE INTO devices (device_id, user_id, device_type, ip_address, last_seen)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        [deviceId, userId, deviceType, ipAddress]
      );
    } catch (error) {
      logger.warn('register_device_failed', { message: error.message });
      throw error;
    }
  }

  async getActiveDevices() {
    return this.db.all(`
      SELECT d.*, u.full_name as user_name, u.role
      FROM devices d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.is_active = 1
      ORDER BY d.last_seen DESC
    `);
  }
}
