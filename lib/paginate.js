/**
 * Server-side pagination for the admin list endpoints.
 *
 * Every one of these routes used to run an unbounded `SELECT *` and ship the
 * whole table to the browser. At a hundred orders a day that is tens of
 * thousands of rows a year for orders alone, and stock_movements grows several
 * rows per order — so the page got slower every single day it was used.
 *
 * Three rules this module exists to enforce:
 *
 *  1. Sorting happens in SQL. Sorting one page of fifty rows in the browser
 *     reorders that page only, which quietly shows the wrong rows — a
 *     correctness bug, not a cosmetic one.
 *  2. Sort columns come from a per-endpoint allowlist. The sort key arrives in
 *     a query string and is interpolated into SQL, so it can never be taken on
 *     trust.
 *  3. Exports ignore pagination entirely. The owner's requirement is that a
 *     download contains everything matching the filters, not the fifty rows
 *     that happen to be on screen, so `export=1` runs the same filtered query
 *     with no LIMIT.
 *
 * SQL here stays SQLite-flavoured and is translated for Postgres by
 * lib/db/sql.js. In particular there are no `::text` / `::date` casts — those
 * are Postgres-only and break the SQLite path. `CAST(x AS TEXT)` is the
 * portable spelling and is what the search builder uses.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Read the shared list controls off a URLSearchParams.
 * `export=1` (or `all=1`) means "the whole filtered set, no paging".
 *
 * `defaultDir` exists because newest-first is right for a ledger but wrong for
 * an alphabetical list — the caller says which way its natural order runs.
 */
export function readListParams(searchParams, { defaultDir = 'desc' } = {}) {
  const exportAll = searchParams.get('export') === '1' || searchParams.get('all') === '1';
  const page = Math.max(1, toInt(searchParams.get('page'), 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(searchParams.get('page_size'), DEFAULT_PAGE_SIZE)));
  const rawDir = searchParams.get('dir') || defaultDir;
  return {
    page,
    pageSize,
    exportAll,
    sort: searchParams.get('sort') || '',
    dir: String(rawDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC',
    search: (searchParams.get('search') || '').trim(),
  };
}

/**
 * Turn a client sort key into an ORDER BY fragment using an allowlist.
 *
 * @param {Record<string,string>} allowed  sort key -> SQL expression
 * @param {string} fallbackKey             used when the key is absent or unknown
 * @param {string} [tieBreaker]            appended so equal values page stably;
 *                                         without it, rows with the same sort
 *                                         value can reappear across pages.
 */
export function resolveOrderBy(sort, dir, allowed, fallbackKey, tieBreaker) {
  const expr = allowed[sort] || allowed[fallbackKey];
  if (!expr) throw new Error(`No sortable column configured for "${fallbackKey}"`);
  const direction = dir === 'ASC' ? 'ASC' : 'DESC';

  // Push NULLs last in both directions and both dialects.
  //
  // Postgres defaults to NULLS FIRST on DESC and SQLite to NULLS LAST, so
  // "biggest bill first" led with every unbilled order on Postgres and did the
  // right thing on SQLite. `NULLS LAST` is not SQLite-portable, but `x IS NULL`
  // yields false/true in Postgres and 0/1 in SQLite — and both sort the
  // non-null side first — so it fixes the ordering without a dialect branch.
  const parts = [`(${expr}) IS NULL`, `${expr} ${direction}`];
  if (tieBreaker && tieBreaker !== expr) parts.push(`${tieBreaker} DESC`);
  return parts.join(', ');
}

/**
 * Build a case-insensitive search predicate over the given columns.
 * CAST(... AS TEXT) keeps it working for numeric columns and on both dialects.
 * @returns {{ clause: string, params: any[] }} clause is '' when there is nothing to search.
 */
export function buildSearch(term, columns) {
  if (!term || !columns?.length) return { clause: '', params: [] };
  const needle = `%${term.toLowerCase()}%`;
  const clause = `(${columns.map((c) => `lower(CAST(COALESCE(${c}, '') AS TEXT)) LIKE ?`).join(' OR ')})`;
  return { clause, params: columns.map(() => needle) };
}

/**
 * Run a filtered query as a counted page (or, for an export, in full).
 *
 * `from` and `where` are used verbatim for both the count and the page, so the
 * total always describes the same set the rows came from.
 *
 * @returns {{ rows: any[], pagination: object }}
 */
export async function paginateQuery(db, { columns, from, where = '1=1', params = [], orderBy, page, pageSize, exportAll }) {
  const countRow = await db.get(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`, params);
  const total = Number(countRow?.total ?? countRow?.TOTAL ?? 0);

  if (exportAll) {
    const rows = await db.all(`SELECT ${columns} FROM ${from} WHERE ${where} ORDER BY ${orderBy}`, params);
    return { rows, pagination: makePagination({ page: 1, pageSize: rows.length, total, exported: true }) };
  }

  const rows = await db.all(
    `SELECT ${columns} FROM ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { rows, pagination: makePagination({ page, pageSize, total }) };
}

export function makePagination({ page, pageSize, total, exported = false }) {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    has_more: !exported && page < totalPages,
    exported,
  };
}
