'use client'

import { useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Bell, BellRing, Plus, Search, Users, Clock, Receipt, X, ChefHat, Banknote, Calendar,
  LayoutGrid, AlertTriangle, UserCheck, Star, CheckCircle, Trash2, ClipboardList, QrCode,
} from 'lucide-react'
import WastageModal from '@/components/inventory/wastage-modal'
import WastageHistoryModal from '@/components/inventory/wastage-history-modal'
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal'
import PayQrModal from '@/components/waiter/pay-qr-modal'
import {
  formatElapsed,
  normalizeOrderStatus,
} from '@/lib/restaurant-status'
import LogoutButton from '@/components/ui/logout-button'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { useConfirm } from '@/components/ui/confirm'
import { useStaffCapabilities } from '@/components/auth/staff-area-guard'
import ReservationCard from '@/components/waiter/reservation-card'
import AssignTableDialog from '@/components/waiter/assign-table-dialog'
import ReservationDetailSheet from '@/components/waiter/reservation-detail-sheet'
import Link from 'next/link'
import {
  groupReservationsForWaiter,
  filterReservations,
  filterTables,
} from '@/lib/waiter-reservations'
import {
  groupTablesByRoom,
  filterRoomGroups,
  computeTableStatusCounts,
  TableRoomBoard,
} from '@/components/tables/table-room-board'

const SEEN_KEY = 'waiter_alerts_seen'

function loadSeenIds() {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveSeenIds(set) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function alertKey(kind, id, status) {
  return `${kind}:${id}:${status}`
}

function WaiterDashboardInner() {
  const capabilities = useStaffCapabilities()
  const { user, apiCall, logout, loading: authLoading, token } = useAuth()
  const { alert } = useConfirm()
  const [showWastageLog, setShowWastageLog] = useState(false)
  const [showWastageHistory, setShowWastageHistory] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') === 'reservations' ? 'reservations' : 'floor'

  const [tab, setTab] = useState(initialTab)
  const [tables, setTables] = useState([])
  const [reservations, setReservations] = useState([])
  const [takeawayAlerts, setTakeawayAlerts] = useState([])
  const [resAlerts, setResAlerts] = useState([])
  const [graceMinutes, setGraceMinutes] = useState(20)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [showAlerts, setShowAlerts] = useState(false)
  const [seenIds, setSeenIds] = useState(() => new Set())
  const [tableRoomFilter, setTableRoomFilter] = useState('all')
  const [tableStatusFilter, setTableStatusFilter] = useState('all')
  const [resSection, setResSection] = useState(null)
  const [waiterCallCount, setWaiterCallCount] = useState(0)

  const [detailRes, setDetailRes] = useState(null)
  const [assignRes, setAssignRes] = useState(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignAlts, setAssignAlts] = useState([])
  const [customerHistory, setCustomerHistory] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [partyPickerTable, setPartyPickerTable] = useState(null)
  const [startingParty, setStartingParty] = useState(false)
  const [paymentQr, setPaymentQr] = useState({ esewa_qr_image: '', bank_qr_image: '', restaurant_name: '' })
  const [qrState, setQrState] = useState({ loading: true, error: '' })
  const [payQrOpen, setPayQrOpen] = useState(false)
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' })

  useEffect(() => {
    setSeenIds(loadSeenIds())
  }, [])

  /*
   * GET /api/admin/settings already permits the waiter role, so no permission
   * change was needed. It answers `{ settings: {...} }` — reading the keys off
   * the top level finds nothing and the Pay QR screen wrongly reports "no QR
   * uploaded", so go through data.settings.
   */
  const loadPaymentQr = useCallback(async () => {
    setQrState({ loading: true, error: '' })
    try {
      const res = await apiCall('/api/admin/settings')
      if (!res.ok) throw new Error('Could not load the payment QR.')
      const data = await res.json()
      const settings = data?.settings || {}
      setPaymentQr({
        esewa_qr_image: settings.esewa_qr_image || '',
        bank_qr_image: settings.bank_qr_image || '',
        restaurant_name: settings.restaurant_name || '',
      })
      setQrState({ loading: false, error: '' })
    } catch {
      setQrState({ loading: false, error: 'Could not load the payment QR.' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadPaymentQr() }, [loadPaymentQr])

  const payQrCodes = useMemo(() => {
    const image = paymentQr.bank_qr_image || paymentQr.esewa_qr_image
    return image ? [{ key: 'online', label: 'Online', image }] : []
  }, [paymentQr])

  useEffect(() => {
    if (searchParams.get('tab') === 'reservations') setTab('reservations')
  }, [searchParams])

  const fetchAll = useCallback(async () => {
    try {
      const [tablesRes, ordersRes, resRes, alertsRes, posTablesRes, waiterCallsRes] = await Promise.all([
        apiCall('/api/restaurant/tables'),
        apiCall('/api/restaurant/orders'),
        apiCall('/api/restaurant/reservations?board=ops'),
        apiCall('/api/admin/reservations/alerts'),
        apiCall('/api/admin/pos/tables').catch(() => null),
        apiCall('/api/waiter-requests?status=active&limit=1').catch(() => null),
      ])
      // Multi-party info (parties/kot counts) layered on top of the reservation-aware
      // table list above — additive only, never overrides reservation status/badges.
      let partiesByTable = {}
      if (posTablesRes?.ok) {
        const posData = await posTablesRes.json().catch(() => null)
        for (const t of posData?.tables || []) {
          partiesByTable[t.id] = { parties: t.parties || [], party_count: t.party_count || 0, unsent_count: t.unsent_count || 0 }
        }
      }
      if (tablesRes.ok) {
        const data = await tablesRes.json()
        // Keep reserved_arrived distinct from reserved for floor badges
        setTables(
          (data.tables || []).map((t) => {
            const tid = t.table_id || t.id
            const extra = partiesByTable[tid] || { parties: [], party_count: 0, unsent_count: 0 }
            const merged = { ...t, parties: extra.parties, party_count: extra.party_count, unsent_count: extra.unsent_count }
            if (merged.status === 'reserved' && merged.reservation_status === 'arrived') {
              return { ...merged, status: 'reserved_arrived' }
            }
            return merged
          })
        )
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json()
        const takeaways = (data.orders || []).filter((o) => {
          const type = String(o.order_type || '')
          const isTake = type.includes('take')
          const status = normalizeOrderStatus(o.status)
          return isTake && !o.table_id && ['ready', 'awaiting_payment'].includes(status)
        })
        setTakeawayAlerts(takeaways)
      }
      if (resRes.ok) {
        const data = await resRes.json()
        setReservations(data.reservations || [])
      }
      if (alertsRes.ok) {
        const data = await alertsRes.json()
        setResAlerts(data.alerts || [])
        if (data.settings?.reservation_grace_minutes != null) {
          setGraceMinutes(data.settings.reservation_grace_minutes)
        }
      }
      if (waiterCallsRes?.ok) {
        const data = await waiterCallsRes.json().catch(() => ({}))
        setWaiterCallCount(Number(data?.counts?.active || 0))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  useEffect(() => {
    if (authLoading) return
    const hasToken = token || (typeof window !== 'undefined' && localStorage.getItem('pos_token'))
    if (!hasToken) {
      router.push('/login')
      return
    }
    if (user && !['waiter', 'admin'].includes(user.role)) {
      router.push('/login')
      return
    }
    fetchAll()
    const poll = setInterval(fetchAll, 5000)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [authLoading, token, user, fetchAll, router])

  const groups = useMemo(
    () => groupReservationsForWaiter(reservations, { now: new Date(now), graceMinutes }),
    [reservations, now, graceMinutes]
  )

  const filteredReservations = useMemo(
    () => filterReservations(reservations, search),
    [reservations, search]
  )

  const filteredGroups = useMemo(
    () => groupReservationsForWaiter(filteredReservations, { now: new Date(now), graceMinutes }),
    [filteredReservations, now, graceMinutes]
  )

  const searchedTables = useMemo(() => filterTables(tables, search), [tables, search])
  const tableRooms = useMemo(() => groupTablesByRoom(searchedTables), [searchedTables])
  const visibleTableRooms = useMemo(
    () => filterRoomGroups(tableRooms, tableRoomFilter, tableStatusFilter),
    [tableRooms, tableRoomFilter, tableStatusFilter]
  )
  const tableStatusCounts = useMemo(() => computeTableStatusCounts(searchedTables), [searchedTables])

  const summary = useMemo(() => {
    const today = reservations.length
    const arrivingSoon = (resAlerts || []).filter((a) => a.type === 'arriving_soon').length
    const waiting = groups.waiting.length + groups.arrived.length
    const dining = tables.filter((t) =>
      ['dining', 'occupied', 'cooking', 'ready'].includes(t.status)
    ).length
    const pay = tables.filter((t) => t.status === 'awaiting_payment').length
    const free = tables.filter((t) => t.status === 'available').length
    const late = groups.late.length
    return { today, arrivingSoon, waiting, dining, pay, free, late }
  }, [reservations, resAlerts, groups, tables])

  const alertItems = useMemo(() => {
    void now
    const items = []
    for (const t of tables) {
      const status = t.status || normalizeOrderStatus(t.order_status)
      if (!['ready', 'awaiting_payment'].includes(status)) continue
      const orderId = t.current_order_id || t.order_id || t.table_id || t.id
      items.push({
        key: alertKey('table', orderId, status),
        kind: 'table',
        status,
        title: `Table ${t.table_number}`,
        subtitle: status === 'ready' ? 'Food ready — serve guests' : 'Awaiting payment',
        meta: t.order_number,
        elapsed: formatElapsed(t.order_created_at),
        table: t,
      })
    }
    for (const o of takeawayAlerts) {
      const status = normalizeOrderStatus(o.status)
      const orderId = o.order_id || o.id
      items.push({
        key: alertKey('takeaway', orderId, status),
        kind: 'takeaway',
        status,
        title: o.customer_name ? `Takeaway · ${o.customer_name}` : 'Takeaway',
        subtitle: status === 'ready' ? 'Ready for pickup' : 'Awaiting payment',
        meta: o.order_number,
        elapsed: formatElapsed(o.created_at),
        order: o,
      })
    }
    for (const a of resAlerts || []) {
      items.push({
        key: alertKey('res', a.reservation_id, a.type),
        kind: 'reservation',
        status: a.type,
        title: a.title,
        subtitle: a.subtitle,
        reservation: a.reservation,
        alert: a,
      })
    }
    return items
  }, [tables, takeawayAlerts, resAlerts, now])

  const unreadCount = useMemo(
    () => alertItems.filter((a) => !seenIds.has(a.key)).length,
    [alertItems, seenIds]
  )

  const openReservation = (r) => {
    setCustomerHistory(null)
    setDetailRes(r)
  }

  const openFromTable = (table) => {
    const status = table.status || 'available'
    const orderId = table.current_order_id || table.order_id
    if (status === 'reserved' || status === 'reserved_arrived' || table.reservation_id) {
      const fromList = reservations.find((x) => x.id === table.reservation_id)
      openReservation(
        fromList || {
          id: table.reservation_id,
          name: table.reservation_name,
          phone: table.reservation_phone,
          time: table.reservation_time,
          date: table.reservation_date,
          guests: table.reservation_guests,
          party_size: table.reservation_party_size,
          table_id: table.table_id || table.id,
          table_number: table.table_number,
          status: table.reservation_status || (status === 'reserved_arrived' ? 'arrived' : 'confirmed'),
          occasion: table.reservation_occasion,
          message: table.reservation_message,
          is_vip: table.reservation_is_vip,
          preferences: table.reservation_preferences,
        }
      )
      return
    }
    if (status === 'available' || !orderId) {
      router.push(`/waiter/new-order?table=${table.table_id || table.id}`)
      return
    }
    if ((table.party_count || 0) > 1) {
      setPartyPickerTable(table)
      return
    }
    router.push(`/waiter/order/${orderId}`)
  }

  const startNewParty = async (table) => {
    setStartingParty(true)
    try {
      const res = await apiCall('/api/admin/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ table_id: table.table_id || table.id, new_party: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start a new party')
      setPartyPickerTable(null)
      router.push(`/waiter/new-order?order=${data.order_id}&table=${table.table_id || table.id}`)
    } catch (e) {
      await alert({ title: 'Could not start new party', message: e.message, tone: 'danger' })
    } finally {
      setStartingParty(false)
    }
  }

  const patchRes = async (id, body) => {
    setActionBusy(true)
    try {
      const res = await apiCall(`/api/restaurant/reservations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Update failed')
      await fetchAll()
      if (detailRes?.id === id) setDetailRes(data.reservation)
      return data.reservation
    } finally {
      setActionBusy(false)
    }
  }

  const seatGuest = async (r) => {
    const tid = r.table_id
    if (!tid) {
      setAssignRes(r)
      return
    }
    setActionBusy(true)
    try {
      const res = await apiCall(`/api/admin/reservations/${r.id}/seat`, {
        method: 'POST',
        body: JSON.stringify({ table_id: tid }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not seat')
      setDetailRes(null)
      router.push(`/waiter/order/${data.order_id}`)
    } catch (e) {
      await alert({ title: 'Could not seat', message: e.message || 'Could not seat', tone: 'danger' })
    } finally {
      setActionBusy(false)
    }
  }

  const assignConfirm = async (tableId) => {
    if (!assignRes) return
    setAssignBusy(true)
    setAssignError('')
    setAssignAlts([])
    try {
      const res = await apiCall(`/api/restaurant/reservations/${assignRes.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'assign_table', table_id: tableId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setAssignError(data.error || 'Conflict')
        setAssignAlts(data.alternatives || [])
        return
      }
      if (!res.ok) throw new Error(data.error || 'Assign failed')
      setAssignRes(null)
      await fetchAll()
      if (detailRes?.id === assignRes.id) setDetailRes(data.reservation)
    } catch (e) {
      setAssignError(e.message || 'Assign failed')
    } finally {
      setAssignBusy(false)
    }
  }

  const callGuest = (r) => {
    if (r?.phone) window.location.href = `tel:${r.phone}`
  }

  const loadHistory = async (r) => {
    try {
      const res = await apiCall(`/api/admin/customers?phone=${encodeURIComponent(r.phone || '')}`)
      if (res.ok) {
        const data = await res.json()
        const c = data.customer || (data.customers || [])[0] || null
        setCustomerHistory(c)
      }
    } catch {
      setCustomerHistory(null)
    }
  }

  const ask = (cfg) => setConfirmAction(cfg)
  const runConfirm = async () => {
    if (!confirmAction?.run) return
    setConfirmBusy(true)
    try {
      await confirmAction.run()
      setConfirmAction(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const markAlertsSeen = () => {
    setSeenIds((prev) => {
      const next = new Set(prev)
      for (const a of alertItems) next.add(a.key)
      const active = new Set(alertItems.map((a) => a.key))
      for (const k of [...next]) {
        if (!active.has(k)) next.delete(k)
      }
      saveSeenIds(next)
      return next
    })
  }

  const chips = [
    { id: 'today', label: 'Today', value: summary.today, go: () => { setTab('reservations'); setResSection(null) } },
    { id: 'soon', label: 'Soon', value: summary.arrivingSoon, go: () => { setTab('reservations'); setResSection('upcoming') } },
    { id: 'wait', label: 'To seat', value: summary.waiting, go: () => { setTab('reservations'); setResSection('waiting') } },
    { id: 'dining', label: 'Dining', value: summary.dining, go: () => { setTab('floor'); setTableRoomFilter('all'); setTableStatusFilter('running') } },
    { id: 'pay', label: 'Pay', value: summary.pay, go: () => { setTab('floor'); setTableRoomFilter('all'); setTableStatusFilter('running') } },
    { id: 'free', label: 'Free', value: summary.free, go: () => { setTab('floor'); setTableRoomFilter('all'); setTableStatusFilter('available') } },
    { id: 'late', label: 'Late', value: summary.late, go: () => { setTab('reservations'); setResSection('late') } },
  ]

  const sectionList = [
    { key: 'late', title: 'Late arrivals', rows: filteredGroups.late, icon: AlertTriangle },
    { key: 'arrived', title: 'Arrived', rows: filteredGroups.arrived, icon: UserCheck },
    { key: 'waiting', title: 'Waiting for table', rows: filteredGroups.waiting, icon: Clock },
    { key: 'upcoming', title: 'Upcoming', rows: filteredGroups.upcoming, icon: Calendar },
    { key: 'seated', title: 'Seated', rows: filteredGroups.seated, icon: Users },
    { key: 'done', title: 'Completed / cancelled', rows: filteredGroups.done || [], icon: CheckCircle },
  ].filter((s) => !resSection || resSection === s.key)

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3">
          <div className="flex-1 min-w-[5.5rem]">
            <p className="text-xs font-medium text-slate-500">Waiter floor</p>
            <h1 className="text-lg font-semibold text-slate-900 truncate">
              {user?.full_name || 'Waiter'}
            </h1>
          </div>
          {/* Up to 7 actions: on phones they scroll sideways instead of pushing the page wider. */}
          <div className="flex min-w-0 gap-1.5 sm:gap-2 overflow-x-auto overscroll-x-contain pt-1.5 -mt-1.5 pr-1.5 [scrollbar-width:none]">
          <button
            type="button"
            onClick={() => {
              setShowAlerts((o) => {
                if (!o) markAlertsSeen()
                return !o
              })
            }}
            className={`relative h-11 px-2 sm:px-2.5 rounded-xl flex shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] ${
              showAlerts ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
            }`}
            aria-label="Alerts"
          >
            <Bell className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Alerts</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push('/waiter/requests')}
            className={`relative h-11 px-2 sm:px-2.5 rounded-xl flex shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] ${capabilities['waiter_calls.access'] ? '' : 'hidden'} ${waiterCallCount > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'}`}
            aria-label="Waiter calls"
            title="Waiter calls"
          >
            <BellRing className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Calls</span>
            {waiterCallCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
                {waiterCallCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push('/waiter/kots')}
            className={`h-11 px-2 sm:px-2.5 rounded-xl shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] bg-slate-100 text-slate-700 ${capabilities['kot_history.access'] ? 'flex' : 'hidden'}`}
            aria-label="KOT history"
            title="KOT history"
          >
            <ChefHat className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">KOT</span>
          </button>
          <button
            type="button"
            onClick={() => router.push('/waiter/bills')}
            className={`h-11 px-2 sm:px-2.5 rounded-xl shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] bg-slate-100 text-slate-700 ${capabilities['bills.access'] ? 'flex' : 'hidden'}`}
            aria-label="Bills history"
            title="Bills history"
          >
            <Receipt className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Bills</span>
          </button>
          <button
            type="button"
            onClick={() => setShowWastageHistory(true)}
            className={`h-11 px-2 sm:px-2.5 rounded-xl shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] bg-slate-100 text-slate-700 ${capabilities['wastage.manage'] ? 'flex' : 'hidden'}`}
            aria-label="View wastage"
            title="View wastage"
          >
            <ClipboardList className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Waste</span>
          </button>
          <button
            type="button"
            onClick={() => setShowWastageLog(true)}
            className={`h-11 px-2 sm:px-2.5 rounded-xl shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] bg-rose-50 text-rose-700 ${capabilities['wastage.manage'] ? 'flex' : 'hidden'}`}
            aria-label="Log wastage"
            title="Log wastage"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Log</span>
          </button>
          {/* Always shown: with no QR uploaded the modal explains where to add
              one, which is more use than a button that silently is not there. */}
          <button
            type="button"
            onClick={() => setPayQrOpen(true)}
            className="h-11 px-2 sm:px-2.5 rounded-xl flex shrink-0 flex-col items-center justify-center gap-0.5 min-w-[3rem] sm:min-w-[3.25rem] bg-emerald-50 text-emerald-700"
            aria-label="Show payment QR"
            title="Show payment QR"
          >
            <QrCode className="w-4 h-4" />
            <span className="text-[9px] font-semibold leading-none">Pay QR</span>
          </button>
          </div>
          <Link href="/staff" className="h-11 px-2.5 rounded-xl flex shrink-0 flex-col items-center justify-center gap-0.5 bg-sky-50 text-sky-700" aria-label="My attendance and leave" title="My attendance and leave"><Clock className="w-4 h-4" /><span className="text-[9px] font-semibold leading-none">My HR</span></Link>
          <LogoutButton onLogout={logout} iconOnly className="shrink-0" />
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-4 flex gap-2 pb-2">
          {[
            { id: 'floor', label: 'Floor', icon: LayoutGrid },
            { id: 'reservations', label: 'Reservations', icon: Calendar },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                setTableRoomFilter('all')
                setTableStatusFilter('all')
                setResSection(null)
                router.replace(t.id === 'reservations' ? '/waiter?tab=reservations' : '/waiter', {
                  scroll: false,
                })
              }}
              className={`flex-1 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 ${
                tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-white border-b border-slate-200 pt-2">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 pb-2">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none]">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={c.go}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left shadow-sm"
              >
                <p className="text-base font-bold text-slate-900 tabular-nums leading-none">{c.value}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{c.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, table, booking #…"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        </div>
      </div>

      {showAlerts && (
        <div className="fixed inset-0 z-[80]">
          <button type="button" className="absolute inset-0 bg-slate-900/45" aria-label="Dismiss" onClick={() => setShowAlerts(false)} />
          <div className="absolute inset-x-0 top-0 sm:top-16 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md p-0 sm:p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[min(85vh,640px)] flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Needs attention</p>
                <button type="button" onClick={() => setShowAlerts(false)} className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto p-3 space-y-2">
                {alertItems.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No alerts</p>
                ) : (
                  alertItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        markAlertsSeen()
                        setShowAlerts(false)
                        if (item.kind === 'table') openFromTable(item.table)
                        else if (item.kind === 'takeaway') {
                          router.push(`/waiter/order/${item.order.order_id || item.order.id}`)
                        } else if (item.reservation) {
                          setTab('reservations')
                          openReservation(item.reservation)
                        }
                      }}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 ${
                        !seenIds.has(item.key)
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <span className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-slate-100 text-slate-700">
                        {item.kind === 'reservation' ? (
                          item.status === 'vip_arrived' || item.status === 'occasion_today' ? (
                            <Star className="w-5 h-5 text-amber-600" />
                          ) : (
                            <Calendar className="w-5 h-5" />
                          )
                        ) : item.status === 'ready' ? (
                          <ChefHat className="w-5 h-5" />
                        ) : (
                          <Banknote className="w-5 h-5" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 truncate">{item.title}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {item.subtitle}
                          {item.elapsed ? ` · ${item.elapsed}` : ''}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-4">
        {tab === 'floor' ? (
          loading ? (
            <div className="py-20 text-center text-slate-500">Loading tables…</div>
          ) : tables.length === 0 ? (
            <p className="py-20 text-center text-slate-400">No tables configured yet.</p>
          ) : (
            <TableRoomBoard
              tables={searchedTables}
              rooms={tableRooms}
              visibleRooms={visibleTableRooms}
              roomFilter={tableRoomFilter}
              statusFilter={tableStatusFilter}
              statusCounts={tableStatusCounts}
              onRoomFilter={setTableRoomFilter}
              onStatusFilter={setTableStatusFilter}
              onTableClick={openFromTable}
            />
          )
        ) : (
          <div className="space-y-6 pb-4">
            {loading ? (
              <p className="py-16 text-center text-slate-500">Loading reservations…</p>
            ) : filteredReservations.length === 0 ? (
              <p className="py-16 text-center text-slate-500">No reservations match.</p>
            ) : (
              sectionList.map((section) =>
                section.rows.length === 0 ? null : (
                  <section key={section.key}>
                    <div className="flex items-center gap-2 mb-2">
                      <section.icon className="w-4 h-4 text-slate-500" />
                      <h2 className="text-sm font-semibold text-slate-800">
                        {section.title}
                        <span className="text-slate-400 font-medium ml-1.5">{section.rows.length}</span>
                      </h2>
                    </div>
                    <div className="space-y-2.5">
                      {section.rows.map((r) => (
                        <ReservationCard
                          key={r.id}
                          reservation={r}
                          tables={tables}
                          graceMinutes={graceMinutes}
                          now={now}
                          onOpen={openReservation}
                          onAssign={(row) => setAssignRes(row)}
                          onSeat={(row) =>
                            ask({
                              title: 'Seat this guest?',
                              description: `Open a dine-in order for ${row.name}.`,
                              confirmLabel: 'Seat guest',
                              variant: 'primary',
                              icon: Users,
                              run: () => seatGuest(row),
                            })
                          }
                          onCheckIn={(row) =>
                            ask({
                              title: 'Customer arrived?',
                              description: `Check in ${row.name}.`,
                              confirmLabel: 'Check in',
                              variant: 'warning',
                              icon: UserCheck,
                              run: () => patchRes(row.id, { action: 'check_in' }),
                            })
                          }
                          onCall={callGuest}
                          onEdit={openReservation}
                          onCancel={(row) =>
                            ask({
                              title:
                                row.status === 'seated'
                                  ? 'Cancel seating / release table?'
                                  : 'Cancel reservation?',
                              description:
                                row.status === 'seated'
                                  ? `Cancel seating for ${row.name}, close the open order, and free the table.`
                                  : `Cancel booking for ${row.name}.`,
                              confirmLabel:
                                row.status === 'seated' ? 'Cancel seating' : 'Cancel booking',
                              variant: 'danger',
                              run: () => patchRes(row.id, { action: 'cancel' }),
                            })
                          }
                          onNoShow={(row) =>
                            ask({
                              title: 'Mark no-show?',
                              description: `${row.name} did not arrive. Release the table hold.`,
                              confirmLabel: 'Mark no-show',
                              variant: 'warning',
                              icon: AlertTriangle,
                              run: () => patchRes(row.id, { action: 'no_show' }),
                            })
                          }
                          onOpenOrder={(row) => router.push(`/waiter/order/${row.order_id}`)}
                        />
                      ))}
                    </div>
                  </section>
                )
              )
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pointer-events-none">
        <div className="max-w-6xl mx-auto flex gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => {
              setTab('reservations')
              router.replace('/waiter?tab=reservations', { scroll: false })
            }}
            aria-label="Bookings"
            className={`h-12 px-4 rounded-2xl bg-amber-100 border border-amber-200 text-amber-950 font-semibold items-center gap-2 shadow-sm ${capabilities['reservations.access'] ? 'flex' : 'hidden'}`}
          >
            <Calendar className="w-5 h-5" />
            <span className="hidden min-[400px]:inline">Bookings</span>
          </button>
          <button
            type="button"
            onClick={() => router.push('/waiter/new-order?type=takeaway')}
            className={`flex-1 min-w-0 whitespace-nowrap h-12 rounded-2xl bg-slate-900 text-white font-semibold items-center justify-center gap-2 shadow-lg ${capabilities['orders.create'] ? 'flex' : 'hidden'}`}
          >
            <Plus className="w-5 h-5" />
            New Takeaway
          </button>
          <button
            type="button"
            onClick={() => router.push('/waiter/bills')}
            aria-label="Bills"
            className={`h-12 px-4 rounded-2xl bg-white border border-slate-200 text-slate-800 font-semibold items-center gap-2 shadow-sm ${capabilities['bills.access'] ? 'flex' : 'hidden'}`}
          >
            <Receipt className="w-5 h-5" />
            <span className="hidden min-[400px]:inline">Bills</span>
          </button>
        </div>
      </div>

      <ReservationDetailSheet
        open={!!detailRes}
        reservation={detailRes}
        tables={tables}
        customerHistory={customerHistory}
        graceMinutes={graceMinutes}
        busy={actionBusy}
        onClose={() => setDetailRes(null)}
        onAssign={(r) => setAssignRes(r)}
        onSeat={(r) =>
          ask({
            title: 'Seat this guest?',
            description: `Open a dine-in order for ${r.name}.`,
            confirmLabel: 'Seat guest',
            variant: 'primary',
            run: () => seatGuest(r),
          })
        }
        onCheckIn={(r) =>
          ask({
            title: 'Customer arrived?',
            description: `Check in ${r.name}.`,
            confirmLabel: 'Check in',
            variant: 'warning',
            run: () => patchRes(r.id, { action: 'check_in' }),
          })
        }
        onCall={callGuest}
        onCancel={(r) =>
          ask({
            title:
              r.status === 'seated' ? 'Cancel seating / release table?' : 'Cancel reservation?',
            description:
              r.status === 'seated'
                ? `Cancel seating for ${r.name}, close the open order, and free the table.`
                : `Cancel booking for ${r.name}.`,
            confirmLabel: r.status === 'seated' ? 'Cancel seating' : 'Cancel booking',
            variant: 'danger',
            run: async () => {
              await patchRes(r.id, { action: 'cancel' })
              setDetailRes(null)
            },
          })
        }
        onNoShow={(r) =>
          ask({
            title: 'Mark no-show?',
            description: `${r.name} did not arrive.`,
            confirmLabel: 'Mark no-show',
            variant: 'warning',
            run: async () => {
              await patchRes(r.id, { action: 'no_show' })
              setDetailRes(null)
            },
          })
        }
        onEdit={async (r, fields) => {
          await patchRes(r.id, { action: 'edit', ...fields })
        }}
        onOpenOrder={(r) => router.push(`/waiter/order/${r.order_id}`)}
        onLoadHistory={loadHistory}
      />

      <AssignTableDialog
        open={!!assignRes}
        reservation={assignRes}
        tables={tables}
        busy={assignBusy}
        error={assignError}
        alternatives={assignAlts}
        onClose={() => {
          setAssignRes(null)
          setAssignError('')
          setAssignAlts([])
        }}
        onConfirm={assignConfirm}
      />

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel}
        cancelLabel={confirmAction?.cancelLabel || 'Back'}
        variant={confirmAction?.variant || 'danger'}
        icon={confirmAction?.icon}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null)
        }}
        onConfirm={runConfirm}
      />

      {partyPickerTable && (
        <div className="fixed inset-0 z-[85] bg-black/40 flex items-end sm:items-center sm:justify-center">
          <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Table {partyPickerTable.table_number} — parties</h3>
              <button type="button" onClick={() => setPartyPickerTable(null)} className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
              {(partyPickerTable.parties || []).map((p) => (
                <button
                  key={p.order_id}
                  type="button"
                  onClick={() => {
                    setPartyPickerTable(null)
                    router.push(`/waiter/order/${p.order_id}`)
                  }}
                  className="w-full text-left rounded-xl border border-slate-200 px-3 py-2.5 flex items-center justify-between hover:border-slate-400"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{p.party_label}</span>
                    <span className="block text-xs text-slate-500">{p.order_number}{p.customer_name ? ` · ${p.customer_name}` : ''}</span>
                  </span>
                  <span className="text-sm font-bold text-slate-900">Rs {Number(p.amount || 0).toFixed(0)}</span>
                </button>
              ))}
              <button
                type="button"
                disabled={startingParty}
                onClick={() => startNewParty(partyPickerTable)}
                className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                {startingParty ? 'Starting…' : '+ Start new party'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWastageLog && <WastageModal request={apiCall} onClose={() => setShowWastageLog(false)} />}
      {showWastageHistory && <WastageHistoryModal request={apiCall} onClose={() => setShowWastageHistory(false)} />}

      {/* Tabs live inside the modal now, so the waiter picks the code on the
          same screen instead of answering a question first. */}
      <PayQrModal
        open={payQrOpen}
        onClose={() => setPayQrOpen(false)}
        codes={payQrCodes}
        restaurantName={paymentQr.restaurant_name}
        loading={qrState.loading}
        error={qrState.error}
        onRetry={loadPaymentQr}
      />
      <QrEnlargeModal open={qrModal.open} title={qrModal.title} image={qrModal.image} onClose={() => setQrModal({ open: false, title: '', image: '' })} />
    </div>
  )
}

export default function WaiterDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">
          Loading…
        </div>
      }
    >
      <WaiterDashboardInner />
    </Suspense>
  )
}
