'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ShoppingBag, Plus, Minus, X, CheckCircle2, Clock, Leaf, Loader2,
  BellRing, Utensils, ReceiptText, Droplets,
} from 'lucide-react';
import DishImage from '@/components/public/dish-image';
import { compactOrderNumber } from '@/lib/document-display.js';
import { RESTAURANT } from '@/lib/restaurant-info.js';

const rs = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const lineKey = (item, variant) => `${item.id}${variant ? `:${variant.name}` : ''}`;

const WAITER_OPTIONS = [
  { id: 'service', label: 'Need service', detail: 'I need help at the table', icon: BellRing },
  { id: 'order', label: 'Ready to order', detail: 'Please send someone to take our order', icon: Utensils },
  { id: 'bill', label: 'Request bill', detail: 'We are ready for the bill', icon: ReceiptText },
  { id: 'water', label: 'Need water', detail: 'Please bring water to the table', icon: Droplets },
];

function MenuCard({ item, qtyFor, onAdd, onDec, orderingEnabled }) {
  const hasVariants = item.variants && item.variants.length > 0;
  const totalQty = hasVariants
    ? item.variants.reduce((s, v) => s + qtyFor(lineKey(item, v)), 0)
    : qtyFor(lineKey(item));
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative">
        <DishImage src={item.image} alt={item.name} rounded="rounded-none" className="aspect-[4/3] w-full" />
        {item.diet === 'veg' && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 shadow-sm backdrop-blur">
            <Leaf className="h-3 w-3" /> Veg
          </span>
        )}
        {item.offerBadge ? <span className="absolute right-2 top-2 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-extrabold text-white shadow-md">{item.offerBadge}</span> : null}
        {totalQty > 0 && (
          <span className="absolute bottom-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-900 px-1.5 text-xs font-bold text-white shadow">
            {totalQty}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {item.isCombo ? <span className="mb-1 w-fit rounded-full bg-amber-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">COMBO</span> : null}
        {item.offerName ? <span className="mb-0.5 text-[10px] font-semibold text-rose-700">{item.offerName}</span> : null}
        <h3 className="text-sm font-semibold leading-snug text-stone-900 sm:text-base">{item.name}</h3>
        {item.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-stone-500">{item.description}</p>
        ) : null}
        {item.combo ? <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-stone-500">{item.combo.components.map((component, index) => <p key={`${component.id}-${component.variant || ''}-${index}`}>{component.quantity}× {component.name}{component.variant ? ` (${component.variant})` : ''}</p>)}</div> : null}
        <div className="mt-auto pt-2">
          {hasVariants ? (
            <div className="flex flex-col gap-1.5">
              {item.variants.map((v) => {
                const key = lineKey(item, v);
                const qty = qtyFor(key);
                return (
                  <div key={v.name} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-stone-200 px-2.5 py-1.5">
                    <span className="text-xs font-medium text-stone-900">{v.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-bold tabular-nums text-amber-700">{rs(v.price)}</span>
                      {!orderingEnabled ? null : qty === 0 ? (
                        <button type="button" onClick={() => onAdd(item, v)} aria-label={`Add ${item.name} ${v.name}`} className="rounded p-1.5 text-stone-700 hover:bg-stone-100">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-md bg-stone-900 px-1 py-0.5 text-white">
                          <button type="button" onClick={() => onDec(item, v)} aria-label="Remove one" className="rounded p-1.5 hover:bg-white/10">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="min-w-3 text-center text-[11px] font-bold">{qty}</span>
                          <button type="button" onClick={() => onAdd(item, v)} aria-label="Add one" className="rounded p-1.5 hover:bg-white/10">
                            <Plus className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>
                {item.combo?.originalPrice > item.price ? <span className="mr-1.5 text-xs text-stone-400 line-through">{rs(item.combo.originalPrice)}</span> : null}
                <span className="text-sm font-bold tabular-nums text-amber-700 sm:text-base">{rs(item.price)}</span>
                {item.combo?.savings > 0 ? <span className="block text-[10px] font-semibold text-emerald-600">Save {rs(item.combo.savings)}</span> : null}
              </span>
              {!orderingEnabled ? null : totalQty === 0 ? (
                <button
                  type="button"
                  onClick={() => onAdd(item)}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              ) : (
                <div className="flex items-center gap-1 rounded-lg bg-stone-900 px-0.5 text-white">
                  <button type="button" onClick={() => onDec(item)} aria-label="Remove one" className="rounded p-1.5 hover:bg-white/10">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-4 text-center text-xs font-bold">{totalQty}</span>
                  <button type="button" onClick={() => onAdd(item)} aria-label="Add one" className="rounded p-1.5 hover:bg-white/10">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function CustomerOrderPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({});
  const [showCart, setShowCart] = useState(false);
  const [name, setName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [track, setTrack] = useState(null);
  const [activeCat, setActiveCat] = useState('');
  const [showWaiterCall, setShowWaiterCall] = useState(false);
  const [waiterRequest, setWaiterRequest] = useState(null);
  const [callingWaiter, setCallingWaiter] = useState(false);
  const [waiterError, setWaiterError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [promotion, setPromotion] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/order/${token}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load menu.');
      setData(d);
      setActiveCat((c) => c || d.categories?.[0]?.id || '');
      if (d.active_order) setPlaced({ order_id: d.active_order.order_id, order_number: d.active_order.order_number });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const loadWaiterRequest = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/order/${token}/waiter-request`);
      const body = await res.json();
      if (res.ok) setWaiterRequest(body.request || null);
    } catch { /* keep the menu usable if status polling fails */ }
  }, [token]);

  useEffect(() => { loadWaiterRequest(); }, [loadWaiterRequest]);
  useEffect(() => {
    if (!waiterRequest) return undefined;
    const timer = setInterval(loadWaiterRequest, 10000);
    return () => clearInterval(timer);
  }, [waiterRequest, loadWaiterRequest]);

  useEffect(() => {
    if (!placed?.order_id) return undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/order/${token}?order_id=${placed.order_id}`);
        const d = await res.json();
        if (res.ok) setTrack(d.order);
      } catch { /* ignore */ }
    };
    tick();
    pollRef.current = setInterval(tick, 10000);
    return () => clearInterval(pollRef.current);
  }, [placed, token]);

  const items = useMemo(() => Object.values(cart), [cart]);
  const count = items.reduce((s, x) => s + x.qty, 0);
  const total = items.reduce((s, x) => s + x.qty * Number((x.variant ? x.variant.price : x.item.price) || 0), 0);
  const discount = Math.min(total, Number(promotion?.discount || 0));
  // Room-service QR only takes orders while a guest is checked in to that room.
  const roomClosed = Boolean(data?.table?.roomService && !data.table.guestInHouse);
  const orderingEnabled = data?.ordering_enabled !== false && !roomClosed;
  const qtyFor = (key) => cart[key]?.qty || 0;

  const add = (item, variant = null) => {
    const key = lineKey(item, variant);
    setCart((c) => ({ ...c, [key]: { item, variant, qty: (c[key]?.qty || 0) + 1 } }));
  };
  const dec = (item, variant = null) => {
    const key = lineKey(item, variant);
    setCart((c) => {
      const q = (c[key]?.qty || 0) - 1;
      const next = { ...c };
      if (q <= 0) delete next[key];
      else next[key] = { item, variant, qty: q };
      return next;
    });
  };

  const checkPromotion = useCallback(async (code = '') => {
    if (!items.length) { setPromotion(null); return; }
    setCouponBusy(true);
    try {
      const res = await fetch('/api/public/promotions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'qr', coupon_code: code.trim(), items: items.map((x) => ({ menu_item_id: x.item.id, variant_name: x.variant?.name || null, quantity: x.qty })) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not apply coupon.');
      setPromotion(body.promotion || null);
    } catch (promoError) { setPromotion(null); alert(promoError.message); }
    finally { setCouponBusy(false); }
  }, [items]);

  useEffect(() => {
    const timer = setTimeout(() => checkPromotion(couponCode && promotion?.code ? couponCode : ''), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  const place = async () => {
    setPlacing(true);
    try {
      const res = await fetch(`/api/public/order/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: name || null, coupon_code: promotion?.code ? couponCode : undefined, items: items.map((x) => ({ menu_item_id: x.item.id, variant_name: x.variant?.name || null, quantity: x.qty })) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not place order.');
      setCart({});
      setShowCart(false);
      setPlaced({ order_id: d.order_id, order_number: d.order_number });
    } catch (e) {
      alert(e.message);
    } finally {
      setPlacing(false);
    }
  };

  const callWaiter = async (requestType) => {
    setCallingWaiter(true);
    setWaiterError('');
    try {
      const res = await fetch(`/api/public/order/${token}/waiter-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_type: requestType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not call a waiter.');
      setWaiterRequest(body.request);
      setShowWaiterCall(false);
    } catch (callError) {
      setWaiterError(callError.message);
    } finally {
      setCallingWaiter(false);
    }
  };

  if (loading) return <Splash><Loader2 className="h-8 w-8 animate-spin text-amber-600" /></Splash>;
  if (error) {
    return (
      <Splash>
        <div className="text-center">
          <p className="text-lg font-semibold text-stone-800">{error}</p>
          <p className="mt-1 text-sm text-stone-500">Please ask a member of staff for help.</p>
        </div>
      </Splash>
    );
  }

  const cats = data.categories || [];

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#fef3c7_0%,_#f5f0e8_45%,_#fafaf9_100%)] pb-28">
      <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
              {data.table?.roomService ? `Room service · ${data.table.number}` : `Table ${data.table?.number || '—'}${data.table?.floor ? ` · ${data.table.floor}` : ''}`}
            </p>
            <h1 className="truncate font-serif text-xl font-bold tracking-tight text-stone-900 sm:text-3xl">{RESTAURANT.name}</h1>
            <p className="hidden text-sm text-stone-500 sm:block">Order from your table — kitchen gets it instantly.</p>
          </div>
          <button
            type="button"
            onClick={() => !waiterRequest && setShowWaiterCall(true)}
            disabled={Boolean(waiterRequest)}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
              waiterRequest?.status === 'acknowledged'
                ? 'bg-emerald-100 text-emerald-800'
                : waiterRequest
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-stone-900 text-white hover:bg-stone-800'
            }`}
          >
            {waiterRequest?.status === 'acknowledged' ? <CheckCircle2 className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
            <span>{waiterRequest?.status === 'acknowledged' ? 'On the way' : waiterRequest ? 'Waiter called' : 'Call waiter'}</span>
          </button>
        </div>
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto overscroll-x-contain px-4 pb-3 [scrollbar-width:none] sm:px-6">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={(e) => {
                setActiveCat(c.id);
                e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
                document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                activeCat === c.id
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>
      </header>

      {!orderingEnabled && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
            {roomClosed ? 'Room service ordering opens once you are checked in. Please call the front desk.' : 'Self-ordering is paused right now. Browse the menu and a member of staff will take your order.'}
          </div>
        </div>
      )}

      {placed && track && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
            <div className="flex items-center gap-2 text-emerald-900">
              {track.status === 'ready' || track.status === 'served'
                ? <CheckCircle2 className="h-5 w-5" />
                : <Clock className="h-5 w-5" />}
              <p className="font-semibold">{track.status_label}</p>
            </div>
            <p className="mt-1 text-sm text-emerald-800">
              Order {compactOrderNumber(track.order_number)} · {track.items?.reduce((s, i) => s + i.quantity, 0)} item(s). Add more below anytime.
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        {cats.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="mb-10 scroll-mt-36 sm:scroll-mt-44">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-serif text-xl font-bold text-stone-900 sm:text-2xl">{cat.title}</h2>
              <span className="text-xs text-stone-400">{cat.items.length} dishes</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {cat.items.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  qtyFor={qtyFor}
                  onAdd={add}
                  onDec={dec}
                  orderingEnabled={orderingEnabled}
                />
              ))}
            </div>
          </section>
        ))}
        {cats.length === 0 && (
          <p className="py-20 text-center text-stone-500">The menu is being updated. Please check back shortly.</p>
        )}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="mx-auto flex w-full max-w-6xl items-center justify-between rounded-2xl bg-stone-900 px-5 py-3.5 text-white shadow-lg"
          >
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="h-5 w-5" /> {count} item{count > 1 ? 's' : ''}
            </span>
            <span className="font-bold">{rs(total)} · Review</span>
          </button>
        </div>
      )}

      {showCart && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setShowCart(false)} />
          <div className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-bold text-stone-900">Your order</h2>
              <button type="button" onClick={() => setShowCart(false)} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-3">
              {items.map((x) => {
                const price = Number((x.variant ? x.variant.price : x.item.price) || 0);
                return (
                  <div key={lineKey(x.item, x.variant)} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-stone-900">{x.item.name}{x.variant ? ` (${x.variant.name})` : ''}</p>
                      <p className="text-xs text-stone-500">{rs(price)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg bg-stone-100">
                      <button type="button" onClick={() => dec(x.item, x.variant)} aria-label="Remove one" className="p-2"><Minus className="h-4 w-4 text-stone-700" /></button>
                      <span className="min-w-4 text-center text-sm font-bold">{x.qty}</span>
                      <button type="button" onClick={() => add(x.item, x.variant)} aria-label="Add one" className="p-2"><Plus className="h-4 w-4 text-stone-700" /></button>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold text-stone-900 sm:w-20 sm:text-base">{rs(x.qty * price)}</span>
                  </div>
                );
              })}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="mt-4 h-12 w-full rounded-xl border border-stone-300 bg-stone-50 px-4 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            />
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <label className="text-xs font-bold text-stone-800">Offer / coupon</label>
              <div className="mt-1.5 flex gap-2"><input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Coupon code" className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-bold uppercase outline-none focus:border-violet-500" /><button type="button" disabled={couponBusy || !couponCode.trim()} onClick={() => checkPromotion(couponCode)} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{couponBusy ? 'Checking…' : 'Apply'}</button></div>
              {promotion && <p className="mt-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{promotion.name}: save {rs(discount)}</p>}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-4">
              <span className="text-sm text-stone-500">Total</span>
              <span className="text-right"><span className="block text-xl font-bold text-stone-900">{rs(total - discount)}</span>{discount > 0 && <span className="text-xs font-semibold text-emerald-700">You save {rs(discount)}</span>}</span>
            </div>
            <button
              type="button"
              disabled={placing}
              onClick={place}
              className="mt-4 h-14 w-full rounded-2xl bg-amber-600 text-lg font-bold text-white shadow-sm transition hover:bg-amber-500 disabled:opacity-60"
            >
              {placing ? 'Sending…' : placed ? 'Add to my order' : 'Place order'}
            </button>
            <p className="mt-2 text-center text-xs text-stone-400">
              Your order goes straight to the kitchen. Pay at the counter or ask staff.
            </p>
          </div>
        </div>
      )}

      {showWaiterCall && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close waiter request" onClick={() => setShowWaiterCall(false)} />
          <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-lg">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-stone-900">Call a waiter</h2>
                <p className="mt-0.5 text-sm text-stone-500">What can we help with at table {data.table?.number}?</p>
              </div>
              <button type="button" onClick={() => setShowWaiterCall(false)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WAITER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => callWaiter(option.id)}
                  className="min-h-[112px] rounded-lg border border-stone-200 bg-stone-50 p-3 text-left transition-[border-color,background-color,transform] duration-150 hover:border-amber-300 hover:bg-amber-50 active:scale-[0.97] disabled:opacity-60"
                >
                  <option.icon className="h-5 w-5 text-amber-700" />
                  <span className="mt-3 block text-sm font-semibold text-stone-900">{option.label}</span>
                  <span className="mt-1 block text-xs leading-4 text-stone-500">{option.detail}</span>
                </button>
              ))}
            </div>
            {waiterError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{waiterError}</p>}
            {callingWaiter && <p className="mt-3 text-center text-sm text-stone-500">Calling waiter…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Splash({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#fef3c7_0%,_#f5f0e8_45%,_#fafaf9_100%)] p-6">
      {children}
    </div>
  );
}
