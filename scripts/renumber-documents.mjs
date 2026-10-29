/**
 * Re-prefix existing orders, bills and KOTs into the channel-aware scheme.
 *
 *   BILL-397 / B397   ->  T-397   TW-397   D-397    (by the order's channel)
 *   KOT-2001          ->  K-2001  K-TW-2001  K-D-2001
 *   ORD-417 / O417    ->  O-417   O-TW-417   O-D-417
 *
 * THE SERIAL IS PRESERVED. Only the prefix changes: bill 397 stays bill 397,
 * so an old printed docket, a customer's photo of a receipt and the row in the
 * database still match, and the shared counters in `document_counters` stay
 * exactly where they were. Renumbering from 1 would have broken all three.
 *
 * The channel comes from the order the document belongs to, through the same
 * normalizedOrderType() every report groups by — never from guessing at the old
 * text. A KOT with no table snapshot falls back to its order, the way
 * lib/channel-mix.js classifies tickets.
 *
 * Safety
 * ------
 *  - Dry run by default; `--apply` writes.
 *  - A row whose number is in some other format (imports, the seeded
 *    ORD-2001-DEMO01 style) is left ALONE and listed, never guessed at.
 *  - A rename that would collide with a number already in the table is skipped
 *    and reported rather than overwriting anything.
 *  - Numbers already in the new format are skipped, so re-running is a no-op.
 *
 * Usage — the loader is required because lib/ uses the `@/` alias:
 *   npm run docs:renumber                    # dry run
 *   npm run docs:renumber -- --apply         # write
 *   npm run docs:renumber -- --apply --only=bills
 *   DB_NAME=rich.db npm run docs:renumber
 */

import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const apply = process.argv.includes('--apply');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

const { default: Database } = await import('../lib/db/index.js');
const { CHANNEL_PREFIX } = await import('../lib/document-numbers.js');
const { normalizedOrderType } = await import('../lib/order-types.js');

const db = Database.getInstance();

/** Old formats, per document type. The capture group is the serial to keep. */
const LEGACY = {
  order: /^(?:ORD-|O)(\d{3,})$/i,
  bill: /^(?:BILL-|B)(\d{3,})$/i,
  kot: /^(?:KOT-|K)(\d{3,})$/i,
};

const TABLES = {
  order: { table: 'orders', column: 'order_number' },
  bill: { table: 'bills', column: 'bill_number' },
  kot: { table: 'kots', column: 'kot_number' },
};

/** Already in the new scheme? Then there is nothing to do for this row. */
function isNewFormat(type, value) {
  const prefixes = Object.values(CHANNEL_PREFIX[type]);
  return prefixes.some((prefix) => new RegExp(`^${prefix}-\\d+$`, 'i').test(value));
}

async function rowsFor(type) {
  if (type === 'order') {
    return db.all(`SELECT id, order_number AS number, order_type, table_id, table_number FROM orders ORDER BY id`);
  }
  if (type === 'bill') {
    return db.all(
      `SELECT b.id, b.bill_number AS number, o.order_type, o.table_id, o.table_number
       FROM bills b LEFT JOIN orders o ON o.id = b.order_id ORDER BY b.id`
    );
  }
  // A ticket keeps its own snapshot; fall back to the order when it is empty,
  // otherwise a NULL table would read as takeaway.
  return db.all(
    `SELECT k.id, k.kot_number AS number,
            COALESCE(k.order_type, o.order_type) AS order_type,
            COALESCE(k.table_id, o.table_id) AS table_id,
            COALESCE(k.table_number, o.table_number) AS table_number
     FROM kots k LEFT JOIN orders o ON o.id = k.order_id ORDER BY k.id`
  );
}

const types = onlyArg
  ? [onlyArg.replace(/s$/, '')].filter((t) => TABLES[t])
  : ['order', 'bill', 'kot'];

if (onlyArg && !types.length) {
  console.log(`--only=${onlyArg} is not one of: orders, bills, kots`);
  process.exit(1);
}

let totalPlanned = 0;
let totalSkipped = 0;

for (const type of types) {
  const { table, column } = TABLES[type];
  const rows = await rowsFor(type).catch(() => []);
  const taken = new Set(rows.map((r) => String(r.number || '').toUpperCase()));
  const planned = [];
  const unmatched = [];
  const collisions = [];
  let alreadyNew = 0;

  for (const row of rows) {
    const current = String(row.number || '').trim();
    if (!current) continue;
    if (isNewFormat(type, current)) { alreadyNew += 1; continue; }

    const match = current.match(LEGACY[type]);
    if (!match) { unmatched.push(current); continue; }

    const channel = normalizedOrderType(row);
    const next = `${CHANNEL_PREFIX[type][channel]}-${match[1]}`;
    if (next.toUpperCase() === current.toUpperCase()) { alreadyNew += 1; continue; }
    if (taken.has(next.toUpperCase())) { collisions.push(`${current} -> ${next}`); continue; }

    taken.delete(current.toUpperCase());
    taken.add(next.toUpperCase());
    planned.push({ id: row.id, from: current, to: next, channel });
  }

  console.log(`\n${table}: ${rows.length} row(s) — ${planned.length} to renumber, ${alreadyNew} already in the new format`);
  for (const change of planned.slice(0, 25)) {
    console.log(`  ${apply ? 'renumber' : 'would renumber'}  ${change.from.padEnd(16)} -> ${change.to.padEnd(16)} (${change.channel})`);
  }
  if (planned.length > 25) console.log(`  … and ${planned.length - 25} more`);
  if (unmatched.length) {
    console.log(`  left alone (unrecognised format): ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? `, +${unmatched.length - 8} more` : ''}`);
  }
  if (collisions.length) {
    console.log(`  SKIPPED, target already exists: ${collisions.join(', ')}`);
  }

  if (apply) {
    for (const change of planned) {
      await db.run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [change.to, change.id]);
    }
  }
  totalPlanned += planned.length;
  totalSkipped += unmatched.length + collisions.length;
}

console.log(
  `\n${apply ? 'Renumbered' : 'Would renumber'} ${totalPlanned} document(s)`
  + (totalSkipped ? `; ${totalSkipped} left unchanged.` : '.')
);
if (!apply) console.log('Re-run with --apply to write. Safe to run again afterwards — it is a no-op once converted.');
