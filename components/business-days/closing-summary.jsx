'use client';

import React from 'react';
import { AlertTriangle, Banknote, ChevronDown, ChevronUp, CircleCheck, CreditCard, ReceiptText, Utensils } from 'lucide-react';
import PanelLink from '@/components/admin/panel-link.jsx';
import { financialToneClass } from '@/lib/financial-tone';
import DenominationTable, { CASH_DENOMINATIONS, emptyDenominationCounts } from '@/components/business-days/denomination-table.jsx';

const amount = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (value) => Number(value || 0).toLocaleString('en-IN');

function Metric({ label, value, money = true, tone }) {
  return <div className="min-w-0 border-l-2 border-gray-200 pl-3"><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-1 truncate text-base font-semibold tabular-nums ${money ? financialToneClass({ label, value, tone }) : 'text-gray-950'}`}>{money ? amount(value) : count(value)}</p></div>;
}

function Section({ icon: Icon, title, children }) {
  return <section className="border-t border-gray-200 py-6 first:border-t-0 first:pt-0">
    <div className="mb-4 flex items-center gap-2"><Icon className="h-4 w-4 text-gray-500" /><h2 className="text-sm font-semibold text-gray-950">{title}</h2></div>
    {children}
  </section>;
}

export default function ClosingSummary({
  summary,
  countedCash = '',
  onCountedCashChange,
  denominationCounts: controlledDenominationCounts,
  onDenominationCountsChange,
  interactive = false,
  onHistoricalSessionChange,
}) {
  const sessions = Array.isArray(summary?.sessions) ? summary.sessions : [];
  const liveSessionNumber = Number(summary?.cash?.session_number || 0);
  const sessionCount = Number(summary?.cash?.session_count || sessions.length || 0);
  const defaultSession = liveSessionNumber || sessionCount || 1;
  const [viewSessionNumber, setViewSessionNumber] = React.useState(defaultSession);
  const [showCash, setShowCash] = React.useState(false);
  const [localDenominationCounts, setLocalDenominationCounts] = React.useState(emptyDenominationCounts);

  React.useEffect(() => {
    setViewSessionNumber(defaultSession);
  }, [defaultSession, summary?.business_day?.id, summary?.store_session?.id]);

  const viewedSession = sessions.find((row) => Number(row.session_number) === Number(viewSessionNumber)) || null;
  const viewingHistorical = Boolean(
    viewedSession
    && viewedSession.status === 'closed'
    && Number(viewSessionNumber) !== Number(liveSessionNumber)
  );

  React.useEffect(() => {
    onHistoricalSessionChange?.(viewingHistorical ? viewedSession : null);
  }, [viewingHistorical, viewedSession, onHistoricalSessionChange]);

  const denominationCounts = controlledDenominationCounts || localDenominationCounts;
  const liveOriginalExpected = Number(summary?.cash?.original_expected_cash ?? summary?.cash?.expected_cash ?? 0);
  const liveExpected = Number(summary?.cash?.adjusted_expected_cash ?? liveOriginalExpected);
  const historicalExpected = Number(
    viewedSession?.reconciliation?.expected_cash
    ?? viewedSession?.expected_cash
    ?? 0
  );
  const originalExpected = viewingHistorical ? historicalExpected : liveOriginalExpected;
  const expected = viewingHistorical ? historicalExpected : liveExpected;
  const postClose = viewingHistorical ? null : summary?.post_close_adjustments;
  const displayCounted = viewingHistorical
    ? (viewedSession?.reconciliation?.counted_cash ?? viewedSession?.counted_cash ?? '')
    : countedCash;
  const hasCount = displayCounted !== '' && displayCounted != null;
  const difference = hasCount ? Number(displayCounted) - expected : null;
  const state = difference == null ? null : Math.abs(difference) < 0.005 ? 'MATCHED' : difference < 0 ? 'SHORT' : 'OVER';
  const sales = summary?.sales || {};
  const collections = summary?.collections || {};
  const breakdown = viewingHistorical
    ? (viewedSession?.cash_breakdown || {})
    : (summary?.cash?.breakdown || {});
  const isSessionScope = summary?.cash?.scope === 'store_session' || sessions.length > 1;
  const sessionNumber = Number(viewSessionNumber || liveSessionNumber || 0);
  const earlierSessionCashSales = viewingHistorical
    ? 0
    : Number(summary?.cash?.earlier_session_cash_sales || 0);
  const postCloseCashSales = viewingHistorical ? 0 : Number(summary?.cash?.post_close_cash_sales || 0);
  const reconciliationTitle = isSessionScope
    ? `Store session ${sessionNumber || sessionCount || 1} of ${sessionCount || sessionNumber || 1} · Cash reconciliation`
    : 'Cash reconciliation';
  const cashInteractive = interactive && !viewingHistorical;
  const denominationTotal = CASH_DENOMINATIONS.reduce(
    (total, denomination) => total + (Number(denominationCounts[denomination]) || 0) * denomination,
    0,
  );

  const selectSession = (number) => {
    setViewSessionNumber(number);
    setShowCash(true);
  };

  const updateDenominationCount = (denomination, value) => {
    const quantity = value === '' ? '' : Math.max(0, Math.floor(Number(value) || 0));
    const next = { ...denominationCounts, [denomination]: quantity };
    if (onDenominationCountsChange) onDenominationCountsChange(next);
    else setLocalDenominationCounts(next);
    const total = CASH_DENOMINATIONS.reduce(
      (sum, note) => sum + (Number(next[note]) || 0) * note,
      0,
    );
    onCountedCashChange(String(total));
  };

  const clearDenominationCount = () => {
    const empty = emptyDenominationCounts();
    if (onDenominationCountsChange) onDenominationCountsChange(empty);
    else setLocalDenominationCounts(empty);
    onCountedCashChange('');
  };

  return (
    <div className="space-y-0">
      {summary?.cancellationWarnings && (summary.cancellationWarnings.unverified + summary.cancellationWarnings.disputedAdmin + summary.cancellationWarnings.disputedKitchen > 0) && (
        <p role="status" className="mb-5 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Cancellation audit: {summary.cancellationWarnings.unverified} awaiting admin verification; {summary.cancellationWarnings.disputedKitchen} kitchen dispute(s); {summary.cancellationWarnings.disputedAdmin} admin dispute(s). These warnings do not block closing.
        </p>
      )}

      <Section icon={ReceiptText} title="Sales summary">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Gross Billed Sales" value={sales.gross_sales} tone="positive" />
          <Metric label="Discounts" value={sales.discounts} />
          <Metric label="Sales Before Returns" value={sales.sales_before_returns} tone="positive" />
          <Metric label="Net Sales After Refunds" value={sales.net_sales} tone={Number(sales.net_sales) < 0 ? 'negative' : 'positive'} />
          <Metric label="VAT / Tax" value={sales.tax} />
          <Metric label="Service Charge" value={sales.service_charge} />
          <Metric label="Refunds" value={sales.refunds} />
          <Metric label="Voided Sales (bill value)" value={sales.voided_bill_value} />
          <Metric label="Finalized Bills" value={sales.completed_bills} money={false} />
          <Metric label="Orders Completed" value={summary?.orders?.completed} money={false} />
          <Metric label="Average Net Bill" value={sales.average_bill} tone="positive" />
          <Metric label="Items Sold" value={sales.items_sold} money={false} />
        </div>
        {!!sales.channels?.length && (
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-100 pt-4">
            {sales.channels.map((row) => (
              <span key={row.channel} className="text-sm text-gray-600">
                <strong className="capitalize text-gray-900">{String(row.channel).replaceAll('_', ' ')}</strong>{' '}
                <span className="font-semibold text-emerald-700">{amount(row.amount)} net</span>
                {Number(row.refunds || 0) > 0 && (
                  <> (<span className="text-emerald-700">{amount(row.gross_amount)} gross</span> - <span className="text-rose-700">{amount(row.refunds)} refunded</span>)</>
                )}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section icon={CreditCard} title="Payment collection summary">
        <p className="mb-4 text-xs text-gray-500">Whole business-day totals across all store sessions. Active settlement rows only; voided payments are removed.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Business-Day Cash Collected" value={collections.cash} />
          <Metric label="Online Collected" value={collections.online ?? (Number(collections.qr || 0) + Number(collections.card || 0) + Number(collections.bank || 0) + Number(collections.other || 0))} tone="positive" />
          <Metric label="Credit Sales (not cash)" value={collections.credit_sales} tone="positive" />
          <Metric label="Active Money Collected" value={collections.total_collected} />
          <Metric label="Refunds Returned" value={collections.refunds} />
          <Metric label="Cash Returned for Voided Bills" value={collections.void_returns} />
          <Metric label="Net Money Retained" value={collections.net_collected} />
        </div>
      </Section>

      {!summary?.cash?.hidden && (
        <section className="border-y-2 border-gray-950 bg-gray-950 px-3 py-4 text-white sm:px-4 lg:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              <h2 className="text-sm font-semibold">{reconciliationTitle}</h2>
            </div>
            {sessions.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Store sessions">
                {sessions.map((row) => {
                  const active = Number(row.session_number) === Number(viewSessionNumber);
                  return (
                    <button
                      key={row.id || row.session_number}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectSession(row.session_number)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                        active
                          ? 'bg-white text-gray-950'
                          : 'border border-white/30 bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      Session {row.session_number}
                      <span className={`text-[10px] font-medium ${active ? 'text-gray-500' : 'text-white/70'}`}>
                        {row.status === 'open' ? 'open' : 'closed'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {viewingHistorical && (
            <p className="mb-3 border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Viewing <strong>session {viewSessionNumber}</strong>
              {viewedSession?.closed_by_name ? ` (closed by ${viewedSession.closed_by_name})` : ' (closed)'}.
              Frozen count from that session — switch back to session {liveSessionNumber || sessionCount} to count and close the current drawer.
            </p>
          )}
          {isSessionScope && !viewingHistorical && Math.abs(postCloseCashSales) >= 0.005 && (
            <p className="mb-3 border border-rose-400/50 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              <strong>Post-close cash activity:</strong> {amount(Math.abs(postCloseCashSales))} in cash sales was posted after this drawer was counted and closed. It appears in whole-day Analytics but is not part of the frozen physical count below.
            </p>
          )}
          {isSessionScope && !viewingHistorical && Math.abs(earlierSessionCashSales) >= 0.005 && (
            <p className="mb-3 border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
              The business day recorded {amount(summary?.cash?.business_day_cash_sales)} in cash sales. {amount(Math.abs(earlierSessionCashSales))} belongs to earlier store session(s), so it is already reconciled before this session&rsquo;s opening and is not added again below. Tap <strong>Session 1</strong> above to review that closed count.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-stretch">
            <div className="flex h-full flex-col border border-white/20 bg-white/5 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-400">Expected Cash</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{amount(expected)}</p>
              {!!postClose?.entries && (
                <div className="mt-2 border-l-2 border-amber-400 pl-2 text-[11px] text-amber-200">
                  <p>{amount(originalExpected)} at close</p>
                  <p>{Number(postClose.cash_delta) >= 0 ? '+' : '-'} {amount(Math.abs(Number(postClose.cash_delta || 0)))} from {count(postClose.entries)} later correction(s)</p>
                </div>
              )}
              <button type="button" onClick={() => setShowCash((value) => !value)} className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-gray-300 hover:text-white">
                {showCash ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Cash calculation
              </button>
            </div>
            <div className="flex h-full flex-col border border-white/20 bg-white p-3 text-gray-950">
              <label className="block text-[11px] font-semibold uppercase text-gray-500">Counted Cash</label>
              {cashInteractive ? (
                <>
                  <div className="mt-1 flex items-baseline justify-between gap-3 border-b border-gray-950 pb-1.5">
                    <p className="text-2xl font-bold tabular-nums">{amount(denominationTotal)}</p>
                    <button type="button" onClick={clearDenominationCount} className="text-[11px] font-semibold text-gray-500 hover:text-gray-950">Clear</button>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">Enter how many notes you have for each denomination. The total is calculated automatically.</p>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {CASH_DENOMINATIONS.map((denomination) => {
                      const value = (Number(denominationCounts[denomination]) || 0) * denomination;
                      return (
                        <label key={denomination} className="grid grid-cols-[auto_minmax(56px,1fr)_auto] items-center gap-1.5 border border-gray-200 bg-gray-50 px-2 py-1">
                          <span className="shrink-0 text-[11px] font-bold tabular-nums text-gray-900">Rs {denomination.toLocaleString('en-IN')} ×</span>
                          <input
                            aria-label={`Number of Rs ${denomination} notes`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={denominationCounts[denomination] ?? ''}
                            onChange={(event) => updateDenominationCount(denomination, event.target.value)}
                            className="h-7 min-w-0 border-b border-gray-300 bg-white px-1 py-0 text-center text-sm font-bold tabular-nums outline-none focus:border-gray-950"
                            placeholder="0"
                          />
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-600">= {amount(value)}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {amount(viewingHistorical ? displayCounted : (summary?.reconciliation?.counted_cash ?? summary?.business_day?.counted_cash))}
                  </p>
                  <DenominationTable
                    counts={viewingHistorical ? viewedSession?.reconciliation?.cash_denominations : summary?.reconciliation?.cash_denominations}
                    className="mt-3"
                  />
                </>
              )}
              <div className={`mt-3 border-l-4 pl-2.5 ${state === 'SHORT' ? 'border-rose-600 text-rose-700' : state === 'OVER' ? 'border-amber-500 text-amber-700' : state === 'MATCHED' ? 'border-emerald-600 text-emerald-700' : 'border-gray-300 text-gray-500'}`}>
                <p className="text-[11px] font-bold uppercase">{state || 'Difference'}</p>
                <p className="text-lg font-bold tabular-nums">{difference == null ? 'Enter counted cash' : amount(Math.abs(difference))}</p>
              </div>
            </div>
          </div>

          {showCash && (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/20 pt-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
              <CashLine label={isSessionScope ? `Session ${sessionNumber} Opening Cash` : 'Opening Cash'} value={breakdown.opening_cash} />
              <CashLine label={isSessionScope ? `Cash Sales in Session ${sessionNumber}` : 'Cash Sales Collected'} value={breakdown.cash_collections} sign="+" />
              <CashLine label="Old Credit Collected (net)" value={breakdown.credit_collections} sign="+" />
              <CashLine label="Hotel Guest Payments" value={breakdown.hotel_collections} sign="+" />
              <CashLine label="Other Cash In" value={breakdown.cash_in} sign="+" />
              <CashLine label="Business Funding Added" value={breakdown.business_funding_in} sign="+" />
              <CashLine label="Money Exchange Cash In" value={breakdown.money_exchange_in} sign="+" />
              <CashLine label="Cash Expenses" value={breakdown.cash_expenses} sign="-" />
              <CashLine label="Cash Refunds" value={breakdown.cash_refunds} sign="-" />
              <CashLine label="Cash Returned for Voided Bills" value={breakdown.void_returns} sign="-" />
              <CashLine label="Supplier Payments" value={breakdown.supplier_payments} sign="-" />
              <CashLine label="Money Exchange Cash Out" value={breakdown.money_exchange_out} sign="-" />
              <CashLine label="Other Cash Out" value={breakdown.other_cash_out} sign="-" />
            </div>
          )}
          {viewingHistorical && viewedSession?.closing_note ? (
            <p className="mt-3 border-t border-white/20 pt-3 text-xs text-gray-300">
              <span className="font-semibold text-white">Closing note:</span> {viewedSession.closing_note}
            </p>
          ) : null}
        </section>
      )}

      <Section icon={CreditCard} title="Online and bank reconciliation">
        {summary?.online?.length ? (
          <div className="divide-y divide-gray-100 border-y border-gray-100">
            {summary.online.map((row) => (
              <div key={row.code} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 py-3 text-sm">
                <span className="font-medium text-gray-900">{row.name}</span>
                <span className="font-medium text-emerald-700">In {amount(row.inflow)}</span>
                <span className="font-medium text-rose-700">Out {amount(row.outflow)}</span>
                <strong className={`tabular-nums ${Number(row.net) > 0 ? 'text-emerald-700' : Number(row.net) < 0 ? 'text-rose-700' : 'text-gray-950'}`}>Net {amount(row.net)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No online or bank movement in this business day.</p>
        )}
      </Section>

      <Section icon={Banknote} title="Outflows">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Operating Expenses" value={summary?.outflows?.operating_expenses} />
          <Metric label="Cash Expenses" value={summary?.outflows?.cash_expenses} />
          <Metric label="Online Expenses" value={summary?.outflows?.online_expenses} />
          <Metric label="Refunds Returned" value={summary?.outflows?.refunds} />
          <Metric label="Cash Returned for Voided Bills" value={summary?.outflows?.cash_void_returns} />
        </div>
      </Section>

      <Section icon={Utensils} title="Orders, kitchen and floor">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-8">
          <Metric label="Orders Created" value={summary?.orders?.created} money={false} />
          <Metric label="Completed" value={summary?.orders?.completed} money={false} />
          <Metric label="Open Orders" value={summary?.orders?.open} money={false} />
          <Metric label="Cancelled" value={summary?.orders?.cancelled} money={false} />
          <Metric label="KOTs Generated" value={summary?.kots?.generated} money={false} />
          <Metric label="KOTs Completed" value={summary?.kots?.completed} money={false} />
          <Metric label="Active KOTs" value={summary?.kots?.active} money={false} />
          <Metric label="Tables Served" value={summary?.operations?.tables_served} money={false} />
        </div>
        {!!summary?.operations?.top_items?.length && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Top-selling items</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {summary.operations.top_items.map((item) => (
                <span key={item.name} className="text-sm">
                  <strong>{item.name}</strong> <span className="text-gray-500">{count(item.quantity)} sold</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section icon={summary?.blockers?.canCloseNormally ? CircleCheck : AlertTriangle} title="Issues before closing">
        {summary?.blockers?.canCloseNormally ? (
          <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <CircleCheck className="h-4 w-4" />No unresolved operational records.
          </div>
        ) : (
          <div className="border border-rose-200 bg-rose-50">
            <div className="border-b border-rose-200 px-4 py-3 text-sm font-semibold text-rose-900">Cannot close normally</div>
            <div className="divide-y divide-rose-100">
              {summary?.blockers?.items?.map((item) => (
                <PanelLink key={item.key} href={item.href} className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-rose-800 hover:bg-rose-100">
                  <span>{item.message || `${item.count} ${item.label}`}</span>
                  <span className="shrink-0 font-semibold">View</span>
                </PanelLink>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function CashLine({ label, value, sign = '' }) {
  const numeric = Number(value || 0);
  const shownSign = numeric < 0 ? (sign === '+' ? '-' : sign === '-' ? '+' : sign) : sign;
  const tone = shownSign === '+' ? 'text-emerald-400' : shownSign === '-' ? 'text-rose-400' : 'text-white';
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{shownSign} {amount(Math.abs(numeric))}</p>
    </div>
  );
}
