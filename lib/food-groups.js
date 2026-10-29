/**
 * Master ("food") categories that group menu categories for reporting.
 *
 * A menu_category belongs to exactly one master category via its `food_group`
 * column. This is a coarse, owner-facing grouping — Food, Beverages, Tobacco —
 * so reports can be read at a glance without listing every menu category.
 *
 * Kept dependency-free so it is safe to import from both client components and
 * server code.
 */

export const FOOD_GROUPS = [
  { id: 'food', label: 'Food' },
  { id: 'beverage', label: 'Beverages' },
  { id: 'tobacco', label: 'Tobacco' },
  { id: 'other', label: 'Other' },
];

export const DEFAULT_FOOD_GROUP = 'food';

const LABEL_BY_ID = new Map(FOOD_GROUPS.map((g) => [g.id, g.label]));

/** Common misspellings / seed typos → canonical id. */
const ALIASES = {
  foods: 'food',
  beverage: 'beverage',
  beverages: 'beverage',
  drink: 'beverage',
  drinks: 'beverage',
  tobacco: 'tobacco',
  cigarette: 'tobacco',
  cigarettes: 'tobacco',
  other: 'other',
  misc: 'other',
  miscellaneous: 'other',
};

/** Coerce any stored value to a known group id, falling back to the default. */
export function normalizeFoodGroup(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return DEFAULT_FOOD_GROUP;
  if (v === 'uncategorised' || v === 'uncategorized') return 'uncategorised';
  const id = ALIASES[v] || v;
  return LABEL_BY_ID.has(id) ? id : DEFAULT_FOOD_GROUP;
}

/** Human label for a group id. `uncategorised` is handled for report rows. */
export function foodGroupLabel(id) {
  if (id === 'uncategorised' || id === 'uncategorized') return 'Uncategorised';
  return LABEL_BY_ID.get(normalizeFoodGroup(id)) || 'Food';
}

/**
 * SQL expression that yields a canonical food_group id for a menu_categories alias.
 * Collapses 'Food'/'food'/'beverages'/'beverage' so charts do not double-count.
 */
export function foodGroupSql(mcAlias = 'mc') {
  const g = `LOWER(TRIM(COALESCE(${mcAlias}.food_group, '${DEFAULT_FOOD_GROUP}')))`;
  return `CASE
    WHEN ${mcAlias}.id IS NULL THEN 'uncategorised'
    WHEN ${g} IN ('beverage', 'beverages', 'drink', 'drinks') THEN 'beverage'
    WHEN ${g} IN ('tobacco', 'cigarette', 'cigarettes') THEN 'tobacco'
    WHEN ${g} IN ('other', 'misc', 'miscellaneous') THEN 'other'
    WHEN ${g} IN ('food', 'foods') THEN 'food'
    ELSE '${DEFAULT_FOOD_GROUP}'
  END`;
}
