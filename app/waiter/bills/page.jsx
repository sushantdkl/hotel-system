'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Search, Printer, Receipt, ChevronRight, QrCode } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { friendlyFromError } from '@/lib/friendly-message'
import { formatNepalDateTime } from '@/lib/report-dates.js'
import { SittingTime } from '@/components/tables/table-open-duration.jsx'
import { printFinalBill } from '@/lib/pos-print.js'
import { receiptFromBillDetail } from '@/lib/bill-receipt.js'
import OperationalDateFilter from '@/components/ui/operational-date-filter'
import PayQrModal from '@/components/waiter/pay-qr-modal'
import { operationalDateRange } from '@/lib/operational-date-range'

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
]

const CHANNELS = [
  { id: 'all', label: 'All' },
  { id: 'counter', label: 'Table' },
  { id: 'takeaway', label: 'Takeaway' },
  { id: 'online', label: 'Online' },
]

const CHANNEL_LABEL = { online: 'Online', takeaway: 'Takeaway', counter: 'Dine-in' }

export default function WaiterBillsPage() {
  const { apiCall } = useAuth()
  const router = useRouter()
  const { addToast } = useToast()

  const [tab, setTab] = useState('active')
  const [channel, setChannel] = useState('all')
  const [search, setSearch] = useState('')
  const [bills, setBills] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [settings, setSettings] = useState({})
  const [datePreset, setDatePreset] = useState('today')
  // Bill whose QR is on screen. Read-only: showing it records no payment.
  const [qrBill, setQrBill] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tab, search, pageSize: '50' })
      if (channel !== 'all') params.set('channel', channel)
      if (!['active', 'pending'].includes(tab)) {
        const range = operationalDateRange(datePreset)
        if (range.from) params.set('from', range.from)
        if (range.to) params.set('to', range.to)
      }
      const res = await apiCall(`/api/admin/bills?${params}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBills(data.bills || [])
        setCounts(data.counts || {})
      } else {
        addToast(friendlyFromError(data, 'load_failed'))
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'load_failed'))
    } finally {
      setLoading(false)
    }
  }, [tab, channel, search, datePreset, apiCall, addToast])

  useEffect(() => {
    apiCall('/api/admin/settings').then((r) => r.json()).then((d) => setSettings(d.settings || {})).catch(() => {})
  }, [apiCall])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  const printBill = async (bill) => {
    setBusyId(bill.id)
    try {
      const res = await apiCall(`/api/admin/bills/${bill.id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load bill')
      const receipt = receiptFromBillDetail(data.bill, settings)
      printFinalBill(receipt, { size: settings.receipt_paper_size || '80', reprint: true, settings })
      await apiCall(`/api/admin/bills/${bill.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reprint', kind: 'final' }),
      })
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
          <button type="button" onClick={() => router.push('/waiter')} className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Bills
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
        <div className="max-w-3xl mx-auto px-4 flex gap-2 pb-2 overflow-x-auto">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChannel(c.id)}
              className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold border ${
                channel === c.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {!['active', 'pending'].includes(tab) && (
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
              placeholder="Search bill #, order #, table…"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-sm"
            />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
        {loading ? (
          <p className="py-16 text-center text-slate-500">Loading…</p>
        ) : bills.length === 0 ? (
          <p className="py-16 text-center text-slate-500">No bills</p>
        ) : (
          bills.map((bill) => (
            <div key={bill.id} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3.5 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={!bill.orderId}
                onClick={() => bill.orderId && router.push(`/waiter/order/${bill.orderId}`)}
                className="flex-1 min-w-0 text-left flex items-center gap-2 disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                    {bill.billNumber || bill.orderNumber}
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      bill.channel === 'takeaway' ? 'bg-amber-100 text-amber-800' : bill.channel === 'online' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'
                    }`}>
                      {bill.tableNumber ? `Table ${bill.tableNumber}` : CHANNEL_LABEL[bill.channel] || 'Takeaway'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">
                    {bill.paymentStatus} · Rs {Number(bill.total || 0).toFixed(0)}
                    {bill.balance > 0 ? ` · Rs ${Number(bill.balance).toFixed(0)} due` : ''}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formatNepalDateTime(bill.createdAt)}
                    {bill.tableNumber ? (
                      <>
                        {' · '}
                        <SittingTime
                          openedAt={bill.openedAt || bill.createdAt}
                          closedAt={bill.paidAt}
                          status={bill.orderStatus || bill.billStatus}
                          dineIn
                        />
                      </>
                    ) : null}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => setQrBill(bill)}
                className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"
                title="Show payment QR"
                aria-label="Show payment QR"
              >
                <QrCode className="w-4 h-4 text-emerald-700" />
              </button>
              <button
                type="button"
                disabled={busyId === bill.id}
                onClick={() => printBill(bill)}
                className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 disabled:opacity-50"
                title="Print"
              >
                <Printer className="w-4 h-4 text-slate-700" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Here the outstanding balance IS known, so the amount shows large above
          the code — the one thing a printed placard at the counter cannot do. */}
      <PayQrModal
        open={Boolean(qrBill)}
        onClose={() => setQrBill(null)}
        codes={(settings.bank_qr_image || settings.esewa_qr_image)
          ? [{ key: 'online', label: 'Online', image: settings.bank_qr_image || settings.esewa_qr_image, payload: settings.payment_qr_payload }]
          : []}
        restaurantName={settings.restaurant_name || ''}
        amountDue={qrBill ? Number(qrBill.balance ?? qrBill.total ?? 0) : null}
      />
    </div>
  )
}
