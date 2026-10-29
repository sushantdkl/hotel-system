'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ChefHat, Loader2, RefreshCw, X, Ban,
  LayoutGrid, FileText, ShoppingCart, Sparkles, ReceiptText, Clock,
  ArrowLeftRight, Users, Printer, CreditCard, Utensils, ShoppingBag,
  Truck, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import MenuItemImage from '@/components/menu-item-image';
import { formatCurrency } from '@/lib/currency';
import { printKot, printFinalBill, printProforma } from '@/lib/pos-print.js';
import QtyInput from '@/components/ui/qty-input';
import { calculateBillTotals, parseSettingsRates, resolveServiceCharge } from '@/lib/billing-totals';
import { emptyServiceCharge, serviceChargePayload } from '@/components/billing/service-charge-field';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import { emptySplitPayment } from '@/components/billing/split-payment-fields';
import BillPaymentPanel from '@/components/pos/bill-payment-panel';
import OrderStayLink from '@/components/hotel/order-stay-link';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import {
  findPromotionForProduct,
  isPromotionScheduledNow,
  promotionMenuBadgeLabel,
  sortCombosFirst,
} from '@/lib/promotion-display.js';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function token() {
  return typeof window === 'undefined' ? '' : localStorage.getItem('pos_token') || '';
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code, status: res.status, data });
  return data;
}

const STATUS_BADGE = {
  available: 'bg-emerald-100 text-emerald-800',
  occupied: 'bg-blue-100 text-blue-800',
  cooking: 'bg-blue-100 text-blue-800',
  ready: 'bg-blue-100 text-blue-800',
  dining: 'bg-blue-100 text-blue-800',
  awaiting_payment: 'bg-blue-100 text-blue-900',
  cleaning: 'bg-slate-100 text-slate-700',
  reserved: 'bg-red-100 text-red-900',
  reserved_arrived: 'bg-red-100 text-red-900',
};

export default function AdminPos() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const notify = useCallback((description, variant = 'default', opts = {}) => {
    addToast({
      title: opts.title || (variant === 'success' ? 'Success' : variant === 'error' ? 'Error' : variant === 'warning' ? 'Notice' : undefined),
      description,
      variant,
      duration: opts.duration ?? (variant === 'success' ? 2800 : 3500),
    });
  }, [addToast]);

  const [flash, setFlash] = useState(null); // { title, detail } shown 2.5s after KOT/pay
  const flashTimerRef = useRef(null);

  const showSuccessFlash = useCallback((title, detail) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash({ title, detail });
    notify(detail || title, 'success', { title, duration: 2800 });
    flashTimerRef.current = setTimeout(() => setFlash(null), 2800);
  }, [notify]);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paperSize, setPaperSize] = useState('80');
  const [settings, setSettings] = useState({
    vat_percentage: 0,
    service_charge_percentage: 0,
    esewa_qr_image: '',
    bank_qr_image: '',
    restaurant_name: '',
    restaurant_address: '',
    vat_number: '',
    pan_number: '',
    delivery_pricing_enabled: false,
    delivery_pricing_mode: 'fixed',
    delivery_fixed_fee: 0,
  });

  const [tables, setTables] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showBillsPicker, setShowBillsPicker] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [changeTableMode, setChangeTableMode] = useState(false);
  const [partyChooser, setPartyChooser] = useState(null); // { table, parties }
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [clearAllOpen, setClearAllOpen] = useState(false); // custom clear-cart confirm
  const [showCustom, setShowCustom] = useState(false);
  const [customItem, setCustomItem] = useState({ name: '', price: '', quantity: 1 });
  const [variantPicker, setVariantPicker] = useState(null); // product with variants, awaiting a pick
  const [kotNotes, setKotNotes] = useState('');
  // Local cart before first KOT — no DB order/bill until kitchen ticket is cut.
  const [draftLines, setDraftLines] = useState([]);
  const [draftDest, setDraftDest] = useState(null); // { type, table_id?, table_number?, new_party? }

  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState('percent'); // percent | amount
  const [promotion, setPromotion] = useState(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  // Active auto offers — used to badge menu items that currently have a discount.
  const [activeOffers, setActiveOffers] = useState([]);

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [roomStayId, setRoomStayId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [splitPayment, setSplitPayment] = useState(emptySplitPayment);
  const [customerSelection, setCustomerSelection] = useState(emptyCustomerSelection);
  const [deliveryAtCheckout, setDeliveryAtCheckout] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('');
  // Per-bill service / extra charge. `enabled: false` means "use the house rate
  // from Settings"; enabling it makes THIS bill's charge explicit, in % or Rs.
  const [serviceCharge, setServiceCharge] = useState(emptyServiceCharge);
  const [deliveryExecutiveId, setDeliveryExecutiveId] = useState(null);
  const [deliveryExecutives, setDeliveryExecutives] = useState([]);

  const kotKeyRef = useRef(null);
  const payKeyRef = useRef(null);
  const bootstrappedRef = useRef(false);

  const orderId = workspace?.order?.order_id || workspace?.order?.id || null;
  const orderStatus = workspace?.order?.status;
  const canEdit = !orderId || !['completed', 'cancelled'].includes(String(orderStatus || ''));
  const lastKot = useMemo(() => {
    const list = (workspace?.kots || []).filter((k) => !k.voided && k.kot_type !== 'cancellation');
    return list.length ? list[list.length - 1] : null;
  }, [workspace?.kots]);

  const resetPaymentState = useCallback(() => {
    setDiscount(0);
    setDiscountMode('percent');
    setPromotion(null);
    setCouponCode('');
    setPaymentMethod('cash');
    setRoomStayId('');
    setAmountPaid('');
    setSplitPayment(emptySplitPayment);
    setCustomerSelection(emptyCustomerSelection);
    setDeliveryAtCheckout(false);
    setDeliveryFee('');
    setDeliveryExecutiveId(null);
    // A charge chosen for one bill must never carry into the next sale.
    setServiceCharge(emptyServiceCharge);
    payKeyRef.current = null;
  }, []);

  const clearToIdle = useCallback(() => {
    kotKeyRef.current = null;
    setShowTablePicker(false);
    setShowBillsPicker(false);
    setShowPayment(false);
    setChangeTableMode(false);
    setPartyChooser(null);
    setMobileCartOpen(false);
    setDraftLines([]);
    setDraftDest(null);
    setKotNotes('');
    resetPaymentState();
    setWorkspace(null);
  }, [resetPaymentState]);

  const resetToNewSale = useCallback(async () => {
    // Idle counter — no order until KOT is cut.
    clearToIdle();
  }, [clearToIdle]);

  const bindDraftTable = useCallback((table, { newParty = false } = {}) => {
    setDraftDest({
      type: 'dine_in',
      table_id: table.id,
      table_number: table.table_number,
      new_party: newParty,
    });
    setWorkspace(null);
    kotKeyRef.current = null;
    resetPaymentState();
  }, [resetPaymentState]);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      const data = await api('/api/admin/pos/tables');
      setTables(data.tables || []);
    } catch (e) { notify(e.message, 'error'); }
    finally { setLoadingTables(false); }
  }, [notify]);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await api('/api/admin/products?channel=pos');
      setProducts((data.products || []).filter((p) => p.is_available));
    } catch (e) { notify(e.message, 'error'); }
  }, [notify]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api('/api/restaurant/menu/categories');
      setCategories(data.categories || []);
    } catch (e) { notify(e.message, 'error'); }
  }, [notify]);

  const fetchActiveOffers = useCallback(async () => {
    try {
      const data = await api('/api/admin/promotions');
      setActiveOffers(
        (data.promotions || []).filter(
          (promo) =>
            promo.is_active &&
            promo.auto_apply &&
            (promo.channels || []).includes('pos') &&
            isPromotionScheduledNow(promo)
        )
      );
    } catch { /* offers are optional chrome on the menu grid */ }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api('/api/admin/settings');
      const s = data.settings || data || {};
      const size = String(s.receipt_paper_size || s.paper_size || '80').replace('mm', '');
      setPaperSize(['58', '80'].includes(size) ? size : '80');
      setSettings({
        ...s,
        vat_percentage: Number(s.vat_percentage ?? 0),
        service_charge_percentage: Number(s.service_charge_percentage ?? 0),
        esewa_qr_image: s.esewa_qr_image || '',
        bank_qr_image: s.bank_qr_image || '',
        restaurant_name: s.restaurant_name || 'Restaurant',
        restaurant_address: s.restaurant_address || '',
        vat_number: s.vat_number || '',
        pan_number: s.pan_number || '',
        delivery_pricing_enabled: String(s.delivery_pricing_enabled ?? 'false') === 'true',
        delivery_pricing_mode: s.delivery_pricing_mode || 'fixed',
        delivery_fixed_fee: Number(s.delivery_fixed_fee || 0),
      });
    } catch { /* defaults */ }
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchActiveOffers();
    fetchSettings();
    loadTables();
    const onFocus = () => {
      fetchSettings();
      fetchActiveOffers();
    };
    window.addEventListener('focus', onFocus);
    // Re-filter badges when the daily window opens/closes (Nepal schedule).
    const tick = window.setInterval(fetchActiveOffers, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(tick);
    };
  }, [fetchProducts, fetchCategories, fetchActiveOffers, fetchSettings, loadTables]);

  const refreshWorkspace = useCallback(async (id) => {
    const data = await api(`/api/admin/pos/orders/${id}`);
    setWorkspace(data.workspace);
    return data.workspace;
  }, []);

  const openTarget = useCallback(async (payload) => {
    setBusy(true);
    try {
      const data = await api('/api/admin/pos/orders', { method: 'POST', body: JSON.stringify(payload) });
      setWorkspace(data.workspace);
      kotKeyRef.current = null;
      resetPaymentState();
      return data.workspace;
    } catch (e) { notify(e.message, 'error'); return null; }
    finally { setBusy(false); }
  }, [notify, resetPaymentState]);

  const openExisting = useCallback(async (id) => {
    setBusy(true);
    try {
      setDraftLines([]);
      setDraftDest(null);
      const ws = await refreshWorkspace(id);
      kotKeyRef.current = null;
      resetPaymentState();
      if (ws?.reopened) {
        const original = ws.reopen_original || ws.bill || {};
        const order = ws.order || {};
        const hasCustomer = Boolean(order.customer_id || order.customer_phone || order.customer_name);
        setCustomerSelection(hasCustomer ? {
          mode: 'customer',
          phone: String(order.customer_phone || '').replace(/\D/g, ''),
          name: order.customer_name || '',
          address: '',
          customer: order.customer_id ? { id: order.customer_id, name: order.customer_name || '', phone: order.customer_phone || '' } : null,
          isNew: false,
        } : emptyCustomerSelection);
        setDiscountMode('amount');
        setDiscount(Number(original.discount ?? original.discount_amount ?? 0));
        const originalServicePercent = Number(original.service_charge_percent || 0);
        setServiceCharge({
          enabled: true,
          mode: originalServicePercent > 0 ? 'percent' : 'amount',
          value: String(originalServicePercent > 0 ? originalServicePercent : Number(original.service_charge || 0)),
        });
        const isDelivery = String(order.order_type || '').toLowerCase() === 'delivery';
        setDeliveryAtCheckout(isDelivery);
        setDeliveryFee(isDelivery ? String(original.delivery_fee ?? order.delivery_fee ?? 0) : '');
        setDeliveryExecutiveId(order.delivery_executive_id || null);
        const priorMethod = ws.payments?.length === 1 ? String(ws.payments[0].method || 'cash').toLowerCase() : 'cash';
        setPaymentMethod(
          ['qr', 'fonepay', 'esewa', 'khalti', 'bank', 'online'].includes(priorMethod)
            ? 'online'
            : ['cash', 'credit'].includes(priorMethod) ? priorMethod : 'cash'
        );
      }
      setShowBillsPicker(false);
      setShowTablePicker(false);
      return ws;
    } catch (e) { notify(e.message, 'error'); return null; }
    finally { setBusy(false); }
  }, [refreshWorkspace, notify, resetPaymentState]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const resumeId = params?.get('order');
    const tableId = params?.get('table');
    const newParty = params?.get('new_party') === '1';
    const changeTable = params?.get('change') === '1';
    const openPay = params?.get('pay') === '1';

    (async () => {
      setBooting(true);
      try {
        if (resumeId) {
          await openExisting(Number(resumeId));
          if (changeTable) {
            setChangeTableMode(true);
            await loadTables();
            setShowTablePicker(true);
          }
          if (openPay) setShowPayment(true);
        } else if (tableId) {
          const data = await api('/api/admin/pos/tables');
          const board = data.tables || [];
          setTables(board);
          const table = board.find((t) => Number(t.id) === Number(tableId));
          if (newParty && table) {
            // Add-person must create the party order immediately so it shows on the table board.
            await openTarget({ table_id: table.id, new_party: true });
          } else if (!newParty && table?.current_order_id) {
            await openExisting(table.current_order_id);
          } else if (table) {
            bindDraftTable(table, { newParty: false });
          } else {
            setWorkspace(null);
          }
          if (changeTable) {
            setChangeTableMode(true);
            setShowTablePicker(true);
          }
        } else {
          setWorkspace(null);
          if (changeTable) {
            setChangeTableMode(true);
            await loadTables();
            setShowTablePicker(true);
          }
        }
        const base = window.location.pathname.startsWith('/cashier') ? '/cashier/pos' : '/admin/pos';
        window.history.replaceState({}, '', base);
      } finally {
        setBooting(false);
      }
    })();
  }, [openExisting, openTarget, bindDraftTable, loadTables]);

  const filteredProducts = useMemo(() => {
    return sortCombosFirst(
      products.filter((product) => {
        const matchesSearch =
          product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.category_name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory =
          selectedCategory === 'all' ||
          String(product.category_id) === String(selectedCategory) ||
          product.category_name === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    );
  }, [products, searchTerm, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      const key = String(p.category_id ?? '');
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [products]);

  const unsentLines = useMemo(() => {
    if (orderId) return (workspace?.items || []).filter((i) => Number(i.unsent_quantity) > 0);
    return draftLines;
  }, [orderId, workspace, draftLines]);
  const allLines = useMemo(() => {
    if (orderId) return workspace?.items || [];
    return draftLines;
  }, [orderId, workspace, draftLines]);

  /** Best active offer that currently covers a menu product (for grid badges). */
  const offerForProduct = useCallback(
    (product) => findPromotionForProduct(activeOffers, product),
    [activeOffers],
  );

  /** Per-line discount from the promotion currently applied to this bill. */
  const lineOfferDiscount = useCallback((line) => {
    if (!promotion?.lines?.length) {
      if (!promotion) return 0;
      const scope = promotion.scope || 'order';
      const targets = (promotion.target_ids || []).map(Number);
      const menuId = Number(line.menu_item_id || line.item_id || 0);
      const categoryId = Number(line.category_id || 0);
      if (scope === 'order') return null; // bill-level only
      if (scope === 'item' && targets.includes(menuId)) return null; // eligible, amount unknown until lines
      if (scope === 'category' && targets.includes(categoryId)) return null;
      return 0;
    }
    const orderItemId = Number(line.order_item_id || line.id || 0);
    const menuId = Number(line.menu_item_id || line.item_id || 0);
    const match = promotion.lines.find((row) =>
      (orderItemId && Number(row.order_item_id) === orderItemId)
      || (menuId && Number(row.menu_item_id) === menuId && row.eligible)
    );
    return match?.eligible ? Number(match.line_discount || 0) : 0;
  }, [promotion]);

  // A delivery is still a table-less POS order, but is intentionally marked at
  // checkout because that is when the cashier knows whether it is being picked
  // up or sent out and what fee to charge.
  useEffect(() => {
    if (!orderId) {
      setDeliveryAtCheckout(false);
      setDeliveryFee('');
      setDeliveryExecutiveId(null);
      return;
    }
    const existingDelivery = String(workspace?.order?.order_type || '').toLowerCase() === 'delivery';
    setDeliveryAtCheckout(existingDelivery);
    setDeliveryFee(existingDelivery ? String(Number(workspace?.order?.delivery_fee || 0)) : '');
    setDeliveryExecutiveId(existingDelivery ? (workspace?.order?.delivery_executive_id || null) : null);
  // The order id, not every workspace refresh, establishes checkout mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Delivery executive roster, loaded once — the picker filters/searches client-side.
  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/admin/delivery-executives');
        setDeliveryExecutives(data.executives || []);
      } catch { /* non-critical */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const calculateSubtotal = useCallback(
    () => allLines.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    [allLines]
  );

  const getTotals = useCallback(() => {
    const serverTotals = workspace?.totals;
    // A bill may already be awaiting payment when the cashier decides this
    // pickup is actually being delivered. Recalculate locally in that case so
    // the payment allocation includes the newly-entered delivery charge.
    if (serverTotals && orderStatus === 'awaiting_payment' && !deliveryAtCheckout && !serviceCharge.enabled && !promotion) {
      return {
        subtotal: Number(serverTotals.subtotal ?? calculateSubtotal()),
        discount: Number(serverTotals.discount ?? 0),
        tax: Number(serverTotals.tax ?? 0),
        serviceCharge: Number(serverTotals.serviceCharge ?? 0),
        deliveryFee: Number(serverTotals.deliveryFee ?? 0),
        total: Number(serverTotals.total ?? calculateSubtotal()),
        taxPercent: Number(serverTotals.taxPercent ?? settings.vat_percentage),
        servicePercent: Number(serverTotals.servicePercent ?? settings.service_charge_percentage),
      };
    }
    const rates = parseSettingsRates(settings);
    const vatPercent = workspace?.reopened && workspace?.bill?.tax_percent != null
      ? Number(workspace.bill.tax_percent || 0)
      : rates.vatPercent;
    const service = resolveServiceCharge(serviceCharge, rates.servicePercent);
    return calculateBillTotals(calculateSubtotal(), {
      ...(promotion
        ? { discountAmount: promotion.discount }
        : discountMode === 'amount'
        ? { discountAmount: discount }
        : { discountPercent: discount }),
      vatPercent,
      servicePercent: service.servicePercent,
      serviceAmount: service.serviceAmount,
      deliveryFee: deliveryAtCheckout ? Math.max(0, Number(deliveryFee) || 0) : 0,
    });
  }, [calculateSubtotal, deliveryAtCheckout, deliveryFee, discount, discountMode, orderStatus, promotion, serviceCharge, settings, workspace?.totals, workspace?.reopened, workspace?.bill?.tax_percent]);

  const cartCount = allLines.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totals = getTotals();
  const isReopened = Boolean(workspace?.reopened);
  const alreadyPaid = isReopened ? Number(workspace?.already_paid || 0) : 0;
  const amountDue = Math.round((totals.total - alreadyPaid) * 100) / 100;

  const checkPromotion = useCallback(async (code = '') => {
    const lines = orderId
      ? null
      : allLines.map((line) => ({
          menu_item_id: line.menu_item_id || line.item_id || null,
          variant_name: line.variant_name || null,
          quantity: line.quantity,
          price: line.price,
          is_custom: !line.menu_item_id && !line.item_id,
        }));
    if (!orderId && !lines?.length) {
      setPromotion(null);
      return;
    }
    setCouponBusy(true);
    try {
      const result = await api('/api/admin/promotions/preview', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId || undefined,
          coupon_code: code.trim(),
          items: lines || undefined,
        }),
      });
      setPromotion(result.promotion || null);
      if (code && !result.promotion) notify('This coupon does not apply to this bill.', 'warning');
    } catch (error) {
      setPromotion(null);
      notify(error.message, 'warning');
    } finally {
      setCouponBusy(false);
    }
  }, [orderId, allLines, notify]);

  // Live cart preview: apply scheduled auto-offers as soon as the cart changes,
  // not only when the payment modal opens.
  const cartFingerprint = useMemo(
    () => allLines.map((line) => `${line.order_item_id || line.local_id}:${line.quantity}:${line.price}`).join('|'),
    [allLines]
  );
  useEffect(() => {
    if (Number(discount || 0) > 0) {
      setPromotion(null);
      return undefined;
    }
    if (!orderId && !allLines.length) {
      setPromotion(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      checkPromotion(couponCode && promotion?.code ? couponCode : '');
    }, 250);
    return () => window.clearTimeout(timer);
    // Intentionally omit promotion/coupon from deps so we don't re-loop when preview sets them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, cartFingerprint, discount, checkPromotion]);

  useEffect(() => {
    if (showPayment && orderId && Number(discount || 0) === 0) checkPromotion(couponCode || '');
  }, [showPayment, orderId, discount, couponCode, checkPromotion]);

  const buildAllocations = useCallback((total) => {
    const amount = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const common = { notes: splitPayment.notes || undefined };
    let allocations;
    if (paymentMethod === 'cash') {
      allocations = [{ method: 'cash', amount: total, cash_tendered: amountPaid || total, ...common }];
    } else if (paymentMethod === 'online') {
      allocations = [{ method: 'online', amount: total, ...common }];
    } else if (paymentMethod === 'credit') {
      allocations = [{ method: 'credit', amount: total, due_date: splitPayment.creditDueDate || undefined, ...common }];
    } else if (paymentMethod === 'room') {
      if (!roomStayId) throw new Error('Choose the in-house guest to charge this bill to.');
      // Mixed settlement: part paid now (cash / online), the rest to the guest folio.
      const cashNow = amount(splitPayment.roomCash);
      const onlineNow = amount(splitPayment.roomOnline);
      const toRoom = amount(total - cashNow - onlineNow);
      if (toRoom < 0) throw new Error('Cash + online paid now cannot exceed the bill.');
      allocations = [
        { method: 'cash', amount: cashNow, cash_tendered: cashNow, ...common },
        { method: 'online', amount: onlineNow, ...common },
        { method: 'room', amount: toRoom, ...common },
      ].filter((row) => row.amount > 0);
    } else {
      allocations = [
        { method: 'cash', amount: amount(splitPayment.cash), cash_tendered: splitPayment.cashTendered || splitPayment.cash, ...common },
        { method: 'online', amount: amount(splitPayment.qr), ...common },
        { method: 'credit', amount: amount(splitPayment.credit), due_date: splitPayment.creditDueDate || undefined, ...common },
      ].filter((row) => row.amount > 0);
    }
    const allocatedCents = allocations.reduce((sum, row) => sum + Math.round(Number(row.amount || 0) * 100), 0);
    if (allocatedCents !== Math.round(total * 100)) throw new Error('Cash + Online + Credit must equal the invoice total.');
    const cash = allocations.find((row) => row.method === 'cash');
    if (cash && Math.round(Number(cash.cash_tendered || 0) * 100) < Math.round(cash.amount * 100)) {
      throw new Error('Cash tendered must cover the cash allocation.');
    }
    const credit = allocations.find((row) => row.method === 'credit');
    if (credit) {
      // A brand-new customer is fine for credit — the checkout API creates the
      // record before booking the credit, so an existing id is not required.
      // We only need enough detail to create them: a name and a 10-digit phone.
      const digits = String(customerSelection.phone || '').replace(/\D/g, '');
      const canCredit = !!customerSelection.customer?.id
        || (customerSelection.mode === 'customer' && digits.length >= 10 && String(customerSelection.name || '').trim().length > 0);
      if (!canCredit) throw new Error('Credit needs a customer — look one up, or enter a new name and 10-digit phone above.');
    }
    return allocations;
  }, [amountPaid, customerSelection, paymentMethod, roomStayId, splitPayment]);

  const addItem = useCallback(async (product, variant = null) => {
    if (!canEdit) return;
    const price = variant ? Number(variant.price ?? 0) : Number(product.price ?? product.base_price ?? 0);
    const variantName = variant?.variant_name || null;
    const displayName = variantName ? `${product.name} (${variantName})` : product.name;
    const visibleStock = variant ? variant.pos_stock_quantity : product.stock_quantity;
    const existingDraftQty = !orderId
      ? Number(draftLines.find((line) => line.menu_item_id === product.id && line.variant_name === variantName)?.quantity || 0)
      : 0;
    const stockNeeded = variant
      ? (existingDraftQty + 1) * Math.max(0, Number(variant.stock_quantity || 1))
      : existingDraftQty + 1;
    if (visibleStock != null && (Number(visibleStock) <= 0 || (!orderId && stockNeeded > Number(visibleStock)))) {
      notify(`No stock for "${displayName}". This item cannot be ordered.`, 'warning');
      return;
    }
    if (!orderId) {
      setDraftLines((prev) => {
        const existing = prev.find((l) => l.menu_item_id === product.id && l.variant_name === variantName);
        if (existing) {
          return prev.map((l) => {
            if (l.local_id !== existing.local_id) return l;
            const quantity = Number(l.quantity) + 1;
            return { ...l, quantity, unsent_quantity: quantity, subtotal: price * quantity };
          });
        }
        return [...prev, {
          local_id: uid(),
          order_item_id: null,
          menu_item_id: product.id,
          item_name: displayName,
          price,
          quantity: 1,
          sent_quantity: 0,
          unsent_quantity: 1,
          subtotal: price,
          image_url: product.image_url || null,
          category: product.category_name || product.category || 'Menu',
          variant_name: variantName,
        }];
      });
      return;
    }
    setBusy(true);
    try {
      const lines = unsentLines;
      const existing = lines.find((l) => l.menu_item_id === product.id && l.variant_name === variantName && Number(l.sent_quantity || 0) === 0);
      if (existing) {
        const data = await api(`/api/admin/pos/orders/${orderId}/items`, {
          method: 'PATCH',
          body: JSON.stringify({ order_item_id: existing.order_item_id, quantity: Number(existing.quantity) + 1 }),
        });
        setWorkspace(data.workspace);
      } else {
        const data = await api(`/api/admin/pos/orders/${orderId}/items`, {
          method: 'POST',
          body: JSON.stringify({ items: [{ menu_item_id: product.id, quantity: 1, price, variant_name: variantName }] }),
        });
        setWorkspace(data.workspace);
      }
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, canEdit, unsentLines, draftLines, notify]);

  const pickProduct = useCallback((product) => {
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      setVariantPicker(product);
    } else {
      addItem(product);
    }
  }, [addItem]);

  const addCustomToCart = useCallback(async () => {
    if (!canEdit) return;
    const name = customItem.name.trim();
    const price = parseFloat(customItem.price);
    const quantity = Math.max(1, parseInt(customItem.quantity, 10) || 1);
    if (!name || !price || price <= 0) {
      notify('Enter a valid custom item name and price.', 'warning');
      return;
    }
    if (!orderId) {
      setDraftLines((prev) => [...prev, {
        local_id: uid(),
        order_item_id: null,
        menu_item_id: null,
        item_name: name,
        price,
        quantity,
        sent_quantity: 0,
        unsent_quantity: quantity,
        subtotal: price * quantity,
        image_url: null,
        category: 'Custom',
        variant_name: null,
      }]);
      setCustomItem({ name: '', price: '', quantity: 1 });
      setShowCustom(false);
      notify('Custom item added.', 'success');
      return;
    }
    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/orders/${orderId}/items`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ item_name: name, price, quantity }] }),
      });
      setWorkspace(data.workspace);
      setCustomItem({ name: '', price: '', quantity: 1 });
      setShowCustom(false);
      notify('Custom item added.', 'success');
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, canEdit, customItem, notify]);

  const changeQty = useCallback(async (line, delta) => {
    if (!orderId) {
      setDraftLines((prev) => prev.flatMap((l) => {
        if (l.local_id !== line.local_id) return [l];
        const next = Number(l.quantity) + delta;
        if (next <= 0) return [];
        return [{ ...l, quantity: next, unsent_quantity: next, subtotal: Number(l.price) * next }];
      }));
      return;
    }
    const isUnsent = Number(line.unsent_quantity) > 0;
    const sentQty = Number(line.sent_quantity || 0);
    const canEditSent = Boolean(workspace?.reopened);
    const next = Number(line.quantity) + delta;
    if (!canEditSent && sentQty > 0 && next < sentQty) {
      notify('Sent items must be cancelled with a reason.', 'warning');
      return;
    }
    if (!isUnsent && !canEditSent && delta < 0 && sentQty > 0 && Number(line.quantity) === sentQty) {
      notify('Sent items must be cancelled with a reason.', 'warning');
      return;
    }
    setBusy(true);
    try {
      if (next <= 0) {
        if (sentQty > 0 && !canEditSent) {
          const data = await api(`/api/admin/pos/orders/${orderId}/items`, {
            method: 'PATCH', body: JSON.stringify({ order_item_id: line.order_item_id, quantity: sentQty }),
          });
          setWorkspace(data.workspace);
        } else {
          const data = await api(`/api/admin/pos/orders/${orderId}/items?order_item_id=${line.order_item_id}`, { method: 'DELETE' });
          setWorkspace(data.workspace);
        }
      } else {
        const data = await api(`/api/admin/pos/orders/${orderId}/items`, {
          method: 'PATCH', body: JSON.stringify({ order_item_id: line.order_item_id, quantity: next }),
        });
        setWorkspace(data.workspace);
      }
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, notify, workspace?.reopened]);

  const markUnsentAsSent = useCallback(async () => {
    if (!orderId || !unsentLines.length) return;
    if (!kotKeyRef.current) kotKeyRef.current = uid();
    await api(`/api/admin/pos/orders/${orderId}/kot`, {
      method: 'POST', body: JSON.stringify({ idempotency_key: kotKeyRef.current, order_notes: kotNotes.trim() || undefined }),
    });
    kotKeyRef.current = null;
    setKotNotes('');
    await refreshWorkspace(orderId);
  }, [orderId, unsentLines.length, refreshWorkspace, kotNotes]);

  const reprintLastKot = useCallback(async () => {
    if (!lastKot || busy) return;
    const kotId = lastKot.kot_id || lastKot.id;
    if (!kotId) {
      notify('No KOT to reprint.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/kots/${kotId}/reprint`, { method: 'POST' });
      const payload = data.kot || { ...lastKot, is_reprint: true };
      const ok = printKot(payload, { size: paperSize, reprint: true, settings });
      if (!ok) notify('Print was blocked by the browser.', 'warning');
      else showSuccessFlash('KOT reprinted', `${payload.kot_number} sent to printer.`);
      if (orderId) await refreshWorkspace(orderId);
    } catch (e) {
      try {
        printKot({ ...lastKot, is_reprint: true }, { size: paperSize, reprint: true, settings });
        notify('Printed local KOT snapshot.', 'success');
      } catch {
        notify(e.message, 'error');
      }
    } finally { setBusy(false); }
  }, [lastKot, busy, paperSize, notify, orderId, refreshWorkspace, showSuccessFlash]);

  const issueKot = useCallback(async ({ print = false } = {}) => {
    if (busy) return;
    if (!unsentLines.length) {
      if (lastKot && print) return reprintLastKot();
      notify('Add items to the cart first.', 'warning');
      return;
    }
    setBusy(true);
    try {
      let id = orderId;
      if (!id) {
        const createBody = draftDest?.table_id
          ? { table_id: draftDest.table_id, new_party: Boolean(draftDest.new_party) }
          : { order_type: 'takeaway' };
        const created = await api('/api/admin/pos/orders', {
          method: 'POST',
          body: JSON.stringify(createBody),
        });
        id = created.workspace?.order?.order_id || created.workspace?.order?.id || created.order_id;
        if (!id) throw new Error('Could not open the order for KOT.');
        if (draftLines.length) {
          const items = draftLines.map((l) => ({
           menu_item_id: l.menu_item_id || undefined,
           item_name: l.menu_item_id ? undefined : l.item_name,
            variant_name: l.variant_name || undefined,
           price: l.price,
            quantity: l.quantity,
          }));
          const withItems = await api(`/api/admin/pos/orders/${id}/items`, {
            method: 'POST',
            body: JSON.stringify({ items }),
          });
          setWorkspace(withItems.workspace);
        } else {
          setWorkspace(created.workspace);
        }
        setDraftLines([]);
        setDraftDest(null);
      }

      if (!kotKeyRef.current) kotKeyRef.current = uid();
      const key = kotKeyRef.current;
      const data = await api(`/api/admin/pos/orders/${id}/kot`, {
        method: 'POST', body: JSON.stringify({ idempotency_key: key, order_notes: kotNotes.trim() || undefined }),
      });
      kotKeyRef.current = null;
      setKotNotes('');
      if (data.kot && print) {
        const ok = printKot(data.kot, { size: paperSize, settings });
        if (!ok) notify('KOT saved but print was blocked. Use Reprint KOT.', 'warning');
        else showSuccessFlash('KOT sent', data.idempotent ? 'KOT reprinted to kitchen.' : `${data.kot.kot_number} sent to kitchen.`);
      } else if (data.kot) {
        showSuccessFlash('KOT sent', data.idempotent ? 'KOT already issued.' : `${data.kot.kot_number} sent to kitchen.`);
      }
      const refreshed = await refreshWorkspace(id);
      await loadTables();
      return refreshed;
    } catch (e) {
      notify(e.message, 'error');
      if (e.code === 'no_unsent_items') kotKeyRef.current = null;
      return null;
    } finally { setBusy(false); }
  }, [busy, unsentLines.length, lastKot, reprintLastKot, orderId, draftDest, draftLines, paperSize, notify, refreshWorkspace, loadTables, showSuccessFlash, kotNotes]);

  const saveAndPrintKot = useCallback(() => {
    if (!unsentLines.length && lastKot) return reprintLastKot();
    return issueKot({ print: true });
  }, [unsentLines.length, lastKot, reprintLastKot, issueKot]);
  const saveKotOnly = useCallback(() => issueKot({ print: false }), [issueKot]);

  const openPaymentPanel = useCallback(() => {
    if (!orderId) {
      notify('Send a KOT first — payment starts after the kitchen ticket.', 'warning');
      return;
    }
    const due = workspace?.reopened
      ? Math.max(0, Math.round((getTotals().total - Number(workspace?.already_paid || 0)) * 100) / 100)
      : getTotals().total;
    setPaymentMethod('cash');
    setAmountPaid(String(due || ''));
    setShowPayment(true);
  }, [getTotals, notify, orderId, workspace]);

  const sendKotAndOpenPayment = useCallback(async () => {
    const refreshed = await issueKot({ print: true });
    if (refreshed) openPaymentPanel();
  }, [issueKot, openPaymentPanel]);

  const printBillOnly = useCallback(async () => {
    if (!orderId || busy) {
      if (!orderId) notify('Send a KOT first — no bill until kitchen ticket is cut.', 'warning');
      return;
    }
    if (!allLines.length) { notify('Add items to the cart first.', 'warning'); return; }
    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/orders/${orderId}/bill`);
      const billCustomer = customerSelection?.mode === 'customer'
        ? String(customerSelection.customer?.name || customerSelection.name || '').trim()
        : '';
      const ok = printProforma({ ...data.proforma, customer_name: billCustomer || data.proforma?.order?.customer_name || '' }, { size: paperSize, settings });
      if (!ok) notify('Print was blocked by the browser.', 'warning');
      else notify('Bill printed (preview — not paid).', 'success');
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, busy, allLines.length, paperSize, notify, settings, customerSelection]);

  const clearCart = useCallback(async ({ skipConfirm = false } = {}) => {
    if (busy) return;
    if (!orderId) {
      if (!draftLines.length) { await resetToNewSale(); return; }
      if (!skipConfirm) {
        const ok = await confirm({
          title: 'Clear the draft cart?',
          message: 'This removes every item from the draft. Nothing has been sent to the kitchen yet.',
          confirmLabel: 'Clear everything',
          tone: 'delete',
        });
        if (!ok) return;
      }
      setDraftLines([]);
      notify('Cart cleared.', 'success');
      return;
    }
    if (!allLines.length) { await resetToNewSale(); return; }
    const removable = workspace?.reopened
      ? allLines
      : allLines.filter((l) => Number(l.unsent_quantity) > 0 || Number(l.sent_quantity || 0) === 0);
    if (!removable.length) {
      notify(workspace?.reopened ? 'Nothing left to clear.' : 'Sent items stay on the order — cancel them individually.', 'warning');
      return;
    }
    if (!skipConfirm) {
      const ok = await confirm({
        title: workspace?.reopened ? 'Clear this reopened bill?' : 'Clear unsent items?',
        message: workspace?.reopened
          ? 'This removes every item from the cart. The customer may be owed a refund on Complete Sale.'
          : 'This clears unsent items only. Items already sent to the kitchen stay on the order.',
        confirmLabel: 'Clear everything',
        tone: 'delete',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      for (const line of [...removable].reverse()) {
        const sentQty = Number(line.sent_quantity || 0);
        if (sentQty > 0 && !workspace?.reopened) {
          await api(`/api/admin/pos/orders/${orderId}/items`, {
            method: 'PATCH',
            body: JSON.stringify({ order_item_id: line.order_item_id, quantity: sentQty }),
          });
        } else {
          await api(`/api/admin/pos/orders/${orderId}/items?order_item_id=${line.order_item_id}`, { method: 'DELETE' });
        }
      }
      const ws = await refreshWorkspace(orderId);
      if (!(ws?.items || []).length && !workspace?.reopened) await resetToNewSale();
      else setWorkspace(ws);
      notify('Cart cleared.', 'success');
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, busy, allLines, draftLines, refreshWorkspace, resetToNewSale, notify, workspace?.reopened, confirm]);

  const completeSale = useCallback(async () => {
    if (!orderId || busy) return;
    if (!allLines.length) { notify('Add items to the cart first.', 'warning'); return; }

    const billTotals = getTotals();
    const paidAlready = workspace?.reopened ? Number(workspace?.already_paid || 0) : 0;
    const dueNow = Math.round((billTotals.total - paidAlready) * 100) / 100;

    let allocations = [];
    if (dueNow > 0.009) {
      try { allocations = buildAllocations(dueNow); }
      catch (error) { notify(error.message, 'warning'); return; }
    }

    const customerCheck = validateCustomerSelection(customerSelection);
    if (!customerCheck.ok) {
      notify(customerCheck.message, 'warning');
      return;
    }

    if (!payKeyRef.current) payKeyRef.current = uid();

    // Server refuses payment while unsent lines exist — block here with a clear action.
    if (unsentLines.length) {
      notify('Send or remove unsent items (KOT) before settling this bill.', 'warning');
      return;
    }

    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/orders/${orderId}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: payKeyRef.current,
          payment_method: paymentMethod,
          room_reservation_id: paymentMethod === 'room' ? roomStayId : undefined,
          use_package: paymentMethod === 'room' ? splitPayment.usePackage !== false : undefined,
          discount: promotion ? 0 : billTotals.discount,
          coupon_code: promotion?.code ? couponCode : undefined,
          promotion_id: promotion?.id || undefined,
          allocations,
          customer_mode: customerSelection.mode,
          customer_name: customerCheck.name,
          customer_phone: customerCheck.phone,
          customer_address: customerCheck.address || customerSelection.address || '',
          // Mode + value, never a computed amount: the server re-prices.
          ...serviceChargePayload(serviceCharge),
          delivery: deliveryAtCheckout,
          delivery_fee: deliveryAtCheckout ? billTotals.deliveryFee : 0,
          delivery_executive_id: deliveryAtCheckout ? deliveryExecutiveId : null,
        }),
      });
      printFinalBill(data.receipt, { size: paperSize, settings });
      showSuccessFlash('Payment recorded', data.message || 'Bill paid and receipt printed.');
      setShowPayment(false);
      await resetToNewSale();
      await loadTables();
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, busy, allLines.length, unsentLines.length, notify, customerSelection, resetToNewSale, paperSize, workspace, loadTables, showSuccessFlash, buildAllocations, getTotals, deliveryAtCheckout, deliveryExecutiveId, promotion, couponCode, paymentMethod, roomStayId, serviceCharge, settings, splitPayment.usePackage]);

  const selectTable = useCallback(async (table) => {
    if (changeTableMode && orderId) {
      setBusy(true);
      try {
        const data = await api(`/api/admin/pos/orders/${orderId}`, {
          method: 'PATCH',
          body: JSON.stringify({ table_id: table.id }),
        });
        setWorkspace(data.workspace);
        setChangeTableMode(false);
        setShowTablePicker(false);
        notify(`Moved to table ${table.table_number}.`, 'success');
        await loadTables();
      } catch (e) { notify(e.message, 'error'); }
      finally { setBusy(false); }
      return;
    }

    const parties = table.parties || [];
    if (parties.length > 1) {
      setPartyChooser({ table, parties });
      return;
    }

    setShowTablePicker(false);
    if (table.current_order_id && parties.length === 1) {
      setBusy(true);
      try { await openExisting(table.current_order_id); }
      finally { setBusy(false); }
      return;
    }

    // Empty table (or free) — bind destination only; order is created on first KOT.
    bindDraftTable(table, { newParty: false });
    notify(`Table ${table.table_number} selected. Add items, then cut KOT.`, 'success');
  }, [changeTableMode, orderId, openExisting, notify, loadTables, bindDraftTable]);

  const addAnotherPerson = useCallback(async (table) => {
    if (!table?.id && !table?.table_id) {
      notify('Pick a table first.', 'warning');
      return;
    }
    const tableId = table.id || table.table_id;
    const tableNumber = table.table_number;
    const partyCount = Number(table.party_count || table.parties?.length || 0);
    const ok = await confirm({
      title: `Add another person on table ${tableNumber}?`,
      message: partyCount > 0
        ? `This opens a new separate tab on table ${tableNumber} (alongside the ${partyCount} already seated). They order and pay independently.`
        : `This opens a new separate tab on table ${tableNumber}. They order and pay independently.`,
      confirmLabel: 'Add person',
      cancelLabel: 'Cancel',
      tone: 'default',
    });
    if (!ok) return;
    setShowTablePicker(false);
    setPartyChooser(null);
    setChangeTableMode(false);
    setDraftLines([]);
    setDraftDest(null);
    const ws = await openTarget({ table_id: tableId, new_party: true });
    if (!ws) return;
    notify(`New party opened on table ${tableNumber}. Add items, then cut KOT.`, 'success');
    await loadTables();
  }, [openTarget, notify, loadTables, confirm]);

  const removeParty = useCallback(async (party, table) => {
    const label = party.party_label || party.order_number || `order #${party.order_id}`;
    const tableLabel = table?.table_number ? ` from table ${table.table_number}` : '';
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: `This cancels that person's order${tableLabel}. This cannot be undone.`,
      confirmLabel: 'Remove party',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/admin/orders/${party.order_id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'void', reason: 'Removed party from table' }),
      });
      notify(`${label} removed.`, 'success');
      if (Number(orderId) === Number(party.order_id)) clearToIdle();
      setPartyChooser(null);
      await loadTables();
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, clearToIdle, notify, loadTables, confirm]);

  const movePartyToTable = useCallback(async (partyOrderId, targetTableId, targetTableNumber) => {
    if (!partyOrderId || !targetTableId) return;
    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/orders/${partyOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ table_id: targetTableId }),
      });
      if (Number(orderId) === Number(partyOrderId)) setWorkspace(data.workspace);
      notify(`Moved to table ${targetTableNumber}.`, 'success');
      await loadTables();
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [orderId, notify, loadTables]);

  const confirmCancelSent = useCallback(async (reason, prepared, quantity) => {
    if (!cancelTarget || !orderId) return;
    setBusy(true);
    try {
      const data = await api(`/api/admin/pos/orders/${orderId}/cancel-item`, {
        method: 'POST',
        body: JSON.stringify({ order_item_id: cancelTarget.order_item_id, reason, prepared, quantity }),
      });
      setWorkspace(data.workspace);
      if (data.cancellation_kot) printKot(data.cancellation_kot, { size: paperSize, settings });
      notify(quantity < cancelTarget.quantity ? `${quantity} cancelled.` : 'Item cancelled.', 'success');
      setCancelTarget(null);
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); }
  }, [cancelTarget, orderId, paperSize, notify]);

  if (booting) {
    return (
      <div className="admin-page-content flex h-[calc(100dvh-3.5rem)] items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading POS…
      </div>
    );
  }

  const destLabel = orderId
    ? (workspace?.order?.table_number
      ? `Table ${workspace.order.table_number}${workspace?.order?.party_label ? ` · ${workspace.order.party_label}` : ''}`
      : workspace?.order?.order_type === 'delivery' ? 'Delivery' : 'Takeaway')
    : draftDest?.table_number
      ? `Table ${draftDest.table_number}${draftDest.new_party ? ' · New party' : ''} (draft)`
      : draftLines.length
        ? 'Takeaway draft — KOT creates order'
        : 'Ready — pick a table or add items';

  return (
    <div className="admin-page-content relative flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] lg:h-dvh overflow-hidden">
      {flash && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[95] flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-600 px-4 py-3 text-white shadow-2xl">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold">✓</div>
            <div>
              <p className="text-sm font-bold">{flash.title}</p>
              {flash.detail && <p className="text-xs text-emerald-50 mt-0.5">{flash.detail}</p>}
            </div>
          </div>
        </div>
      )}
      {/* Products — original New Sale layout */}
      <div className="flex-1 flex flex-col bg-gradient-to-br from-blue-50 to-white min-h-0 min-w-0">
        <header className="bg-white border-b border-blue-200 px-3 sm:px-6 py-3 sm:py-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">Point of Sale</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {destLabel}
                {workspace?.order?.order_number ? ` · ${workspace.order.order_number}` : ''}
                {orderId ? <span className="ml-2"><OrderStayLink orderId={orderId} compact /></span> : null}
                {orderStatus && (
                  <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[orderStatus] || 'bg-gray-100 text-gray-700'}`}>
                    {String(orderStatus).replace(/_/g, ' ')}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setChangeTableMode(false); loadTables(); setShowTablePicker(true); }}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border-2 border-blue-200 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-blue-50 disabled:opacity-50"
              >
                <LayoutGrid className="w-4 h-4" /> Table
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setChangeTableMode(true); loadTables(); setShowTablePicker(true); }}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border-2 border-amber-200 bg-white text-xs sm:text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                <ArrowLeftRight className="w-4 h-4" /> Change table
              </button>
              {(workspace?.order?.table_id || draftDest?.table_id) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => addAnotherPerson({
                    id: workspace?.order?.table_id || draftDest.table_id,
                    table_number: workspace?.order?.table_number || draftDest.table_number,
                  })}
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border-2 border-violet-200 bg-white text-xs sm:text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                >
                  <Users className="w-4 h-4" /> Add person
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowBillsPicker(true)}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border-2 border-blue-200 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-blue-50 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" /> Bills
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={resetToNewSale}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border-2 border-blue-200 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-blue-50 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> New
              </button>
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-xs sm:text-sm font-semibold hover:bg-stone-800"
              >
                <Sparkles className="w-4 h-4" />
                Custom item
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Search menu..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 border-2 border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 text-slate-900"
            />
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/50">
            <button
              type="button"
              onClick={() => setCategoriesExpanded((open) => !open)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50"
              aria-expanded={categoriesExpanded}
              aria-controls="pos-category-list"
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold uppercase tracking-wide text-slate-700">Categories</span>
                {!categoriesExpanded && (
                  <span className="block truncate text-xs text-slate-500">
                    {selectedCategory === 'all'
                      ? `Showing all ${products.length} menu items`
                      : `Showing ${categories.find((cat) => String(cat.id) === String(selectedCategory))?.name || 'selected category'}`}
                  </span>
                )}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-blue-700">
                {categoriesExpanded ? 'Hide categories' : 'Show categories'}
                {categoriesExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>
            <div
              id="pos-category-list"
              className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${categoriesExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex max-h-[26dvh] flex-wrap gap-2 overflow-y-auto border-t border-blue-100 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      selectedCategory === 'all'
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    All ({products.length})
                  </button>
                  {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(String(cat.id))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  String(selectedCategory) === String(cat.id)
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="text-base leading-none">{cat.icon || '🍽️'}</span>
                {cat.name} ({categoryCounts.get(String(cat.id)) || 0})
              </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 lg:pb-6">
          {!canEdit && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              This order is closed and cannot be edited.
            </div>
          )}
          {canEdit && orderStatus === 'awaiting_payment' && (
            <div className="mb-3 rounded-xl bg-sky-50 border border-sky-200 p-3 text-sm text-sky-900">
              Ready to pay — you can still add items and send another KOT, or complete payment in the cart.
            </div>
          )}
          {!orderId && draftLines.length > 0 && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              Draft cart only — order and bill are created when you cut the first KOT.
            </div>
          )}
          {isReopened && canEdit && (
            <div className="mb-3 rounded-xl bg-violet-50 border border-violet-300 p-3 text-sm text-violet-950 shadow-sm">
              <p className="font-bold">Reopened bill — edit, send KOT, then settle</p>
              <p className="text-xs mt-0.5">
                Previous payment: {formatCurrency(alreadyPaid)}. New quantities remain unsent until a KOT is issued.
                {amountDue > 0.009
                  ? ` Collect ${formatCurrency(amountDue)} more.`
                  : amountDue < -0.009
                    ? ` Refund ${formatCurrency(Math.abs(amountDue))}.`
                    : ' No extra balance.'}
              </p>
              <p className="mt-2 text-xs font-semibold">
                {unsentLines.length
                  ? `Next: send ${unsentLines.reduce((sum, line) => sum + Number(line.unsent_quantity || line.quantity || 0), 0)} new item(s) to kitchen.`
                  : 'Kitchen is up to date. You can settle the revised bill.'}
              </p>
            </div>
          )}
          {filteredProducts.length === 0 ? (
            <div className="text-center text-slate-500 py-16">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No menu items found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4">
              {filteredProducts.map((product) => {
                const menuOffer = offerForProduct(product);
                const offerLabel = promotionMenuBadgeLabel(menuOffer);
                const variantStocks = (product.variants || []).filter((variant) => variant.pos_stock_quantity != null);
                const isOutOfStock = product.stock_quantity != null
                  ? Number(product.stock_quantity) <= 0
                  : variantStocks.length > 0 && variantStocks.every((variant) => Number(variant.pos_stock_quantity) <= 0);
                return (
                <button
                  key={product.id}
                  type="button"
                  disabled={busy || !canEdit}
                  onClick={() => pickProduct(product)}
                  className={`relative overflow-hidden rounded-xl border p-3 text-left transition-transform active:scale-[0.98] sm:p-4 disabled:opacity-50 ${
                    isOutOfStock
                      ? 'border-red-200 bg-red-50/40 hover:border-red-300'
                      : menuOffer
                        ? 'border-rose-200 bg-rose-50/30 hover:border-rose-400 hover:shadow-md'
                        : 'border-blue-100 bg-white hover:border-blue-400 hover:shadow-md'
                  }`}
                >
                  <div className="relative aspect-square rounded-lg mb-2 overflow-hidden bg-stone-100">
                    <MenuItemImage
                      src={product.image_url}
                      alt={product.name}
                      size="card"
                      className="rounded-lg w-full h-full"
                    />
                    {product.stock_quantity != null && (
                      <span
                        className={`absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${
                          Number(product.stock_quantity) <= 0
                            ? 'bg-red-600'
                            : Number(product.stock_quantity) <= 5
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                        }`}
                      >
                        {product.stock_quantity} {product.stock_unit || ''}
                      </span>
                    )}
                    {product.stock_quantity != null && Number(product.stock_quantity) <= 0 && (
                      <span className="absolute inset-x-2 bottom-2 rounded-md bg-red-600 px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white">No stock</span>
                    )}
                    {product.combo && <span className="absolute left-1 top-1 rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold text-white">COMBO</span>}
                    {offerLabel && (
                      <span className={`absolute ${product.combo ? 'left-1 top-7' : 'left-1 top-1'} inline-flex items-center gap-0.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white`}>
                        <Sparkles className="h-2.5 w-2.5" /> {offerLabel}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-slate-900 text-xs sm:text-sm line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
                  <p className="text-[11px] text-slate-500 truncate mb-1">{product.category_name || product.category || 'Menu'}</p>
                  {menuOffer && <p className="mb-1 truncate text-[10px] font-semibold text-rose-700">{menuOffer.name}</p>}
                  {product.combo && <p className="mb-1 line-clamp-2 text-[10px] leading-snug text-slate-500">{product.combo.components.map((component) => `${component.quantity}× ${component.name}${component.variant_name ? ` (${component.variant_name})` : ''}`).join(' · ')}</p>}
                  {product.variants?.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold text-blue-600">{product.variants.length} options</p>
                      {variantStocks.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Variation stock">
                          {variantStocks.map((variant) => (
                            <span key={variant.id || variant.variant_name} className={`max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-bold ${Number(variant.pos_stock_quantity) <= 0 ? 'bg-red-100 text-red-700' : Number(variant.pos_stock_quantity) <= 5 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                              {variant.variant_name}: {Number(variant.pos_stock_quantity) <= 0 ? 'out' : `${variant.pos_stock_quantity} ${variant.pos_stock_unit || ''}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div><p className="text-base sm:text-lg font-bold text-blue-600">{formatCurrency(product.price || product.base_price || 0)}</p>{product.combo?.savings > 0 && <p className="text-[10px] font-semibold text-emerald-600">Save {formatCurrency(product.combo.savings)}</p>}</div>
                  )}
                </button>
              );
              })}
            </div>
          )}
        </div>
      </div>

      {variantPicker && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-stone-900">{variantPicker.name}</h3>
              <button type="button" onClick={() => setVariantPicker(null)} className="p-1 text-stone-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-stone-500 mb-3">Choose an option</p>
            <div className="space-y-2">
              {variantPicker.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => { addItem(variantPicker, variant); setVariantPicker(null); }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border active:scale-[0.98] transition-transform ${
                    variant.pos_stock_quantity != null && Number(variant.pos_stock_quantity) <= 0
                      ? 'border-red-200 bg-red-50 text-red-900'
                      : 'border-stone-200 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  <span className="font-medium text-stone-900">{variant.variant_name}</span>
                  <span className="flex items-center gap-2">
                    {variant.pos_stock_quantity != null && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${Number(variant.pos_stock_quantity) <= 0 ? 'bg-red-600' : Number(variant.pos_stock_quantity) <= 5 ? 'bg-amber-500' : 'bg-emerald-600'}`}>{Number(variant.pos_stock_quantity) <= 0 ? 'No stock' : `${variant.pos_stock_quantity} ${variant.pos_stock_unit || ''}`}</span>}
                    <span className="font-bold text-blue-600">{formatCurrency(variant.price || 0)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCustom && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-stone-900">Add custom item</h3>
              <button type="button" onClick={() => setShowCustom(false)} className="p-1 text-stone-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-stone-700">Item name</label>
                <input
                  value={customItem.name}
                  onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
                  placeholder="e.g. Extra sauce"
                  className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-stone-700">Price (Rs)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customItem.price}
                    onChange={(e) => setCustomItem({ ...customItem, price: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-stone-700">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={customItem.quantity}
                    onChange={(e) => setCustomItem({ ...customItem, quantity: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={addCustomToCart}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white font-semibold disabled:opacity-50"
              >
                Add to cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile cart FAB — blue like original billing */}
      <button
        type="button"
        onClick={() => setMobileCartOpen(true)}
        className="lg:hidden fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full bg-blue-600 text-white pl-4 pr-5 py-3 shadow-xl active:scale-95"
      >
        <ShoppingCart className="w-5 h-5" />
        <span className="font-bold">{formatCurrency(totals.total)}</span>
        {cartCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1 rounded-full bg-red-500 text-xs font-bold flex items-center justify-center">
            {cartCount}
          </span>
        )}
      </button>

      {mobileCartOpen && (
        <button
          type="button"
          aria-label="Close cart"
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMobileCartOpen(false)}
        />
      )}

      {/* Cart panel */}
      <div
        className={`
          bg-white border-blue-200 flex flex-col shadow-xl min-h-0
          fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] rounded-t-2xl border-t-2 transition-transform duration-200
          lg:static lg:z-auto lg:h-full lg:max-h-none lg:rounded-none lg:translate-y-0 lg:w-[440px] xl:w-[540px] lg:border-t-0 lg:border-l-2
          ${mobileCartOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
          ${mobileCartOpen ? '' : 'lg:flex'}
        `}
      >
        <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-3 sm:px-4 pt-3 pb-2 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-white shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Current Order</h2>
              <p className="text-[11px] text-slate-500">{destLabel}</p>
              {workspace?.order?.created_at && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium tabular-nums text-slate-500">
                  <Clock className="h-3 w-3" /> Opened {formatOrderOpenedAt(workspace.order.created_at)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {allLines.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setClearAllOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear all
                </button>
              )}
              <button
                type="button"
                disabled={!orderId || busy}
                onClick={() => orderId && refreshWorkspace(orderId)}
                className="p-2 rounded-lg text-slate-500 hover:bg-blue-50 disabled:opacity-40"
                aria-label="Refresh cart"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="lg:hidden text-sm font-semibold text-blue-600 px-2 py-1"
                onClick={() => setMobileCartOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-[160px] overflow-y-auto p-3 sm:p-4">
          {allLines.length === 0 ? (
            <div className="text-center text-slate-500 py-8">
              <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-semibold text-sm">Cart is empty</p>
              <p className="text-xs">Add items to get started</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {allLines.map((line) => {
                const isUnsent = Number(line.unsent_quantity) > 0;
                const sentQty = Number(line.sent_quantity || 0);
                const fullySent = sentQty > 0 && !isUnsent && !workspace?.reopened;
                const canAdjustQty = canEdit && (isUnsent || workspace?.reopened || Boolean(orderId));
                const rowKey = line.order_item_id || line.local_id;
                const offerAmt = lineOfferDiscount(line);
                const onOffer = offerAmt === null || offerAmt > 0;
                return (
                  <div
                    key={rowKey}
                    className={`rounded-xl p-2.5 border shadow-sm ${
                      isUnsent || !orderId ? 'bg-white border-blue-200' : 'bg-blue-50/40 border-blue-100'
                    } ${onOffer && promotion ? 'ring-1 ring-rose-200' : ''}`}
                  >
                    <div className="flex gap-2.5">
                      <MenuItemImage
                        src={line.image_url}
                        alt={line.item_name}
                        size="md"
                        className="!w-14 !h-14 rounded-xl ring-1 ring-blue-100"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <h4 className="font-bold text-slate-900 text-sm leading-tight line-clamp-2">{line.item_name}</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                              {line.category || (line.menu_item_id ? 'Item' : 'Custom')}
                              {!orderId ? ' · Draft' : isUnsent ? ' · Not sent' : workspace?.reopened ? ' · Reopened' : ' · In kitchen'}
                            </p>
                            <p className="text-xs text-blue-600 font-semibold mt-0.5">
                              {formatCurrency(line.price || 0)} each
                            </p>
                            {onOffer && promotion && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                                <Sparkles className="h-3 w-3" />
                                {promotion.name}
                                {offerAmt > 0 ? ` · −${formatCurrency(offerAmt)}` : ''}
                              </p>
                            )}
                          </div>
                          {(isUnsent || !orderId || workspace?.reopened) && canEdit ? (
                            <button
                              type="button"
                              onClick={() => changeQty(line, -line.quantity)}
                              className="text-red-500 p-1.5 rounded-lg active:bg-red-100 flex-shrink-0"
                              aria-label={`Remove ${line.item_name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : fullySent && canEdit ? (
                            <button
                              type="button"
                              onClick={() => setCancelTarget({ ...line, cancelQty: line.quantity })}
                              className="text-red-500 p-1.5 rounded-lg active:bg-red-100 flex-shrink-0"
                              aria-label={`Cancel ${line.item_name}`}
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          {canAdjustQty ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (fullySent) setCancelTarget({ ...line, cancelQty: 1 });
                                  else changeQty(line, -1);
                                }}
                                disabled={busy}
                                className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <QtyInput
                                value={line.quantity}
                                disabled={busy}
                                onCommit={(q) => {
                                  const delta = q - Number(line.quantity);
                                  if (delta < 0 && fullySent) setCancelTarget({ ...line, cancelQty: -delta });
                                  else changeQty(line, delta);
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => changeQty(line, 1)}
                                disabled={busy}
                                className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-sm font-bold text-slate-700">{line.quantity}×</span>
                          )}
                          <span className="font-bold text-blue-700 text-sm">
                            {formatCurrency(Number(line.subtotal || 0))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shrinks and scrolls on short screens so Bill Payment / Bill Print stay reachable. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-blue-200">
          <div className="p-3 sm:p-4 space-y-2.5 bg-gradient-to-r from-blue-50 to-white">
            <div className="space-y-1 text-sm bg-white rounded-xl p-2.5 border border-blue-100">
              <div className="flex justify-between">
                <span className="text-slate-700">Subtotal</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals.subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount ({discountMode === 'amount' ? 'Rs' : `${discount}%`})</span>
                  <span className="font-bold">- {formatCurrency(totals.discount)}</span>
                </div>
              )}
              {promotion && Number(promotion.discount) > 0 && (
                <div className="flex justify-between text-rose-700">
                  <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />{promotion.name}{promotion.scope && promotion.scope !== 'order' ? ` (${promotion.scope})` : ''}</span>
                  <span className="font-bold">- {formatCurrency(promotion.discount)}</span>
                </div>
              )}
              {Number(settings.service_charge_percentage) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-700">Service</span>
                  <span className="font-bold text-slate-900">{formatCurrency(totals.serviceCharge)}</span>
                </div>
              )}
              {Number(settings.vat_percentage) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-700">Tax</span>
                  <span className="font-bold text-slate-900">{formatCurrency(totals.tax)}</span>
                </div>
              )}
              {totals.deliveryFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-700">Delivery</span>
                  <span className="font-bold text-slate-900">{formatCurrency(totals.deliveryFee)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1.5 border-t border-blue-200">
                <span className="text-slate-900">Total</span>
                <span className="text-blue-600">{formatCurrency(totals.total)}</span>
              </div>
              {isReopened && (
                <div className={`flex justify-between text-sm font-bold ${amountDue < -0.009 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  <span>{amountDue < -0.009 ? 'Refund due' : 'Due now'}</span>
                  <span>{formatCurrency(Math.abs(amountDue))}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  KOT note / special request
                </span>
                <textarea
                  value={kotNotes}
                  onChange={(e) => setKotNotes(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Optional note for this kitchen ticket"
                  className="w-full resize-none rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </label>
              {String(settings.pos_customer_field_enabled ?? 'true') !== 'false' && (
                <div className="col-span-2">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Customer (optional)
                  </span>
                  <CustomerModePicker value={customerSelection} onChange={setCustomerSelection} compact />
                </div>
              )}
              <button
                type="button"
                onClick={saveKotOnly}
                disabled={busy || !canEdit || !unsentLines.length}
                className="py-2.5 bg-amber-100 text-amber-900 rounded-xl font-bold disabled:opacity-40 text-sm flex items-center justify-center gap-1.5 border border-amber-200"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChefHat className="w-4 h-4" />}
                KOT
              </button>
              <button
                type="button"
                onClick={saveAndPrintKot}
                disabled={busy || !canEdit || (!unsentLines.length && !lastKot)}
                className="py-2.5 bg-amber-500 text-white rounded-xl font-bold disabled:opacity-40 text-sm flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {!unsentLines.length && lastKot ? 'Reprint KOT' : 'KOT & Print'}
              </button>
              <button
                type="button"
                onClick={unsentLines.length ? sendKotAndOpenPayment : openPaymentPanel}
                disabled={busy || !allLines.length || !orderId}
                className={`py-2.5 text-white rounded-xl font-bold disabled:opacity-40 text-sm flex items-center justify-center gap-1.5 ${unsentLines.length ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {unsentLines.length ? <ChefHat className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                {unsentLines.length ? 'Send KOT & Pay' : (isReopened ? 'Settle Revised Bill' : 'Bill Payment')}
              </button>
              <button
                type="button"
                onClick={printBillOnly}
                disabled={busy || !allLines.length || !orderId}
                className="py-2.5 bg-slate-800 text-white rounded-xl font-bold disabled:opacity-40 text-sm flex items-center justify-center gap-1.5"
              >
                <FileText className="w-4 h-4" />
                Bill Print
              </button>
              <button
                type="button"
                onClick={clearCart}
                disabled={busy || (!orderId && !draftLines.length)}
                className="col-span-2 py-2 bg-red-50 text-red-700 rounded-xl font-semibold disabled:opacity-40 text-xs border border-red-100"
              >
                Clear unsent items
              </button>
            </div>
          </div>
        </div>
      </div>

      {showTablePicker && (
        changeTableMode ? (
          <ChangeTableBoard
            tables={tables}
            loading={loadingTables}
            busy={busy}
            activeOrderId={orderId}
            onClose={() => { setShowTablePicker(false); setChangeTableMode(false); }}
            onRefresh={loadTables}
            onMoveParty={movePartyToTable}
            onRemoveParty={removeParty}
            onOpenParty={async (party) => {
              setShowTablePicker(false);
              setChangeTableMode(false);
              await openExisting(party.order_id);
            }}
            onAddPerson={addAnotherPerson}
          />
        ) : (
          <TablePickerModal
            tables={tables}
            loading={loadingTables}
            busy={busy}
            onClose={() => { setShowTablePicker(false); setChangeTableMode(false); }}
            onRefresh={loadTables}
            onSelect={selectTable}
            onAddPerson={addAnotherPerson}
          />
        )
      )}

      {partyChooser && (
        <PartyChooserModal
          table={partyChooser.table}
          parties={partyChooser.parties}
          busy={busy}
          onClose={() => setPartyChooser(null)}
          onSelectParty={async (party) => {
            setPartyChooser(null);
            setShowTablePicker(false);
            await openExisting(party.order_id);
          }}
          onAddPerson={() => addAnotherPerson(partyChooser.table)}
          onRemoveParty={(party) => removeParty(party, partyChooser.table)}
        />
      )}

      {showBillsPicker && (
        <ActiveBillsModal
          busy={busy}
          onClose={() => setShowBillsPicker(false)}
          onSelect={(bill) => {
            if (bill.orderId) openExisting(bill.orderId);
            else notify('No order linked to this bill.', 'warning');
          }}
        />
      )}

      {cancelTarget && (
        <CancelReasonModal item={cancelTarget} busy={busy} onClose={() => setCancelTarget(null)} onConfirm={confirmCancelSent} />
      )}

      {clearAllOpen && (
        <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <button type="button" aria-label="Close" className="absolute inset-0" onClick={() => !busy && setClearAllOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-xl bg-red-100 p-2.5 text-red-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Clear the whole cart?</h3>
            </div>
            <p className="mb-5 text-sm text-slate-600">
              This removes <span className="font-semibold">every item</span> from this
              {isReopened ? ' reopened bill' : ' order'}.
              {isReopened
                ? ' The customer may be owed a refund on Complete Sale.'
                : ' Sent kitchen items stay on the order — cancel those individually.'}
              {' '}This can’t be undone.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setClearAllOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep items
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => { setClearAllOpen(false); await clearCart({ skipConfirm: true }); }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" /> Clear everything
              </button>
            </div>
          </div>
        </div>
      )}

      <BillPaymentPanel
        open={showPayment}
        onClose={() => setShowPayment(false)}
        onConfirm={(result) => {
          if (result?.error) { notify(result.error, 'warning'); return; }
          completeSale();
        }}
        busy={busy}
        totals={totals}
        alreadyPaid={alreadyPaid}
        isReopened={isReopened}
        settings={settings}
        discount={discount}
        onDiscountChange={(value) => { setDiscount(value); if (value > 0) { setPromotion(null); setCouponCode(''); } }}
        discountMode={discountMode}
        onDiscountModeChange={setDiscountMode}
        promotion={promotion}
        couponCode={couponCode}
        onCouponChange={setCouponCode}
        couponBusy={couponBusy}
        onApplyCoupon={() => checkPromotion(couponCode)}
        customerSelection={customerSelection}
        onCustomerChange={setCustomerSelection}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        roomStayId={roomStayId}
        onRoomStayChange={setRoomStayId}
        amountPaid={amountPaid}
        onAmountPaidChange={setAmountPaid}
        splitPayment={splitPayment}
        onSplitPaymentChange={setSplitPayment}
        serviceCharge={serviceCharge}
        onServiceChargeChange={setServiceCharge}
        canSetDelivery={!workspace?.order?.table_id}
        deliveryEnabled={deliveryAtCheckout}
        onDeliveryEnabledChange={(enabled) => {
          setDeliveryAtCheckout(enabled);
          if (enabled && !String(deliveryFee).trim()) {
            setDeliveryFee(String(settings.delivery_pricing_mode === 'fixed' ? Number(settings.delivery_fixed_fee || 0) : 0));
          }
          if (!enabled) setDeliveryExecutiveId(null);
        }}
        deliveryFee={deliveryFee}
        onDeliveryFeeChange={setDeliveryFee}
        executives={deliveryExecutives}
        deliveryExecutiveId={deliveryExecutiveId}
        onDeliveryExecutiveChange={setDeliveryExecutiveId}
      />
    </div>
  );
}

function TablePickerModal({ tables, loading, busy, onClose, onRefresh, onSelect, onAddPerson }) {
  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-blue-200 p-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Select Table</h3>
            <p className="text-sm text-slate-500">Pick a table to start or resume. Running tables can host multiple parties.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onRefresh} disabled={loading} className="p-2 rounded-lg border border-blue-200 hover:bg-blue-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading tables…</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {tables.map((t) => (
                <div key={t.id} className="relative">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(t)}
                    className={`flex min-h-[104px] w-full flex-col items-start justify-between rounded-lg border-2 p-3 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out hover:shadow-md active:scale-[0.98] ${
                      t.status === 'available'
                        ? 'border-emerald-300 bg-emerald-50'
                        : ['reserved', 'reserved_arrived'].includes(t.status)
                          ? 'border-red-300 bg-red-50'
                          : t.status === 'cleaning'
                            ? 'border-slate-300 bg-slate-50'
                            : 'border-blue-300 bg-blue-50'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-lg font-bold text-slate-900">{t.table_number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[t.status] || 'bg-gray-100'}`}>
                        {(t.status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">Seats {t.capacity || '—'}</span>
                    {t.party_count > 0 ? (
                      <span className="text-xs font-medium text-blue-700">
                        {t.party_count} part{t.party_count === 1 ? 'y' : 'ies'} · {formatCurrency(t.current_amount)}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-700">Available</span>
                    )}
                  </button>
                  {t.party_count > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onAddPerson?.(t);
                      }}
                      className="absolute bottom-2 right-2 z-10 rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-violet-700"
                      title="Add another person"
                    >
                      + Person
                    </button>
                  )}
                </div>
              ))}
              {!tables.length && <p className="col-span-full py-8 text-center text-sm text-slate-400">No tables configured.</p>}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function ChangeTableBoard({
  tables, loading, busy, activeOrderId, onClose, onRefresh, onMoveParty, onRemoveParty, onOpenParty, onAddPerson,
}) {
  const [dragParty, setDragParty] = useState(null); // { order_id, from_table_id, ... }
  const [overTableId, setOverTableId] = useState(null);

  const onDragStart = (e, party, table) => {
    setDragParty({ ...party, from_table_id: table.id });
    e.dataTransfer.setData('text/plain', String(party.order_id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e, tableId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverTableId(tableId);
  };

  const onDrop = async (e, table) => {
    e.preventDefault();
    setOverTableId(null);
    const oid = Number(e.dataTransfer.getData('text/plain') || dragParty?.order_id);
    if (!oid || !table?.id) return;
    if (Number(dragParty?.from_table_id) === Number(table.id)) {
      setDragParty(null);
      return;
    }
    await onMoveParty(oid, table.id, table.table_number);
    setDragParty(null);
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-white p-4 sm:p-5">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Change table</h3>
            <p className="text-sm text-slate-500">
              Drag a party card onto another table to move them. Click a party to open it in POS.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onRefresh} disabled={loading || busy} className="p-2 rounded-lg border border-amber-200 hover:bg-amber-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Done
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex justify-center py-16 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading floor…</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tables.map((t) => {
                const parties = t.parties || [];
                const isOver = overTableId === t.id && dragParty && Number(dragParty.from_table_id) !== Number(t.id);
                return (
                  <div
                    key={t.id}
                    onDragOver={(e) => onDragOver(e, t.id)}
                    onDragLeave={() => setOverTableId((id) => (id === t.id ? null : id))}
                    onDrop={(e) => onDrop(e, t)}
                    className={`min-h-[160px] rounded-2xl border-2 p-3 transition ${
                      isOver
                        ? 'border-amber-500 bg-amber-50 shadow-lg ring-2 ring-amber-300'
                        : parties.length
                          ? 'border-sky-200 bg-sky-50/40'
                          : 'border-dashed border-emerald-300 bg-emerald-50/50'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-lg font-bold text-slate-900">Table {t.table_number}</p>
                        <p className="text-[11px] text-slate-500">
                          {t.floor || 'Floor'}{t.section ? ` · ${t.section}` : ''} · Seats {t.capacity || '—'}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[t.status] || 'bg-gray-100'}`}>
                        {parties.length ? `${parties.length} party` : 'Free'}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {parties.map((p) => {
                        const isActive = Number(p.order_id) === Number(activeOrderId);
                        return (
                          <div
                            key={p.order_id}
                            draggable={!busy}
                            onDragStart={(e) => onDragStart(e, p, t)}
                            onDragEnd={() => { setDragParty(null); setOverTableId(null); }}
                            className={`cursor-grab active:cursor-grabbing rounded-xl border-2 bg-white p-2.5 shadow-sm ${
                              isActive ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-sky-200'
                            } ${dragParty?.order_id === p.order_id ? 'opacity-50' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onOpenParty(p)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="truncate text-sm font-bold text-slate-900">{p.party_label || 'Party'}</p>
                                <p className="truncate text-[11px] text-slate-500">
                                  {p.order_number} · {formatCurrency(p.amount)}
                                  {p.unsent_count > 0 ? ` · ${p.unsent_count} unsent` : ''}
                                </p>
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onRemoveParty(p, t)}
                                className="shrink-0 rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                title="Remove person"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Drag to move</p>
                          </div>
                        );
                      })}
                      {!parties.length && (
                        <p className="py-6 text-center text-xs text-emerald-700">
                          {isOver ? 'Drop party here' : 'Drop a party here'}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAddPerson(t)}
                      className="mt-2 w-full rounded-lg border border-dashed border-violet-300 py-1.5 text-[11px] font-bold text-violet-700 hover:bg-violet-50"
                    >
                      + Add person
                    </button>
                  </div>
                );
              })}
              {!tables.length && <p className="col-span-full py-12 text-center text-sm text-slate-400">No tables configured.</p>}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function PartyChooserModal({ table, parties, busy, onClose, onSelectParty, onAddPerson, onRemoveParty }) {
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-blue-200 p-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Table {table.table_number}</h3>
            <p className="text-sm text-slate-500">Choose a party, add another, or remove someone.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 p-4">
          {parties.map((p) => (
            <div key={p.order_id} className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onSelectParty(p)}
                className="flex flex-1 items-center justify-between rounded-xl border-2 border-blue-200 bg-blue-50/50 px-4 py-3 text-left hover:border-blue-400"
              >
                <div>
                  <p className="font-bold text-slate-900">{p.party_label}</p>
                  <p className="text-xs text-slate-500">{p.order_number} · {p.kot_count} KOT</p>
                </div>
                <span className="font-bold text-blue-700">{formatCurrency(p.amount)}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemoveParty?.(p)}
                className="rounded-xl border border-red-200 bg-red-50 px-3 text-red-700 hover:bg-red-100"
                title="Remove person"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={onAddPerson}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 px-4 py-3 font-bold text-violet-800 hover:border-violet-500"
          >
            <Users className="w-4 h-4" /> Add another person
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function ActiveBillsModal({ busy, onClose, onSelect }) {
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/admin/bills?tab=active&pageSize=50');
      setBills(data.bills || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((b) =>
      [b.tableNumber, b.customerName, b.customerPhone, b.orderNumber, b.billNumber, b.channel]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [bills, search]);

  const groups = useMemo(() => {
    const used = new Set();
    const pick = (list) => list.filter((b) => {
      if (used.has(b.id)) return false;
      used.add(b.id);
      return true;
    });

    return [
      {
        id: 'pay',
        title: 'Ready to pay',
        hint: 'Food served — open and collect payment',
        icon: ReceiptText,
        tone: 'border-amber-200 bg-amber-50/60',
        bills: pick(filtered.filter((b) => b.orderStatus === 'awaiting_payment')),
      },
      {
        id: 'table',
        title: 'Table orders',
        hint: 'Dining in — add items, print KOT, or pay',
        icon: Utensils,
        tone: 'border-blue-200 bg-blue-50/40',
        bills: pick(filtered.filter((b) => b.tableNumber && b.orderStatus !== 'awaiting_payment')),
      },
      {
        id: 'counter',
        title: 'Takeaway',
        hint: 'Orders not linked to a table',
        icon: ShoppingBag,
        tone: 'border-slate-200 bg-slate-50/60',
        bills: pick(filtered.filter((b) => !b.tableNumber && b.orderStatus !== 'awaiting_payment')),
      },
    ].filter((g) => g.bills.length > 0);
  }, [filtered]);

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-blue-100 p-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Open orders</h3>
              <p className="mt-1 text-sm text-slate-500">
                These are live orders — not finished invoices. Tap one to continue in POS.
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" onClick={load} disabled={loading} className="p-2 rounded-lg border border-blue-200 hover:bg-blue-50" aria-label="Refresh">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search table, customer, order #…"
              className="w-full pl-9 pr-3 py-2.5 border-2 border-blue-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="overflow-y-auto p-3 sm:p-4 space-y-4">
          {loading && (
            <div className="flex justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading open orders…
            </div>
          )}
          {error && <p className="p-4 text-sm text-red-600 rounded-xl bg-red-50">{error}</p>}
          {!loading && !error && !filtered.length && (
            <div className="py-12 text-center">
              <ShoppingCart className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">
                {search ? 'No orders match your search.' : 'No open orders right now.'}
              </p>
              {!search && <p className="text-xs text-slate-400 mt-1">New orders appear here after you print a KOT.</p>}
            </div>
          )}
          {!loading && groups.map((group) => (
            <section key={group.id}>
              <div className={`rounded-xl border px-3 py-2 mb-2 ${group.tone}`}>
                <div className="flex items-center gap-2">
                  <group.icon className="w-4 h-4 text-slate-700 shrink-0" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900">{group.title}</h4>
                    <p className="text-[11px] text-slate-600">{group.hint}</p>
                  </div>
                  <span className="ml-auto shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                    {group.bills.length}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {group.bills.map((b) => (
                  <ActiveBillCard key={b.id} bill={b} busy={busy} onSelect={onSelect} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

const ORDER_STATUS = {
  pending: { label: 'New', badge: 'bg-slate-100 text-slate-700', action: 'Add items' },
  confirmed: { label: 'Confirmed', badge: 'bg-slate-100 text-slate-700', action: 'Add items' },
  preparing: { label: 'Preparing', badge: 'bg-orange-100 text-orange-800', action: 'Kitchen working' },
  cooking: { label: 'Cooking', badge: 'bg-orange-100 text-orange-800', action: 'Kitchen working' },
  ready: { label: 'Ready', badge: 'bg-violet-100 text-violet-800', action: 'Serve customer' },
  dining: { label: 'Dining', badge: 'bg-blue-100 text-blue-800', action: 'Add items or pay' },
  served: { label: 'Served', badge: 'bg-blue-100 text-blue-800', action: 'Add items or pay' },
  awaiting_payment: { label: 'Pay now', badge: 'bg-amber-100 text-amber-900', action: 'Collect payment' },
  open: { label: 'Open', badge: 'bg-sky-100 text-sky-800', action: 'Continue order' },
  unpaid: { label: 'Unpaid', badge: 'bg-amber-100 text-amber-900', action: 'Collect payment' },
};

function billDisplayTitle(b) {
  if (b.tableNumber) return `Table ${b.tableNumber}`;
  if (b.customerName) return b.customerName;
  if (b.channel === 'takeaway') return 'Takeaway';
  if (b.channel === 'online') return 'Online order';
  return 'Takeaway';
}

function billTimeLabel(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return formatNepalDateTime(iso);
}

function formatOrderOpenedAt(value) {
  if (!value) return '';
  const source = String(value).trim();
  const date = new Date(/Z$|[+-]\d{2}:\d{2}$/i.test(source) ? source : `${source.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return source;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function ActiveBillCard({ bill, busy, onSelect }) {
  const st = ORDER_STATUS[bill.orderStatus] || ORDER_STATUS.open;
  const hasUnsent = Number(bill.unsentCount) > 0;
  const itemCount = Number(bill.itemCount) || 0;

  let kitchenHint = '';
  if (bill.orderStatus === 'awaiting_payment') {
    kitchenHint = 'Bill ready — complete payment in POS';
  } else if (hasUnsent) {
    kitchenHint = `${bill.unsentCount} item${bill.unsentCount === 1 ? '' : 's'} not sent to kitchen yet`;
  } else if (itemCount > 0) {
    kitchenHint = `${itemCount} item${itemCount === 1 ? '' : 's'} · sent to kitchen`;
  } else {
    kitchenHint = 'No items yet';
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSelect(bill)}
      className="w-full rounded-xl border-2 border-blue-100 bg-white p-3 text-left hover:border-blue-400 hover:shadow-md transition-all disabled:opacity-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-slate-900 text-base">{billDisplayTitle(bill)}</span>
            {bill.isOpenOrder && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
                Live
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.badge}`}>
              {st.label}
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500 truncate">
            {bill.isOpenOrder ? 'No invoice yet' : (bill.billNumber || 'Invoice pending')}
            {bill.orderNumber ? ` · ${bill.orderNumber}` : ''}
          </p>

          {bill.customerName && bill.tableNumber && (
            <p className="mt-0.5 text-xs text-slate-600 truncate">{bill.customerName}{bill.customerPhone ? ` · ${bill.customerPhone}` : ''}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className={`inline-flex items-center gap-1 font-medium ${hasUnsent ? 'text-amber-700' : 'text-emerald-700'}`}>
              {hasUnsent ? <ChefHat className="w-3 h-3" /> : <ChefHat className="w-3 h-3" />}
              {kitchenHint}
            </span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Clock className="w-3 h-3" />
              {billTimeLabel(bill.updatedAt)}
            </span>
          </div>

          <p className="mt-2 text-[11px] font-semibold text-blue-700">{st.action} →</p>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-lg font-bold text-blue-600 tabular-nums">{formatCurrency(bill.total)}</div>
          {bill.balance > 0 && bill.paymentStatus !== 'paid' && (
            <div className="text-[10px] text-amber-700 font-medium mt-0.5">
              Due {formatCurrency(bill.balance)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function CancelReasonModal({ item, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState(false);
  const maxQty = Number(item.quantity) || 1;
  const [qty, setQty] = useState(Math.min(maxQty, Math.max(1, Number(item.cancelQty) || maxQty)));
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Cancel sent item</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="mb-3 text-sm text-slate-600">{item.quantity}× <b>{item.item_name}</b> was sent to the kitchen.</p>
        {maxQty > 1 && (
          <div className="mb-3">
            <p className="mb-1.5 text-sm font-medium text-slate-700">How many to cancel?</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"><Minus className="w-3.5 h-3.5" /></button>
              <span className="w-10 text-center font-bold text-slate-900">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"><Plus className="w-3.5 h-3.5" /></button>
              <span className="text-xs text-slate-500">of {maxQty}</span>
            </div>
          </div>
        )}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="mb-3 w-full rounded-lg border-2 border-blue-200 p-2 text-sm focus:border-blue-500 focus:outline-none" />
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prepared} onChange={(e) => setPrepared(e.target.checked)} className="h-4 w-4" />
          Already prepared (wastage)
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep</Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim(), prepared, qty)}>{qty < maxQty ? `Cancel ${qty}` : 'Cancel item'}</Button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      {children}
    </div>
  );
}
