'use client';

/**
 * Presentation primitives for the printable Summary Report.
 *
 * These were inlined in app/admin/summary-report/page.jsx; they live here so any
 * other report can be built in the same language without the styling drifting
 * apart. The reference for this look is the printed Summary Report PDF:
 *
 *  - Each top-level GROUP is introduced by a coloured left stripe + heading.
 *  - A handful of cards an owner checks first (revenue, payment received, cash
 *    in hand, counted cash, profit & loss) are `highlight` — the WHOLE card is
 *    tinted, header a shade stronger than the body, with a coloured border and
 *    a thicker left edge. Every other card is neutral: grey header, white body.
 *  - Colours are part of the document, not screen decoration: they survive
 *    window.print() (see `printColorClass` / the report container), which is why
 *    there are no `print:bg-white` overrides here.
 */

import DenominationTable from '@/components/business-days/denomination-table.jsx';
import { financialToneClass } from '@/lib/financial-tone';
import { summaryAccountRows } from '@/lib/summary-account';
import { formatCalendarDate } from '@/lib/calendar-system.js';

export const money = (n) =>
  `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const line = (label, value, sign = '', tone) => ({ label, value, sign, tone });

/**
 * Same light-tint families as the sidebar's nav groups (components/admin/
 * admin-layout.jsx NAV_TINTS), so a report section reads as its own "group" the
 * way the sidebar's sections do.
 *
 * `head` is the -100 step, `body` the -50 step: enough separation to see the
 * header as a header, mild enough that the figures' own positive/negative
 * colouring still reads on top of it.
 */
const TINTS = {
  blue:    { head: 'bg-blue-100 text-blue-900',       body: 'bg-blue-50/60',    border: 'border-blue-200',    stripe: 'border-l-blue-500' },
  sky:     { head: 'bg-sky-100 text-sky-900',         body: 'bg-sky-50/60',     border: 'border-sky-200',     stripe: 'border-l-sky-500' },
  violet:  { head: 'bg-violet-100 text-violet-900',   body: 'bg-violet-50/60',  border: 'border-violet-200',  stripe: 'border-l-violet-500' },
  emerald: { head: 'bg-emerald-100 text-emerald-900', body: 'bg-emerald-50/60', border: 'border-emerald-200', stripe: 'border-l-emerald-500' },
  indigo:  { head: 'bg-indigo-100 text-indigo-900',   body: 'bg-indigo-50/60',  border: 'border-indigo-200',  stripe: 'border-l-indigo-500' },
  pink:    { head: 'bg-pink-100 text-pink-900',       body: 'bg-pink-50/60',    border: 'border-pink-200',    stripe: 'border-l-pink-500' },
  amber:   { head: 'bg-amber-100 text-amber-900',     body: 'bg-amber-50/60',   border: 'border-amber-200',   stripe: 'border-l-amber-500' },
};

const NEUTRAL = { head: 'bg-gray-50 text-gray-900', body: 'bg-white', border: 'border-gray-200', stripe: 'border-l-gray-400' };

export const tintClass = (t) => TINTS[t] || NEUTRAL;

/**
 * Colours are meaningful here, so force them through the print pipeline instead
 * of relying on the browser's "Background graphics" checkbox being ticked.
 */
export const printColorClass = 'print-exact';
export const PrintColorStyle = () => (
  <style>{`.print-exact,.print-exact *{-webkit-print-color-adjust:exact;print-color-adjust:exact}`}</style>
);

/* ------------------------------------------------------------------ */

export function Rows({ title, rows }) {
  return (
    <div className="divide-y divide-gray-200/70">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`flex justify-between gap-4 px-4 py-2.5 text-sm ${i === rows.length - 1 ? 'font-bold' : 'text-gray-600'}`}
        >
          <span>{r.label}</span>
          <span className={`tabular-nums ${financialToneClass({ ...r, label: `${title} ${r.label}` })}`}>
            {r.sign && `${r.sign} `}
            {money(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReportGroup({ title, note, tint, children }) {
  const t = tintClass(tint);
  return (
    <section className="mt-7 first:mt-0 break-inside-avoid">
      <div className={`mb-3 border-l-4 ${t.stripe} pl-3`}>
        <h2 className="text-base font-bold text-gray-950">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Shared shell so every card in the report has the same border / header rules. */
export function Card({ title, tint, highlight = false, children, className = '' }) {
  const t = tintClass(tint);
  const shell = highlight ? `border ${t.border} border-l-4 ${t.stripe} ${t.body}` : `border ${NEUTRAL.border} ${NEUTRAL.body}`;
  const head = highlight ? `${t.head} border-b ${t.border}` : `${NEUTRAL.head} border-b ${NEUTRAL.border}`;
  return (
    <section className={`break-inside-avoid ${shell} ${className}`}>
      <h3 className={`${head} px-4 py-3 text-sm font-bold`}>{title}</h3>
      {children}
    </section>
  );
}

export function Section({ title, rows, note, tint, highlight = false }) {
  return (
    <Card title={title} tint={tint} highlight={highlight}>
      <Rows title={title} rows={rows} />
      {note && <p className="border-t border-gray-200/70 px-4 py-3 text-xs text-gray-500">{note}</p>}
    </Card>
  );
}

export function Account({ title, data, tint, highlight = false, cash = title === 'Cash in Hand' }) {
  return (
    <Section
      highlight={highlight}
      tint={tint}
      title={title}
      rows={summaryAccountRows(data, { cash })}
    />
  );
}

export function ExchangeCard({ data, tint, highlight = false }) {
  return (
    <Card title="Exchange" tint={tint} highlight={highlight}>
      <div className="divide-y divide-gray-200/70">
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Exchange Cash</h4>
          <Rows title="Exchange Cash" rows={[line('Cash In', data.cash.in), line('Cash Out', data.cash.out), line('Balance', data.cash.in - data.cash.out)]} />
        </div>
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Exchange Online / Bank</h4>
          <Rows title="Exchange Online / Bank" rows={[line('Online In', data.bank.in), line('Online Out', data.bank.out), line('Balance', data.bank.in - data.bank.out)]} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Sales and kitchen tickets by channel, with the document prefix each channel
 * prints on.
 *
 * The prefix column is the point of the card: it is the key that turns a docket
 * in someone's hand (TW-118, K-D-042) into a line in this report. Without it
 * the numbering scheme and the reporting are two systems that happen to agree.
 */
export function ChannelMix({ data, tint = 'blue', highlight = true, className = '' }) {
  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const active = rows.filter((r) => r.bills || r.kots);
  return (
    <Card title="Sales by Channel" tint={tint} highlight={highlight} className={className}>
      {active.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-500">No bills or kitchen tickets in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-4 py-2 text-left font-semibold">Channel</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Numbering</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bills</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">KOTs</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Net Item Sales</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Billed Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70">
              {rows.map((row) => (
                <tr key={row.channel} className={row.bills || row.kots ? '' : 'text-gray-400'}>
                  <td className="px-4 py-2 font-medium text-gray-800">
                    {row.label}
                    <span className="ml-2 text-xs font-normal text-gray-400">{row.share}%</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{row.billPrefix}-001</span>
                    <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{row.kotPrefix}-001</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.bills}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.kots}
                    {row.cancelledKots ? <span className="ml-1 text-xs text-rose-600">({row.cancelledKots} cancelled)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.netItemSales)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-950">{money(row.billedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-950 font-bold text-gray-950">
                <th scope="row" className="px-4 py-2.5 text-left text-xs uppercase tracking-wide">Total</th>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right tabular-nums">{totals.bills || 0}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{totals.kots || 0}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.netItemSales)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(totals.billedTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="border-t border-gray-200/70 px-4 py-3 text-xs text-gray-500">
        Orders number O-001 / O-TW-001 / O-D-001, bills T / TW / D and tickets K / K-TW / K-D.
        The serial behind the prefix is one continuous count per document type, so numbers never
        restart or collide. Channels here are read from the order, so bills raised before the
        prefixes existed are still counted in the right row.
      </p>
    </Card>
  );
}

/**
 * One line of the Money Position card. Declared at module level, not inside the
 * component: a component created during render is a new type every pass, so
 * React remounts the subtree instead of updating it.
 */
function PositionRow({ label, value, tone, strong = false, note }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 px-4 py-2 text-sm ${strong ? 'font-bold text-gray-950' : ''}`}>
      <span className={strong ? '' : 'text-gray-600'}>
        {label}
        {note ? <span data-print-skip className="ml-1 text-xs font-normal text-gray-400">{note}</span> : null}
      </span>
      <span className={`tabular-nums ${strong ? '' : 'font-medium'} ${
        tone === 'out' ? 'text-rose-700' : tone === 'in' ? 'text-emerald-700' : 'text-gray-800'
      }`}>
        {tone === 'out' ? '- ' : tone === 'in' ? '+ ' : ''}{money(value)}
      </span>
    </div>
  );
}

/**
 * The one-glance money position: drawer in/out, QR split into trade vs money
 * exchange, and what the bank should hold today.
 *
 * Three questions an owner asks while closing up, each with its own total, and
 * the bank line stated as the figure to check a bank statement against rather
 * than as a ledger balance nobody can act on. Every number is reused from the
 * builders the cards beside it use, so they cannot disagree.
 */
export function MoneyPosition({ data, closing, tint = 'indigo', highlight = true, className = '' }) {
  const cash = data?.cash || {};
  const qr = data?.qr || {};
  const bank = data?.bank || {};
  const hasOneDrawerCount = Number(closing?.days_closed || 0) === 1;
  const drawerExpected = Number((closing?.adjusted_expected_cash ?? closing?.expected_cash) || 0);
  const ledgerToDrawerDifference = Number(cash.closing || 0) - drawerExpected;
  return (
    <Card title="Money Position" tint={tint} highlight={highlight} className={className}>
      <div className="divide-y divide-gray-200/70">
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Cash Drawer</h4>
          <PositionRow label="Total Cash In" value={cash.in} tone="in" />
          <PositionRow label="Total Cash Out" value={cash.out} tone="out" />
          <PositionRow label="Cash Ledger Balance" value={cash.closing} strong note="accounting record" />
          {hasOneDrawerCount && <PositionRow label="Expected Drawer Cash" value={drawerExpected} strong note="last drawer close" />}
          {hasOneDrawerCount && Math.abs(ledgerToDrawerDifference) >= 0.005 && <PositionRow label="Ledger-to-Drawer Gap" value={Math.abs(ledgerToDrawerDifference)} tone={ledgerToDrawerDifference > 0 ? 'in' : 'out'} note={ledgerToDrawerDifference > 0 ? 'ledger is higher' : 'drawer is higher'} />}
        </div>
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Online</h4>
          <PositionRow label="Online Restaurant Sales" value={qr.restaurant} note="food sold" />
          <PositionRow label="Online Cash Exchange" value={qr.exchange} note="cash paid out" />
          <PositionRow label="Total Online Received" value={qr.total} strong />
        </div>
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Balance</h4>
          <PositionRow label="Online in Primary Bank" value={bank.expected} note="online receipts less online payments" strong />
        </div>
      </div>
      <p className="border-t border-gray-200/70 px-4 py-3 text-xs text-gray-500">
        Cash Ledger Balance is the accounting account for the selected period. Expected Drawer Cash is the last physical drawer calculation (opening drawer cash + movements assigned to that store session), so they can differ when opening cash or a cash movement was recorded outside that session. Every non-cash payment is recorded directly in the single Online balance.
      </p>
    </Card>
  );
}

/**
 * Digital takings split by WHY the money arrived.
 *
 * One eSewa or Fonepay account receives two unrelated things: a guest paying
 * for food, and a money-exchange customer sending digital money to take cash
 * out of the drawer. Added together they overstate trade and hide why the
 * drawer is light, so each medium is shown as
 *
 *     restaurant sale | money exchange | total
 *
 * with the two columns totalled separately at the foot. "Restaurant" already
 * nets off refunds and void reversals booked back to that medium, which is why
 * it can read lower than the day's gross card/QR takings.
 */
export function DigitalReceipts({ data, tint = 'sky', highlight = true, className = '' }) {
  const media = data?.media || [];
  const totals = data?.totals || {};
  const restaurantOf = (row) => Number(row.sales || 0) + Number(row.collections || 0) + Number(row.reversals || 0);
  const restaurantTotal = round(Number(totals.sales || 0) + Number(totals.collections || 0) + Number(totals.reversals || 0));
  const exchangeTotal = round(Number(totals.exchange || 0));
  return (
    <Card title="Online Received" tint={tint} highlight={highlight} className={className}>
      {media.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-500">
          No Online money moved in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-4 py-2 text-left font-semibold">Medium</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Restaurant Sale</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Hotel Payments</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Money Exchange</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70">
              {media.map((row) => (
                <tr key={row.code}>
                  <td className="px-4 py-2 text-gray-700">{row.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{money(restaurantOf(row))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{money(row.hotel_collections)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{money(row.exchange)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-950">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-950 font-bold text-gray-950">
                <th scope="row" className="px-4 py-2.5 text-left text-xs uppercase tracking-wide">Total</th>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(restaurantTotal)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.hotel_collections)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(exchangeTotal)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(round(restaurantTotal + Number(totals.hotel_collections || 0) + exchangeTotal))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="border-t border-gray-200/70 px-4 py-3 text-xs text-gray-500">
        Restaurant and hotel receipts are shown separately. Money exchange is a
        customer swapping digital money for cash; only its fee is business income.
      </p>
    </Card>
  );
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Where the drawer's cash came from and where it went.
 *
 * Reads the same 1010 movements as Cash in Hand, so the arithmetic on screen is
 * the account's own: opening + in - out = closing. Outflow is the half an owner
 * asks about first — purchases, expenses, salary, savings and exchange payouts
 * — so it is listed line by line rather than rolled into one number.
 */
export function CashFlowCard({ data, tint = 'amber', highlight = true, className = '', showDetails = true }) {
  const inflow = data?.inflow || [];
  const outflow = data?.outflow || [];
  const details = data?.details || [];
  const row = (r, tone) => (
    <div key={`${tone}-${r.source}`} className="flex justify-between gap-4 px-4 py-2 text-sm">
      <span className="text-gray-600">{r.label}</span>
      <span className={`tabular-nums font-medium ${tone === 'out' ? 'text-rose-700' : 'text-emerald-700'}`}>
        {tone === 'out' ? '- ' : '+ '}{money(r.amount)}
      </span>
    </div>
  );
  return (
    <Card title="Cash In / Cash Out" tint={tint} highlight={highlight} className={className}>
      <div className="divide-y divide-gray-200/70">
        <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
          <span className="text-gray-600">Opening Cash</span>
          <span className="font-medium tabular-nums text-gray-800">{money(data?.opening)}</span>
        </div>
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Cash In</h4>
          {inflow.length ? inflow.map((r) => row(r, 'in'))
            : <p className="px-4 pb-2 text-xs text-gray-500">No cash came into the drawer in this period.</p>}
          <div className="flex justify-between gap-4 border-t border-gray-200/70 px-4 py-2 text-sm font-bold text-gray-950">
            <span>Total In</span><span className="tabular-nums">{money(data?.total_in)}</span>
          </div>
        </div>
        <div>
          <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Cash Out</h4>
          {outflow.length ? outflow.map((r) => row(r, 'out'))
            : <p className="px-4 pb-2 text-xs text-gray-500">Nothing left the drawer in this period.</p>}
          <div className="flex justify-between gap-4 border-t border-gray-200/70 px-4 py-2 text-sm font-bold text-gray-950">
            <span>Total Out</span><span className="tabular-nums">{money(data?.total_out)}</span>
          </div>
        </div>
        <div className="flex justify-between gap-4 px-4 py-2.5 text-sm font-bold text-gray-950">
          <span>Closing Cash</span><span className="tabular-nums">{money(data?.closing)}</span>
        </div>
        {showDetails && details.length > 0 && (
          <div>
            <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Recorded movement details</h4>
            {details.map((detail) => {
              const incoming = Number(detail.cash_in || 0);
              const outgoing = Number(detail.cash_out || 0);
              const amount = incoming || outgoing;
              return (
                <div key={detail.id} className="flex justify-between gap-4 px-4 py-2 text-xs">
                  <span className="text-gray-600"><span className="font-medium text-gray-800">{formatCalendarDate(detail.entry_date)}</span> · {detail.is_reversal ? <strong className="text-rose-700">Reversal: </strong> : null}{detail.memo}{detail.is_reversal ? <span className="block text-[11px] text-gray-500">Undoing #{detail.reversed_journal_id}: {detail.original_memo}</span> : null}</span>
                  <span className={`shrink-0 tabular-nums font-semibold ${outgoing ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {outgoing ? '- ' : '+ '}{money(amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * The counted-cash box that sits beside Closing Cash.
 *
 * Shows expected versus physically counted cash before the denomination table.
 * Omitting that difference makes a valid cash count look like a broken ledger
 * closing calculation.
 */
export function CountedCash({ data, tint = 'violet', highlight = true, className = '', showNotes = true, showBreakdown = true }) {
  const hasBreakdown = Number(data.days_recorded || 0) > 0;
  // days_CLOSED is how many drawers were counted; days_recorded is only how many
  // of those also captured a note breakdown. The header counts the counts.
  const days = Number(data.days_closed || 0);
  const counts = days === 1 ? 'count' : 'counts';
  // Two different empty states, and telling them apart is the whole point:
  // a drawer that was counted without a note breakdown is not the same as no
  // drawer having been counted in this period at all.
  const empty = days === 0
    ? 'No drawer was counted in this period. Close the store with a cash count and the note breakdown appears here.'
    : 'Note breakdown was not recorded for this period - the counted cash total was entered directly.';
  const correctionCount = Number(data.post_close_adjustments?.entries || 0);
  const expected = data.adjusted_expected_cash ?? data.expected_cash;
  const difference = data.adjusted_difference ?? data.difference;
  return (
    <Card title={`Drawer Count · ${days} ${counts}`} tint={tint} highlight={highlight} className={className}>
      {days > 0 && (
        <Rows title="Cash Reconciliation" rows={[
          ...(correctionCount ? [line('Expected Drawer Cash at Original Close', data.expected_cash)] : []),
          line(correctionCount ? 'Adjusted Expected Drawer Cash' : 'Expected Drawer Cash', expected),
          ...(correctionCount ? [line(`Post-close Corrections (${correctionCount})`, Math.abs(Number(data.post_close_adjustments.cash_delta || 0)), Number(data.post_close_adjustments.cash_delta || 0) >= 0 ? '+' : '-')] : []),
          line('Physically Counted Drawer Cash', data.counted_cash),
          line(
            Number(difference || 0) < 0 ? 'Drawer Cash Short' : Number(difference || 0) > 0 ? 'Drawer Cash Over' : 'Drawer Difference',
            Math.abs(Number(difference || 0)),
            Number(difference || 0) < 0 ? '-' : Number(difference || 0) > 0 ? '+' : ''
          ),
        ]} />
      )}
      {showBreakdown && (
        <div className="px-4 py-3">
          <DenominationTable
            counts={hasBreakdown ? (data.cash_denominations || {}) : null}
            title={null}
            denominationPrefix=""
            empty={empty}
          />
        </div>
      )}
      {showNotes && data.notes?.length > 0 && (
        <div className="border-t border-gray-200/70 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Closing notes</p>
          <div className="mt-1.5 space-y-1.5">
            {data.notes.map((n) => (
              <p key={n.business_date} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">
                  {formatCalendarDate(n.business_date)}
                  {n.force_closed ? ' (force closed)' : ''}:
                </span>{' '}
                {n.note}
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function Category({ title, rows, tint, highlight = false }) {
  const tone = title.startsWith('Gross Sale') ? 'positive' : title.startsWith('Purchase') ? 'negative' : undefined;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <Card title={title} tint={tint} highlight={highlight}>
      {rows.length ? (
        <>
          <div className="divide-y divide-gray-200/70">
            {rows.map((r) => (
              <div key={r.category} className="flex justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{r.category}</p>
                  <p className="text-xs text-gray-500">Qty: {Number(r.quantity).toLocaleString()}</p>
                </div>
                <b className={financialToneClass({ label: title, value: r.amount, tone })}>{money(r.amount)}</b>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t-2 border-gray-900 px-4 py-3 text-sm font-bold text-gray-900">
            <span>Total</span>
            <b className={financialToneClass({ label: title, value: total, tone })}>{money(total)}</b>
          </div>
        </>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-gray-500">No {title.toLowerCase()} data</p>
      )}
    </Card>
  );
}

export function QuantitySummary({ items }) {
  return (
    <div className="mt-5 break-inside-avoid border border-gray-200">
      <h3 className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900">Quantity Summary</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        {Object.entries(items).map(([k, v]) => (
          <div key={k} data-print-row className="border-b border-r border-gray-100 p-4">
            <p className="text-xs text-gray-500">{k}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{Number(v || 0).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Title block only. The report deliberately carries NO methodology prose — no
 * "built from posted journal entries rather than…", no basis or notes
 * paragraphs. The per-card footnotes stay, because those explain the figures
 * sitting directly above them; a wall of narrative under the title does not.
 */
export function ReportHeader({ restaurantName, title, rangeText, generatedText }) {
  return (
    <div className="mb-6 border-b-2 border-gray-900 pb-5">
      <p className="text-sm font-semibold text-gray-600">{restaurantName}</p>
      <h2 className="mt-1 text-3xl font-bold text-gray-950">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{rangeText}</p>
      <p className="mt-1 text-xs text-gray-400">{generatedText}</p>
    </div>
  );
}
