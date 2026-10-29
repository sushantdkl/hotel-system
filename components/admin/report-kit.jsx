'use client';

/**
 * Presentation primitives for the Reports analytics centre.
 * Same visual language as the Dashboard / Inventory / Wastage pages:
 * white cards, border-gray-200, rounded-2xl, shadow-sm, gray-900 headings,
 * gray-500 secondary text, small colour chips, semantic colour only.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Area, AreaChart as RcAreaChart, Bar, BarChart as RcBarChart, CartesianGrid, Cell,
  LabelList, ResponsiveContainer, Scatter, ScatterChart as RcScatterChart,
  Tooltip as RcTooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Star, Clock3, CreditCard, Wallet, Info,
  AlertTriangle, Search, ArrowUpDown, Download, Lightbulb, X, LoaderCircle,
  ReceiptText, PackageSearch,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { formatNepalDateTime, formatNepalDisplay } from '@/lib/report-dates';
import { formatCalendarText } from '@/lib/calendar-system.js';
import { toCsv } from '@/lib/csv';
import { financialToneClass } from '@/lib/financial-tone';
import { paymentBucket } from '@/lib/report-scope.js';
import PaginationControls from '@/components/ui/pagination-controls';
import { DEFAULT_PAGE_SIZE } from '@/lib/paginate.js';
import KotPopup from '@/components/admin/kot-popup.jsx';

const CHIP_ICONS = {
  up: { Icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-600' },
  down: { Icon: TrendingDown, tone: 'bg-red-50 text-red-600' },
  star: { Icon: Star, tone: 'bg-amber-50 text-amber-600' },
  clock: { Icon: Clock3, tone: 'bg-blue-50 text-blue-600' },
  card: { Icon: CreditCard, tone: 'bg-violet-50 text-violet-600' },
  wallet: { Icon: Wallet, tone: 'bg-teal-50 text-teal-600' },
  warn: { Icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600' },
  info: { Icon: Info, tone: 'bg-gray-100 text-gray-500' },
};

const TONE_CARD = {
  positive: 'border-emerald-200 bg-emerald-50/40',
  warning: 'border-amber-200 bg-amber-50/40',
  negative: 'border-red-200 bg-red-50/40',
  neutral: 'border-gray-200 bg-white',
};

const STATUS_TONE = {
  completed: 'bg-emerald-50 text-emerald-700',
  paid: 'bg-emerald-50 text-emerald-700',
  ok: 'bg-emerald-50 text-emerald-700',
  positive: 'bg-emerald-50 text-emerald-700',
  ready: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-blue-50 text-blue-700',
  seated: 'bg-blue-50 text-blue-700',
  occupied: 'bg-blue-50 text-blue-700',
  preparing: 'bg-amber-50 text-amber-700',
  pending: 'bg-gray-100 text-gray-600',
  new: 'bg-gray-100 text-gray-600',
  low: 'bg-amber-50 text-amber-700',
  reserved: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-red-50 text-red-700',
  no_show: 'bg-red-50 text-red-700',
  'out of stock': 'bg-red-50 text-red-700',
  available: 'bg-gray-100 text-gray-600',
};

/**
 * Chart palette — deliberately small.
 *
 * Every chart on this page is single-series, so hue never carries identity
 * *within* a chart; it only sets the card's tone. That lets the whole app run on
 * two neutral accents (blue for series, slate for ranked lists) plus three
 * reserved semantic tones (profit / expense / loss). The legacy `violet` and
 * `teal` keys collapse onto blue on purpose — seven hues across the tabs read as
 * a rainbow, which the design language forbids.
 *
 * Validated with the dataviz palette checker (light surface): lightness band,
 * chroma floor, normal-vision separation and 3:1 contrast all pass. The
 * amber↔emerald pair sits in the 6–8 CVD band, which is safe here only because
 * those two never appear as two series inside one chart.
 */
const CHART_COLORS = {
  blue: '#2563eb',
  violet: '#2563eb',
  teal: '#2563eb',
  slate: '#475569',
  emerald: '#059669',
  amber: '#d97706',
  red: '#be123c',
};

const AXIS_TICK = { fontSize: 11, fill: '#9ca3af' };
const GRID_STROKE = '#f3f4f6';
/** Subtle, not flashy: one short ease-out on mount. */
const ANIM = { isAnimationActive: true, animationDuration: 550, animationEasing: 'ease-out' };

const pickColor = (color) => CHART_COLORS[color] || CHART_COLORS.blue;

/* ------------------------------------------------------------------ */

export function formatValue(value, format) {
  if (value == null || value === '') return '—';
  switch (format) {
    case 'currency': {
      // Paise only matter under Rs 1,000; above that they just overflow the card.
      const n = Number(value) || 0;
      if (Math.abs(n) < 1000) return formatCurrency(n);
      return `Rs ${Math.round(n).toLocaleString('en-IN')}`;
    }
    case 'percent':
      return `${(Number(value) || 0).toFixed(1)}%`;
    case 'decimal':
      return (Number(value) || 0).toFixed(1);
    case 'minutes':
      return `${Math.round(Number(value) || 0)} min`;
    case 'number':
      return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value);
    case 'datetime':
      return formatNepalDateTime(value);
    case 'date':
      return formatNepalDisplay(String(value).slice(0, 10));
    default:
      return formatCalendarText(value);
  }
}

/** 1. Quick insight chips — one glanceable line each. */
export function QuickChips({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-in fade-in duration-300">
      {chips.map((chip, i) => {
        const meta = CHIP_ICONS[chip.icon] || CHIP_ICONS.info;
        return (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <span className={`shrink-0 rounded-lg p-1.5 ${meta.tone}`}>
              <meta.Icon className="h-4 w-4" />
            </span>
            <p className="text-sm text-gray-700 leading-snug">{formatCalendarText(chip.text)}</p>
          </div>
        );
      })}
    </div>
  );
}

/** 2. Large KPI cards. `kpi.highlight` marks the one headline number in the
 * row (Profit, Revenue, etc.) with a light accent — not every card, just the
 * one worth an owner's eye landing on first. */
export function KpiCards({ kpis, groups }) {
  if (!kpis?.length) return null;

  /*
   * Beyond about six figures a flat grid stops being scannable and starts
   * inviting nonsense arithmetic across unrelated cards. When the report
   * supplies groups, band them under the question each answers.
   */
  if (groups?.length) {
    const byKey = new Map(kpis.map((k) => [k.key, k]));
    const grouped = groups
      .map((g) => ({ ...g, items: g.keys.map((k) => byKey.get(k)).filter(Boolean) }))
      .filter((g) => g.items.length);
    const claimed = new Set(grouped.flatMap((g) => g.items.map((k) => k.key)));
    const leftovers = kpis.filter((k) => !claimed.has(k.key));
    const bands = leftovers.length
      ? [...grouped, { id: 'other', title: 'Other', caption: null, items: leftovers }]
      : grouped;
    return (
      <div className="space-y-5 animate-in fade-in duration-300">
        {bands.map((band) => (
          <section key={band.id}>
            <div className="mb-2.5">
              <h2 className="text-sm font-semibold text-gray-900">{band.title}</h2>
              {band.caption && <p className="mt-0.5 text-xs text-gray-500">{band.caption}</p>}
            </div>
            <KpiGrid kpis={band.items} />
          </section>
        ))}
      </div>
    );
  }

  return <KpiGrid kpis={kpis} />;
}

function KpiGrid({ kpis }) {
  const cols = kpis.length >= 5 ? 'xl:grid-cols-5' : 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-5 ${cols}`}>
      {kpis.map((kpi) => (
        <div
          key={kpi.key}
          className={`rounded-2xl border p-4 shadow-sm sm:p-6 ${
            kpi.highlight ? 'border-emerald-200 bg-emerald-50/50 ring-1 ring-emerald-100' : 'border-gray-200 bg-white'
          }`}
        >
          <p className="text-xs font-medium text-gray-500 sm:text-sm">
            {kpi.hint ? (
              // A metric an owner cannot define is a metric they cannot trust.
              // The dotted underline is the affordance; the definition is one
              // hover away rather than crowding thirteen cards with prose.
              <span className="cursor-help decoration-dotted underline-offset-2 [text-decoration-line:underline]" title={kpi.hint}>
                {kpi.label}
              </span>
            ) : (
              kpi.label
            )}
          </p>
          <h3 className={`mt-2 truncate text-xl font-bold tabular-nums sm:text-2xl ${kpi.format === 'currency' ? financialToneClass(kpi) : 'text-gray-900'}`} title={String(kpi.value ?? '')}>
            {formatValue(kpi.value, kpi.format)}
          </h3>
          {kpi.sub && <p className="mt-1 truncate text-xs text-gray-400">{kpi.sub}</p>}
          {kpi.change != null && (
            <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${kpi.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {kpi.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {kpi.change >= 0 ? '+' : ''}{kpi.change}%
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** One chart per card — never two. */
export function ChartCard({ title, hint, children, isEmpty, empty, className = '' }) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 animate-in fade-in duration-300 ${className}`}>
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
      </div>
      {isEmpty ? <p className="py-12 text-center text-sm text-gray-500">{empty}</p> : children}
    </div>
  );
}

/* ---------------------------- chart primitives ---------------------------- */
/*
 * Three shared wrappers cover every chart in the app (dashboard, 11 report tabs,
 * wastage). Callers pass the same `{ label, sub, value, meta }` rows they always
 * have and pick a palette key — nothing configures recharts inline.
 *
 * None of these render their own empty state: <ChartCard isEmpty> already swaps
 * in a friendly message before the chart mounts, so an empty frame is
 * impossible. No legends either — every series here is single, and a legend box
 * for one series is pure clutter; the card title names it.
 */

/** Shared hover card. Shows the long label, the formatted value and any meta. */
function ChartTooltip({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium capitalize text-gray-500">{d.sub || d.label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
        {formatValue(d.value, format)}
      </p>
      {d.meta && <p className="mt-0.5 text-xs text-gray-400">{d.meta}</p>}
    </div>
  );
}

/** Axis ticks stay short so they never collide — the tooltip carries the detail. */
function compactTick(value, format) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n * 10) / 10);
}

const truncate = (s, max) => {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

/**
 * Area line — for anything measured against time (daily revenue, profit,
 * expenses, wastage). A continuous measure over ordered dates reads as a shape,
 * which is what an area gives you and a row of separate bars does not.
 */
export function TrendChart({ data, color = 'blue', format = 'currency', height = 200 }) {
  const stroke = pickColor(color);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcAreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compactTick(v, format)} />
        <RcTooltip cursor={{ stroke: '#d1d5db', strokeWidth: 1 }} content={(p) => <ChartTooltip {...p} format={format} />} />
        {/* Flat low-opacity fill, not a gradient — the design language has none. */}
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          fill={stroke}
          fillOpacity={0.12}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          {...ANIM}
        />
      </RcAreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Vertical bars — for ordered categorical buckets (hour of day, weekday, prep
 * time band). Discrete buckets should be compared, not connected.
 * Negative bars (a loss-making day) pick up the loss tone automatically.
 */
export function BarChart({ data, color = 'blue', format = 'currency', height = 200 }) {
  const fill = pickColor(color);
  const hasNegative = data.some((d) => Number(d.value) < 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compactTick(v, format)} />
        <RcTooltip cursor={{ fill: '#f9fafb' }} content={(p) => <ChartTooltip {...p} format={format} />} />
        <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={44} {...ANIM}>
          {hasNegative &&
            data.map((d, i) => (
              <Cell key={i} fill={Number(d.value) < 0 ? CHART_COLORS.red : fill} />
            ))}
        </Bar>
      </RcBarChart>
    </ResponsiveContainer>
  );
}

/**
 * Horizontal ranked bars — for composition and "who is biggest" questions.
 * This is deliberately the answer instead of a pie: a ranked bar stays readable
 * at twelve slices and can be compared by length rather than by angle.
 */
export function RankBars({ data, color = 'slate', format = 'currency', limit = 12 }) {
  const rows = data.slice(0, limit);
  const fill = pickColor(color);
  // One comfortable row height, with a floor so a two-row chart is not a sliver.
  const height = Math.max(120, rows.length * 34 + 16);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => compactTick(v, format)} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...AXIS_TICK, fontSize: 12, fill: '#374151' }}
          tickLine={false}
          axisLine={false}
          width={124}
          tickFormatter={(v) => truncate(v, 18)}
        />
        <RcTooltip cursor={{ fill: '#f9fafb' }} content={(p) => <ChartTooltip {...p} format={format} />} />
        <Bar dataKey="value" fill={fill} radius={[0, 4, 4, 0]} maxBarSize={18} {...ANIM}>
          {/* Direct label at the bar end — the value without needing a hover. */}
          <LabelList
            dataKey="value"
            position="right"
            className="fill-gray-500"
            style={{ fontSize: 11 }}
            formatter={(v) => formatValue(v, format)}
          />
        </Bar>
      </RcBarChart>
    </ResponsiveContainer>
  );
}

/** Popularity vs profitability quadrant. */
export function ScatterChart({ data, xLabel, yLabel, height = 260 }) {
  const points = data.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  const maxX = Math.max(1, ...points.map((d) => d.x));
  const maxY = Math.max(1, ...points.map((d) => d.y));
  const minY = Math.min(0, ...points.map((d) => d.y));
  const midX = maxX / 2;
  const midY = minY + (maxY - minY) / 2;
  const toneOf = (d) =>
    d.x >= midX && d.y >= midY ? CHART_COLORS.emerald : d.x < midX && d.y < midY ? CHART_COLORS.red : '#9ca3af';

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RcScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis type="number" dataKey="x" name={xLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis type="number" dataKey="y" name={yLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${Math.round(v)}%`} />
          <ZAxis range={[42, 42]} />
          <RcTooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#d1d5db' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
                  <p className="text-xs font-medium text-gray-900">{d.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatValue(d.x, 'number')} sold · {d.y.toFixed(1)}% margin
                  </p>
                </div>
              );
            }}
          />
          <Scatter data={points} {...ANIM}>
            {points.map((d, i) => (
              <Cell key={i} fill={toneOf(d)} fillOpacity={0.75} />
            ))}
          </Scatter>
        </RcScatterChart>
      </ResponsiveContainer>
      {/* Identity here is genuinely colour-coded, so it gets a key. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
        <span>{xLabel} →</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.emerald }} /> Stars
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.red }} /> Underperformers
          </span>
        </span>
        <span>↑ {yLabel}</span>
      </div>
    </div>
  );
}

/** 4. Business Insights — short written cards, not a stat dump. */
export function BusinessInsights({ insights }) {
  if (!insights?.length) return null;
  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-4 flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h2 className="text-base font-semibold text-gray-900">Business Insights</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight, i) => (
          <div key={i} className={`rounded-2xl border p-5 shadow-sm ${TONE_CARD[insight.tone] || TONE_CARD.neutral}`}>
            <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{insight.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Badge({ value }) {
  const key = String(value || '').toLowerCase();
  const semanticTone = (() => {
    if (/cancel|removed|void|refund|reduced|failed|declined/.test(key)) return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200';
    if (/edit|revis|reopen|change|increased/.test(key)) return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200';
    if (/added|settled|completed|approved/.test(key)) return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200';
    if (/order|bill|kitchen|kot|payment|customer/.test(key)) return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200';
    return null;
  })();
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[key] || semanticTone || 'bg-gray-100 text-gray-600'}`}>
      {value || '—'}
    </span>
  );
}

/** 5. Detailed table — sticky header, searchable, sortable, CSV export, paginated. */
export function DataTable({
  title, columns, rows, empty, csvName, onExportAll, toolbar, detailContext,
  visibleColumnKeys, onRowClick, onBillClick, onEntityClick, pagination: serverPagination, onPageChange, onPageSizeChange,
  pageLoading = false, tableTotals, paymentTotals: serverPaymentTotals, accentClass,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [detailRow, setDetailRow] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = needle
      ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle)))
      : rows.slice();
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      const numeric = ['currency', 'number', 'percent'].includes(col?.type);
      out.sort((a, b) => {
        let av = a[sort.key];
        let bv = b[sort.key];
        if (col?.type === 'datetime') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
        else if (numeric) { av = Number(av) || 0; bv = Number(bv) || 0; }
        else { av = String(av ?? '').toLowerCase(); bv = String(bv ?? '').toLowerCase(); }
        if (av < bv) return sort.dir === 'asc' ? -1 : 1;
        if (av > bv) return sort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [rows, columns, search, sort]);

  const usesServerPaging = Boolean(serverPagination);
  const activePageSize = usesServerPaging
    ? Number(serverPagination.page_size ?? serverPagination.pageSize ?? DEFAULT_PAGE_SIZE)
    : clientPageSize;
  const activePage = usesServerPaging
    ? Number(serverPagination.page ?? 1)
    : clientPage;
  const totalRows = usesServerPaging
    ? Number(serverPagination.total ?? rows.length)
    : visible.length;
  const pagedVisible = useMemo(() => {
    if (usesServerPaging) return visible;
    if (visible.length <= activePageSize) return visible;
    const offset = (activePage - 1) * activePageSize;
    return visible.slice(offset, offset + activePageSize);
  }, [visible, usesServerPaging, activePage, activePageSize]);
  const tablePagination = useMemo(() => {
    if (usesServerPaging) return serverPagination;
    if (visible.length <= activePageSize) return null;
    const totalPages = Math.max(1, Math.ceil(visible.length / activePageSize));
    return {
      page: activePage,
      page_size: activePageSize,
      total: visible.length,
      total_pages: totalPages,
      has_more: activePage < totalPages,
    };
  }, [usesServerPaging, serverPagination, visible.length, activePage, activePageSize]);

  const tableColumns = useMemo(() => {
    if (!visibleColumnKeys?.length) return columns;
    const keys = new Set(visibleColumnKeys);
    const compact = columns.filter((column) => keys.has(column.key));
    return compact.length ? compact : columns;
  }, [columns, visibleColumnKeys]);

  const toggleSort = (key) => {
    setClientPage(1);
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const openDetails = (row) => {
    const billId = row._bill_id ?? row._links?.bill_number?.id;
    if (billId && onBillClick) {
      onBillClick(billId);
      return;
    }
    if (onRowClick) {
      onRowClick(row);
      return;
    }
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(Boolean(detailContext));
    setDetailRow(row);
  };

  const totalColumns = useMemo(() => tableColumns.filter((column) => {
    if (column.total === false) return false;
    if (column.total === 'sum') return true;
    if (!['currency', 'number'].includes(column.type)) return false;
    return !/(avg|average|margin|rate|minutes?|wait|duration|utilisation|percent|%)/i.test(column.label);
  }), [tableColumns]);
  const totalKeys = useMemo(() => new Set(totalColumns.map((column) => column.key)), [totalColumns]);
  const totalLabelIndex = useMemo(() => {
    const firstNonTotal = tableColumns.findIndex((column) => !totalKeys.has(column.key));
    return firstNonTotal >= 0 ? firstNonTotal : 0;
  }, [tableColumns, totalKeys]);

  const totalsFor = (source) => Object.fromEntries(totalColumns.map((column) => [
    column.key,
    source.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0),
  ]));
  const footerTotals = search.trim()
    ? totalsFor(visible)
    : (tableTotals && Object.keys(tableTotals).length ? tableTotals : totalsFor(visible));

  const paymentSplit = useMemo(() => {
    const amountKey = totalColumns.find((column) => column.type === 'currency' && !/cash_amount|digital_amount|credit_amount/.test(column.key))?.key
      || totalColumns.find((column) => column.type === 'currency')?.key
      || totalColumns[totalColumns.length - 1]?.key;
    const hasMethod = tableColumns.some((column) => column.key === 'payment_method' || column.key === 'payment' || column.key === 'method');
    const hasBucketCols = tableColumns.some((column) => column.key === 'cash_amount')
      || Boolean(tableTotals?.cash_amount != null || tableTotals?.digital_amount != null || tableTotals?.credit_amount != null)
      || Boolean(serverPaymentTotals);

    const fromBucketColumns = (source) => {
      const totals = { cash: 0, digital: 0, credit: 0, funding: 0 };
      let matched = false;
      for (const row of source) {
        if (row.cash_amount != null || row.digital_amount != null || row.credit_amount != null) {
          totals.cash += Number(row.cash_amount) || 0;
          totals.digital += Number(row.digital_amount) || 0;
          totals.credit += Number(row.credit_amount) || 0;
          totals.funding += Number(row.funding_amount) || 0;
          matched = true;
          continue;
        }
        // Prefer a single method field — never the sales "payment" display string
        // (GROUP_CONCAT can be "cash, qr" and would bucket wrongly).
        const method = row.payment_method ?? row.method;
        if (method != null && amountKey) {
          totals[paymentBucket(method)] += Number(row[amountKey]) || 0;
          matched = true;
        }
      }
      return matched ? totals : null;
    };

    if (!hasMethod && !hasBucketCols) return null;

    // Table search narrows the visible set — recompute so Cash/Online/Credit match what is shown.
    if (search.trim()) return fromBucketColumns(visible);

    if (serverPaymentTotals && (serverPaymentTotals.cash != null || serverPaymentTotals.digital != null || serverPaymentTotals.credit != null || serverPaymentTotals.funding != null)) {
      return {
        cash: Number(serverPaymentTotals.cash) || 0,
        digital: Number(serverPaymentTotals.digital) || 0,
        credit: Number(serverPaymentTotals.credit) || 0,
        funding: Number(serverPaymentTotals.funding) || 0,
      };
    }

    // Sales invoices already sum cash/digital/credit in table.totals from the server.
    if (tableTotals && (tableTotals.cash_amount != null || tableTotals.digital_amount != null || tableTotals.credit_amount != null)) {
      return {
        cash: Number(tableTotals.cash_amount) || 0,
        digital: Number(tableTotals.digital_amount) || 0,
        credit: Number(tableTotals.credit_amount) || 0,
      };
    }

    if (!usesServerPaging || hasMethod) {
      return fromBucketColumns(visible);
    }
    return null;
  }, [serverPaymentTotals, search, visible, tableColumns, totalColumns, usesServerPaging, tableTotals]);

  const showPaymentSplit = Boolean(paymentSplit);

  useEffect(() => {
    if (!detailRow) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDetailRow(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailRow]);

  useEffect(() => {
    if (!detailRow || !detailContext) return undefined;
    const controller = new AbortController();
    fetch('/api/admin/reports/details', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('pos_token')}`,
      },
      body: JSON.stringify({ ...detailContext, row: detailRow }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'The full record could not be loaded.');
        setDetailData(body.detail);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setDetailError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailRow, detailContext]);

  /**
   * A download is the complete table, never the truncated view: when the server
   * capped this table, re-ask for it uncapped before writing the file.
   */
  const exportCsv = async () => {
    let source = visible;
    const needsFullExport = onExportAll && (usesServerPaging ? totalRows > rows.length : visible.length > pagedVisible.length);
    if (needsFullExport) {
      const full = await onExportAll();
      if (full?.length) {
        const needle = search.trim().toLowerCase();
        source = needle
          ? full.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle)))
          : full;
      }
    }
    const headers = columns.map((c) => c.label);
    const exportValue = (column, value) => {
      if (value == null || value === '') return '';
      if (column.type === 'datetime') return formatNepalDateTime(value);
      if (column.type === 'date') return formatNepalDisplay(String(value).slice(0, 10));
      if (/(^|_)(date|day)$|\bdate\b|\bday\b/i.test(`${column.key || ''} ${column.label || ''}`)) return formatNepalDisplay(String(value).slice(0, 10));
      if (['currency', 'percent', 'decimal', 'minutes', 'number'].includes(column.type)) {
        return formatValue(value, column.type);
      }
      return value;
    };
    const csvRows = source.map((row) =>
      Object.fromEntries(columns.map((c) => [c.label, exportValue(c, row[c.key])]))
    );
    if (source.length && totalColumns.length) {
      const exportTotals = totalsFor(source);
      csvRows.push(Object.fromEntries(columns.map((column, index) => [
        column.label,
        index === 0 ? 'TOTAL' : exportValue(column, exportTotals[column.key]),
      ])));
      if (showPaymentSplit && paymentSplit) {
        const breakdown = [
          ['Cash', paymentSplit.cash],
          ['Online', paymentSplit.digital],
          ['Funding', paymentSplit.funding],
          ['Credit', paymentSplit.credit],
        ];
        csvRows.push(Object.fromEntries(headers.map((header) => [header, ''])));
        breakdown.forEach(([method, amount], rowIndex) => {
          csvRows.push(Object.fromEntries(columns.map((column, index) => [
            column.label,
            index === 0 ? (rowIndex === 0 ? 'PAYMENT BREAKDOWN' : '')
              : index === 1 ? (columns.length > 2 ? method : `${method}: ${formatValue(amount, 'currency')}`)
                : index === 2 ? formatValue(amount, 'currency') : '',
          ])));
        });
      }
    }
    const blob = new Blob([toCsv(headers, csvRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${csvName || 'report'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`rounded-2xl border-x border-b border-gray-200 border-t-4 ${accentClass || 'border-t-gray-200'} bg-white p-5 shadow-sm sm:p-6 animate-in fade-in duration-300`}>
      {toolbar && <div className="-mx-5 -mt-5 mb-5 border-b border-gray-200 sm:-mx-6 sm:-mt-6">{toolbar}</div>}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-400">
            {usesServerPaging || tablePagination
              ? `${totalRows.toLocaleString()} record${totalRows === 1 ? '' : 's'}`
              : `${visible.length} row${visible.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setClientPage(1);
              }}
              placeholder="Search this table…"
              className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900"
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!visible.length}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      {/* A capped list must never read as a complete one. */}
      {!pagedVisible.length ? (
        <p className="py-12 text-center text-sm text-gray-500">
          {search.trim() ? `Nothing in this table matches “${search.trim()}”.` : empty}
        </p>
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-t-xl border border-gray-100">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                {tableColumns.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-700">
                      {c.label}
                      <ArrowUpDown className={`h-3 w-3 ${sort.key === c.key ? 'text-gray-700' : 'text-gray-300'}`} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedVisible.map((row, i) => (
                <tr
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetails(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetails(row);
                    }
                  }}
                  className="cursor-pointer outline-none transition-colors hover:bg-blue-50/60 focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  aria-label={`View details for row ${i + 1} in ${title}`}
                >
                  {tableColumns.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-4 py-3.5 ${c.align === 'right' ? `text-right tabular-nums font-medium ${c.type === 'currency' ? financialToneClass({ label: c.label, value: row[c.key], tone: c.tone }) : 'text-gray-900'}` : 'text-gray-600'}`}>
                      {c.type === 'badge' || c.type === 'status'
                        ? <Badge value={row[c.key]} />
                        : formatValue(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totalColumns.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-gray-300 bg-gray-100 shadow-[0_-5px_12px_rgba(15,23,42,0.08)]">
                <tr className="text-sm">
                  {tableColumns.map((column, index) => (
                    <td key={column.key} className={`whitespace-nowrap px-4 py-3 font-bold ${column.align === 'right' ? 'text-right tabular-nums text-gray-950' : 'text-gray-950'}`}>
                      {index === totalLabelIndex
                        ? (
                          <span className="inline-flex flex-wrap items-baseline gap-x-8 gap-y-1">
                            <span>TOTAL</span>
                            {showPaymentSplit && paymentSplit ? (
                              <>
                                <span className="tabular-nums">Cash&nbsp;&nbsp;{formatValue(paymentSplit.cash, 'currency')}</span>
                                <span className="tabular-nums">Online&nbsp;&nbsp;{formatValue(paymentSplit.digital, 'currency')}</span>
                                <span className="tabular-nums">Funding&nbsp;&nbsp;{formatValue(paymentSplit.funding, 'currency')}</span>
                                <span className="tabular-nums">Credit&nbsp;&nbsp;{formatValue(paymentSplit.credit, 'currency')}</span>
                              </>
                            ) : null}
                          </span>
                          )
                        : totalKeys.has(column.key)
                          ? formatValue(footerTotals[column.key], column.type)
                          : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {tablePagination && (
        <PaginationControls
          pagination={tablePagination}
          loading={pageLoading}
          onPageChange={(page) => {
            if (usesServerPaging) onPageChange?.(page);
            else setClientPage(page);
          }}
          onPageSizeChange={(pageSize) => {
            if (usesServerPaging) onPageSizeChange?.(pageSize);
            else {
              setClientPageSize(pageSize);
              setClientPage(1);
            }
          }}
        />
      )}
      {detailRow && createPortal(
        <RecordDetailsModal
          tableTitle={title}
          columns={columns}
          row={detailRow}
          detail={detailData}
          loading={detailLoading}
          error={detailError}
          onClose={() => setDetailRow(null)}
          onEntityClick={(link) => {
            const handled = onEntityClick?.(link);
            if (handled) setDetailRow(null);
            return handled;
          }}
        />,
        document.body
      )}
    </div>
  );
}

export function RecordDetailsModal({ tableTitle, columns, row, detail, loading, error, onClose, onEntityClick }) {
  const [kotPopupId, setKotPopupId] = useState(null);
  const [nestedDetail, setNestedDetail] = useState(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedError, setNestedError] = useState(null);
  const headingId = `record-details-${String(tableTitle).replace(/[^a-z0-9_-]/gi, '-')}`;
  const primaryColumn = columns[0];
  const primaryValue = primaryColumn ? formatValue(row[primaryColumn.key], primaryColumn.type) : null;
  const shownDetail = nestedDetail || detail;
  const shownLoading = nestedLoading || loading;
  const shownError = nestedError || error;
  const title = shownDetail?.title || 'Record details';
  const subtitle = shownDetail?.subtitle || (primaryValue != null ? `${primaryColumn.label}: ${primaryValue}` : null);
  const accent = statusAccentClass(shownDetail?.status);

  const openLinkedEntity = async (link) => {
    if (!link?.type || link.id == null) return;
    if (onEntityClick?.(link)) return;
    const request = {
      bill: { tab: 'sales', tableId: 'transactions', row: { _bill_id: link.id } },
      order: { tab: 'orders', tableId: 'orders', row: { _order_id: link.id } },
      purchase: { tab: 'purchases', tableId: 'purchases', row: { _record_id: link.id } },
      expense: { tab: 'expenses', tableId: 'ledger', row: { _record_id: link.id } },
    }[link.type];
    if (!request) return;
    setNestedLoading(true);
    setNestedError(null);
    try {
      const response = await fetch('/api/admin/reports/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The linked record could not be loaded.');
      setNestedDetail(body.detail);
    } catch (linkedError) {
      setNestedError(linkedError.message || 'The linked record could not be loaded.');
    } finally {
      setNestedLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/55 p-3 backdrop-blur-[2px] animate-in fade-in duration-150 motion-reduce:animate-none sm:p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200 ease-out motion-reduce:animate-none"
      >
        <header className={`flex shrink-0 items-start justify-between gap-4 border-b border-l-4 border-gray-200 px-5 py-4 sm:px-6 ${accent}`}>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">{shownDetail?.eyebrow || tableTitle}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-xl font-bold text-gray-950 sm:text-2xl">{title}</h2>
              {shownDetail?.status && <Badge value={String(shownDetail.status).replace(/_/g, ' ')} />}
            </div>
            {subtitle && <p className="mt-1 truncate text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-[color,background-color,transform] duration-150 ease-out hover:bg-gray-100 hover:text-gray-950 active:scale-[0.96]"
            aria-label="Close details"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/70">
          {shownLoading ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <LoaderCircle className="h-6 w-6 animate-spin text-gray-400 motion-reduce:animate-none" />
              <p className="mt-3 text-sm font-medium text-gray-700">Loading linked items, payments and activity…</p>
            </div>
          ) : shownError ? (
            <div className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 sm:m-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Full details could not be loaded</p><p className="mt-0.5">{shownError}</p></div>
            </div>
          ) : shownDetail ? (
            <div className="space-y-5 p-4 sm:p-6">
              {shownDetail.summary?.length > 0 && (
                <dl className="grid overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
                  {shownDetail.summary.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="min-w-0 border-b border-gray-100 px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</dt>
                      <dd
                        className={`mt-1 truncate text-sm font-semibold tabular-nums ${item.format === 'currency' ? financialToneClass({ label: item.label, value: item.value }) : 'text-gray-950'}`}
                        title={String(item.value ?? '')}
                      >
                        {detailValue(item.value, item.format)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {(shownDetail.sections || []).map((section, index) => (
                section.type === 'table'
                  ? <RecordDetailTable key={`${section.title}-${index}`} section={section} onKotClick={setKotPopupId} onEntityClick={openLinkedEntity} />
                  : <RecordDetailFields key={`${section.title}-${index}`} section={section} onKotClick={setKotPopupId} onEntityClick={openLinkedEntity} />
              ))}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 bg-white px-5 py-3 sm:px-6">
          <p className="text-xs text-gray-500">Press Escape or click outside to close.</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-gray-800 active:scale-[0.97]">Close</button>
        </footer>
      </section>
      {kotPopupId && <KotPopup kotId={kotPopupId} onClose={() => setKotPopupId(null)} />}
    </div>
  );
}

const NEGATIVE_STATUS = /\b(cancel+ed|void(?:ed)?|no_show|refund(?:ed)?|failed|out of stock)\b/i;
const POSITIVE_STATUS = /\b(paid|completed|ok|available|confirmed)\b/i;
/** Left-border accent on a detail modal's header, so a cancelled/voided record reads as trouble at a glance instead of looking identical to a normal one. */
function statusAccentClass(status) {
  const text = String(status || '');
  if (NEGATIVE_STATUS.test(text)) return 'border-l-red-400 bg-red-50/40';
  if (POSITIVE_STATUS.test(text)) return 'border-l-emerald-400 bg-emerald-50/30';
  return 'border-l-gray-200';
}

function detailValue(value, format) {
  if (format === 'datetime') return formatNepalDateTime(value);
  return formatValue(value, format === 'text' ? undefined : format);
}

function RecordDetailFields({ section, onKotClick, onEntityClick }) {
  const pathname = usePathname();
  const cashier = pathname?.startsWith('/cashier');
  if (!section.items?.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
        <ReceiptText className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-950">{section.title}</h3>
      </div>
      <dl className="divide-y divide-gray-100 px-4 sm:px-5">
        {section.items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5">
            <dt className="text-xs font-medium text-gray-500">{item.label}</dt>
            <dd className={`break-words text-sm ${['currency', 'number', 'percent'].includes(item.format) ? 'font-semibold tabular-nums text-gray-950' : 'text-gray-700'}`}>
              {item.link ? <RecordEntityLink link={item.link} cashier={cashier} onKotClick={onKotClick} onEntityClick={onEntityClick}>{detailValue(item.value, item.format)}</RecordEntityLink> : detailValue(item.value, item.format)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RecordDetailTable({ section, onKotClick, onEntityClick }) {
  const pathname = usePathname();
  const cashier = pathname?.startsWith('/cashier');
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-gray-400" /><h3 className="text-sm font-semibold text-gray-950">{section.title}</h3></div>
        <span className="text-xs tabular-nums text-gray-400">{section.rows?.length || 0} {section.rows?.length === 1 ? 'record' : 'records'}</span>
      </div>
      {!section.rows?.length ? <p className="px-5 py-8 text-center text-sm text-gray-500">{section.empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[11px] uppercase tracking-wide text-gray-400">
              {section.columns.map((column) => <th key={column.key} className={`whitespace-nowrap px-4 py-2.5 font-semibold ${column.align === 'right' ? 'text-right' : ''}`}>{column.label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {section.rows.map((record, rowIndex) => <tr key={record.id || `${section.title}-${rowIndex}`} className="align-top">
                {section.columns.map((column) => <td key={column.key} className={`px-4 py-3 ${column.align === 'right' ? 'text-right font-medium tabular-nums text-gray-950' : 'text-gray-600'}`}>
                  {column.format === 'status' ? <Badge value={String(record[column.key] || '—').replace(/_/g, ' ')} /> : record._links?.[column.key] ? <RecordEntityLink link={record._links[column.key]} cashier={cashier} onKotClick={onKotClick} onEntityClick={onEntityClick}>{detailValue(record[column.key], column.format)}</RecordEntityLink> : detailValue(record[column.key], column.format)}
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function recordEntityHref(link, cashier) {
  const root = cashier ? '/cashier' : '/admin';
  const id = encodeURIComponent(String(link.id ?? ''));
  switch (link.type) {
    case 'order': return `${root}/orders/${id}`;
    case 'bill': return `${root}/bills?bill=${id}`;
    case 'kot': return `${cashier ? '/cashier/kots' : '/admin/kot'}?kot=${id}${link.label ? `&search=${encodeURIComponent(link.label)}` : ''}`;
    case 'purchase': return `${root}/purchases?purchase=${id}`;
    case 'expense': return `${root}/expenses?expense=${id}`;
    case 'wastage': return `${root}/wastage?wastage=${id}`;
    case 'customer': return `${root}/customers/${id}`;
    case 'inventory': return `${root}/inventory/${id}`;
    case 'reservation': return `${root}/reservations?reservation=${id}`;
    case 'employee': return `${root}/employees?employee=${id}`;
    case 'table': return `${root}/table-management?table=${id}`;
    case 'supplier': return `${root}/suppliers?supplier=${id}`;
    case 'menu': return `${cashier ? '/cashier/menu-items' : '/admin/products'}?item=${id}`;
    default: return null;
  }
}

function RecordEntityLink({ link, cashier, children, onKotClick, onEntityClick }) {
  // A KOT opens in place — no reason to leave the record you're already
  // reading just to glance at a kitchen ticket.
  if (link.type === 'kot' && onKotClick) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onKotClick(link.id); }}
        className="inline-flex rounded-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 transition-[color,transform] duration-150 ease-out hover:text-blue-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        {children}
      </button>
    );
  }
  if (onEntityClick && ['bill', 'order', 'purchase', 'expense'].includes(link.type)) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onEntityClick(link); }}
        className="inline-flex rounded-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 transition-[color,transform] duration-150 ease-out hover:text-blue-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        {children}
      </button>
    );
  }
  const href = recordEntityHref(link, cashier);
  if (!href) return children;
  return <Link href={href} className="inline-flex rounded-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 transition-[color,transform] duration-150 ease-out hover:text-blue-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{children}</Link>;
}

export function ChartGrid({ children }) {
  return <div className="grid min-w-0 gap-5 lg:grid-cols-2 [&>*]:min-w-0">{children}</div>;
}
