/** Local hotel demo. Additive, atomic, and safe to rerun; never resets the POS. */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from '../lib/db/index.js';
import { ensureHotelSchema } from '../lib/hotel/schema.js';
import { hotelDate, hotelSnapshot } from '../lib/hotel/service.js';
import { prepareHotelAccounting, processFolioCommand, loadFolio } from '../lib/hotel/folios.js';
import { folioTotals } from '../lib/hotel/folio-math.js';
import { priceStay } from '../lib/hotel/rates.js';
import { ensureStaffHrSchema } from '../lib/staff-hr.js';
import { ensureNotificationSchema } from '../lib/notifications.js';

const MARK = 'hotel-demo-v1';
const today = hotelDate();
const date = (offset) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const id = (kind, key) => `${MARK}-${kind}-${key}`;

async function seed(db) {
  // Refuse remote/production targets: this command is specifically for local demos.
  const sqlite = db.driver === 'sqlite';
  const installed = sqlite
    ? await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hotel_audit_events'")
    : await db.get("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'hotel_audit_events'");
  if (installed && await db.get('SELECT id FROM hotel_audit_events WHERE id = ?', [MARK])) {
    console.log('Hotel demo already installed; existing records and dates were preserved.');
    return;
  }
  if (sqlite) {
    // SQLite's backup API includes WAL contents and is safe with the app running.
    const backupDir = path.resolve('databases/backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `before-hotel-demo-${Date.now()}.db`);
    if (typeof db.db.backup !== 'function') throw new Error('This seed requires better-sqlite3 for a consistent backup.');
    await db.db.backup(backup);
    console.log(`Database backup: ${backup}`);
  } else {
    console.log('PostgreSQL: no file backup taken; the demo is inserted in one transaction and rolls back on any error.');
  }
  await ensureHotelSchema(db);
  await prepareHotelAccounting(db);
  await ensureStaffHrSchema(db);
  await ensureNotificationSchema(db);
  const actor = await db.get("SELECT id, role FROM users WHERE role = 'admin' AND COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1");
  if (!actor) throw new Error('An active admin is required.');

  await db.transaction(async (tx) => {
    if (await tx.get('SELECT id FROM hotel_audit_events WHERE id = ?', [MARK])) return;
    // Reserve a coherent demo inventory; fail instead of taking over existing rooms/categories.
    for (const number of ['101','102','103','104','105','106','201','202','203','204','205','206','301','302','303','304','401','402']) {
      if (await tx.get("SELECT id FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [number])) {
        throw new Error(`Room ${number} already exists. No demo records were added.`);
      }
    }
    await tx.run("UPDATE hotel_properties SET name = 'Himalayan Courtyard Hotel (Demo)', room_tax_bps = 1300 WHERE id = 'main' AND name = 'Your hotel'");
    const property = await tx.get("SELECT * FROM hotel_properties WHERE id = 'main'");
    const categories = [
      ['single', 'Standard Single', 2500, 1, '1 single bed', 'A quiet room for solo travellers.', 'Wi-Fi, Desk, Hot shower', ['101','102','103','104']],
      ['twin', 'Standard Twin', 3500, 2, '2 single beds', 'Comfortable twin room with courtyard views.', 'Wi-Fi, Desk, Tea maker', ['105','106','201','202']],
      ['deluxe', 'Deluxe King', 5500, 2, '1 king bed', 'Spacious king room with a private balcony.', 'Wi-Fi, AC, Balcony, Minibar', ['203','204','205','206']],
      ['family', 'Family Room', 7500, 4, '1 king + 2 single beds', 'Extra space for a family holiday.', 'Wi-Fi, AC, Sofa, Tea maker', ['301','302','303','304']],
      ['suite', 'Himalayan Suite', 12000, 3, '1 king + sofa bed', 'Top-floor suite with a separate sitting area.', 'Wi-Fi, AC, Lounge, Bathtub, Mountain view', ['401','402']],
    ];
    const rooms = new Map();
    for (const [key, name, rate, capacity, beds, description, amenities, numbers] of categories) {
      await tx.run('INSERT INTO hotel_room_types (id, name, base_rate_cents, capacity, beds, description, amenities, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id('category', key), name, rate * 100, capacity, beds, description, amenities, categories.findIndex((c) => c[0] === key)]);
      for (const number of numbers) {
        const room = { id: id('room', number), number, type: name, cents: rate * 100, capacity };
        rooms.set(number, room);
        await tx.run("INSERT INTO hotel_rooms (id, property_id, room_number, floor, room_type, capacity, nightly_rate_cents) VALUES (?, 'main', ?, ?, ?, ?, ?)",
          [room.id, number, Number(number[0]), name, capacity, room.cents]);
      }
    }
    const names = [
      ['Aarav Sharma','Nepal','Kathmandu',1], ['Sita Gurung','Nepal','Pokhara',0],
      ['Oliver Bennett','United Kingdom','Bristol',0], ['Emma Wilson','Australia','Melbourne',1],
      ['Priya Mehta','India','New Delhi',0], ['Kenji Tanaka','Japan','Kyoto',0],
      ['Maya Tamang','Nepal','Dhulikhel',0], ['Lucas Martin','France','Lyon',0],
      ['Anita Rai','Nepal','Dharan',1], ['Daniel Weber','Germany','Munich',0],
      ['Nisha Thapa','Nepal','Butwal',0], ['Sofia Rossi','Italy','Florence',0],
      ['Rohan Patel','India','Ahmedabad',0], ['Tenzin Sherpa','Nepal','Namche Bazaar',0],
      ['Charlotte Lee','Singapore','Singapore',0], ['Samir Adhikari','Nepal','Chitwan',0],
    ];
    for (const [i, [name, nationality, address, vip]] of names.entries()) {
      await tx.run('INSERT INTO hotel_guests (id, full_name, phone, email, nationality, id_type, id_number, address, vip, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id('guest', i), name, `DEMO-${String(i + 1).padStart(4, '0')}`, `guest${i + 1}@example.com`, nationality, nationality === 'Nepal' ? 'Citizenship' : 'Passport', `DEMO-ID-${i + 1}`, address, vip, 'Fictional demo guest. No real contact or identity information.']);
    }
    const seasons = [{ name: 'Demo autumn offer', start: date(1), end: date(30), roomType: '', adjustBps: 1000 }];
    await tx.run('INSERT INTO hotel_rate_seasons (id, name, start_date, end_date, room_type, adjust_bps) VALUES (?, ?, ?, ?, ?, ?)',
      [id('season', 'autumn'), seasons[0].name, date(1), date(30), '', 1000]);
    for (const [name, supplement] of [['Room only',0], ['Breakfast included',700], ['Half board',1800], ['Full board',2800]]) {
      await tx.run('INSERT INTO hotel_rate_plans (id, name, supplement_cents) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING', [id('plan', name), name, supplement * 100]);
    }
    // Preserve an existing business day and use its real posting date/session.
    let day = await tx.get("SELECT * FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    if (!day) {
      if (await tx.get('SELECT id FROM business_days WHERE business_date = ?', [today])) throw new Error('Today is already closed. Open a business day before installing the demo.');
      await tx.run("INSERT INTO business_days (business_date, status, opened_by, opening_cash, opening_note) VALUES (?, 'open', ?, 0, 'Hotel demo setup')", [today, actor.id]);
      day = await tx.get('SELECT * FROM business_days WHERE business_date = ?', [today]);
      const drawer = await tx.get('SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1');
      if (!drawer) throw new Error('Configure a cash drawer first.');
      const session = await tx.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount, opened_by) VALUES (?, ?, 'open', 0, ?)", [drawer.id, day.id, actor.id]);
      await tx.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, opened_by, drawer_session_id) VALUES (?, 1, 'open', 0, ?, ?)", [day.id, actor.id, Number(session.lastInsertRowid)]);
    }
    const postingDate = String(day.business_date).slice(0, 10);
    if (postingDate < date(-2) || postingDate > today) throw new Error('Open a business day within the last two days before installing this demo.');
    const postingSession = await tx.get("SELECT s.id FROM business_day_sessions s JOIN drawer_sessions d ON d.id = s.drawer_session_id AND d.status = 'open' WHERE s.business_day_id = ? AND s.status = 'open'", [day.id]);
    if (!postingSession) throw new Error('Reopen the business session before installing this demo.');
    const stays = [
      ['occupied-single','101',0,-3,2,1,'in_house','Direct'],
      ['occupied-twin','105',1,-2,0,2,'in_house','Phone'],
      ['occupied-deluxe','203',2,-3,3,2,'in_house','Booking.com'],
      ['occupied-family','301',3,-2,2,4,'in_house','Direct'],
      ['occupied-suite','401',4,-3,1,2,'in_house','Travel agent'],
      ['arrival-single','102',5,0,2,1,'confirmed','Direct'],
      ['arrival-deluxe','204',6,0,3,2,'confirmed','Booking.com'],
      ['arrival-family','302',7,0,4,3,'confirmed','Phone'],
      ['tomorrow','201',8,1,4,2,'confirmed','Direct'],
      ['weekend','402',9,3,6,2,'confirmed','Agoda'],
      ['group-a','303',10,2,5,3,'confirmed','Travel agent'],
      ['group-b','304',10,2,5,3,'confirmed','Travel agent'],
      ['next-week','206',11,7,10,2,'confirmed','Direct'],
      ['cancelled','202',12,2,4,2,'cancelled','Agoda'],
      ['no-show','104',13,-1,1,1,'cancelled','Phone'],
      ['departed','103',14,-4,-2,1,'in_house','Direct'],
    ];
    for (const [key, number, guestIndex, start, end, count, status, source] of stays) {
      const room = rooms.get(number);
      const meal = ['occupied-family','occupied-suite','weekend'].includes(key) ? 'Breakfast included' : 'Room only';
      const plan = await tx.get('SELECT supplement_cents FROM hotel_rate_plans WHERE name = ?', [meal]);
      const departure = key === 'departed' ? postingDate : date(end);
      const prices = priceStay({ baseCents: room.cents, roomType: room.type, start: date(start), end: departure, seasons, supplementCents: Number(plan.supplement_cents) });
      await tx.run(`INSERT INTO hotel_reservations
        (id, property_id, room_id, guest_id, group_id, guest_name, guest_phone, arrival_date, departure_date, guest_count, source, meal_plan, nightly_rate_cents, nightly_rates_json, room_tax_bps, status, checked_in_at, cancelled_at, no_show, created_by, eta)
        VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('stay', key), room.id, id('guest', guestIndex), key.startsWith('group-') ? id('group','trek') : null, names[guestIndex][0], `DEMO-${String(guestIndex + 1).padStart(4,'0')}`, date(start), departure, count, source, meal, prices[0].cents, JSON.stringify(Object.fromEntries(prices.map((p) => [p.date,p.cents]))), Number(property.room_tax_bps), status, status === 'in_house' ? `${date(start)} 14:00:00` : null, status === 'cancelled' ? `${today} 08:00:00` : null, key === 'no-show' ? 1 : 0, actor.id, start === 0 ? '14:00' : null]);
    }
    const command = (key, action) => processFolioCommand(tx, action, actor, id('command', key), postingDate);
    for (const key of ['occupied-single','occupied-twin','occupied-deluxe','occupied-family','occupied-suite','departed']) {
      const stayId = id('stay',key);
      const isDeparted = key === 'departed';
      await command(`${key}-nights`, { type:'post_nights', id:stayId });
      await command(`${key}-service`, { type:'charge', id:stayId, description: key === 'occupied-suite' ? 'Airport transfer (demo)' : 'Laundry service (demo)', amountCents: key === 'occupied-suite' ? 250000 : 60000 });
      const entries = await loadFolio(tx, stayId);
      const total = folioTotals(entries).balance;
      await command(`${key}-payment`, { type:'payment', id:stayId, method: key === 'occupied-deluxe' ? 'Online' : 'Cash', amountCents: isDeparted ? total : Math.floor(total / 2), revision:entries.length });
      if (isDeparted) {
        await command(`${key}-checkout`, { type:'checkout', id:stayId, revision:(await loadFolio(tx,stayId)).length });
        await tx.run('UPDATE hotel_reservations SET checked_out_at = ? WHERE id = ?', [`${postingDate} 11:00:00`,stayId]);
      }
    }
    await command('arrival-deposit', { type:'payment', id:id('stay','arrival-deluxe'), method:'Online', amountCents:300000, revision:0 });
    for (const [number,status,priority,note] of [
      ['106','cleaning','Normal','Linen replacement and bathroom cleaning'],
      ['205','inspection','Normal','Final supervisor inspection'],
      ['302','dirty','High','Family arrival today; prepare extra towels'],
    ]) {
      await tx.run('UPDATE hotel_rooms SET cleaning_status = ? WHERE id = ?', [status,rooms.get(number).id]);
      await tx.run('INSERT INTO hotel_housekeeping_tasks (id, room_id, reservation_id, status, priority, note, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id('task',number),rooms.get(number).id,number === '103' ? id('stay','departed') : null,status,priority,`${note} (demo)`,actor.id]);
    }
    for (const [number,title,priority,status,blocked] of [['202','Bathroom pipe leak','urgent','in_progress',1], ['206','Loose wardrobe handle','low','open',0], ['402','Replace bedside bulb','normal','resolved',0]]) {
      await tx.run('INSERT INTO hotel_maintenance_tickets (id, room_id, title, description, priority, status, blocked_room, reported_by, resolution_note, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id('ticket',number),rooms.get(number).id,title,'Fictional maintenance example.',priority,status,blocked,actor.id,status === 'resolved' ? 'Bulb replaced and tested (demo).' : null,status === 'resolved' ? `${today} 08:30:00` : null]);
      if (blocked) await tx.run('UPDATE hotel_rooms SET blocked = 1 WHERE id = ?', [rooms.get(number).id]);
    }
    for (const [channel,commission,stay] of [['Booking.com',1500,'occupied-deluxe'],['Agoda',1800,'weekend']]) {
      const channelId = id('channel',channel);
      await tx.run('INSERT INTO hotel_ota_channels (id, name, commission_bps, webhook_token, active) VALUES (?, ?, ?, ?, 0)', [channelId,`${channel} (Demo)`,commission,randomBytes(24).toString('hex')]);
      const reservation = await tx.get('SELECT * FROM hotel_reservations WHERE id = ?', [id('stay',stay)]);
      const total = Object.values(JSON.parse(reservation.nightly_rates_json)).reduce((a,b) => a+b,0);
      await tx.run("INSERT INTO hotel_ota_bookings (channel_id, external_id, reservation_id, status, total_cents, commission_cents, payload_json) VALUES (?, ?, ?, 'confirmed', ?, ?, ?)", [channelId,`DEMO-${stay}`,reservation.id,total,Math.round(total*commission/10000),JSON.stringify({ demo:true })]);
      await tx.run("INSERT INTO hotel_ota_log (id, channel_id, source, outcome, external_id, message) VALUES (?, ?, 'webhook', 'ok', ?, ?)", [id('log',stay),channelId,`DEMO-${stay}`,'Demo booking imported; channel is disabled and has no live feed.']);
    }
    await tx.run("INSERT INTO hotel_audit_events (id, property_id, actor_id, action, entity_id, details) VALUES (?, 'main', ?, 'demo_seed', ?, ?)", [MARK,actor.id,MARK,JSON.stringify({ message:`Hotel demo installed: 18 rooms, 5 categories, 16 guests, 16 stays. Base date ${today}; financial posting date ${postingDate}.` })]);
    // PostgreSQL enforces foreign keys on every insert; SQLite needs an explicit check.
    if (sqlite && (await tx.all('PRAGMA foreign_key_check')).length) throw new Error('Foreign-key validation failed; demo transaction rolled back.');
  });
  const snapshot = await hotelSnapshot(db);
  console.log(JSON.stringify({ date:today, rooms:snapshot.rooms.length, categories:snapshot.categories.length, stays:snapshot.bookings.length, guests:Number((await db.get('SELECT COUNT(*) AS n FROM hotel_guests')).n), housekeeping:snapshot.tasks.length, maintenance:snapshot.tickets.length, statuses:snapshot.bookings.reduce((out,b) => ({...out,[b.status]:(out[b.status]||0)+1}),{}) },null,2));
}

const localDb = !process.env.DATABASE_URL
  || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname);
if (!localDb || process.env.NODE_ENV === 'production') throw new Error('Run the hotel demo only against a local development database.');
try { await seed(Database.getInstance()); }
finally { await Database.close(); }
