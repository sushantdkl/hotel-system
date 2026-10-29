'use client';

const PAGE_SIZE_CHOICES = [25, 50, 100, 200];

function valueOf(pagination, camelKey, snakeKey, fallback = 0) {
  return Number(pagination?.[camelKey] ?? pagination?.[snakeKey] ?? fallback);
}

export default function PaginationControls({
  pagination,
  loading = false,
  pageSizeChoices = PAGE_SIZE_CHOICES,
  onPageChange,
  onPageSizeChange,
}) {
  const page = Math.max(1, valueOf(pagination, 'page', 'page', 1));
  const pageSize = Math.max(1, valueOf(pagination, 'pageSize', 'page_size', pageSizeChoices[0] || 25));
  const total = Math.max(0, valueOf(pagination, 'total', 'total', 0));
  const totalPages = Math.max(1, valueOf(pagination, 'totalPages', 'total_pages', Math.ceil(total / pageSize) || 1));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = total ? Math.min(total, page * pageSize) : 0;
  const btn =
    'rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white';

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-gray-500 tabular-nums">
        {total ? `Showing ${first.toLocaleString()}-${last.toLocaleString()} of ${total.toLocaleString()}` : 'No rows'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-gray-500">
          Rows
          <select
            value={pageSize}
            disabled={loading}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700"
          >
            {pageSizeChoices.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} disabled={loading || page <= 1} onClick={() => onPageChange?.(1)}>
            First
          </button>
          <button type="button" className={btn} disabled={loading || page <= 1} onClick={() => onPageChange?.(page - 1)}>
            Prev
          </button>
          <span className="px-2 text-xs text-gray-600 tabular-nums">
            Page {page.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <button type="button" className={btn} disabled={loading || page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
            Next
          </button>
          <button type="button" className={btn} disabled={loading || page >= totalPages} onClick={() => onPageChange?.(totalPages)}>
            Last
          </button>
        </div>
      </div>
    </div>
  );
}
