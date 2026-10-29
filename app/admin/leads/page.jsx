'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import {
  Inbox, Phone, Users, Calendar, Clock, Check, X, MapPin,
  MessageSquare, Archive, UserCheck, AlertTriangle, Plus,
  Star, Wallet,
} from 'lucide-react';
import { nepalDateString } from '@/lib/report-dates.js';
import { StayLink } from '@/components/hotel/order-stay-link';

const RES_STATUS = {
  new: { label: 'New', badge: 'bg-sky-100 text-sky-800' },
  confirmed: { label: 'Confirmed', badge: 'bg-emerald-100 text-emerald-800' },
  arrived: { label: 'Arrived', badge: 'bg-amber-100 text-amber-900' },
  seated: { label: 'Seated', badge: 'bg-violet-100 text-violet-800' },
  completed: { label: 'Completed', badge: 'bg-stone-100 text-stone-600' },
  cancelled: { label: 'Cancelled', badge: 'bg-red-100 text-red-700' },
  no_show: { label: 'No-show', badge: 'bg-orange-100 text-orange-900' },
};

const INQ_STATUS = {
  new: { label: 'New', badge: 'bg-sky-100 text-sky-800' },
  contacted: { label: 'Contacted', badge: 'bg-amber-100 text-amber-900' },
  resolved: { label: 'Resolved', badge: 'bg-emerald-100 text-emerald-800' },
  archived: { label: 'Archived', badge: 'bg-stone-100 text-stone-600' },
};

const emptyCreate = {
  name: '',
  phone: '',
  date: '',
  time: '',
  party_size: 2,
  occasion: '',
  message: '',
  table_id: '',
  confirm: true,
  is_vip: false,
  deposit_required: false,
  deposit_amount: '',
  high_chair: false,
  wheelchair: false,
  outdoor: false,
};

export default function AdminLeadsPage() {
  const { addToast } = useToast();
  const [section, setSection] = useState('reservations');
  const [resBoard, setResBoard] = useState('all');
  const [reservations, setReservations] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const [assignTableId, setAssignTableId] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [conflictInfo, setConflictInfo] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const token = () => localStorage.getItem('pos_token');

  const askConfirm = (cfg) => setConfirmAction(cfg);

  const runConfirmedAction = async () => {
    if (!confirmAction?.run) return;
    setConfirmBusy(true);
    try {
      await confirmAction.run();
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const guestLabel = (r) => {
    if (!r) return 'this guest';
    const when = [r.date, r.time].filter(Boolean).join(' ');
    return `${r.name}${when ? ` (${when})` : ''}`;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${token()}` };
      const board = resBoard === 'all' ? undefined : resBoard;

      const [resMain, resT] = await Promise.all([
        section === 'inquiries'
          ? fetch('/api/admin/inquiries', { headers })
          : fetch(`/api/admin/reservations?auto_noshow=true${board ? `&board=${board}` : ''}`, { headers }),
        fetch('/api/admin/tables', { headers }),
      ]);

      if (section === 'inquiries') {
        if (resMain.ok) {
          const data = await resMain.json();
          setInquiries(data.inquiries || []);
        }
      } else if (resMain.ok) {
        const data = await resMain.json();
        setReservations(data.reservations || []);
      }

      if (resT.ok) {
        const data = await resT.json();
        setTables((data.tables || []).filter((t) => t.is_active !== 0));
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [addToast, section, resBoard]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (row, kind) => {
    setSelected({ ...row, _kind: kind });
    setNotes(row.admin_notes || '');
    setAssignTableId(row.table_id ? String(row.table_id) : '');
    setPartySize(row.party_size || 2);
    setConflictInfo(null);

    if (row.status === 'new') {
      const url = kind === 'inquiry' ? '/api/admin/inquiries' : '/api/admin/reservations';
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ id: row.id, action: 'mark_viewed' }),
      }).catch(() => {});
    }
  };

  const patchReservation = async (id, body) => {
    setBusyId(id);
    setConflictInfo(null);
    try {
      const res = await fetch('/api/admin/reservations', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflictInfo(data);
        addToast(friendlyMessage('validation', { description: data.error || 'Table conflict' }));
        return null;
      }
      if (!res.ok) throw new Error(data.error || 'Update failed');
      addToast(friendlyMessage('save_success', { description: 'Reservation saved.' }));
      await load();
      if (selected?.id === id && selected._kind === 'reservation') {
        setSelected({ ...data.reservation, _kind: 'reservation' });
        setAssignTableId(data.reservation.table_id ? String(data.reservation.table_id) : '');
        setNotes(data.reservation.admin_notes || '');
        setPartySize(data.reservation.party_size || 2);
      }
      return data.reservation;
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const patchInquiry = async (id, body) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/inquiries', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      addToast(friendlyMessage('save_success', { description: 'Inquiry saved.' }));
      await load();
      if (selected?.id === id && selected._kind === 'inquiry') {
        setSelected({ ...data.inquiry, _kind: 'inquiry' });
        setNotes(data.inquiry.admin_notes || '');
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const seatReservation = async (id, tableId, extra = {}) => {
    setBusyId(id);
    setConflictInfo(null);
    try {
      const res = await fetch(`/api/admin/reservations/${id}/seat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table_id: tableId ? Number(tableId) : undefined,
          skip_checkin: true,
          ...extra,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || data.code === 'deposit_unpaid') {
        setConflictInfo(data);
        addToast(friendlyMessage('validation', { description: data.error }));
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not seat guest');
      addToast(
        friendlyMessage('save_success', {
          title: 'Guest seated',
          description: `Order ${data.order_number} created.`,
        })
      );
      await load();
      setSelected(null);
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const changeTable = async (id, tableId, force = false) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/reservations/${id}/change-table`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table_id: Number(tableId), force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflictInfo(data);
        addToast(friendlyMessage('validation', { description: data.error }));
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not change table');
      addToast(friendlyMessage('save_success', { description: 'Table updated.' }));
      await load();
      setSelected({ ...data.reservation, _kind: 'reservation' });
      setAssignTableId(String(data.reservation.table_id));
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const createReservation = async (force = false) => {
    setBusyId('create');
    setConflictInfo(null);
    try {
      const res = await fetch('/api/admin/reservations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: createForm.name,
          phone: createForm.phone,
          date: createForm.date,
          time: createForm.time,
          party_size: Number(createForm.party_size) || 2,
          occasion: createForm.occasion || null,
          message: createForm.message || null,
          table_id: createForm.table_id ? Number(createForm.table_id) : null,
          confirm: createForm.confirm,
          is_vip: createForm.is_vip,
          deposit_required: createForm.deposit_required,
          deposit_amount: createForm.deposit_amount || 0,
          preferences: {
            high_chair: createForm.high_chair,
            wheelchair: createForm.wheelchair,
            outdoor: createForm.outdoor,
          },
          force,
          source: 'phone',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflictInfo(data);
        addToast(friendlyMessage('validation', { description: data.error }));
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not create');
      addToast(friendlyMessage('save_success', { description: 'Reservation created.' }));
      setShowCreate(false);
      setCreateForm(emptyCreate);
      await load();
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const sections = [
    { id: 'reservations', label: 'Reservations' },
    { id: 'inquiries', label: 'Inquiries' },
  ];

  const resBoards = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'history', label: 'History' },
  ];

  return (
    <AdminLayout>
      <header className="bg-white border-b border-stone-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-stone-900 tracking-tight">Host desk</h1>
            <p className="text-stone-500 mt-1 text-sm">
              Host assigns tables when confirming. Waiters can pick a table when seating if none is set.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {section !== 'inquiries' && (
              <button
                type="button"
                onClick={() => {
                  // Nepal calendar, not the browser's: a host opening the form
                  // just after midnight NPT on a UTC-set machine was handed
                  // yesterday's date as the default booking date.
                  setCreateForm({ ...emptyCreate, date: nepalDateString() });
                  setShowCreate(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-stone-900 text-white"
              >
                <Plus className="w-4 h-4" /> New booking
              </button>
            )}
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  section === s.id
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {section === 'reservations' && (
          <div className="flex flex-wrap gap-2 mt-3">
            {resBoards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setResBoard(b.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  resBoard === b.id
                    ? 'bg-stone-800 text-white'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-stone-50">
        {loading ? (
          <div className="text-center py-20 text-stone-500">Loading…</div>
        ) : section === 'inquiries' ? (
          <div className="space-y-3">
            {inquiries.length === 0 && (
              <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center text-stone-500">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-stone-300" />
                No inquiries yet
              </div>
            )}
            {inquiries.map((inq) => {
              const st = INQ_STATUS[inq.status] || INQ_STATUS.new;
              return (
                <div key={inq.id} className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                    <button type="button" onClick={() => openDetail(inq, 'inquiry')} className="text-left flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-stone-900">{inq.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.badge}`}>{st.label}</span>
                      </div>
                      <p className="text-sm text-stone-600 truncate">{inq.subject || 'No subject'}</p>
                      <p className="text-xs text-stone-400 mt-1 line-clamp-2">{inq.message}</p>
                    </button>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {inq.status === 'new' && (
                        <button
                          type="button"
                          disabled={busyId === inq.id}
                          onClick={() =>
                            askConfirm({
                              title: 'Mark as contacted?',
                              description: `Mark the inquiry from ${inq.name} as contacted.`,
                              confirmLabel: 'Mark contacted',
                              cancelLabel: 'Back',
                              variant: 'warning',
                              icon: UserCheck,
                              run: () => patchInquiry(inq.id, { status: 'contacted' }),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Contacted
                        </button>
                      )}
                      {['new', 'contacted'].includes(inq.status) && (
                        <button
                          type="button"
                          disabled={busyId === inq.id}
                          onClick={() =>
                            askConfirm({
                              title: 'Resolve this inquiry?',
                              description: `Close the inquiry from ${inq.name} as resolved.`,
                              confirmLabel: 'Resolve',
                              cancelLabel: 'Keep open',
                              variant: 'primary',
                              icon: Check,
                              run: () => patchInquiry(inq.id, { status: 'resolved' }),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white"
                        >
                          <Check className="w-3.5 h-3.5" /> Resolve
                        </button>
                      )}
                      {inq.status !== 'archived' && (
                        <button
                          type="button"
                          disabled={busyId === inq.id}
                          onClick={() =>
                            askConfirm({
                              title: 'Archive this inquiry?',
                              description: `Archive the message from ${inq.name}. You can still find it later if needed.`,
                              confirmLabel: 'Archive',
                              cancelLabel: 'Keep',
                              variant: 'danger',
                              icon: Archive,
                              run: () => patchInquiry(inq.id, { status: 'archived' }),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-stone-100 text-stone-700"
                        >
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {reservations.length === 0 && (
              <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center text-stone-500">
                <Inbox className="w-8 h-8 mx-auto mb-2 text-stone-300" />
                No reservations here
              </div>
            )}
            {reservations.map((r) => {
              const st = RES_STATUS[r.status] || RES_STATUS.new;
              return (
                <div key={r.id} className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                    <button type="button" onClick={() => openDetail(r, 'reservation')} className="text-left flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-stone-900">{r.name}</span>
                        {!!r.is_vip && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                            <Star className="w-3 h-3" /> VIP
                          </span>
                        )}
                        {!!r.deposit_required && !r.deposit_paid && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700">
                            <Wallet className="w-3 h-3" /> Deposit due
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.badge}`}>{st.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500">
                        <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {r.phone}</span>
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {r.date}</span>
                        {r.time && (
                          <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {r.time}</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> {r.party_size || r.guests}
                        </span>
                        {r.table_number && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" /> Table {r.table_number}
                          </span>
                        )}
                      </div>
                      {(r.occasion || r.message) && (
                        <p className="text-xs text-stone-400 mt-1 line-clamp-1">
                          {[r.occasion, r.message].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </button>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <StayLink kind="reservation" id={r.id} />
                      {r.status === 'new' && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() =>
                            askConfirm({
                              title: 'Confirm this reservation?',
                              description: `Mark ${guestLabel(r)} as confirmed. You can still assign a table or seat them later.`,
                              confirmLabel: 'Yes, confirm',
                              cancelLabel: 'Not now',
                              variant: 'primary',
                              icon: Check,
                              run: () =>
                                patchReservation(r.id, {
                                  status: 'confirmed',
                                  table_id: r.table_id || undefined,
                                }),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white"
                        >
                          <Check className="w-3.5 h-3.5" /> Confirm
                        </button>
                      )}
                      {r.status === 'confirmed' && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() =>
                            askConfirm({
                              title: 'Check in guest?',
                              description: `${guestLabel(r)} has arrived. They will move to Arrived and wait to be seated.`,
                              confirmLabel: 'Check in',
                              cancelLabel: 'Back',
                              variant: 'warning',
                              icon: UserCheck,
                              run: () => patchReservation(r.id, { action: 'check_in' }),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Check in
                        </button>
                      )}
                      {['confirmed', 'arrived', 'new'].includes(r.status) && (
                        <button
                          type="button"
                          disabled={busyId === r.id || !r.table_id}
                          onClick={() =>
                            askConfirm({
                              title: 'Seat this guest?',
                              description: `Seat ${guestLabel(r)} at Table ${r.table_number || r.table_id}. This opens a normal dine-in order.`,
                              confirmLabel: 'Seat guest',
                              cancelLabel: 'Back',
                              variant: 'primary',
                              icon: Users,
                              run: () => seatReservation(r.id, r.table_id),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white disabled:opacity-40"
                        >
                          Seat
                        </button>
                      )}
                      {['new', 'confirmed', 'arrived', 'seated'].includes(r.status) && (
                        <>
                          {r.status !== 'seated' && (
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => openDetail(r, 'reservation')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-stone-100 text-stone-800"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() =>
                              askConfirm({
                                title:
                                  r.status === 'seated'
                                    ? 'Cancel seating and free table?'
                                    : 'Cancel this reservation?',
                                description:
                                  r.status === 'seated'
                                    ? `${guestLabel(r)} will be cancelled and any open order on this table will be closed. The table will be freed.`
                                    : `${guestLabel(r)} will be cancelled. Any soft table hold will be cleared. This cannot be undone from the board.`,
                                confirmLabel:
                                  r.status === 'seated' ? 'Cancel seating' : 'Yes, cancel booking',
                                cancelLabel: 'Keep reservation',
                                variant: 'danger',
                                icon: X,
                                run: () =>
                                  patchReservation(r.id, {
                                    status: 'cancelled',
                                    cancel_reason: 'restaurant',
                                  }),
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700"
                          >
                            <X className="w-3.5 h-3.5" />{' '}
                            {r.status === 'seated' ? 'Cancel seating' : 'Cancel'}
                          </button>
                          {['confirmed', 'arrived'].includes(r.status) && (
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() =>
                                askConfirm({
                                  title: 'Mark as no-show?',
                                  description: `${guestLabel(r)} did not arrive. The table hold will be released so other guests can use it.`,
                                  confirmLabel: 'Mark no-show',
                                  cancelLabel: 'Keep waiting',
                                  variant: 'warning',
                                  icon: AlertTriangle,
                                  run: () => patchReservation(r.id, { status: 'no_show' }),
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-50 text-orange-900"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" /> No-show
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button type="button" className="absolute inset-0 bg-stone-900/40" aria-label="Close" onClick={() => setSelected(null)} />
          <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-stone-200 max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-stone-100 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-400">
                  {selected._kind === 'reservation' ? 'Reservation' : 'Inquiry'}
                </p>
                <h2 className="text-xl font-semibold text-stone-900 flex items-center gap-2">
                  {selected.name}
                  {!!selected.is_vip && <Star className="w-4 h-4 text-amber-500" />}
                </h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="h-9 w-9 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              {selected._kind === 'reservation' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-stone-400 text-xs">Phone</p>
                      <p className="font-medium text-stone-900">{selected.phone}</p>
                    </div>
                    <div>
                      <p className="text-stone-400 text-xs">Guests</p>
                      <input
                        type="number"
                        min={1}
                        value={partySize}
                        onChange={(e) => setPartySize(Number(e.target.value) || 1)}
                        className="w-full h-9 rounded-lg border border-stone-200 px-2"
                      />
                    </div>
                    <div>
                      <p className="text-stone-400 text-xs">Date</p>
                      <p className="font-medium text-stone-900">{selected.date}</p>
                    </div>
                    <div>
                      <p className="text-stone-400 text-xs">Time</p>
                      <p className="font-medium text-stone-900">{selected.time || '—'}</p>
                    </div>
                  </div>
                  {selected.message && (
                    <div>
                      <p className="text-stone-400 text-xs mb-1">Requests</p>
                      <p className="text-stone-700 whitespace-pre-wrap">{selected.message}</p>
                    </div>
                  )}
                  {['new', 'confirmed', 'arrived', 'seated'].includes(selected.status) && (
                    <div>
                      <label className="text-stone-400 text-xs block mb-1">Table</label>
                      <select
                        value={assignTableId}
                        onChange={(e) => setAssignTableId(e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-200 px-3 text-stone-900"
                      >
                        <option value="">No table yet</option>
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            Table {t.table_number} ({t.capacity || '?'} seats)
                            {t.status && t.status !== 'available' ? ` · ${t.status}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {conflictInfo && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 text-xs space-y-2">
                      <p className="font-semibold">{conflictInfo.error}</p>
                      {conflictInfo.alternatives?.length > 0 && (
                        <p>
                          Try:{' '}
                          {conflictInfo.alternatives
                            .map((a) => `T${a.table_number}`)
                            .join(', ')}
                        </p>
                      )}
                      {(conflictInfo.code === 'table_conflict' || conflictInfo.code === 'deposit_unpaid') && (
                        <button
                          type="button"
                          className="underline font-medium"
                          onClick={() => {
                            if (conflictInfo.code === 'deposit_unpaid') {
                              seatReservation(selected.id, assignTableId || selected.table_id, {
                                force_deposit: true,
                              });
                            } else if (selected.status === 'seated') {
                              changeTable(selected.id, assignTableId, true);
                            } else {
                              patchReservation(selected.id, {
                                table_id: assignTableId ? Number(assignTableId) : null,
                                party_size: partySize,
                                admin_notes: notes,
                                force: true,
                              });
                            }
                          }}
                        >
                          Override anyway
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-stone-400 text-xs">Email</p>
                      <p className="font-medium text-stone-900 break-all">{selected.email}</p>
                    </div>
                    <div>
                      <p className="text-stone-400 text-xs">Phone</p>
                      <p className="font-medium text-stone-900">{selected.phone || '—'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-stone-400 text-xs mb-1">Message</p>
                    <p className="text-stone-700 whitespace-pre-wrap">{selected.message}</p>
                  </div>
                </>
              )}

              <div>
                <label className="text-stone-400 text-xs block mb-1">Admin notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                  placeholder="Internal notes…"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => {
                    if (selected._kind === 'reservation') {
                      if (selected.status === 'seated' && assignTableId && Number(assignTableId) !== selected.table_id) {
                        const t = tables.find((x) => String(x.id) === String(assignTableId));
                        askConfirm({
                          title: 'Change table?',
                          description: `Move ${guestLabel(selected)} and their open order to Table ${t?.table_number || assignTableId}. Kitchen tickets stay on the same order.`,
                          confirmLabel: 'Change table',
                          cancelLabel: 'Keep current',
                          variant: 'warning',
                          icon: MapPin,
                          run: () => changeTable(selected.id, assignTableId),
                        });
                      } else {
                        patchReservation(selected.id, {
                          admin_notes: notes,
                          table_id: assignTableId ? Number(assignTableId) : null,
                          party_size: partySize,
                        });
                      }
                    } else {
                      patchInquiry(selected.id, { admin_notes: notes });
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-stone-900 text-white disabled:opacity-50"
                >
                  Save
                </button>
                {selected._kind === 'reservation' && selected.status === 'confirmed' && (
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() =>
                      askConfirm({
                        title: 'Check in guest?',
                        description: `${guestLabel(selected)} has arrived. They will move to Arrived and wait to be seated.`,
                        confirmLabel: 'Check in',
                        cancelLabel: 'Back',
                        variant: 'warning',
                        icon: UserCheck,
                        run: () => patchReservation(selected.id, { action: 'check_in' }),
                      })
                    }
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white"
                  >
                    Check in
                  </button>
                )}
                {selected._kind === 'reservation' &&
                  ['new', 'confirmed', 'arrived'].includes(selected.status) && (
                    <button
                      type="button"
                      disabled={busyId === selected.id || (!assignTableId && !selected.table_id)}
                      onClick={() => {
                        const tid = assignTableId || selected.table_id;
                        const t = tables.find((x) => String(x.id) === String(tid));
                        askConfirm({
                          title: 'Seat this guest?',
                          description: `Seat ${guestLabel(selected)} at Table ${t?.table_number || tid}. This opens a normal dine-in order.`,
                          confirmLabel: 'Seat guest',
                          cancelLabel: 'Back',
                          variant: 'primary',
                          icon: Users,
                          run: () => seatReservation(selected.id, tid),
                        });
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white disabled:opacity-50"
                    >
                      Seat guest
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button type="button" className="absolute inset-0 bg-stone-900/40" onClick={() => setShowCreate(false)} aria-label="Close" />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-stone-200 max-h-[90vh] overflow-y-auto p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">New reservation</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-stone-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            {[
              ['name', 'Name', 'text'],
              ['phone', 'Phone', 'tel'],
              ['date', 'Date', 'date'],
              ['time', 'Time', 'time'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="text-xs text-stone-500">{label}</label>
                <input
                  type={type}
                  value={createForm[key]}
                  onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full h-10 rounded-lg border border-stone-200 px-3"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-stone-500">Party size</label>
              <input
                type="number"
                min={1}
                value={createForm.party_size}
                onChange={(e) => setCreateForm((f) => ({ ...f, party_size: e.target.value }))}
                className="w-full h-10 rounded-lg border border-stone-200 px-3"
              />
            </div>
            <div>
              <label className="text-xs text-stone-500">Table (optional)</label>
              <select
                value={createForm.table_id}
                onChange={(e) => setCreateForm((f) => ({ ...f, table_id: e.target.value }))}
                className="w-full h-10 rounded-lg border border-stone-200 px-3"
              >
                <option value="">Assign later</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Table {t.table_number} ({t.capacity || '?'} seats)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {[
                ['confirm', 'Confirm now'],
                ['is_vip', 'VIP'],
                ['deposit_required', 'Deposit required'],
                ['high_chair', 'High chair'],
                ['wheelchair', 'Wheelchair'],
                ['outdoor', 'Outdoor'],
              ].map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!createForm[key]}
                    onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {conflictInfo && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <p className="font-semibold">{conflictInfo.error}</p>
                {conflictInfo.alternatives?.length > 0 && (
                  <p className="mt-1">
                    Alternatives: {conflictInfo.alternatives.map((a) => `T${a.table_number}`).join(', ')}
                  </p>
                )}
                <button type="button" className="underline mt-2 font-medium" onClick={() => createReservation(true)}>
                  Force create
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={busyId === 'create'}
              onClick={() => createReservation(false)}
              className="w-full h-11 rounded-xl bg-stone-900 text-white font-medium disabled:opacity-50"
            >
              Create reservation
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel}
        cancelLabel={confirmAction?.cancelLabel}
        variant={confirmAction?.variant || 'danger'}
        icon={confirmAction?.icon}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null);
        }}
        onConfirm={runConfirmedAction}
      />
    </AdminLayout>
  );
}
