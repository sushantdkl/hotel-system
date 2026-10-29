'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatValue, KpiCards } from '@/components/admin/report-kit';
import { formatNepalDateTime } from '@/lib/report-dates';
import { financialToneClass } from '@/lib/financial-tone';

export const money = (value) => formatValue(value, 'currency');
export const count = (value) => formatValue(value, 'number');
export const percent = (value) => formatValue(value, 'percent');

const HEADING_TONES = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  orange: 'bg-orange-50 text-orange-600',
  violet: 'bg-violet-50 text-violet-600',
  cyan: 'bg-cyan-50 text-cyan-600',
  teal: 'bg-teal-50 text-teal-600',
  rose: 'bg-rose-50 text-rose-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  slate: 'bg-slate-100 text-slate-600',
  gray: 'bg-gray-100 text-gray-500',
};

export function SectionHeading({ icon: Icon, tone = 'gray', eyebrow, title, description, action }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${HEADING_TONES[tone] || HEADING_TONES.gray}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{eyebrow}</p>}
          <h2 className="mt-0.5 text-lg font-semibold text-gray-950">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Every analytics section renders as its own white card — same language as the Reports tabs. */
export function DashboardSection({ children, className = '' }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function Change({ comparison }) {
  if (!comparison || comparison.percent == null) {
    return <span className="text-xs text-gray-400">No comparable history</span>;
  }
  const up = comparison.absolute > 0;
  const down = comparison.absolute < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-700' : down ? 'text-red-700' : 'text-gray-500'}`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(comparison.percent).toFixed(1)}% ({comparison.absolute > 0 ? '+' : ''}{money(comparison.absolute)})
    </span>
  );
}

/** Hero KPI row — delegates to the same KpiCards used by Reports so the two pages match. */
export function PrimaryKpis({ rows }) {
  const kpis = (rows || []).map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    format: row.format,
    tone: row.tone,
    highlight: row.highlight,
    change: row.comparison?.percent ?? null,
    sub: row.note || (row.comparison
      ? `${row.comparison.absolute >= 0 ? '+' : ''}${formatValue(row.comparison.absolute, row.format)} vs last period`
      : null),
  }));
  return <KpiCards kpis={kpis} />;
}

/** Secondary KPIs — small stat chips, not a table of hairlines. */
export function CompactMetrics({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-[140px] flex-1 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
          <span className="text-xs text-gray-500">{row.label}</span>
          <span className={`text-sm font-semibold tabular-nums ${row.format === 'currency' ? financialToneClass(row) : 'text-gray-900'}`}>{formatValue(row.value, row.format)}</span>
        </div>
      ))}
    </div>
  );
}

export function Metric({ label, value, format = 'number', detail, tone = 'default' }) {
  const tones = {
    default: 'text-gray-950', positive: 'text-emerald-700', warning: 'text-amber-700', negative: 'text-red-700', info: 'text-blue-700',
  };
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${format === 'currency' && tone === 'default' ? financialToneClass({ label, value }) : tones[tone] || tones.default}`}>{formatValue(value, format)}</p>
      {detail && <p className="mt-0.5 text-xs text-gray-400">{detail}</p>}
    </div>
  );
}

/** A single stat cell for the soft metric grids (lifecycle, controls, summary). */
export function StatCell({ label, value, format = 'number', tone = 'default' }) {
  const tones = {
    default: 'text-gray-950', positive: 'text-emerald-700', warning: 'text-amber-700', negative: 'text-red-700', info: 'text-blue-700',
  };
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold tabular-nums ${format === 'currency' && tone === 'default' ? financialToneClass({ label, value }) : tones[tone] || tones.default}`}>{formatValue(value, format)}</p>
    </div>
  );
}

export function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-700', positive: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700', negative: 'bg-red-50 text-red-700', info: 'bg-blue-50 text-blue-700',
  };
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${tones[tone] || tones.neutral}`}>{children}</span>;
}

export function DataList({ rows, render, empty = 'No data for this period.' }) {
  if (!rows?.length) return <p className="py-8 text-center text-sm text-gray-400">{empty}</p>;
  return <div className="divide-y divide-gray-100">{rows.map(render)}</div>;
}

export function TableWrap({ children, minWidth = '720px' }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-gray-100 [-webkit-overflow-scrolling:touch]">
      <table className="w-full text-left text-sm" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export function EmptyDash() {
  return <span className="text-gray-300">-</span>;
}

export function NepalTime({ value }) {
  return <span className="whitespace-nowrap">{formatNepalDateTime(value)}</span>;
}
