'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, Search, Printer, ChefHat } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { friendlyFromError } from '@/lib/friendly-message'
import { formatNepalDateTime } from '@/lib/report-dates.js'
import { printKot } from '@/lib/pos-print.js'
import OperationalDateFilter from '@/components/ui/operational-date-filter'
import { operationalDateRange } from '@/lib/operational-date-range'
import { orderTypeLabel } from '@/lib/order-types.js'

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
]

export default function WaiterKotsPage() {
  const { apiCall } = useAuth()
  const router = useRouter()
  const isKitchen = usePathname()?.startsWith('/kitchen')
  const homePath = isKitchen ? '/kitchen' : '/waiter'
  const { addToast } = useToast()

  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [kots, setKots] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [paperSize, setPaperSize] = useState('80')
  const [printSettings, setPrintSettings] = useState({})
  const [datePreset, setDatePreset] = useState('today')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tab, search, pageSize: '50' })
      if (tab !== 'active') {
        const range = operationalDateRange(datePreset)
        if (range.from) params.set('from', range.from)
        if (range.to) params.set('to', range.to)
      }
      const res = await apiCall(`/api/admin/kots?${params}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setKots(data.kots || [])
        setCounts(data.counts || {})
      } else {
        addToast(friendlyFromError(data, 'load_failed'))
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'load_failed'))
    } finally {
      setLoading(false)
    }
  }, [tab, search, datePreset, apiCall, addToast])

  useEffect(() => {
    apiCall('/api/admin/settings').then((r) => r.json()).then((d) => {
      setPaperSize(d.settings?.receipt_paper_size || d.settings?.kot_paper_size || '80')
      setPrintSettings(d.settings || {})
    }).catch(() => {})
  }, [apiCall])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  const reprint = async (kot) => {
    setBusyId(kot.kot_id)
    try {
      const res = await apiCall(`/api/admin/pos/kots/${kot.kot_id}/reprint`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not reprint')
      printKot(data.kot, { size: paperSize, reprint: true, settings: printSettings })
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => router.push(homePath)} className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ChefHat className="w-5 h-5" />
            Kitchen tickets
          </h1>
        </div>
        <div className="max-w-3xl mx-auto px-4 flex gap-2 pb-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 h-9 px-3 rounded-xl text-sm font-semibold ${tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {t.label}{counts[t.id] != null ? ` (${counts[t.id]})` : ''}
            </button>
          ))}
        </div>
        {tab !== 'active' && (
          <div className="max-w-3xl mx-auto px-4 pb-2">
            <OperationalDateFilter value={datePreset} onChange={setDatePreset} />
          </div>
        )}
        <div className="max-w-3xl mx-auto px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KOT #, order #, table…"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-sm"
            />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
        {loading ? (
          <p className="py-16 text-center text-slate-500">Loading…</p>
        ) : kots.length === 0 ? (
          <p className="py-16 text-center text-slate-500">No kitchen tickets</p>
        ) : (
          kots.map((kot) => (
            <div key={kot.kot_id} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3.5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => !isKitchen && router.push(`/waiter/order/${kot.order_id}`)} className={`flex-1 min-w-0 text-left ${isKitchen ? 'cursor-default' : ''}`}>
                <p className="text-sm font-semibold text-slate-900">
                  {/* Tickets now print their channel (K / K-TW / K-D), so the
                      line says the channel instead of "Table —" for the two
                      off-premise ones, which is what that used to read. */}
                  {kot.kot_number} · {kot.table_number ? `Table ${kot.table_number}` : orderTypeLabel(kot)}
                  {kot.party_label ? ` · ${kot.party_label}` : ''}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 capitalize">
                  {kot.kot_type} · {kot.status} · {kot.item_count} item(s), {kot.total_qty} qty
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {kot.order_number} · {formatNepalDateTime(kot.printed_at)}
                  {kot.reprint_count > 0 ? ` · reprinted ${kot.reprint_count}×` : ''}
                </p>
                {kot.cancel_reason && <p className="text-[11px] text-red-600 mt-0.5">Reason: {kot.cancel_reason}</p>}
              </button>
              <button
                type="button"
                disabled={busyId === kot.kot_id}
                onClick={() => reprint(kot)}
                className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 disabled:opacity-50"
                title="Reprint"
              >
                <Printer className="w-4 h-4 text-slate-700" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
