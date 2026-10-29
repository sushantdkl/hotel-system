/**
 * Canonical unit catalogue.
 *
 * Exists so the owner picks "kg" from a list instead of typing "Kg"/"kilo"/
 * "kgs", and so the conversion factor between a purchase unit and a
 * consumption unit can be derived instead of remembered.
 *
 * ── What this module is NOT ───────────────────────────────────────────────
 * It is not a unit system and it never touches stored data on its own.
 * `normalizeUnit` returns null for anything it does not recognise, and every
 * caller keeps the user's original string in that case — custom units like
 * `box_24` must keep working, so a failed match is a normal outcome, not an
 * error.
 *
 * ── Conversion model ──────────────────────────────────────────────────────
 * Each unit carries a `base` = how many BASE units it contains, where the base
 * is grams (weight), millilitres (volume) or pieces (count). Two units convert
 * only when they share a family AND both have a numeric base.
 *
 * Most count units (packet, box, crate…) deliberately have `base: null`: a box
 * holds whatever the supplier put in it. Returning 1 for box→piece would be a
 * confident wrong answer, so they return null and the UI asks the user.
 */

/** Base unit of each measure family. */
export const FAMILY_BASE = { weight: 'g', volume: 'ml', count: 'pcs' };

export const FAMILY_LABELS = { weight: 'Weight', volume: 'Volume', count: 'Count' };

/**
 * `base` is in grams / millilitres / pieces. `null` means "not derivable" —
 * the quantity per unit depends on the supplier, not on physics.
 */
export const UNITS = [
  // ------------------------------------------------------------- weight (g)
  { key: 'kg', label: 'Kilogram', abbr: 'kg', family: 'weight', base: 1000, aliases: ['kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes', 'kgs', 'kgm'] },
  { key: 'g', label: 'Gram', abbr: 'g', family: 'weight', base: 1, aliases: ['gm', 'gms', 'gram', 'grams', 'gramme', 'grammes'] },
  { key: 'mg', label: 'Milligram', abbr: 'mg', family: 'weight', base: 0.001, aliases: ['milligram', 'milligrams', 'mgs'] },
  { key: 'lb', label: 'Pound', abbr: 'lb', family: 'weight', base: 453.59237, aliases: ['lbs', 'pound', 'pounds'] },
  { key: 'oz', label: 'Ounce', abbr: 'oz', family: 'weight', base: 28.349523125, aliases: ['ozs', 'ounce', 'ounces'] },

  // ------------------------------------------------------------ volume (ml)
  { key: 'l', label: 'Litre', abbr: 'L', family: 'volume', base: 1000, aliases: ['ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'lt'] },
  { key: 'ml', label: 'Millilitre', abbr: 'ml', family: 'volume', base: 1, aliases: ['millilitre', 'millilitres', 'milliliter', 'milliliters', 'mls', 'cc'] },
  { key: 'gallon', label: 'Gallon', abbr: 'gal', family: 'volume', base: 3785.411784, aliases: ['gal', 'gals', 'gallons'] },

  // ----------------------------------------------------------- count (pcs)
  { key: 'pcs', label: 'Piece', abbr: 'pcs', family: 'count', base: 1, aliases: ['pc', 'piece', 'pieces', 'each', 'ea', 'unit', 'units', 'nos', 'no', 'qty'] },
  { key: 'dozen', label: 'Dozen', abbr: 'dz', family: 'count', base: 12, aliases: ['dz', 'doz', 'dozens'] },
  // Everything below holds "however many the supplier packed" -> not derivable.
  { key: 'packet', label: 'Packet', abbr: 'pkt', family: 'count', base: null, aliases: ['pack', 'packs', 'packets', 'pkt', 'pkts', 'pkg', 'package', 'packages'] },
  { key: 'box', label: 'Box', abbr: 'box', family: 'count', base: null, aliases: ['boxes'] },
  { key: 'bottle', label: 'Bottle', abbr: 'btl', family: 'count', base: null, aliases: ['btl', 'btls', 'bottles'] },
  { key: 'plate', label: 'Plate', abbr: 'plate', family: 'count', base: null, aliases: ['plates'] },
  { key: 'bowl', label: 'Bowl', abbr: 'bowl', family: 'count', base: null, aliases: ['bowls'] },
  { key: 'glass', label: 'Glass', abbr: 'glass', family: 'count', base: null, aliases: ['glasses'] },
  { key: 'cup', label: 'Cup', abbr: 'cup', family: 'count', base: null, aliases: ['cups'] },
  { key: 'can', label: 'Can', abbr: 'can', family: 'count', base: null, aliases: ['cans'] },
  { key: 'jar', label: 'Jar', abbr: 'jar', family: 'count', base: null, aliases: ['jars'] },
  { key: 'bag', label: 'Bag', abbr: 'bag', family: 'count', base: null, aliases: ['bags', 'sack', 'sacks'] },
  { key: 'crate', label: 'Crate', abbr: 'crate', family: 'count', base: null, aliases: ['crates'] },
  { key: 'tray', label: 'Tray', abbr: 'tray', family: 'count', base: null, aliases: ['trays'] },
  { key: 'bunch', label: 'Bunch', abbr: 'bunch', family: 'count', base: null, aliases: ['bunches', 'bundle', 'bundles'] },
  { key: 'sachet', label: 'Sachet', abbr: 'sachet', family: 'count', base: null, aliases: ['sachets', 'satchet', 'satchets'] },
  { key: 'tin', label: 'Tin', abbr: 'tin', family: 'count', base: null, aliases: ['tins'] },
  { key: 'carton', label: 'Carton', abbr: 'ctn', family: 'count', base: null, aliases: ['ctn', 'ctns', 'cartons'] },
];

/** key/alias -> unit. Built once; aliases never collide (asserted in scripts/check-units.mjs). */
const LOOKUP = new Map();
for (const unit of UNITS) {
  LOOKUP.set(unit.key, unit);
  LOOKUP.set(unit.abbr.toLowerCase(), unit);
  LOOKUP.set(unit.label.toLowerCase(), unit);
  for (const alias of unit.aliases) LOOKUP.set(alias, unit);
}

/** Strip case, whitespace, dots and a trailing "(s)" so "Kg." and "Kgs" both land. */
function cleanKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\(s\)$/, 's')
    .replace(/[\s._-]+/g, '')
    .trim();
}

export function listUnits() {
  return UNITS;
}

/** Units grouped for a picker: [{ family, label, units }]. */
export function unitsByFamily() {
  return Object.keys(FAMILY_LABELS).map((family) => ({
    family,
    label: FAMILY_LABELS[family],
    units: UNITS.filter((u) => u.family === family),
  }));
}

/**
 * The unit record for a user string, or null when it isn't in the catalogue.
 * Null is the signal to keep whatever the user typed.
 */
export function findUnit(value) {
  const key = cleanKey(value);
  if (!key) return null;
  return LOOKUP.get(key) || LOOKUP.get(key.replace(/s$/, '')) || null;
}

/**
 * Canonical key for a user string, or null when unrecognised.
 * Best-effort by contract: callers must fall back to the original text.
 */
export function normalizeUnit(value) {
  return findUnit(value)?.key ?? null;
}

/** Canonical key when known, otherwise the trimmed original. Safe for storage. */
export function normalizeUnitOrKeep(value) {
  const clean = String(value ?? '').trim();
  return normalizeUnit(clean) ?? clean;
}

/** Short display text for a unit string — the abbreviation when known. */
export function unitLabel(value) {
  const unit = findUnit(value);
  return unit ? unit.abbr : String(value ?? '').trim();
}

/**
 * How many `to` units are inside one `from` unit.
 *   conversionFactor('kg', 'g')     -> 1000
 *   conversionFactor('dozen','pcs') -> 12
 *   conversionFactor('kg', 'pcs')   -> null  (different families)
 *   conversionFactor('box', 'pcs')  -> null  (box has no fixed count)
 *   conversionFactor('box_24','pcs')-> null  (not in the catalogue)
 * Null always means "ask the user", never "1".
 */
export function conversionFactor(from, to) {
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a || !b) return null;
  if (a.key === b.key) return 1;
  if (a.family !== b.family) return null;
  if (a.base === null || b.base === null) return null;

  const factor = a.base / b.base;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  // Kill float noise (oz->g style ratios) without hurting exact ones.
  return Number(factor.toPrecision(12));
}
