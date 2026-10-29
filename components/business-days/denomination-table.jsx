'use client';

/**
 * The ONE renderer for a counted-cash note breakdown.
 *
 * Used by the day-close summary, the closing-report drill-down, the finance
 * report, the analytics money view and the summary report, so the same drawer
 * count looks identical everywhere it is read.
 *
 * Two things worth knowing about where the data comes from (both already
 * handled server-side, do not "fix" them again):
 *
 *  - The count is stored per STORE SESSION, not per business day. Closing the
 *    drawer closes the session; the business day only flips to 'closed' when
 *    the NEXT day is opened. So a query filtering `business_days.status =
 *    'closed'` finds nothing for today, and reading the day row alone misses a
 *    day that was counted twice. lib/summary-report.js closingReconciliation()
 *    joins the latest CLOSED SESSION and filters on `counted_cash != null`.
 *  - businessDayDetail() falls back to a recomputed live summary that carries
 *    no reconciliation block, so it re-attaches expected / counted / difference
 *    / denominations from the day's last counted session.
 */

/** Note denominations in circulation, largest first. */
export const CASH_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

export const emptyDenominationCounts = () =>
  Object.fromEntries(CASH_DENOMINATIONS.map((value) => [value, '']));

const rupees = (value) =>
  `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Total value of a { denomination: count } map. */
export function denominationTotal(counts) {
  if (!counts || typeof counts !== 'object') return 0;
  return CASH_DENOMINATIONS.reduce(
    (total, denomination) => total + (Number(counts[denomination]) || 0) * denomination,
    0
  );
}

/**
 * @param {object}  props
 * @param {object}  props.counts    { [denomination]: quantity }
 * @param {string}  [props.title]   heading above the table; omit to render bare
 * @param {boolean} [props.dark]    render for a dark panel
 * @param {string}  [props.empty]   message when no breakdown was recorded
 * @param {string}  [props.denominationPrefix] prefix on the Name column. The
 *   day-close screens keep "Rs 1,000" because the note value is what the
 *   counter is reading off the cash; the printed Summary Report passes "" so
 *   the column is a bare denomination ladder, as the report has always shown it.
 */
export default function DenominationTable({
  counts,
  title = 'Counted note breakdown',
  dark = false,
  empty = 'Note breakdown was not recorded for this closing.',
  denominationPrefix = 'Rs ',
  className = '',
}) {
  if (counts == null || typeof counts !== 'object') {
    return <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'} ${className}`}>{empty}</p>;
  }

  const total = denominationTotal(counts);
  const head = dark ? 'text-gray-400' : 'text-gray-500';
  const rule = dark ? 'border-white/20' : 'border-gray-200';
  const strong = dark ? 'text-white' : 'text-gray-950';
  const muted = dark ? 'text-gray-500' : 'text-gray-400';
  const normal = dark ? 'text-gray-200' : 'text-gray-800';

  return (
    <div className={className}>
      {title ? (
        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${head}`}>{title}</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={`border-b ${rule} text-left uppercase tracking-wide ${head}`}>
              <th data-print-skip scope="col" className="py-1.5 pr-3 font-semibold">Note</th>
              <th data-print-skip scope="col" className="py-1.5 px-3 text-right font-semibold">Count</th>
              <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Calculation</th>
            </tr>
          </thead>
          <tbody>
            {CASH_DENOMINATIONS.map((denomination) => {
              const quantity = Number(counts[denomination] || 0);
              // Zero rows stay visible so the reader can see the whole ladder
              // was counted, but muted so the eye lands on what is there.
              const tone = quantity ? normal : muted;
              return (
                // Printed rolls keep only counted notes, as the calculation (it already names note and count).
                <tr key={denomination} data-print-skip={quantity ? undefined : true} className={`border-b ${rule} last:border-b-0`}>
                  <td data-print-skip className={`py-1.5 pr-3 font-medium tabular-nums ${tone}`}>
                    {denominationPrefix}{denomination.toLocaleString('en-IN')}
                  </td>
                  <td data-print-skip className={`py-1.5 px-3 text-right tabular-nums ${tone}`}>{quantity}</td>
                  <td className={`py-1.5 pl-3 text-right tabular-nums ${tone}`}>
                    {denominationPrefix}{denomination.toLocaleString('en-IN')} × {quantity} = {rupees(denomination * quantity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={`border-t-2 ${dark ? 'border-white/40' : 'border-gray-950'}`}>
              <th scope="row" className={`py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide ${strong}`}>
                Total
              </th>
              <td className={`py-2 px-3 text-right text-sm font-bold tabular-nums ${strong}`}>
                {CASH_DENOMINATIONS.reduce((sum, d) => sum + (Number(counts[d]) || 0), 0)}
              </td>
              <td className={`py-2 pl-3 text-right text-sm font-bold tabular-nums ${strong}`}>{rupees(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
