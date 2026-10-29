'use client';

import { Download, Printer } from 'lucide-react';
import { downloadCsv, printRows } from '@/components/admin/data-grid';

function safeFilePart(value) {
  return String(value || 'profile')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'profile';
}

export default function ProfileTabActions({ entity, tab, headers, rows }) {
  const columns = headers.map((label, index) => ({ key: `column_${index}`, label }));
  const records = rows.map((row) => Object.fromEntries(columns.map((column, index) => [column.key, row[index] ?? ''])));
  const title = `${entity} — ${tab}`;
  const fileName = `${safeFilePart(entity)}-${safeFilePart(tab)}`;

  return (
    <div className="print:hidden flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-gray-800">{tab}</p>
        <p className="text-xs text-gray-500">{rows.length.toLocaleString()} record{rows.length === 1 ? '' : 's'}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => printRows(title, columns, records)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
          <Printer className="h-4 w-4" /> Print
        </button>
        <button type="button" onClick={() => downloadCsv(fileName, columns, records)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800">
          <Download className="h-4 w-4" /> Download CSV
        </button>
      </div>
    </div>
  );
}
