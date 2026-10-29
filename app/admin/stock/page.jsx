import { redirect } from 'next/navigation';

/**
 * /admin/stock was a second, near-identical CRUD screen over the SAME
 * `/api/admin/inventory` endpoint that /admin/inventory already owns. Nothing
 * linked to it (the sidebar points at /admin/inventory) and the cashier panel
 * never had a counterpart, so it was a stale copy that drifted out of sync —
 * it had no ledger drill-down, no variance panel and no purchase links.
 *
 * The URL is kept and redirected rather than deleted so old bookmarks, printed
 * links and browser history still land somewhere useful.
 *
 * NOTE: /admin/stock/import is NOT dead — it is linked from
 * app/admin/inventory/page.jsx and stays exactly where it is.
 */
export default function StockRedirect() {
  redirect('/admin/inventory');
}
