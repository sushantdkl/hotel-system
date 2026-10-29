/**
 * Item-line diffs for reopened bills — used by settle, print, and history UIs.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineKey(item) {
  const id = item.menuItemId ?? item.menu_item_id ?? item.item_id ?? null;
  const name = String(item.name || item.item_name || '').trim().toLowerCase();
  const variant = String(item.variant || item.variant_name || '').trim().toLowerCase();
  return `${id ?? 'x'}|${name}|${variant}`;
}

function normalizeLine(item) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = round2(item.unitPrice ?? item.unit_price ?? item.price ?? 0);
  const total = round2(item.total ?? item.subtotal ?? unitPrice * quantity);
  return {
    menuItemId: item.menuItemId ?? item.menu_item_id ?? item.item_id ?? null,
    name: item.name || item.item_name || 'Item',
    variant: item.variant || item.variant_name || null,
    quantity,
    unitPrice,
    total,
  };
}

/**
 * Compare snapshot items (at reopen) with current cart items.
 * Returns { added, removed, changed } arrays of human-readable change rows.
 */
export function diffReopenItems(originalItems = [], currentItems = []) {
  const before = new Map();
  for (const raw of originalItems || []) {
    const line = normalizeLine(raw);
    const key = lineKey(line);
    const prev = before.get(key);
    if (prev) {
      prev.quantity += line.quantity;
      prev.total = round2(prev.total + line.total);
    } else {
      before.set(key, { ...line });
    }
  }

  const after = new Map();
  for (const raw of currentItems || []) {
    const line = normalizeLine(raw);
    const key = lineKey(line);
    const prev = after.get(key);
    if (prev) {
      prev.quantity += line.quantity;
      prev.total = round2(prev.total + line.total);
    } else {
      after.set(key, { ...line });
    }
  }

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, curr] of after) {
    const orig = before.get(key);
    if (!orig) {
      added.push({
        name: curr.name,
        variant: curr.variant,
        quantity: curr.quantity,
        fromQty: 0,
        toQty: curr.quantity,
        unitPrice: curr.unitPrice,
        total: curr.total,
        deltaValue: curr.total,
        effect: 'added',
      });
      continue;
    }
    if (curr.quantity !== orig.quantity) {
      const deltaQty = curr.quantity - orig.quantity;
      changed.push({
        name: curr.name,
        variant: curr.variant,
        quantity: curr.quantity,
        fromQty: orig.quantity,
        toQty: curr.quantity,
        unitPrice: curr.unitPrice,
        total: curr.total,
        deltaQty,
        deltaValue: round2(curr.unitPrice * deltaQty),
        effect: deltaQty > 0 ? 'increased' : 'decreased',
      });
    }
    before.delete(key);
  }

  for (const [, orig] of before) {
    removed.push({
      name: orig.name,
      variant: orig.variant,
      quantity: orig.quantity,
      fromQty: orig.quantity,
      toQty: 0,
      unitPrice: orig.unitPrice,
      total: orig.total,
      deltaValue: -orig.total,
      effect: 'removed',
    });
  }

  return { added, removed, changed, hasChanges: added.length + removed.length + changed.length > 0 };
}

/** Snapshot shape stored on reopen audit / used for diffs. */
export function snapshotOrderItems(rows = []) {
  return (rows || []).map((i) => normalizeLine(i));
}

export function formatChangeLabel(row) {
  const name = row.variant ? `${row.name} (${row.variant})` : row.name;
  if (row.effect === 'added') return `+ ${row.toQty}× ${name}`;
  if (row.effect === 'removed') return `− ${row.fromQty}× ${name} (removed)`;
  if (row.effect === 'increased') return `${row.fromQty}→${row.toQty}× ${name} (added)`;
  if (row.effect === 'decreased') return `${row.fromQty}→${row.toQty}× ${name} (cut)`;
  return name;
}

export function parseJsonField(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Most recent reopen-settlement change set from an audit/activity list
 * (ordered newest-first). Returns { added, removed, changed } or null.
 */
export function latestReopenChanges(activity = []) {
  for (const a of activity || []) {
    if (a && (a.event === 'reopen_settled' || a.event === 'reopen_refund_settled')) {
      const v = a.newValue || parseJsonField(a.new_value);
      if (v && v.changes) return v.changes;
    }
  }
  return null;
}

const changeKey = (item) => {
  const name = String(item.name || item.item_name || '').trim().toLowerCase();
  const variant = String(item.variant || item.variant_name || '').trim().toLowerCase();
  return `${name}|${variant}`;
};

/**
 * Build a lookup of per-line change annotations for surviving items plus the
 * list of fully-removed lines, so an items table can show cut/added effects.
 */
export function buildChangeIndex(changes) {
  const map = new Map();
  const removed = [];
  if (changes) {
    for (const r of changes.added || []) map.set(changeKey(r), { ...r, kind: 'added' });
    for (const r of changes.changed || []) {
      map.set(changeKey(r), { ...r, kind: r.deltaQty > 0 ? 'increased' : 'decreased' });
    }
    for (const r of changes.removed || []) removed.push(r);
  }
  return { map, removed, changeKey };
}
