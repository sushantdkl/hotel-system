'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, Calendar, Clock, Users, UserCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import ReservationCard from '@/components/waiter/reservation-card';
import AssignTableDialog from '@/components/waiter/assign-table-dialog';
import ReservationDetailSheet from '@/components/waiter/reservation-detail-sheet';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { useConfirm } from '@/components/ui/confirm';
import { groupReservationsForWaiter, filterReservations } from '@/lib/waiter-reservations';

/** Cashier reservations: view today/upcoming bookings, seat guests, cancel/no-show. No floor plan or KOT tools. */
export default function CashierReservationsPage() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { alert } = useConfirm();

  const [reservations, setReservations] = useState([]);
  const [tables, setTables] = useState([]);
  const [graceMinutes, setGraceMinutes] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const [detailRes, setDetailRes] = useState(null);
  const [assignRes, setAssignRes] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignAlts, setAssignAlts] = useState([]);
  const [customerHistory, setCustomerHistory] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [tablesRes, resRes, alertsRes] = await Promise.all([
        apiCall('/api/restaurant/tables'),
        apiCall('/api/restaurant/reservations?board=ops'),
        apiCall('/api/admin/reservations/alerts').catch(() => null),
      ]);
      if (tablesRes.ok) {
        const data = await tablesRes.json();
        setTables(data.tables || []);
      }
      if (resRes.ok) {
        const data = await resRes.json();
        setReservations(data.reservations || []);
      }
      if (alertsRes?.ok) {
        const data = await alertsRes.json();
        if (data.settings?.reservation_grace_minutes != null) {
          setGraceMinutes(data.settings.reservation_grace_minutes);
        }
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiCall]);

  useEffect(() => {
    fetchAll();
    const poll = setInterval(fetchAll, 15000);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [fetchAll]);

  const filteredReservations = useMemo(() => filterReservations(reservations, search), [reservations, search]);
  const groups = useMemo(
    () => groupReservationsForWaiter(filteredReservations, { now: new Date(now), graceMinutes }),
    [filteredReservations, now, graceMinutes]
  );

  const sectionList = [
    { key: 'late', title: 'Late arrivals', rows: groups.late, icon: AlertTriangle },
    { key: 'arrived', title: 'Arrived', rows: groups.arrived, icon: UserCheck },
    { key: 'waiting', title: 'Waiting for table', rows: groups.waiting, icon: Clock },
    { key: 'upcoming', title: 'Upcoming', rows: groups.upcoming, icon: Calendar },
    { key: 'seated', title: 'Seated', rows: groups.seated, icon: Users },
    { key: 'done', title: 'Completed / cancelled', rows: groups.done || [], icon: CheckCircle },
  ];

  const openReservation = (r) => { setCustomerHistory(null); setDetailRes(r); };
  const ask = (cfg) => setConfirmAction(cfg);
  const runConfirm = async () => {
    if (!confirmAction?.run) return;
    setConfirmBusy(true);
    try { await confirmAction.run(); setConfirmAction(null); } finally { setConfirmBusy(false); }
  };

  const patchRes = async (id, body) => {
    setActionBusy(true);
    try {
      const res = await apiCall(`/api/restaurant/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await fetchAll();
      if (detailRes?.id === id) setDetailRes(data.reservation);
      return data.reservation;
    } finally { setActionBusy(false); }
  };

  const seatGuest = async (r) => {
    if (!r.table_id) { setAssignRes(r); return; }
    setActionBusy(true);
    try {
      const res = await apiCall(`/api/admin/reservations/${r.id}/seat`, { method: 'POST', body: JSON.stringify({ table_id: r.table_id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not seat');
      setDetailRes(null);
      router.push(`/cashier/orders/${data.order_id}`);
    } catch (e) {
      await alert({ title: 'Could not seat', message: e.message || 'Could not seat', tone: 'danger' });
    } finally { setActionBusy(false); }
  };

  const assignConfirm = async (tableId) => {
    if (!assignRes) return;
    setAssignBusy(true);
    setAssignError('');
    setAssignAlts([]);
    try {
      const res = await apiCall(`/api/restaurant/reservations/${assignRes.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'assign_table', table_id: tableId }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) { setAssignError(data.error || 'Conflict'); setAssignAlts(data.alternatives || []); return; }
      if (!res.ok) throw new Error(data.error || 'Assign failed');
      setAssignRes(null);
      await fetchAll();
      if (detailRes?.id === assignRes.id) setDetailRes(data.reservation);
    } catch (e) {
      setAssignError(e.message || 'Assign failed');
    } finally { setAssignBusy(false); }
  };

  const callGuest = (r) => { if (r?.phone) window.location.href = `tel:${r.phone}`; };

  const loadHistory = async (r) => {
    try {
      const res = await apiCall(`/api/admin/customers?phone=${encodeURIComponent(r.phone || '')}`);
      if (res.ok) {
        const data = await res.json();
        setCustomerHistory(data.customer || (data.customers || [])[0] || null);
      }
    } catch { setCustomerHistory(null); }
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-50"><Calendar className="w-6 h-6 text-amber-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
            <p className="text-sm text-gray-500 mt-0.5">Today&apos;s and upcoming bookings — seat, cancel or mark no-show.</p>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-[70vh]">
        <div className="relative mb-4 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, table…"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 bg-white text-sm"
          />
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-16">Loading reservations…</p>
        ) : filteredReservations.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No reservations match.</p>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            {sectionList.map((section) =>
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
                        onSeat={(row) => ask({
                          title: 'Seat this guest?',
                          description: `Open a dine-in order for ${row.name}.`,
                          confirmLabel: 'Seat guest',
                          variant: 'primary',
                          icon: Users,
                          run: () => seatGuest(row),
                        })}
                        onCheckIn={(row) => ask({
                          title: 'Customer arrived?',
                          description: `Check in ${row.name}.`,
                          confirmLabel: 'Check in',
                          variant: 'warning',
                          icon: UserCheck,
                          run: () => patchRes(row.id, { action: 'check_in' }),
                        })}
                        onCall={callGuest}
                        onEdit={openReservation}
                        onCancel={(row) => ask({
                          title: row.status === 'seated' ? 'Cancel seating / release table?' : 'Cancel reservation?',
                          description: row.status === 'seated'
                            ? `Cancel seating for ${row.name}, close the open order, and free the table.`
                            : `Cancel booking for ${row.name}.`,
                          confirmLabel: row.status === 'seated' ? 'Cancel seating' : 'Cancel booking',
                          variant: 'danger',
                          run: () => patchRes(row.id, { action: 'cancel' }),
                        })}
                        onNoShow={(row) => ask({
                          title: 'Mark no-show?',
                          description: `${row.name} did not arrive. Release the table hold.`,
                          confirmLabel: 'Mark no-show',
                          variant: 'warning',
                          icon: AlertTriangle,
                          run: () => patchRes(row.id, { action: 'no_show' }),
                        })}
                        onOpenOrder={(row) => router.push(`/cashier/orders/${row.order_id}`)}
                      />
                    ))}
                  </div>
                </section>
              )
            )}
          </div>
        )}
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
        onSeat={(r) => ask({
          title: 'Seat this guest?',
          description: `Open a dine-in order for ${r.name}.`,
          confirmLabel: 'Seat guest',
          variant: 'primary',
          run: () => seatGuest(r),
        })}
        onCheckIn={(r) => ask({
          title: 'Customer arrived?',
          description: `Check in ${r.name}.`,
          confirmLabel: 'Check in',
          variant: 'warning',
          run: () => patchRes(r.id, { action: 'check_in' }),
        })}
        onCall={callGuest}
        onCancel={(r) => ask({
          title: r.status === 'seated' ? 'Cancel seating / release table?' : 'Cancel reservation?',
          description: r.status === 'seated'
            ? `Cancel seating for ${r.name}, close the open order, and free the table.`
            : `Cancel booking for ${r.name}.`,
          confirmLabel: r.status === 'seated' ? 'Cancel seating' : 'Cancel booking',
          variant: 'danger',
          run: async () => { await patchRes(r.id, { action: 'cancel' }); setDetailRes(null); },
        })}
        onNoShow={(r) => ask({
          title: 'Mark no-show?',
          description: `${r.name} did not arrive.`,
          confirmLabel: 'Mark no-show',
          variant: 'warning',
          run: async () => { await patchRes(r.id, { action: 'no_show' }); setDetailRes(null); },
        })}
        onEdit={async (r, fields) => { await patchRes(r.id, { action: 'edit', ...fields }); }}
        onOpenOrder={(r) => router.push(`/cashier/orders/${r.order_id}`)}
        onLoadHistory={loadHistory}
      />

      <AssignTableDialog
        open={!!assignRes}
        reservation={assignRes}
        tables={tables}
        busy={assignBusy}
        error={assignError}
        alternatives={assignAlts}
        onClose={() => { setAssignRes(null); setAssignError(''); setAssignAlts([]); }}
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
        onCancel={() => { if (!confirmBusy) setConfirmAction(null); }}
        onConfirm={runConfirm}
      />
    </AdminLayout>
  );
}
