'use client';

/**
 * Table-first record grid for the management pages (Airtable / Stripe style).
 *
 * report-kit's <DataTable> stays the right tool for read-only analytics: it
 * renders values through formatValue and nothing else. This one adds what a
 * management surface needs — custom cell renderers, row selection, bulk
 * actions, a sticky action column, inline editing and printing — so the two
 * are complementary rather than duplicated. Sorting/search/CSV behave the same
 * way in both on purpose.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Printer, Search } from 'lucide-react';
import { toCsv } from '@/lib/csv';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils.js';
import { loadPrintSettings, printThermalItems } from '@/lib/print-report.js';

/** Value used for sorting/searching a column: explicit `value()` or row[key]. */
function cellValue(col, row) {
  return col.value ? col.value(row) : row[col.key];
}

function exportedCellValue(col, row) {
  const value = cellValue(col, row);
  if (value == null || value === '') return '';
  const identity = `${col.key || ''} ${col.label || ''}`;
  if (/(created|updated|paid|printed|opened|closed|received|recorded).*(at|time)|date.*time/i.test(identity)) return formatNepalTime(value);
  if (/(^|_)(date|day)$|date|day/i.test(identity)) return formatNepalDate(value);
  return value;
}

/**
 * Opens the print dialog on a plain copy of the visible rows: on the thermal
 * roll one block per record (first column, then each filled column as
 * label/value), on A4 a table.
 */
export async function printRows(title, columns, rows) {
  const settings = await loadPrintSettings();
  const [first, ...rest] = columns;
  const items = rows.flatMap((row) => [
    { type: 'head', text: String(exportedCellValue(first, row) ?? '') || '—' },
    ...rest
      .map((c) => ({ type: 'row', label: c.label, value: String(exportedCellValue(c, row) ?? '') }))
      .filter((r) => r.value.trim()),
  ]);
  if (printThermalItems({ items, title, subtitle: `${rows.length} row(s)`, settings })) return;
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const head = columns.map((c) => `<th>${html(c.label)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${html(exportedCellValue(c, row))}</td>`).join('')}</tr>`)
    .join('');
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '100%';
  document.body.appendChild(frame);
  frame.contentDocument.write(
    `<title>${title}</title><style>
      body{font:12px system-ui,sans-serif;color:#111827;padding:24px}
      h1{font-size:16px;margin:0 0 4px}p{color:#6b7280;margin:0 0 16px}
      table{border-collapse:collapse;width:100%}
      th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left}
      th{color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
     </style>
     <h1>${html(title)}</h1><p>${rows.length} row(s) — ${formatNepalTime(new Date())} NPT</p>
     <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
  frame.contentDocument.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}

export function downloadCsv(name, columns, rows) {
  const headers = columns.map((c) => c.label);
  const csvRows = rows.map((row) =>
    Object.fromEntries(columns.map((c) => [c.label, exportedCellValue(c, row)]))
  );
  const blob = new Blob([toCsv(headers, csvRows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE_CHOICES = [25, 50, 100, 200];

/** "Showing 51–100 of 5,201" — the honest version of a row count. */
function pageRangeLabel({ page, page_size, total }) {
  if (!total) return 'No rows';
  const first = (page - 1) * page_size + 1;
  const last = Math.min(total, page * page_size);
  return `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
}

/**
 * Footer pager. Only rendered in server mode — a client-mode grid already has
 * every row it will ever have.
 */
function Pager({ pagination, disabled, onPage, onPageSize }) {
  const { page, total_pages } = pagination;
  const btn =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-xs text-gray-500 tabular-nums">{pageRangeLabel(pagination)}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Rows
          <select
            value={pagination.page_size}
            onChange={(e) => onPageSize(Number(e.target.value))}
            disabled={disabled}
            className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            {PAGE_SIZE_CHOICES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => onPage(1)} disabled={disabled || page <= 1} aria-label="First page">
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-xs text-gray-600 tabular-nums">
            Page {page.toLocaleString()} of {total_pages.toLocaleString()}
          </span>
          <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={disabled || page >= total_pages} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" className={btn} onClick={() => onPage(total_pages)} disabled={disabled || page >= total_pages} aria-label="Last page">
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object[]} columns  { key, label, align, render(row), value(row), numeric, sortable, className }
 * @param {Function} [renderActions]  row => JSX, pinned in a right-hand column
 * @param {Function} [onSelectionChange]  enables checkboxes; receives an array of row keys
 * @param {object} [server]  switches the grid to server-driven paging:
 *   {
 *     pagination,        // the API's { page, page_size, total, total_pages }
 *     sort,              // { key, dir } currently applied — in SQL, not here
 *     search,            // current search term
 *     loading,           // dims the body while a page is in flight
 *     onChange(patch),   // { page?, pageSize?, sort?, search? }
 *     fetchAll(),        // async () => every row matching the filters
 *   }
 *   With `server` set, the grid stops filtering and sorting locally: doing
 *   either would reorder just the rows on screen, which shows the wrong records
 *   rather than merely the wrong order. Export uses fetchAll() so a download is
 *   always the complete filtered set, never the current page.
 */
export default function DataGrid({
  title,
  columns,
  rows,
  rowKey = (row) => row.id,
  renderActions,
  selected = [],
  onSelectionChange,
  bulkActions,
  toolbar,
  searchPlaceholder = 'Search…',
  empty = 'Nothing here yet.',
  emptySearch,
  csvName,
  onRowClick,
  rowClassName,
  defaultSort,
  maxHeight = 'max-h-[640px]',
  /** Tailwind min-width class for the table (default keeps most pages from wrapping badly). */
  minTableWidth = 'min-w-[720px]',
  footNote,
  footer,
  server,
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [localSort, setLocalSort] = useState(defaultSort || { key: null, dir: 'asc' });
  const [busy, setBusy] = useState(false);

  // In server mode the input is typed into locally and pushed up on a pause,
  // so every keystroke is not a round trip.
  const [searchDraft, setSearchDraft] = useState(server?.search ?? '');
  const serverSearch = server?.search;
  const onChange = server?.onChange;
  const firstRender = useRef(true);

  useEffect(() => {
    setSearchDraft(serverSearch ?? '');
  }, [serverSearch]);

  useEffect(() => {
    if (!onChange) return undefined;
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    if (searchDraft === (serverSearch ?? '')) return undefined;
    const t = setTimeout(() => onChange({ search: searchDraft, page: 1 }), 300);
    return () => clearTimeout(t);
  }, [searchDraft, serverSearch, onChange]);

  const search = server ? searchDraft : localSearch;
  const sort = server ? server.sort || { key: null, dir: 'asc' } : localSort;

  const visible = useMemo(() => {
    // Server mode: the rows handed in are already the right page, filtered and
    // ordered in SQL. Re-sorting them here would only reorder this page.
    if (server) return rows;

    const needle = localSearch.trim().toLowerCase();
    let out = needle
      ? rows.filter((row) =>
          columns.some((c) => String(cellValue(c, row) ?? '').toLowerCase().includes(needle))
        )
      : rows.slice();

    if (localSort.key) {
      const col = columns.find((c) => c.key === localSort.key);
      if (col) {
        out.sort((a, b) => {
          let av = cellValue(col, a);
          let bv = cellValue(col, b);
          if (col.numeric) {
            av = Number(av) || 0;
            bv = Number(bv) || 0;
          } else {
            av = String(av ?? '').toLowerCase();
            bv = String(bv ?? '').toLowerCase();
          }
          if (av < bv) return localSort.dir === 'asc' ? -1 : 1;
          if (av > bv) return localSort.dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }
    return out;
  }, [rows, columns, localSearch, localSort, server]);

  const selectable = typeof onSelectionChange === 'function';
  const visibleKeys = visible.map(rowKey);
  const allSelected = selectable && visibleKeys.length > 0 && visibleKeys.every((k) => selected.includes(k));

  const toggleSort = (key) => {
    const next = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
    if (server) server.onChange({ sort: next, page: 1 });
    else setLocalSort(next);
  };

  const toggleRow = (key) =>
    onSelectionChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  const exportColumns = columns.filter((c) => c.key !== '__actions');

  /**
   * Exports are deliberately not paginated: the owner's requirement is that a
   * download holds everything matching the current filters, so server mode
   * re-fetches the whole set rather than dumping the fifty rows on screen.
   */
  const withAllRows = async (action) => {
    if (!server?.fetchAll) return action(visible);
    setBusy(true);
    try {
      return action(await server.fetchAll());
    } finally {
      setBusy(false);
    }
  };

  const total = server ? server.pagination?.total ?? visible.length : visible.length;
  const loading = server?.loading || busy;
  const exportDisabled = loading || (server ? total === 0 : !visible.length);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-baseline gap-2">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          <span className="text-xs text-gray-400">
            {total.toLocaleString()} row{total === 1 ? '' : 's'}
            {selected.length > 0 ? ` · ${selected.length} selected` : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => (server ? setSearchDraft(e.target.value) : setLocalSearch(e.target.value))}
              placeholder={searchPlaceholder}
              className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900 sm:w-56"
            />
          </div>
          <button
            type="button"
            onClick={() => withAllRows((all) => downloadCsv(csvName || 'export', exportColumns, all))}
            disabled={exportDisabled}
            title={server ? 'Export every row matching the current filters to CSV' : 'Export the rows shown below to CSV'}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            type="button"
            onClick={() => withAllRows((all) => printRows(title || 'Export', exportColumns, all))}
            disabled={exportDisabled}
            title={server ? 'Print every row matching the current filters' : 'Print the rows shown below'}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </div>

      {selectable && selected.length > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
          <span className="text-sm font-medium text-gray-700">{selected.length} selected</span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
          <button
            type="button"
            onClick={() => onSelectionChange([])}
            className="ml-auto text-sm text-gray-500 hover:text-gray-800"
          >
            Clear
          </button>
        </div>
      )}

      {!visible.length ? (
        <p className="px-5 py-16 text-center text-sm text-gray-500">
          {loading
            ? 'Loading…'
            : search.trim()
              ? emptySearch || `Nothing matches “${search.trim()}”. Try a shorter search.`
              : empty}
        </p>
      ) : (
        <div className={`overflow-auto ${maxHeight} ${loading ? 'opacity-60' : ''}`}>
          <table className={`w-full text-sm ${minTableWidth || 'min-w-[720px]'}`}>
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e5e7eb]">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                {selectable && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allSelected}
                      onChange={() =>
                        onSelectionChange(
                          allSelected
                            ? selected.filter((k) => !visibleKeys.includes(k))
                            : [...new Set([...selected, ...visibleKeys])]
                        )
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </th>
                )}
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {c.sortable === false ? (
                      c.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                      >
                        {c.label}
                        <ArrowUpDown className={`h-3 w-3 ${sort.key === c.key ? 'text-gray-700' : 'text-gray-300'}`} />
                      </button>
                    )}
                  </th>
                ))}
                {renderActions && (
                  <th className="sticky right-0 z-10 bg-white px-4 py-3 text-right font-semibold">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    className={`group hover:bg-gray-50/70 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) || ''}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected.includes(key)}
                          onChange={() => toggleRow(key)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-4 ${c.wrap ? '' : 'whitespace-nowrap'} ${
                          c.align === 'right' ? 'text-right tabular-nums' : ''
                        } ${c.className || 'text-gray-600'}`}
                      >
                        {c.render ? c.render(row) : (cellValue(c, row) ?? '—')}
                      </td>
                    ))}
                    {renderActions && (
                      <td
                        className="sticky right-0 bg-white px-4 py-4 text-right group-hover:bg-gray-50/70"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">{renderActions(row)}</div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {footer && (
        <div className="border-t-2 border-gray-300 bg-gray-100 px-5 py-3 text-sm font-bold text-gray-950">
          {footer}
        </div>
      )}
      {server?.pagination && (
        <Pager
          pagination={server.pagination}
          disabled={loading}
          onPage={(page) => server.onChange({ page })}
          onPageSize={(pageSize) => server.onChange({ pageSize, page: 1 })}
        />
      )}
      {footNote && <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">{footNote}</p>}
    </div>
  );
}

/** Small status pill used by every management table. */
export function StatusBadge({ tone = 'gray', children }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
}

/** Text/number cell the owner can edit in place. Commits on blur or Enter. */
export function InlineEdit({ value, onCommit, type = 'text', prefix, suffix, className = '', placeholder = '—' }) {
  const [draft, setDraft] = useState(null);
  const editing = draft !== null;

  const commit = async () => {
    const next = draft;
    setDraft(null);
    if (next !== null && String(next) !== String(value ?? '')) await onCommit(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value ?? '');
        }}
        className={`-mx-1 rounded px-1 py-0.5 text-left hover:bg-gray-100 ${className}`}
        title="Click to edit"
      >
        {value === null || value === undefined || value === '' ? (
          <span className="text-gray-300">{placeholder}</span>
        ) : (
          `${prefix || ''}${value}${suffix || ''}`
        )}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      step={type === 'number' ? 'any' : undefined}
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="h-8 w-24 rounded-md border border-gray-900 px-2 text-sm"
    />
  );
}
