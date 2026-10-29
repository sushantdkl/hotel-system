'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Minus, RefreshCw, Send, CreditCard, X, ChefHat, Printer, Ban, Receipt, Users, ArrowLeftRight, QrCode,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { useConfirm } from '@/components/ui/confirm'
import { formatElapsed } from '@/lib/restaurant-status'
import { formatNepalClock } from '@/lib/time-utils'
import { printKot, printProforma } from '@/lib/pos-print.js'
import { tableBoardState, computeTableStatusCounts, DashboardTableCard } from '@/components/tables/table-room-board'
import PayQrModal from '@/components/waiter/pay-qr-modal'
import QtyInput from '@/components/ui/qty-input'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const ORDER_STATUS_LABEL = {
  pending: { label: 'Pending', badge: 'bg-slate-100 text-slate-700' },
  preparing: { label: 'Preparing', badge: 'bg-orange-100 text-orange-800' },
  awaiting_payment: { label: 'Awaiting payment', badge: 'bg-amber-100 text-amber-900' },
  completed: { label: 'Completed', badge: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', badge: 'bg-red-100 text-red-700' },
}

function CancelSentItemModal({ item, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [prepared, setPrepared] = useState(false)
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-slate-900">Cancel sent item</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          {item.quantity}× <strong>{item.item_name}</strong> was already sent to the kitchen. This writes a cancellation ticket.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Reason (required)"
          className="w-full rounded-xl border border-slate-300 p-2.5 text-sm mb-3 focus:border-slate-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700 mb-4">
          <input type="checkbox" checked={prepared} onChange={(e) => setPrepared(e.target.checked)} className="h-4 w-4" />
          Already prepared (wastage — stock stays consumed)
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 px-4 rounded-xl bg-slate-100 font-semibold text-slate-800">
            Keep
          </button>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim(), prepared)}
            className="h-10 px-4 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50"
          >
            Cancel item
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WaiterOrderPage() {
  const { apiCall, loading: authLoading, token } = useAuth()
  const router = useRouter()
  const params = useParams()
  const orderId = params.id
  const { addToast } = useToast()
  const { prompt, confirm } = useConfirm()

  const [workspace, setWorkspace] = useState(null)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmBill, setConfirmBill] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelSentItem, setCancelSentItem] = useState(null)
  const [showPayQr, setShowPayQr] = useState(false)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [pickerTables, setPickerTables] = useState([])
  const [pickerStatusFilter, setPickerStatusFilter] = useState('all')
  const [loadingTables, setLoadingTables] = useState(false)

  const load = async () => {
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setWorkspace(data.workspace)
      } else {
        addToast(friendlyFromError(data, 'load_failed'))
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'load_failed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    const hasToken = token || (typeof window !== 'undefined' && localStorage.getItem('pos_token'))
    if (!hasToken) {
      router.push('/login')
      return
    }
    load()
    apiCall('/api/admin/settings').then((r) => r.json()).then((d) => setSettings(d.settings || {})).catch(() => {})
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [orderId, authLoading, token])

  const paperSize = settings.receipt_paper_size || settings.kot_paper_size || '80'
  const autoPrintKot = String(settings.kitchen_printing_enabled ?? 'false') === 'true'

  const sendKot = async () => {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}/kot`, {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: uid() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send KOT')
      if (data.kot && autoPrintKot) printKot(data.kot, { size: paperSize, settings })
      addToast(friendlyMessage('save_success', { description: `${data.kot?.kot_number || 'KOT'} sent to kitchen.` }))
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const reprintKotTicket = async (kot) => {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/kots/${kot.kot_id || kot.id}/reprint`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not reprint')
      printKot(data.kot, { size: paperSize, reprint: true, settings })
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelWholeKot = async (kot) => {
    const reason = await prompt({
      title: 'Cancel this KOT',
      message: 'Enter a reason to cancel this kitchen ticket.',
      label: 'Cancel reason',
      required: true,
      multiline: true,
      tone: 'danger',
    })
    if (!reason || !String(reason).trim()) return
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/kots/${kot.kot_id || kot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not cancel KOT')
      addToast(friendlyMessage('save_success', { description: 'KOT cancelled.' }))
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const removeUnsentItem = async (item) => {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}/items?order_item_id=${item.order_item_id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not remove item')
      addToast(friendlyMessage('save_success', { description: 'Item removed.' }))
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const changeReopenedQuantity = async (item, delta) => {
    const quantity = Number(item.quantity || 0) + delta
    if (quantity <= 0) return removeUnsentItem(item)
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ order_item_id: item.order_item_id, quantity }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update item')
      setWorkspace(data.workspace)
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCancelSentItem = async (reason, prepared) => {
    if (!cancelSentItem) return
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}/cancel-item`, {
        method: 'POST',
        body: JSON.stringify({ order_item_id: cancelSentItem.order_item_id, reason, prepared }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not cancel item')
      if (data.cancellation_kot && autoPrintKot) printKot(data.cancellation_kot, { size: paperSize, settings })
      addToast(friendlyMessage('save_success', { description: 'Item cancelled.' }))
      setCancelSentItem(null)
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const requestBill = async () => {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}/bill`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not request bill')
      if (data.proforma) printProforma(data.proforma, { size: paperSize, settings })
      addToast(friendlyMessage('save_success', { description: 'Bill sent to cashier.' }))
      setConfirmBill(false)
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const openTablePicker = async () => {
    setShowTablePicker(true)
    setPickerStatusFilter('all')
    setLoadingTables(true)
    try {
      // Full board, not just free tables — an occupied table is a valid target
      // too (adds this order as another party there, same as "Add person").
      const res = await apiCall('/api/admin/pos/tables')
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const currentTableId = workspace?.order?.table_id
        setPickerTables((data.tables || []).filter((t) => t.id !== currentTableId))
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTables(false)
    }
  }

  const changeTable = async (table) => {
    if (busy) return
    const state = tableBoardState(table)
    const patch = { table_id: table.id }
    if (state !== 'available') {
      const ok = await confirm({
        title: `Table ${table.table_number} is already occupied`,
        message: `This adds ${workspace?.order?.table_number ? `Table ${workspace.order.table_number}` : 'this order'} as another party on Table ${table.table_number}, alongside the ${table.party_count} already seated. It won't merge with their order.`,
        confirmLabel: 'Move here',
        cancelLabel: 'Cancel',
        tone: 'default',
      })
      if (!ok) return
      patch.party_label = `Party ${table.party_count + 1}`
    }
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not change table')
      addToast(friendlyMessage('save_success', { description: `Moved to table ${table.table_number}.` }))
      setShowTablePicker(false)
      await load()
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const addNewParty = async () => {
    if (!workspace?.order?.table_id) return
    setBusy(true)
    try {
      const res = await apiCall('/api/admin/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ table_id: workspace.order.table_id, new_party: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start a new party')
      addToast(friendlyMessage('save_success', { description: 'New party started.' }))
      router.push(`/waiter/order/${data.order_id}`)
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async () => {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/orders/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', reason: 'Empty order released by waiter' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not cancel order')
      addToast(friendlyMessage('order_cancelled'))
      setConfirmCancel(false)
      router.push('/waiter')
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading || !workspace) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">
        Loading order…
      </div>
    )
  }

  const { order, items, kots, bill, unsent_count: unsentCount } = workspace
  const isReopened = Boolean(workspace.reopened)
  const status = String(order.status || 'pending')
  const statusUi = ORDER_STATUS_LABEL[status] || ORDER_STATUS_LABEL.pending
  const activeItems = items.filter((i) => !['voided', 'cancelled'].includes(i.status))
  const activeCount = activeItems.length
  const total = activeItems.reduce((s, i) => s + Number(i.subtotal ?? i.price * i.quantity), 0)
  const allowAdd = !['completed', 'cancelled'].includes(status)
  const allowRequestBill = allowAdd && unsentCount === 0 && activeCount > 0 && status !== 'awaiting_payment'
  const canCancelEmpty = !['completed', 'cancelled'].includes(status) && activeCount === 0
  const activeKots = (kots || []).filter((k) => !k.voided && k.kot_type !== 'cancellation')

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(12rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => router.push('/waiter')} aria-label="Back to floor" className="h-10 w-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">
              {order.table_number ? `Table ${order.table_number}` : 'Takeaway'}
              {order.party_label ? ` · ${order.party_label}` : ''}
            </h1>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusUi.badge}`}>{statusUi.label}</span>
              <p className="text-xs text-slate-500 truncate">
                {order.order_number} · {formatElapsed(order.created_at)} · {formatNepalClock(order.created_at)}
              </p>
            </div>
          </div>
          {order.table_id && allowAdd && (
            <button type="button" onClick={openTablePicker} className="h-10 w-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center" title="Change table" aria-label="Change table">
              <ArrowLeftRight className="w-4 h-4 text-slate-700" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPayQr(true)}
            aria-label="Show payment QR"
            className="h-10 w-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center"
            title="Show payment QR"
          >
            <QrCode className="w-4 h-4" />
          </button>
          <button type="button" onClick={load} aria-label="Refresh" className="h-10 w-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-slate-700" />
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        {isReopened && (
          <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 shadow-sm">
            <p className="font-bold text-violet-950">Reopened bill — revision in progress</p>
            <p className="mt-1 text-sm text-violet-800">
              Adjust old items or add new ones. Send every new quantity to the kitchen, then send the revised bill to the cashier.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
              <span className="rounded-full bg-white px-2.5 py-1 text-violet-700">1. Edit items</span>
              <span className={`rounded-full px-2.5 py-1 ${unsentCount > 0 ? 'bg-blue-600 text-white' : 'bg-white text-emerald-700'}`}>2. Send new KOT</span>
              <span className="rounded-full bg-white px-2.5 py-1 text-violet-700">3. Cashier settles difference</span>
            </div>
          </div>
        )}
        {unsentCount > 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-blue-900">{unsentCount} item(s) not sent yet</p>
              <p className="text-sm text-blue-800 mt-0.5">Kitchen hasn&apos;t seen these — send a KOT.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={sendKot}
              className="h-10 px-4 rounded-xl bg-blue-600 text-white font-semibold flex items-center gap-2 shrink-0 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Send KOT
            </button>
          </div>
        )}

        {status === 'awaiting_payment' && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold text-amber-900">Sent to cashier</p>
            <p className="text-sm text-amber-800 mt-1">Adding an item will pull this back into ordering automatically.</p>
          </div>
        )}

        {canCancelEmpty && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-900">Empty order</p>
            <p className="text-sm text-red-800 mt-1">No items yet. Cancel to free the table if guests left.</p>
          </div>
        )}

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between">
            <h2 className="font-semibold text-slate-900">Order items</h2>
            <span className="text-sm text-slate-500">{activeCount} lines</span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const voided = ['voided', 'cancelled'].includes(item.status)
              const sentQty = Number(item.sent_quantity || 0)
              const unsentQty = Number(item.unsent_quantity || 0)
              return (
                <div key={item.order_item_id} className={`px-4 py-3 flex gap-3 ${voided ? 'bg-red-50 text-red-800' : ''}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${voided ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                    {item.quantity}×
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${voided ? 'line-through text-red-800' : 'text-slate-900'}`}>{item.item_name}</p>
                    {item.special_instructions && (
                      <p className={`text-xs mt-0.5 ${voided ? 'text-red-700' : 'text-amber-700'}`}>Note: {item.special_instructions}</p>
                    )}
                    {!voided && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {sentQty > 0 ? `${sentQty} sent` : 'unsent'}
                        {unsentQty > 0 ? ` · ${unsentQty} unsent` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="font-semibold text-slate-900 text-sm">
                      Rs {Number(item.subtotal ?? item.price * item.quantity).toFixed(0)}
                    </p>
                    {!voided && allowAdd && isReopened && (
                      <div className="flex items-center gap-1">
                        <button type="button" disabled={busy} onClick={() => changeReopenedQuantity(item, -1)} className="h-7 w-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center" aria-label={`Remove one ${item.item_name}`}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <QtyInput value={item.quantity} disabled={busy} onCommit={(q) => changeReopenedQuantity(item, q - Number(item.quantity || 0))} className="w-9 h-7 text-xs" />
                        <button type="button" disabled={busy} onClick={() => changeReopenedQuantity(item, 1)} className="h-7 w-7 rounded-lg bg-violet-600 text-white flex items-center justify-center" aria-label={`Add one ${item.item_name}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {!voided && allowAdd && !isReopened && unsentQty > 0 && sentQty === 0 && (
                      <button type="button" disabled={busy} onClick={() => removeUnsentItem(item)} className="text-[11px] font-semibold text-red-600">
                        Remove
                      </button>
                    )}
                    {!voided && allowAdd && !isReopened && sentQty > 0 && (
                      <button type="button" disabled={busy} onClick={() => setCancelSentItem(item)} className="text-[11px] font-semibold text-red-600">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {items.length === 0 && <p className="px-4 py-10 text-center text-slate-500">No items yet</p>}
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">Running total</span>
            <span className="text-xl font-bold text-slate-900">Rs {total.toFixed(0)}</span>
          </div>
        </div>

        {activeKots.length > 0 && (
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <ChefHat className="w-4 h-4" />
                Kitchen tickets
              </h2>
              <button type="button" onClick={() => router.push('/waiter/kots')} className="text-xs font-semibold text-slate-500">
                Full history →
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {activeKots.map((kot) => (
                <div key={kot.kot_id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{kot.kot_number}</p>
                    <p className="text-xs text-slate-500 capitalize">
                      {kot.kot_type} · {kot.status}{kot.reprint_count > 0 ? ` · reprinted ${kot.reprint_count}×` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" disabled={busy} onClick={() => reprintKotTicket(kot)} className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center" title="Reprint">
                      <Printer className="w-4 h-4 text-slate-700" />
                    </button>
                    {['pending', 'preparing'].includes(kot.status) && (
                      <button type="button" disabled={busy} onClick={() => cancelWholeKot(kot)} className="h-9 w-9 rounded-lg bg-red-50 flex items-center justify-center" title="Cancel KOT">
                        <Ban className="w-4 h-4 text-red-600" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {bill && (
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Bill {bill.bill_number}</p>
              <p className="text-xs text-slate-500 capitalize">{bill.status} · Rs {Number(bill.grand_total || 0).toFixed(0)}</p>
            </div>
            <button type="button" onClick={() => router.push('/waiter/bills')} className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <Receipt className="w-4 h-4" />
              Bills
            </button>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-slate-200">
        <div className="max-w-3xl mx-auto space-y-2">
          {allowAdd && (
            <div className={`grid gap-2 ${order.table_id ? 'grid-cols-3' : 'grid-cols-1'}`}>
              <button
                type="button"
                onClick={() => router.push(`/waiter/new-order?order=${orderId}`)}
                className="col-span-2 h-12 rounded-2xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Add more items
              </button>
              {order.table_id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={addNewParty}
                  className="h-12 rounded-2xl border-2 border-violet-200 bg-white text-violet-700 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  title="Start a new party on this table"
                >
                  <Users className="w-4 h-4" />
                  <span className="text-sm">Add person</span>
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {allowRequestBill && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmBill(true)}
                className="col-span-2 h-12 rounded-2xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CreditCard className="w-5 h-5" />
                {isReopened ? 'Send Revised Bill to Cashier' : 'Request Bill'}
              </button>
            )}
            {canCancelEmpty && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
                className="col-span-2 h-11 rounded-2xl border border-red-200 bg-red-50 text-red-700 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Cancel empty order / release table
              </button>
            )}
            {unsentCount === 0 && activeCount > 0 && status !== 'awaiting_payment' && (
              <p className="col-span-2 text-center text-sm text-slate-500 py-1 flex items-center justify-center gap-2">
                <ChefHat className="w-4 h-4" />
                Kitchen has this order
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmBill}
        title={isReopened ? 'Send revised bill to cashier?' : 'Send to cashier?'}
        description={isReopened
          ? 'The cashier will see the revised total and collect or refund only the difference from the original payment.'
          : "Table moves to Awaiting Payment. Guests can't order more until checkout — adding an item will pull it back automatically."}
        confirmLabel="Confirm"
        cancelLabel="Back"
        variant="warning"
        busy={busy}
        onConfirm={requestBill}
        onCancel={() => setConfirmBill(false)}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel empty order?"
        description="This frees the table. Waiters can only cancel orders with no items — anything with items needs a cashier or admin."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        variant="danger"
        busy={busy}
        onConfirm={cancelOrder}
        onCancel={() => setConfirmCancel(false)}
      />

      {cancelSentItem && (
        <CancelSentItemModal
          item={cancelSentItem}
          busy={busy}
          onClose={() => setCancelSentItem(null)}
          onConfirm={confirmCancelSentItem}
        />
      )}

      {/*
        * Read-only payment QR: the same codes the admin uploaded in Settings,
        * shown big enough to scan across a table. It records NOTHING — the
        * cashier still settles the bill and verifies the transfer afterwards.
        *
        * The amount above the code is the bill's grand total once a bill
        * exists, and the running item total before that. A static merchant QR
        * carries no amount, so the guest types it in — which is exactly why it
        * has to be readable at a glance.
        */}
      <PayQrModal
        open={showPayQr}
        onClose={() => setShowPayQr(false)}
        codes={(settings.bank_qr_image || settings.esewa_qr_image)
          ? [{ key: 'online', label: 'Online', image: settings.bank_qr_image || settings.esewa_qr_image, payload: settings.payment_qr_payload }]
          : []}
        restaurantName={settings.restaurant_name || ''}
        amountDue={bill ? Number(bill.grand_total || 0) : total}
      />

      {showTablePicker && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900">Move to another table</h3>
                <p className="text-xs text-slate-500 mt-0.5">Occupied tables work too — it adds this as another party.</p>
              </div>
              <button type="button" onClick={() => setShowTablePicker(false)} className="p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            {!loadingTables && pickerTables.length > 0 && (() => {
              const counts = computeTableStatusCounts(pickerTables)
              return (
                <div className="px-4 pt-3 flex flex-wrap gap-2">
                  {[
                    ['all', 'All', pickerTables.length, 'bg-slate-700'],
                    ['available', 'Available', counts.available, 'bg-emerald-600'],
                    ['running', 'Running', counts.running, 'bg-blue-600'],
                    ['reserved', 'Reserved', counts.reserved, 'bg-red-600'],
                  ].map(([id, label, count, color]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPickerStatusFilter(id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold text-white transition-[filter,opacity] ${color} ${
                        pickerStatusFilter === id ? 'ring-2 ring-slate-900 ring-offset-1' : 'opacity-50 hover:opacity-75'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  ))}
                </div>
              )
            })()}
            <div className="p-3 sm:p-4 overflow-y-auto">
              {loadingTables ? (
                <p className="py-10 text-center text-slate-500">Loading tables…</p>
              ) : pickerTables.length === 0 ? (
                <p className="py-10 text-center text-slate-500">No other tables to move to.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {pickerTables
                    .filter((t) => pickerStatusFilter === 'all' || tableBoardState(t) === pickerStatusFilter)
                    .map((table) => (
                      <DashboardTableCard key={table.id} table={table} onClick={() => changeTable(table)} />
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
