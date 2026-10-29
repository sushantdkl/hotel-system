'use client';

/**
 * Bulk purchase import. Rows sharing an invoice_number are grouped into one
 * purchase by the API; the preview shows those groups before anything commits.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import { ArrowLeft } from 'lucide-react';
import ImportWizard from '@/components/admin/import-wizard';
import { unitLabel } from '@/lib/units';

const EXPECTED = [
  { key: 'invoice_number', label: 'Invoice Number', hint: 'Rows sharing one become a single purchase' },
  { key: 'invoice_date', label: 'Invoice Date' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'item_name', label: 'Item Name', required: true, hint: 'Must match an active inventory item' },
  { key: 'quantity', label: 'Quantity', required: true, hint: 'In purchase units' },
  { key: 'unit_cost', label: 'Unit Cost', required: true, hint: 'Per purchase unit' },
];

const SAMPLE_ROWS = [
  { invoice_number: 'INV-4471', invoice_date: '2025-07-14', supplier: 'Kathmandu Fresh Traders', item_name: 'Green Chili', quantity: '5', unit_cost: '250' },
  { invoice_number: 'INV-4471', invoice_date: '2025-07-14', supplier: 'Kathmandu Fresh Traders', item_name: 'Cooking Oil', quantity: '10', unit_cost: '300' },
  { invoice_number: 'INV-4488', invoice_date: '2025-07-16', supplier: 'Bagmati Poultry', item_name: 'Chicken', quantity: '12', unit_cost: '420' },
];

function summarize(preview) {
  const c = preview.counts || {};
  return {
    ok: preview.ok,
    // The API refuses a commit unless every row is valid, so mirror that here.
    blockCommit: !preview.ok || !(preview.purchases || []).length,
    counts: [
      { label: 'Rows in file', value: c.rows ?? 0 },
      { label: 'Valid rows', value: c.valid ?? 0 },
      { label: 'Problem rows', value: c.errors ?? 0 },
      { label: 'Purchases to create', value: c.purchases ?? 0 },
    ],
    message: preview.ok
      ? `Ready. ${c.purchases} purchase(s) will be created from ${c.valid} line(s), stock will rise by the converted amounts and one expense per purchase will be posted.`
      : `${c.errors} row(s) need fixing. The import will not run until every row is valid — that keeps a half-posted delivery from happening.`,
    issues: (preview.errors || []).map((e) => ({
      row: e.row,
      status: 'validation_error',
      reason: `${e.field}: ${e.message}`,
    })),
    detail: (preview.purchases || []).length > 0 && (
      <div className="space-y-4">
        {preview.purchases.map((p, i) => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900">{p.invoice_number || 'No invoice number'}</h3>
              <span className="text-sm text-gray-500">
                {p.supplier || 'No supplier'} · {p.invoice_date ? formatCalendarDate(p.invoice_date) : 'today'} · Rs {Number(p.subtotal).toFixed(2)}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                    <th className="px-3 py-2 text-right font-semibold">Into stock</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.items.map((l, j) => (
                    <tr key={j} className="text-gray-600">
                      <td className="px-3 py-2 font-medium text-gray-900">{l.item_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.quantity_received} {unitLabel(l.purchase_unit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.converts_to} {unitLabel(l.consumption_unit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        Rs {Number(l.unit_cost).toFixed(2)}
                        {l.purchase_unit ? <span className="text-gray-400"> /{unitLabel(l.purchase_unit)}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">Rs {Number(l.line_total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    ),
  };
}

export default function PurchaseImportPage() {
  const router = useRouter();
  const pathname = usePathname();
  const purchasesPath = pathname?.startsWith('/cashier') ? '/cashier/purchases' : '/admin/purchases';

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Import purchases</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              Load a batch of delivery lines at once. Each invoice number becomes one purchase, with its stock and expense.
            </p>
          </div>
          <Link href={purchasesPath} className="inline-flex items-center gap-1.5 self-start rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.97] transition-transform duration-150">
            <ArrowLeft className="h-4 w-4" /> Back to purchases
          </Link>
        </div>
      </header>

      <div className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <ImportWizard
          expected={EXPECTED}
          sampleRows={SAMPLE_ROWS}
          templateName="purchase_import_template"
          endpoint="/api/admin/purchases/import"
          summarize={summarize}
          commitLabel="Create these purchases"
          onCommitted={() => router.push(purchasesPath)}
        />
        <p className="mt-5 text-sm text-gray-500">
          Item names must match an active inventory item — archived items are ignored on purpose, so a retired ingredient
          cannot quietly come back through an import. There is no unit column: each line uses the item&apos;s own purchase
          unit, shown above next to what it converts to in stock.
        </p>
      </div>
    </AdminLayout>
  );
}
