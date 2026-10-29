'use client';

/**
 * Inventory import. Always previews first — /api/admin/inventory/import
 * classifies every row (added / updated / duplicate conflict / validation
 * error) without writing, and only a second call with mode:'commit' saves.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft } from 'lucide-react';
import ImportWizard from '@/components/admin/import-wizard';

const EXPECTED = [
  { key: 'item_name', label: 'Item Name', required: true },
  { key: 'purchase_unit', label: 'Purchase Unit', hint: 'How you buy it — kg, liter, box' },
  { key: 'consumption_unit', label: 'Consumption Unit', required: true, hint: 'How recipes use it — grams, ml, pieces' },
  { key: 'conversion_factor', label: 'Conversion Factor', hint: 'Optional — worked out for you when both units are known' },
  { key: 'cost_per_unit', label: 'Cost', hint: 'Per purchase unit when one is given' },
  { key: 'min_stock_level', label: 'Min Stock' },
  { key: 'quantity', label: 'Opening Stock', hint: 'Optional — posted as an opening balance' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'category', label: 'Category' },
];

const SAMPLE_ROWS = [
  // Row 2 leaves the factor blank on purpose — liter/ml derives it. Row 3 is a
  // custom unit, which is exactly when the factor still has to be given.
  { item_name: 'Chili, Fresh', purchase_unit: 'kg', consumption_unit: 'grams', conversion_factor: '1000', cost_per_unit: '250', min_stock_level: '500', quantity: '5', supplier: 'Local Farm', category: 'Vegetables' },
  { item_name: 'Cooking Oil', purchase_unit: 'liter', consumption_unit: 'ml', conversion_factor: '', cost_per_unit: '300', min_stock_level: '2000', quantity: '10', supplier: '', category: 'Pantry' },
  { item_name: 'Momo Wrappers', purchase_unit: 'box_24', consumption_unit: 'pieces', conversion_factor: '24', cost_per_unit: '600', min_stock_level: '48', quantity: '4', supplier: '', category: 'Frozen' },
];

function summarize(preview) {
  const c = preview.counts || {};
  const issues = (preview.details || []).filter(
    (d) => d.status === 'validation_error' || d.status === 'duplicate_conflict'
  );
  const willWrite = (c.added || 0) + (c.updated || 0);

  return {
    ok: issues.length === 0,
    blockCommit: willWrite === 0,
    counts: [
      { label: 'Rows in file', value: preview.total ?? 0 },
      { label: 'New items', value: c.added || 0 },
      { label: 'Updated', value: c.updated || 0 },
      { label: 'Duplicate conflicts', value: c.duplicate_conflict || 0 },
      { label: 'Validation errors', value: c.validation_error || 0 },
    ],
    message: issues.length
      ? `${willWrite} row(s) are ready to import. The ${issues.length} flagged below will be skipped unless you fix them first.`
      : willWrite
        ? `All ${willWrite} row(s) check out. Committing will add ${c.added || 0} new item(s) and update ${c.updated || 0}.`
        : 'Nothing in this file would be written. Check the column mapping.',
    issues: issues.map((d) => ({ row: d.row, status: d.status, reason: d.reason })),
    detail: (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">What will happen</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 font-semibold">Row</th>
                <th className="px-3 py-2 font-semibold">Item</th>
                <th className="px-3 py-2 font-semibold">Outcome</th>
                <th className="px-3 py-2 font-semibold">Detail</th>
                <th className="px-3 py-2 font-semibold">Units read as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(preview.details || []).map((d) => (
                <tr key={d.row} className="text-gray-600">
                  <td className="px-3 py-2 text-gray-400">{d.row}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{d.data?.item_name || '—'}</td>
                  <td className="px-3 py-2 capitalize">{String(d.status).replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2">{d.reason || 'Will be created as a new item.'}</td>
                  {/* Spelling fixes are shown, never applied silently. */}
                  <td className="px-3 py-2">
                    {(d.notes || []).length ? (
                      <ul className="space-y-0.5">
                        {d.notes.map((note, i) => (
                          <li key={i} className="text-xs text-amber-700">
                            {note}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-300">as written</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
  };
}

export default function StockImportPage() {
  const router = useRouter();

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Import inventory</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              Bring in a supplier price list or a stock count. You always see exactly what will change before anything is saved.
            </p>
          </div>
          <Link href="/admin/inventory" className="inline-flex items-center gap-1.5 self-start rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Back to inventory
          </Link>
        </div>
      </header>

      <div className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <ImportWizard
          expected={EXPECTED}
          sampleRows={SAMPLE_ROWS}
          templateName="inventory_import_template"
          endpoint="/api/admin/inventory/import"
          summarize={summarize}
          commitLabel="Commit inventory import"
          onCommitted={() => router.push('/admin/inventory')}
        />
        <p className="mt-5 text-sm text-gray-500">
          Cost and opening stock are read in <span className="font-medium">purchase units</span> whenever a row supplies a
          purchase unit — “Chili, kg, grams, 1000, 250” means Rs 250/kg. The conversion happens once, on the way in.
          Unit spellings are matched to the standard list (“Kg”, “kilo” and “kgs” all mean kg) and the conversion factor
          is worked out for you when both units are known — both are shown in the preview above, never applied silently.
        </p>
      </div>
    </AdminLayout>
  );
}
