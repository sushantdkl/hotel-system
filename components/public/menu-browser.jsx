'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, MessageCircle, Plus, Search, ShoppingBag, Truck, UtensilsCrossed, X } from 'lucide-react';
import DishImage from '@/components/public/dish-image';
import { formatMenuPrice } from '@/lib/menu-format';
import { buildWhatsAppOrderMessage, buildWhatsAppOrderUrl } from '@/lib/whatsapp-order';
import { compactOrderNumber } from '@/lib/document-display.js';

const CART_KEY = 'dsp_cart_v1';
const lineKey = (item, variant) => `${item.id}${variant ? `:${variant.name}` : ''}`;

/** One dish as a menu row: photo, name, short description, then price + add (or one button per size). */
function MenuItem({ item, onAdd }) {
  const hasVariants = item.variants && item.variants.length > 0;
  return (
    <article className="rc-menu-item">
      <DishImage src={item.image} alt={item.name} className="rc-menu-thumb" rounded="rounded-xl" />
      <div style={{ minWidth: 0 }}>
        <h3>
          {item.diet === 'veg' ? <span title="Vegetarian" aria-label="Vegetarian" style={{ display: 'inline-block', width: 9, height: 9, marginRight: 6, borderRadius: '50%', background: 'var(--saag)', verticalAlign: '.1em' }} /> : null}
          {item.name}
        </h3>
        {item.offerBadge ? <p style={{ color: 'var(--wall)', fontWeight: 600 }}>{item.offerBadge}</p> : null}
        {item.description ? <p>{item.description}</p> : null}
        {hasVariants ? (
          <div className="rc-variants">
            {item.variants.map((variant) => (
              <button key={variant.name} type="button" onClick={() => onAdd(item, variant)} className="rc-variant dsp-focus" aria-label={`Add ${item.name}, ${variant.name}`}>
                <span>{variant.name}</span>
                <span><span className="rc-price">{formatMenuPrice(variant.price)}</span><i aria-hidden="true"><Plus /></i></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rc-menu-buy">
            <span className="rc-price">{formatMenuPrice(item.price)}</span>
            <button type="button" onClick={() => onAdd(item)} aria-label={`Add ${item.name}`} className="rc-add dsp-focus"><Plus aria-hidden="true" />Add</button>
          </div>
        )}
      </div>
    </article>
  );
}

function ItemGrid({ items, onAdd }) {
  return <div className="rc-menu-grid">{items.map((item) => <MenuItem key={item.id} item={item} onAdd={onAdd} />)}</div>;
}

function Field({ error, children }) {
  return <div>{children}{error ? <p className="rc-input-error">{error}</p> : null}</div>;
}

export default function MenuBrowser({ categories, whatsappNumber, deliveryPricing = {}, initialCategory = 'all', note = '', restaurantName = '' }) {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState(initialCategory);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderType, setOrderType] = useState('takeaway');
  const [location, setLocation] = useState('');
  const [landmark, setLandmark] = useState('');
  const [deliveryBandId, setDeliveryBandId] = useState('');
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [orderErr, setOrderErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const idempotencyRef = useRef(null);
  const inFlightRef = useRef(false);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const locationRef = useRef(null);
  const deliveryRangeRef = useRef(null);

  // Persist cart across navigation.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (Array.isArray(saved)) setCart(saved);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart]);

  // The open sheet owns the screen: lock page scroll and let Escape close it.
  useEffect(() => {
    if (!cartOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => { if (event.key === 'Escape') setCartOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [cartOpen]);

  const addItem = (item, variant) => {
    const key = lineKey(item, variant);
    setCart((prev) => {
      const found = prev.find((l) => l.key === key);
      if (found) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key, id: item.id, name: item.name, variant: variant?.name || null, price: variant ? variant.price : item.price, qty: 1 }];
    });
  };
  const changeQty = (key, delta) =>
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  const clearCart = () => setCart([]);

  const validateCheckout = () => {
    const errors = {};
    const digits = phone.replace(/\D/g, '');
    if (!name.trim()) errors.name = 'Please enter your name.';
    if (/[A-Za-z]/.test(phone) || digits.length < 10 || digits.length > 15) errors.phone = 'Please enter a valid phone number.';
    if (orderType === 'delivery' && !location.trim()) errors.location = 'Please enter a delivery location.';
    if (orderType === 'delivery' && deliveryPricing.enabled && deliveryPricing.mode === 'distance_bands' && !deliveryBandId) errors.deliveryRange = 'Please choose your delivery distance range.';
    if (orderType === 'delivery' && deliveryPricing.enabled && deliveryPricing.mode === 'per_km' && !(Number(deliveryDistanceKm) > 0)) errors.deliveryDistance = 'Please enter the delivery distance.';
    setFieldErrors(errors);
    const first = errors.name ? nameRef : errors.phone ? phoneRef : errors.location ? locationRef : (errors.deliveryRange || errors.deliveryDistance) ? deliveryRangeRef : null;
    first?.current?.focus();
    if (first) setOrderErr(Object.values(errors)[0]);
    return Object.keys(errors).length === 0;
  };

  async function placeOrder({ openWhatsApp = false } = {}) {
    if (placing || inFlightRef.current) return;
    setOrderErr('');
    if (!validateCheckout()) return;
    if (!idempotencyRef.current) {
      idempotencyRef.current = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const whatsappWindow = openWhatsApp ? window.open('about:blank', '_blank') : null;
    if (whatsappWindow) whatsappWindow.opener = null;
    inFlightRef.current = true;
    setPlacing(true);
    try {
      const res = await fetch('/api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          delivery_address: location.trim(),
          nearby_landmark: landmark.trim(),
          customer_note: customerNote.trim(),
          order_type: orderType,
          delivery_band_id: deliveryBandId || undefined,
          delivery_distance_km: deliveryDistanceKm || undefined,
          idempotency_key: idempotencyRef.current,
          items: cart.map((l) => ({ menu_item_id: l.id, variant_name: l.variant, quantity: l.qty })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setPlaced(compactOrderNumber(j.order_number) || 'your order');
        if (openWhatsApp) {
          const message = buildWhatsAppOrderMessage(j.order, {
            restaurantName: restaurantName || undefined,
            pickupName: restaurantName || undefined,
          });
          const url = buildWhatsAppOrderUrl(whatsappNumber, message);
          if (whatsappWindow) whatsappWindow.location.replace(url);
          else window.open(url, '_blank', 'noopener,noreferrer');
        }
        clearCart();
        idempotencyRef.current = null;
      } else {
        whatsappWindow?.close();
        setOrderErr(j.error || 'Could not place the order. Please try again.');
        if (j.field === 'name') nameRef.current?.focus();
        if (j.field === 'phone') phoneRef.current?.focus();
        if (j.field === 'delivery_address') locationRef.current?.focus();
        if (j.field === 'delivery_range' || j.field === 'delivery_distance_km') deliveryRangeRef.current?.focus();
      }
    } catch {
      whatsappWindow?.close();
      setOrderErr('Network error. Your details are still here — please try again.');
    } finally {
      inFlightRef.current = false;
      setPlacing(false);
    }
  }

  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + l.qty * l.price, 0);
  const selectedBand = (deliveryPricing.bands || []).find((band) => band.id === deliveryBandId);
  const deliveryFee = orderType !== 'delivery' || !deliveryPricing.enabled ? 0
    : deliveryPricing.mode === 'fixed' ? Number(deliveryPricing.fixedFee || 0)
      : deliveryPricing.mode === 'distance_bands' ? Number(selectedBand?.fee || 0)
        : Math.max(Number(deliveryPricing.minimumFee || 0), Number(deliveryDistanceKm || 0) * Number(deliveryPricing.perKmRate || 0));
  const payableTotal = cartTotal + deliveryFee;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const searchResults = useMemo(
    () => (searching ? categories.flatMap((c) => c.items.filter((it) => it.name.toLowerCase().includes(q) || String(it.description || '').toLowerCase().includes(q))) : []),
    [categories, q, searching]
  );
  const totalItems = useMemo(() => categories.reduce((n, c) => n + c.items.length, 0), [categories]);
  const visibleCategories = useMemo(() => {
    if (searching) return [];
    if (activeCat === 'all') return categories;
    return categories.filter((c) => c.id === activeCat);
  }, [categories, activeCat, searching]);

  // Changing category shrinks the list; bring its top back under the sticky bar.
  const resultsRef = useRef(null);
  const pickCategory = (id) => {
    setActiveCat(id);
    if (resultsRef.current?.getBoundingClientRect().top < 0) resultsRef.current.scrollIntoView({ block: 'start' });
  };
  const fieldProps = (key, ref) => ({ ref, 'aria-invalid': Boolean(fieldErrors[key]) || undefined, className: 'rc-input dsp-focus' });

  return (
    <div>
      <div className="rc-menu-controls">
        <div className="rc-wrap rc-menu-controls-inner">
          <div className="rc-search">
            <Search aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes" aria-label="Search the menu" className="dsp-focus" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="dsp-focus"><X style={{ width: '1rem', height: '1rem' }} /></button> : null}
          </div>
          {!searching && (
            <div className="rc-chips" role="tablist" aria-label="Menu categories">
              <Chip label="All" count={totalItems} active={activeCat === 'all'} onClick={() => pickCategory('all')} />
              {categories.map((c) => <Chip key={c.id} label={c.title} count={c.items.length} active={activeCat === c.id} onClick={() => pickCategory(c.id)} />)}
            </div>
          )}
        </div>
      </div>

      <div ref={resultsRef} className="rc-wrap rc-menu-body" style={{ scrollMarginTop: 'calc(var(--nav-h) + 8rem)' }}>
        {searching ? (
          searchResults.length > 0 ? (
            <>
              <p className="rc-lead" style={{ marginBottom: '.5rem' }}>{searchResults.length} {searchResults.length === 1 ? 'dish matches' : 'dishes match'} “{query}”</p>
              <ItemGrid items={searchResults} onAdd={addItem} />
            </>
          ) : (
            <div className="rc-empty">
              <UtensilsCrossed aria-hidden="true" style={{ width: '2rem', height: '2rem', color: 'var(--muted)', margin: '0 auto' }} />
              <h2 className="rc-h3" style={{ marginTop: '.75rem' }}>No dishes match “{query}”</h2>
              <p>Try another word, or clear the search to browse by category.</p>
            </div>
          )
        ) : (
          visibleCategories.map((cat) => (
            <section key={cat.id} id={cat.id} aria-labelledby={`h-${cat.id}`} className="rc-menu-section">
              <div className="rc-menu-section-head">
                <h2 id={`h-${cat.id}`} className="rc-h3" style={{ fontSize: '1.45rem' }}>{cat.title}</h2>
                <span>{cat.items.length} {cat.items.length === 1 ? 'dish' : 'dishes'}</span>
              </div>
              <ItemGrid items={cat.items} onAdd={addItem} />
            </section>
          ))
        )}
        {note ? <p className="rc-menu-note">{note}</p> : null}
      </div>

      {cartCount > 0 && !cartOpen ? (
        <button type="button" onClick={() => setCartOpen(true)} className="rc-cart-button dsp-focus">
          <span>{cartCount} {cartCount === 1 ? 'item' : 'items'} · {formatMenuPrice(cartTotal)}</span>
          <span><ShoppingBag aria-hidden="true" />View order</span>
        </button>
      ) : null}

      {cartOpen ? (
        <div className="rc-sheet-root">
          <button type="button" aria-label="Close your order" className="rc-sheet-scrim" onClick={() => setCartOpen(false)} />
          <div className="rc-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title">
            <div className="rc-sheet-head">
              <h2 id="order-title">Your order</h2>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Close" className="rc-sheet-close dsp-focus"><X style={{ width: '1.1rem', height: '1.1rem' }} /></button>
            </div>

            {placed ? (
              <div className="rc-done">
                <span><Check style={{ width: '1.8rem', height: '1.8rem' }} aria-hidden="true" /></span>
                <h3 className="rc-h2" style={{ fontSize: '1.6rem' }}>Order received</h3>
                <p>Order <strong>{placed}</strong> has gone to our counter. We&apos;ll call <strong>{phone}</strong> to confirm.</p>
                <button type="button" className="rc-btn rc-btn--wall dsp-focus" onClick={() => { setPlaced(null); setCartOpen(false); setName(''); setPhone(''); setLocation(''); setLandmark(''); setCustomerNote(''); setFieldErrors({}); }}>Done</button>
              </div>
            ) : (
              <div className="rc-sheet-scroll">
                {cart.length === 0 ? (
                  <p className="rc-empty" style={{ paddingBlock: '3rem' }}>Your order is empty. Add dishes from the menu.</p>
                ) : (
                  <>
                    {cart.map((l) => (
                      <div key={l.key} className="rc-cart-line">
                        <span style={{ minWidth: 0 }}>
                          <strong>{l.name}{l.variant ? ` · ${l.variant}` : ''}</strong>
                          <small>{formatMenuPrice(l.price)} each</small>
                        </span>
                        <span className="rc-qty">
                          <button type="button" onClick={() => changeQty(l.key, -1)} aria-label={`One less ${l.name}`} className="dsp-focus"><Minus /></button>
                          <span aria-live="polite">{l.qty}</span>
                          <button type="button" onClick={() => changeQty(l.key, 1)} aria-label={`One more ${l.name}`} className="dsp-focus"><Plus /></button>
                        </span>
                        <span className="rc-cart-total">{formatMenuPrice(l.price * l.qty)}</span>
                      </div>
                    ))}

                    <div className="rc-checkout">
                      <div className="rc-segment" role="group" aria-label="Pickup or delivery">
                        {['takeaway', 'delivery'].map((t) => (
                          <button key={t} type="button" aria-pressed={orderType === t} onClick={() => setOrderType(t)} className="dsp-focus">{t === 'takeaway' ? 'Pickup' : 'Delivery'}</button>
                        ))}
                      </div>
                      <Field error={fieldErrors.name}>
                        <input {...fieldProps('name', nameRef)} value={name} autoComplete="name" onChange={(e) => { setName(e.target.value); setFieldErrors((v) => ({ ...v, name: null })); }} placeholder="Your name" aria-label="Your name" />
                      </Field>
                      <Field error={fieldErrors.phone}>
                        <input {...fieldProps('phone', phoneRef)} value={phone} type="tel" autoComplete="tel" inputMode="tel" onChange={(e) => { setPhone(e.target.value); setFieldErrors((v) => ({ ...v, phone: null })); }} placeholder="Phone number" aria-label="Phone number" />
                      </Field>
                      {orderType === 'delivery' && (
                        <>
                          <Field error={fieldErrors.location}>
                            <input {...fieldProps('location', locationRef)} value={location} autoComplete="street-address" onChange={(e) => { setLocation(e.target.value); setFieldErrors((v) => ({ ...v, location: null })); }} placeholder="Delivery location" aria-label="Delivery location" />
                          </Field>
                          <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Nearby landmark (optional)" aria-label="Nearby landmark" className="rc-input dsp-focus" />
                          {deliveryPricing.enabled && deliveryPricing.mode === 'distance_bands' ? (
                            <Field error={fieldErrors.deliveryRange}>
                              <select {...fieldProps('deliveryRange', deliveryRangeRef)} value={deliveryBandId} onChange={(e) => { setDeliveryBandId(e.target.value); setFieldErrors((v) => ({ ...v, deliveryRange: null })); }} aria-label="Delivery distance range">
                                <option value="">Choose delivery distance</option>
                                {(deliveryPricing.bands || []).map((band) => <option key={band.id} value={band.id}>{band.label} · {formatMenuPrice(band.fee)}</option>)}
                              </select>
                            </Field>
                          ) : null}
                          {deliveryPricing.enabled && deliveryPricing.mode === 'per_km' ? (
                            <Field error={fieldErrors.deliveryDistance}>
                              <input {...fieldProps('deliveryDistance', deliveryRangeRef)} type="number" min="0.1" step="0.1" inputMode="decimal" value={deliveryDistanceKm} onChange={(e) => { setDeliveryDistanceKm(e.target.value); setFieldErrors((v) => ({ ...v, deliveryDistance: null })); }} placeholder="Distance from the restaurant (km)" aria-label="Delivery distance in kilometres" />
                            </Field>
                          ) : null}
                        </>
                      )}
                      <textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Note for the kitchen (optional)" aria-label="Note for the kitchen" rows={2} className="rc-input dsp-focus" />
                    </div>

                    <div className="rc-summary">
                      <div><span>Items</span><span>{formatMenuPrice(cartTotal)}</span></div>
                      {orderType === 'delivery' ? (
                        <div><span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}><Truck style={{ width: '.95rem', height: '.95rem' }} aria-hidden="true" />Delivery</span><span>{deliveryPricing.enabled ? (deliveryFee > 0 ? formatMenuPrice(deliveryFee) : selectedBand || deliveryPricing.mode === 'fixed' ? 'Free' : 'Choose distance') : 'Free'}</span></div>
                      ) : null}
                      <div><span>Total</span><span>{formatMenuPrice(payableTotal)}</span></div>
                      {orderType === 'delivery' && deliveryPricing.enabled ? <p>We confirm the distance against your address.</p> : null}
                    </div>

                    {orderErr ? <p className="rc-input-error" role="alert" style={{ marginTop: '.75rem' }}>{orderErr}</p> : null}

                    <div className="rc-sheet-cta">
                      <button type="button" onClick={() => placeOrder()} disabled={placing} className="rc-btn rc-btn--wall dsp-focus"><ShoppingBag aria-hidden="true" />{placing ? 'Placing order…' : 'Place order'}</button>
                      <button type="button" onClick={() => placeOrder({ openWhatsApp: true })} disabled={placing} className="rc-btn rc-btn--ghost dsp-focus"><MessageCircle aria-hidden="true" />{placing ? 'Saving order…' : 'Send on WhatsApp'}</button>
                    </div>
                    {note ? <p className="rc-sheet-note">{note}</p> : null}
                    <button type="button" onClick={clearCart} className="rc-clear dsp-focus">Clear order</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={(e) => { onClick(); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }}
      className="rc-chip dsp-focus"
    >
      {label}<small>{count}</small>
    </button>
  );
}
