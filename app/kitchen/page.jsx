'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { ChefHat, Clock, CheckCircle, Flame, Maximize2, X, Trash, ClipboardList, BookOpen, Printer, Warehouse } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message'
import { formatElapsed, urgencyFromCreatedAt } from '@/lib/restaurant-status'
import { parseDbDate, formatNepalClock } from '@/lib/time-utils'
import MenuItemImage from '@/components/menu-item-image'
import LogoutButton from '@/components/ui/logout-button'
import WastageModal from '@/components/inventory/wastage-modal'
import WastageHistoryModal from '@/components/inventory/wastage-history-modal'
import { useStaffCapabilities } from '@/components/auth/staff-area-guard'

const ACTIVE = ['pending', 'preparing', 'ready']

function ticketBorder(urgency) {
  if (urgency === 'critical') return 'border-rose-500 ring-2 ring-rose-200'
  if (urgency === 'late') return 'border-orange-400'
  return 'border-slate-300'
}

// Status drives the ticket's header strip + pill, so cooks read state at a glance.
const STATUS_META = {
  pending: { label: 'NEW', pill: 'bg-blue-600 text-white', strip: 'bg-blue-50' },
  preparing: { label: 'COOKING', pill: 'bg-orange-500 text-white', strip: 'bg-orange-50' },
  ready: { label: 'READY', pill: 'bg-emerald-600 text-white', strip: 'bg-emerald-50' },
}
function statusMeta(status) {
  return STATUS_META[status] || { label: String(status || '').toUpperCase(), pill: 'bg-slate-600 text-white', strip: 'bg-slate-50' }
}

function TicketBody({ order, items, expanded = false }) {
  return (
    <>
      <div className={`flex-1 ${expanded ? 'p-5 space-y-3.5' : 'p-3 space-y-2'}`}>
        {items.map((item) => (
          <div
            key={item.item_id || item.id}
            className={`flex items-center ${expanded ? 'gap-3.5 py-1' : 'gap-2.5'}`}
          >
            <MenuItemImage
              src={item.image_url}
              alt={item.item_name}
              size={expanded ? 'md' : 'sm'}
              className="rounded-lg"
            />
            <span
              className={`rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center shrink-0 ${
                expanded ? 'min-w-11 h-11 text-sm' : 'min-w-8 h-8 text-xs'
              }`}
            >
              {item.quantity}×
            </span>
            <div className="flex-1 min-w-0">
              <p
                className={`font-semibold text-slate-900 ${
                  expanded ? 'text-lg' : 'text-sm truncate'
                }`}
              >
                {item.item_name}
              </p>
              {item.special_instructions && (
                <p
                  className={`text-amber-800 bg-amber-50 rounded-md px-1.5 py-0.5 mt-0.5 ${
                    expanded ? 'text-sm' : 'text-xs line-clamp-2'
                  }`}
                >
                  {item.special_instructions}
                </p>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-slate-400">Loading items…</p>
        )}
        {order.notes && (
          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-sm font-medium text-amber-900">
            Order note: {order.notes}
          </p>
        )}
        {expanded && order.customer_name && (
          <p className="text-sm text-slate-600 pt-2 border-t border-slate-100">
            Customer:{' '}
            <span className="font-semibold text-slate-900">{order.customer_name}</span>
            {order.customer_phone ? ` · ${order.customer_phone}` : ''}
          </p>
        )}
      </div>
    </>
  )
}

function TicketActions({ order, id, busyId, setStatus, expanded = false }) {
  const h = expanded ? 'h-14 text-base' : 'h-12 text-sm'
  return (
    <div className={`border-t border-slate-100 grid grid-cols-1 gap-2 ${expanded ? 'p-4' : 'p-2.5'}`}>
      {order.status === 'pending' && (
        <button
          type="button"
          disabled={busyId === id}
          onClick={() => setStatus(id, 'preparing')}
          className={`${h} rounded-xl bg-orange-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50`}
        >
          <Flame className="w-4 h-4" />
          Start Preparing
        </button>
      )}
      {(order.status === 'preparing' || order.status === 'pending') && (
        <button
          type="button"
          disabled={busyId === id}
          onClick={() => setStatus(id, 'ready')}
          className={`${h} rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50`}
        >
          <CheckCircle className="w-4 h-4" />
          Mark Ready
        </button>
      )}
      {order.status === 'ready' && (
        <div
          className={`${h} rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold flex items-center justify-center gap-2`}
        >
          <CheckCircle className="w-4 h-4" />
          Waiting for waiter
        </div>
      )}
    </div>
  )
}

export default function KitchenPage() {
  const capabilities = useStaffCapabilities()
  const { user, apiCall, logout, loading: authLoading, token } = useAuth()
  const router = useRouter()
  const { addToast } = useToast()
  const [orders, setOrders] = useState([])
  const [itemsByOrder, setItemsByOrder] = useState({})
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [showWastage, setShowWastage] = useState(false)
  const [showWastageHistory, setShowWastageHistory] = useState(false)

  const load = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (load.inFlight) return
    load.inFlight = true
    try {
      const res = await apiCall('/api/restaurant/orders?board=kitchen&limit=40')
      if (!res.ok) return
      const data = await res.json()
      const active = (data.orders || []).sort((a, b) => {
        const ta = parseDbDate(a.created_at)?.getTime() || 0
        const tb = parseDbDate(b.created_at)?.getTime() || 0
        return ta - tb
      })
      setOrders(active)
      setItemsByOrder(data.itemsByOrder || {})
    } catch (e) {
      console.error(e)
    } finally {
      load.inFlight = false
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
    if (user && !['kitchen', 'admin'].includes(user.role)) {
      router.push('/login')
      return
    }
    load()
    const t = setInterval(load, 8000)
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [authLoading, token, user, router])

  useEffect(() => {
    if (!focusedId) return
    const stillThere = orders.some((o) => (o.order_id || o.id) === focusedId)
    if (!stillThere) setFocusedId(null)
  }, [orders, focusedId])

  const visible = useMemo(() => {
    if (filter === 'all') return orders
    return orders.filter((o) => o.status === filter)
  }, [orders, filter])

  const counts = useMemo(() => ({
    all: orders.length,
    pending: orders.filter((o) => o.status === 'pending').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    ready: orders.filter((o) => o.status === 'ready').length,
  }), [orders])

  const focusedOrder = useMemo(
    () => orders.find((o) => (o.order_id || o.id) === focusedId) || null,
    [orders, focusedId]
  )

  const setStatus = async (orderId, status) => {
    setBusyId(orderId)
    try {
      const res = await apiCall(`/api/restaurant/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        addToast(friendlyMessage('save_success', {
          description: status === 'ready' ? 'Order marked ready for waiter.' : 'Kitchen started preparing.',
        }))
        await load()
      } else {
        const err = await res.json().catch(() => ({}))
        addToast(friendlyFromError(err, 'save_failed'))
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>
          <div className="min-w-0 mr-auto">
            <h1 className="font-bold text-slate-900">Kitchen</h1>
            <p className="text-xs text-slate-500 truncate">{user?.full_name || 'Station'}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/kitchen/kots')}
            className={`${capabilities['kot_history.access'] ? 'flex' : 'hidden'} h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200`}
          >
            <Printer className="w-3.5 h-3.5" /> <span>Tickets</span>
          </button>
          <button
            type="button"
            onClick={() => router.push('/kitchen/inventory')}
            className={`${capabilities['inventory.view'] ? 'flex' : 'hidden'} h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200`}
          >
            <Warehouse className="w-3.5 h-3.5" /> <span>Stock</span>
          </button>
          <button
            type="button"
            onClick={() => router.push('/kitchen/recipes')}
            className={`${capabilities['recipes.view'] ? 'flex' : 'hidden'} h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200`}
          >
            <BookOpen className="w-3.5 h-3.5" /> <span>Recipes</span>
          </button>
          {capabilities['cancellation_verifications.manage'] && capabilities['kot_cancellation_approval.enabled'] && <Link href="/kitchen/cancellations" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancelled KOT approval</Link>}
          <button
            type="button"
            onClick={() => setShowWastageHistory(true)}
            className={`${capabilities['wastage.manage'] ? 'flex' : 'hidden'} h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200`}
          >
            <ClipboardList className="w-3.5 h-3.5" /> <span>Wastage</span>
          </button>
          <button
            type="button"
            onClick={() => setShowWastage(true)}
            className={`${capabilities['wastage.manage'] ? 'flex' : 'hidden'} h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100`}
          >
            <Trash className="w-3.5 h-3.5" /> <span>Log Wastage</span>
          </button>
          <Link href="/staff" className="h-10 px-2.5 rounded-xl flex shrink-0 flex-col items-center justify-center gap-0.5 bg-sky-50 text-sky-700" aria-label="My attendance and leave" title="My attendance and leave"><Clock className="w-4 h-4" /><span className="text-[9px] font-semibold leading-none">My HR</span></Link>
          <LogoutButton onLogout={logout} iconOnly />
        </div>
        <div className="max-w-[1600px] mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
          {[
            { id: 'all', label: 'All active' },
            { id: 'pending', label: 'New' },
            { id: 'preparing', label: 'Cooking' },
            { id: 'ready', label: 'Ready' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                filter === f.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label} <span className={`ml-1 tabular-nums ${filter === f.id ? 'text-white/80' : 'text-slate-400'}`}>{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 py-4">
        {loading && <p className="text-center text-slate-500 py-16">Loading tickets…</p>}
        {!loading && visible.length === 0 && (
          <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-slate-500">
            No active kitchen orders
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {visible.map((order) => {
            const id = order.order_id || order.id
            const items = itemsByOrder[id] || []
            const urgency = urgencyFromCreatedAt(order.created_at)
            const border = ticketBorder(urgency)
            const meta = statusMeta(order.status)

            return (
              <article
                key={id}
                className={`rounded-2xl bg-white border-2 ${border} shadow-sm overflow-hidden flex flex-col`}
              >
                <button
                  type="button"
                  onClick={() => setFocusedId(id)}
                  className={`w-full text-left px-3.5 py-3 flex flex-wrap items-center gap-2 border-b border-slate-200 ${meta.strip} hover:brightness-95 transition-all`}
                >
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold tracking-wide ${meta.pill}`}>
                    {meta.label}
                  </span>
                  <span className="text-xl font-extrabold text-slate-900">
                    {order.table_number ? `T-${order.table_number}` : 'Takeaway'}
                  </span>
                  <span className="text-xs font-medium text-slate-600 truncate">{order.order_number}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-sm font-bold text-slate-800">
                    <Clock className="w-4 h-4" />
                    {formatElapsed(order.created_at)}
                  </span>
                  {urgency !== 'normal' && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        urgency === 'critical' ? 'bg-rose-600 text-white' : 'bg-orange-500 text-white'
                      }`}
                    >
                      {urgency === 'critical' ? 'LATE' : 'AGING'}
                    </span>
                  )}
                  <Maximize2 className="w-4 h-4 text-slate-500" />
                </button>

                <TicketBody order={order} items={items} />
                <TicketActions
                  order={order}
                  id={id}
                  busyId={busyId}
                  setStatus={setStatus}
                />
              </article>
            )
          })}
        </div>
      </div>

      {focusedOrder && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]"
            aria-label="Close ticket"
            onClick={() => setFocusedId(null)}
          />
          <article
            className={`relative z-10 w-full sm:max-w-xl max-h-[92vh] sm:max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white border-2 shadow-2xl overflow-hidden ${ticketBorder(
              urgencyFromCreatedAt(focusedOrder.created_at)
            )}`}
          >
            <div className={`px-4 py-3.5 flex flex-wrap items-center gap-2 border-b border-slate-200 ${statusMeta(focusedOrder.status).strip} shrink-0`}>
              <span className={`px-2 py-0.5 rounded-md text-xs font-extrabold tracking-wide ${statusMeta(focusedOrder.status).pill}`}>
                {statusMeta(focusedOrder.status).label}
              </span>
              <span className="text-2xl font-bold text-slate-900">
                {focusedOrder.table_number ? `T-${focusedOrder.table_number}` : 'Takeaway'}
              </span>
              <span className="text-sm font-medium text-slate-600">{focusedOrder.order_number}</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Clock className="w-4 h-4" />
                {formatElapsed(focusedOrder.created_at)}
                <span className="text-slate-400 font-medium">
                  · {formatNepalClock(focusedOrder.created_at)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setFocusedId(null)}
                className="h-10 w-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              <TicketBody
                order={focusedOrder}
                items={itemsByOrder[focusedOrder.order_id || focusedOrder.id] || []}
                expanded
              />
            </div>

            <div className="shrink-0 bg-white">
              <TicketActions
                order={focusedOrder}
                id={focusedOrder.order_id || focusedOrder.id}
                busyId={busyId}
                setStatus={setStatus}
                expanded
              />
            </div>
          </article>
        </div>
      )}

      {showWastage && (
        <WastageModal request={apiCall} onClose={() => setShowWastage(false)} />
      )}
      {showWastageHistory && (
        <WastageHistoryModal request={apiCall} onClose={() => setShowWastageHistory(false)} />
      )}
    </div>
  )
}
