/**
 * Global search across hotel and restaurant records. Each section is returned
 * only when the user's permissions allow that module; queries are bounded
 * (LIMIT per section) and run on the server.
 */
import { isPermissionAllowedSync } from './permissions.js';
import { permissionRole, isAdminLike } from './roles.js';
import { ensureHotelSchema } from './hotel/schema.js';

const safe = async (promise) => { try { return await promise; } catch { return []; } };

export async function globalSearch(db, user, query) {
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, results: [] };
  const like = `%${q.toLowerCase()}%`;
  const role = permissionRole(user);
  const can = (key) => isAdminLike(user.role) || isPermissionAllowedSync(role, key);
  const results = [];
  const add = (type, items) => { for (const item of items) results.push({ type, ...item }); };

  if (can('hotel.view')) {
    await ensureHotelSchema(db);
    const stays = await safe(db.all(`SELECT b.id, b.guest_name, b.guest_phone, b.status, b.checked_out_at, b.arrival_date, b.departure_date, b.company, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
      WHERE LOWER(b.id) LIKE ? OR LOWER(b.guest_name) LIKE ? OR b.guest_phone LIKE ? OR LOWER(r.room_number) = ? OR LOWER(b.company) LIKE ? OR LOWER(COALESCE(b.group_id, '')) LIKE ?
      ORDER BY CASE WHEN b.status = 'in_house' AND b.checked_out_at IS NULL THEN 0 WHEN b.status = 'confirmed' THEN 1 ELSE 2 END, b.arrival_date DESC LIMIT 8`, [like, like, like, q.toLowerCase(), like, like]));
    add('Stay', stays.map((s) => ({ id: s.id, title: `${s.guest_name} · room ${s.room_number}`, subtitle: `${s.id} · ${s.arrival_date} → ${s.departure_date} · ${s.checked_out_at ? 'checked out' : s.status.replace('_', ' ')}${s.company ? ` · ${s.company}` : ''}`, href: `/admin/hotel/reservations?stay=${encodeURIComponent(s.id)}` })));
    const rooms = await safe(db.all("SELECT room_number, room_type, floor FROM hotel_rooms WHERE property_id = 'main' AND LOWER(room_number) LIKE ? ORDER BY room_number LIMIT 5", [like]));
    add('Room', rooms.map((r) => ({ id: r.room_number, title: `Room ${r.room_number}`, subtitle: `${r.room_type} · floor ${r.floor}`, href: `/admin/hotel/rooms?room=${encodeURIComponent(r.room_number)}` })));
    if (can('hotel.folios')) {
      const invoices = await safe(db.all('SELECT s.statement_number, s.reservation_id, b.guest_name FROM hotel_checkout_statements s JOIN hotel_reservations b ON b.id = s.reservation_id WHERE LOWER(s.statement_number) LIKE ? LIMIT 5', [like]));
      add('Hotel invoice', invoices.map((i) => ({ id: i.statement_number, title: i.statement_number, subtitle: `${i.guest_name} · ${i.reservation_id}`, href: `/admin/hotel/folios?guest=${encodeURIComponent(i.reservation_id)}` })));
    }
  }
  if (can('hotel.front_desk')) {
    const guests = await safe(db.all('SELECT id, full_name, phone, email, vip FROM hotel_guests WHERE LOWER(full_name) LIKE ? OR phone LIKE ? OR LOWER(email) LIKE ? OR LOWER(id) LIKE ? ORDER BY updated_at DESC LIMIT 6', [like, like, like, like]));
    add('Guest', guests.map((g) => ({ id: g.id, title: `${g.full_name}${Number(g.vip) ? ' · VIP' : ''}`, subtitle: [g.phone, g.email].filter(Boolean).join(' · '), href: `/admin/hotel/guests?guest=${encodeURIComponent(g.id)}` })));
  }
  if (can('bills.access') || can('pos.access')) {
    const bills = await safe(db.all('SELECT id, bill_number, grand_total, status, created_at FROM bills WHERE LOWER(bill_number) LIKE ? ORDER BY id DESC LIMIT 6', [like]));
    add('Restaurant bill', bills.map((b) => ({ id: b.id, title: b.bill_number, subtitle: `NPR ${Number(b.grand_total).toFixed(2)} · ${b.status} · ${String(b.created_at).slice(0, 16)}`, href: `/admin/bills?bill=${b.id}` })));
    const orders = await safe(db.all('SELECT id, order_number, status, table_number, customer_name FROM orders WHERE LOWER(order_number) LIKE ? OR LOWER(COALESCE(customer_name, \'\')) LIKE ? OR COALESCE(customer_phone, \'\') LIKE ? ORDER BY id DESC LIMIT 6', [like, like, like]));
    add('Order', orders.map((o) => ({ id: o.id, title: o.order_number, subtitle: [o.table_number && `Table ${o.table_number}`, o.customer_name, o.status].filter(Boolean).join(' · '), href: `/admin/orders?search=${encodeURIComponent(o.order_number)}` })));
    const tables = await safe(db.all('SELECT id, table_number, status, section FROM tables WHERE LOWER(table_number) LIKE ? AND COALESCE(is_active, 1) = 1 LIMIT 5', [like]));
    add('Table', tables.map((t) => ({ id: t.id, title: `Table ${t.table_number}`, subtitle: [t.section, t.status].filter(Boolean).join(' · '), href: '/admin/pos' })));
  }
  if (can('customers.access')) {
    const customers = await safe(db.all('SELECT id, name, phone FROM customers WHERE LOWER(COALESCE(name, \'\')) LIKE ? OR COALESCE(phone, \'\') LIKE ? LIMIT 5', [like, like]));
    add('Customer', customers.map((c) => ({ id: c.id, title: c.name || c.phone, subtitle: c.phone, href: `/admin/customers?search=${encodeURIComponent(c.phone || c.name)}` })));
  }
  if (isAdminLike(user.role) || can('supplier_ledger.access')) {
    const suppliers = await safe(db.all('SELECT id, name, phone FROM suppliers WHERE LOWER(name) LIKE ? OR COALESCE(phone, \'\') LIKE ? LIMIT 5', [like, like]));
    add('Supplier', suppliers.map((s) => ({ id: s.id, title: s.name, subtitle: s.phone || '', href: '/admin/suppliers' })));
  }
  if (isAdminLike(user.role)) {
    const staff = await safe(db.all('SELECT id, full_name, username, role FROM users WHERE LOWER(COALESCE(full_name, \'\')) LIKE ? OR LOWER(username) LIKE ? LIMIT 5', [like, like]));
    add('Employee', staff.map((u) => ({ id: u.id, title: u.full_name || u.username, subtitle: `${u.username} · ${u.role}`, href: '/admin/employees' })));
  }
  return { query: q, results };
}
