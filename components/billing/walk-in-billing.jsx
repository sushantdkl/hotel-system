'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, Plus, Minus, ShoppingCart, Trash2, Wallet, Building2, QrCode, Sparkles, X, ArrowLeft } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import MenuItemImage from '@/components/menu-item-image';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import BillConfirmModal from '@/components/billing/bill-confirm-modal';
import DateInput from '@/components/ui/date-input.jsx';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';
import { usePaymentQr } from '@/lib/payment-qr.js';
import { calculateBillTotals, parseSettingsRates, resolveServiceCharge } from '@/lib/billing-totals';
import ServiceChargeField, { emptyServiceCharge, serviceChargePayload } from '@/components/billing/service-charge-field';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display.js';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';
import { sortCombosFirst } from '@/lib/promotion-display.js';
import QtyInput from '@/components/ui/qty-input';

export default function WalkInBilling({ variant = 'admin' }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [splitPayment, setSplitPayment] = useState(emptySplitPayment);
  const [discount, setDiscount] = useState(0);
  const [promotion, setPromotion] = useState(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  // Per-bill service / extra charge; unticked means the house rate applies.
  const [serviceCharge, setServiceCharge] = useState(emptyServiceCharge);
  const [discountMode, setDiscountMode] = useState('percent');
  const [customerSelection, setCustomerSelection] = useState(emptyCustomerSelection);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBill, setPendingBill] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customItem, setCustomItem] = useState({ name: '', price: '', quantity: 1 });
  const [settings, setSettings] = useState({
    vat_percentage: 0,
    service_charge_percentage: 0,
    esewa_qr_image: '',
    bank_qr_image: '',
    restaurant_name: '',
    restaurant_address: '',
    vat_number: '',
    pan_number: ''
  });

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchSettings();
    const onFocus = () => fetchSettings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSettings({
          vat_percentage: Number(data.settings?.vat_percentage ?? 0),
          service_charge_percentage: Number(data.settings?.service_charge_percentage ?? 0),
          esewa_qr_image: data.settings.esewa_qr_image || '',
          bank_qr_image: data.settings.bank_qr_image || '',
          payment_qr_payload: data.settings.payment_qr_payload || '',
          restaurant_name: data.settings.restaurant_name || 'Restaurant',
          restaurant_address: data.settings.restaurant_address || '',
          vat_number: data.settings.vat_number || '',
          pan_number: data.settings.pan_number || ''
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/restaurant/menu/categories', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/products?channel=pos', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products.filter(p => p.is_available));
      } else {
        addToast(friendlyMessage('load_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    }
  };

  const addToCart = (product) => {
    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) {
      setCart(cart.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, {
        ...product,
        price: Number(product.price || product.base_price || 0),
        quantity: 1,
        image_url: product.image_url || null,
        category_name: product.category_name || product.category || null,
      }]);
    }
  };

  const addCustomToCart = () => {
    const name = customItem.name.trim();
    const price = parseFloat(customItem.price);
    const quantity = Math.max(1, parseInt(customItem.quantity, 10) || 1);
    if (!name || !price || price <= 0) {
      addToast(friendlyMessage('invalid_custom'));
      return;
    }
    const entry = {
      id: `custom-${Date.now()}`,
      name,
      price,
      quantity,
      is_custom: true,
      category_name: 'Custom',
      image_url: null,
    };
    setCart((prev) => [...prev, entry]);
    setCustomItem({ name: '', price: '', quantity: 1 });
    setShowCustom(false);
    addToast(friendlyMessage('custom_added'));
  };

  const updateQuantity = (productId, change) => {
    setCart(cart.map(item => {
      if (item.id === productId) {
        const newQuantity = item.quantity + change;
        return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter(item => item.id !== productId));
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const getTotals = () => {
    const rates = parseSettingsRates(settings);
    const service = resolveServiceCharge(serviceCharge, rates.servicePercent);
    return calculateBillTotals(calculateSubtotal(), {
      ...(promotion
        ? { discountAmount: promotion.discount }
        : discountMode === 'amount'
        ? { discountAmount: discount }
        : { discountPercent: discount }),
      vatPercent: rates.vatPercent,
      servicePercent: service.servicePercent,
      serviceAmount: service.serviceAmount,
    });
  };

  const calculateDiscount = () => getTotals().discount;
  const calculateTax = () => getTotals().tax;
  const calculateService = () => getTotals().serviceCharge;
  const calculateTotal = () => getTotals().total;
  const paymentQr = usePaymentQr(settings, calculateTotal());

  const calculateChange = () => {
    const paid = parseFloat(amountPaid) || 0;
    return paid - calculateTotal();
  };

  const promotionItems = () => cart.map((item) => ({ menu_item_id: item.is_custom ? null : item.id, id: item.is_custom ? null : item.id, quantity: item.quantity, price: item.price, is_custom: !!item.is_custom }));
  const checkPromotion = async (code = '') => {
    if (!cart.length) { setPromotion(null); return; }
    setCouponBusy(true);
    try {
      const response = await fetch('/api/admin/promotions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pos_token')}` }, body: JSON.stringify({ coupon_code: code.trim(), items: promotionItems() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not apply coupon.')
      setPromotion(body.promotion || null)
    } catch (error) { setPromotion(null); addToast(friendlyFromError(error, 'load_failed')); }
    finally { setCouponBusy(false); }
  };
  useEffect(() => {
    const timer = setTimeout(() => checkPromotion(couponCode && promotion?.code ? couponCode : ''), 250);
    return () => clearTimeout(timer);
    // Re-price automatic/chosen offers when cart quantities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  const buildAllocations = (total) => {
    const amount = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const common = { notes: splitPayment.notes || undefined };
    let allocations;
    if (paymentMethod === 'cash') {
      allocations = [{ method: 'cash', amount: total, cash_tendered: amountPaid || total, ...common }];
    } else if (paymentMethod === 'online') {
      allocations = [{ method: 'online', amount: total, verified: true, ...common }];
    } else if (paymentMethod === 'credit') {
      allocations = [{ method: 'credit', amount: total, due_date: splitPayment.creditDueDate || undefined, ...common }];
    } else {
      allocations = [
        { method: 'cash', amount: amount(splitPayment.cash), cash_tendered: splitPayment.cashTendered || splitPayment.cash, ...common },
        { method: 'online', amount: amount(splitPayment.qr), verified: true, ...common },
        { method: 'credit', amount: amount(splitPayment.credit), due_date: splitPayment.creditDueDate || undefined, ...common },
      ].filter((row) => row.amount > 0);
    }
    const allocatedCents = allocations.reduce((sum, row) => sum + Math.round(Number(row.amount || 0) * 100), 0);
    if (allocatedCents !== Math.round(total * 100)) throw new Error('Cash + Online + Credit must equal the invoice total.');
    const cash = allocations.find((row) => row.method === 'cash');
    if (cash && Math.round(Number(cash.cash_tendered || 0) * 100) < Math.round(cash.amount * 100)) throw new Error('Cash tendered must cover the cash allocation.');
    const credit = allocations.find((row) => row.method === 'credit');
    if (credit) {
      // New customers can take credit — billing creates the record before
      // booking the credit, so a name + 10-digit phone is enough here.
      const digits = String(customerSelection.phone || '').replace(/\D/g, '');
      const canCredit = !!customerSelection.customer?.id
        || (customerSelection.mode === 'customer' && digits.length >= 10 && String(customerSelection.name || '').trim().length > 0);
      if (!canCredit) throw new Error('Credit needs a customer — look one up, or enter a new name and 10-digit phone above.');
    }
    return allocations;
  };



  const handleCheckout = () => {
    if (cart.length === 0) {
      addToast(friendlyMessage('empty_cart'));
      return;
    }

    const totals = getTotals();
    const total = totals.total;
    let allocations;
    try { allocations = buildAllocations(total); }
    catch (error) { addToast(friendlyMessage('payment_invalid', { description: error.message })); return; }
    const paid = allocations.filter((row) => row.method !== 'credit').reduce((sum, row) => sum + Number(row.amount), 0);
    const cash = allocations.find((row) => row.method === 'cash');

    const customerCheck = validateCustomerSelection(customerSelection);
    if (!customerCheck.ok) {
      addToast(friendlyMessage('customer_required', { description: customerCheck.message }));
      return;
    }

    const orderNumber = `ORD-${Date.now()}`;
    const billNumber = `BILL-${Date.now()}`;
    const billPreview = {
      order_number: orderNumber,
      bill_number: billNumber,
      customer_mode: customerSelection.mode,
      customer_name: customerCheck.name,
      customer_phone: customerCheck.phone,
      customer_address: customerCheck.address || customerSelection.address || '',
      customer_id: customerCheck.customer_id || null,
      is_new_customer: !!customerCheck.isNew,
      subtotal: totals.subtotal,
      discount: totals.discount,
      promotion,
      coupon_code: promotion?.code ? couponCode : null,
      tax: totals.tax,
      tax_percent: totals.taxPercent,
      service_charge: totals.serviceCharge,
      service_percent: totals.servicePercent,
      // Mode + value, never a computed amount: the route re-prices.
      ...serviceChargePayload(serviceCharge),
      total: totals.total,
      payment_method: paymentMethod,
      amount_paid: paid,
      change: cash ? Math.max(0, Number(cash.cash_tendered || 0) - Number(cash.amount)) : 0,
      allocations,
      idempotency_key: globalThis.crypto?.randomUUID?.() || `bill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      order_type: 'takeaway',
      date: new Date().toISOString(),
      restaurant_name: settings.restaurant_name || 'Restaurant',
      restaurant_address: settings.restaurant_address || '',
      vat_number: settings.vat_number,
      pan_number: settings.pan_number,
      items: cart.map((item) => ({
        menu_item_id: item.is_custom ? null : item.id,
        id: item.is_custom ? null : item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
        is_custom: !!item.is_custom,
      })),
    };

    setPendingBill(billPreview);
    setConfirmOpen(true);
  };

  const confirmSale = async () => {
    if (!pendingBill) return;
    setConfirming(true);
    try {
      const token = localStorage.getItem('pos_token');
      const orderData = {
        order_number: pendingBill.order_number,
        bill_number: pendingBill.bill_number,
        customer_mode: pendingBill.customer_mode,
        customer_name: pendingBill.customer_name,
        customer_phone: pendingBill.customer_phone,
        customer_address: pendingBill.customer_address,
        subtotal: pendingBill.subtotal,
        discount: pendingBill.promotion ? 0 : pendingBill.discount,
        coupon_code: pendingBill.coupon_code || undefined,
        tax: pendingBill.tax,
        tax_percent: pendingBill.tax_percent,
        service_charge: pendingBill.service_charge || 0,
        final_total: pendingBill.total,
        payment_method: pendingBill.payment_method,
        amount_paid: pendingBill.amount_paid,
        change_amount: pendingBill.change,
        allocations: pendingBill.allocations,
        idempotency_key: pendingBill.idempotency_key,
        order_type: 'takeaway',
        items: pendingBill.items,
      };

      const response = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(orderData),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        printThermalBill(pendingBill);
        addToast(friendlyMessage('sale_success', {
          description: result.customer?.created
            ? 'Sale complete. New customer was saved.'
            : result.warnings?.length
              ? `${result.message || 'Sale complete.'} ${result.warnings[0]}`
              : undefined,
        }));
        if (result.warnings?.length > 1) {
          addToast(friendlyMessage('stock_low', { description: result.warnings.slice(1).join(' ') }));
        }

        setCart([]);
        setAmountPaid('');
        setDiscount(0);
        setPromotion(null);
        setCouponCode('');
        setServiceCharge(emptyServiceCharge);
        setPaymentMethod('cash');
        setSplitPayment(emptySplitPayment);
        setCustomerSelection(emptyCustomerSelection);
        setMobileCartOpen(false);
        setConfirmOpen(false);
        setPendingBill(null);
      } else {
        addToast(friendlyFromError(result, 'sale_failed'));
      }
    } catch (error) {
      console.error('Error creating order:', error);
      addToast(friendlyFromError(error, 'sale_failed'));
    } finally {
      setConfirming(false);
    }
  };

  const printThermalBill = (billData) => {
    const printWindow = window.open('', '', 'width=300,height=600');
    
    const billHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Bill - ${billData.bill_number}</title>
        <style>
          @media print {
            @page {
              size: 72mm auto;
              margin: 0;
            }
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            width: 72mm;
            max-width: 72mm;
            margin: 0 auto;
            font-family: 'Courier New', monospace;
            font-size: 9px;
            padding: 2mm;
            line-height: 1.2;
            background: white;
          }
          .header {
            text-align: center;
            margin-bottom: 3px;
            border-bottom: 1px dashed #000;
            padding-bottom: 3px;
          }
          .shop-name {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 1px;
          }
          .bill-info {
            margin: 3px 0;
            font-size: 8px;
          }
          .bill-info div {
            margin: 1px 0;
          }
          table {
            width: 100%;
            margin: 3px 0;
            border-collapse: collapse;
          }
          th {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            padding: 2px 0;
            text-align: left;
            font-size: 8px;
          }
          td {
            padding: 1px 0;
            font-size: 8px;
          }
          .item-name {
            width: 50%;
          }
          .item-qty {
            width: 15%;
            text-align: center;
          }
          .item-price {
            width: 17.5%;
            text-align: right;
          }
          .item-total {
            width: 17.5%;
            text-align: right;
          }
          .totals {
            border-top: 1px dashed #000;
            margin-top: 3px;
            padding-top: 2px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin: 1px 0;
            font-size: 8px;
          }
          .grand-total {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            padding: 3px 0;
            margin: 3px 0;
            font-size: 10px;
            font-weight: bold;
          }
          .payment-info {
            margin: 3px 0;
            font-size: 8px;
          }
          .footer {
            text-align: center;
            margin-top: 4px;
            border-top: 1px dashed #000;
            padding-top: 3px;
            font-size: 8px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="shop-name">${billData.restaurant_name || 'RESTAURANT POS'}</div>
          ${billData.restaurant_address ? `<div style="font-size: 10px; margin-top: 3px;">${billData.restaurant_address}</div>` : ''}
          ${billData.vat_number ? `<div style="font-size: 9px; margin-top: 2px;">VAT: ${billData.vat_number}</div>` : ''}
          ${billData.pan_number ? `<div style="font-size: 9px;">PAN: ${billData.pan_number}</div>` : ''}
          <div style="margin-top: 5px;">Tax Invoice</div>
        </div>

        <div class="bill-info">
          <div><strong>Bill No:</strong> ${compactBillNumber(billData.bill_number)}</div>
          <div><strong>Order No:</strong> ${compactOrderNumber(billData.order_number)}</div>
          <div><strong>Date:</strong> ${formatCalendarDateTime(billData.date)}</div>
          <div><strong>Customer:</strong> ${billData.customer_name}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="item-name">Item</th>
              <th class="item-qty">Qty</th>
              <th class="item-price">Price</th>
              <th class="item-total">Total</th>
            </tr>
          </thead>
          <tbody>
            ${billData.items.map(item => `
              <tr>
                <td class="item-name">${item.name}</td>
                <td class="item-qty">${item.quantity}</td>
                <td class="item-price">Rs ${item.price.toFixed(2)}</td>
                <td class="item-total">Rs ${item.subtotal.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>Rs ${billData.subtotal.toFixed(2)}</span>
          </div>
          ${billData.discount > 0 ? `
          <div class="total-row">
            <span>Discount:</span>
            <span>- Rs ${billData.discount.toFixed(2)}</span>
          </div>
          ` : ''}
          ${billData.service_charge > 0 ? `
          <div class="total-row">
            <span>Service (${billData.service_percent ?? settings.service_charge_percentage}%):</span>
            <span>Rs ${Number(billData.service_charge).toFixed(2)}</span>
          </div>
          ` : ''}
          <div class="total-row">
            <span>Tax (${billData.tax_percent}%):</span>
            <span>Rs ${billData.tax.toFixed(2)}</span>
          </div>
          <div class="total-row grand-total">
            <span>GRAND TOTAL:</span>
            <span>Rs ${billData.total.toFixed(2)}</span>
          </div>
        </div>

        <div class="payment-info">
          <div class="total-row"><span><strong>Payment:</strong></span><span>${billData.allocations.length > 1 ? 'SPLIT' : billData.allocations[0].method.toUpperCase()}</span></div>
          ${billData.allocations.map((allocation) => `
          <div class="total-row">
            <span>${allocation.method === 'credit' ? 'Credit / Due' : allocation.method.toUpperCase()}:</span>
            <span>Rs ${Number(allocation.amount).toFixed(2)}</span>
          </div>`).join('')}
          <div class="total-row">
            <span>Amount received:</span>
            <span>Rs ${billData.amount_paid.toFixed(2)}</span>
          </div>
          ${billData.total - billData.amount_paid > 0 ? `<div class="total-row"><span>Outstanding:</span><span>Rs ${(billData.total - billData.amount_paid).toFixed(2)}</span></div>` : ''}
          <div class="total-row"><span>Payment status:</span><span>${billData.total - billData.amount_paid > 0 ? 'PARTIALLY PAID' : 'PAID'}</span></div>
          ${billData.allocations.some((a) => a.method === 'credit') ? `<div class="total-row"><span>Credit customer:</span><span>${billData.customer_name}</span></div>` : ''}
          ${billData.allocations.find((a) => a.method === 'credit')?.due_date ? `<div class="total-row"><span>Credit due date:</span><span>${formatCalendarDate(billData.allocations.find((a) => a.method === 'credit').due_date)}</span></div>` : ''}
          ${billData.allocations.find((a) => a.method === 'qr')?.reference ? `<div class="total-row"><span>QR reference:</span><span>${billData.allocations.find((a) => a.method === 'qr').reference}</span></div>` : ''}
          ${billData.change > 0 ? `
          <div class="total-row">
            <span>Change:</span>
            <span>Rs ${billData.change.toFixed(2)}</span>
          </div>
          ` : ''}
        </div>

        <div class="footer">
          <div>Thank you for your visit!</div>
          <div>Please come again</div>
        </div>

        <div style="height: 10mm;"></div>

        <script>
          // Prevent double printing
          let printed = false;
          
          // Single print trigger
          window.onload = function() {
            if (!printed) {
              printed = true;
              window.focus();
              window.print();
              // Close after user finishes printing
              setTimeout(() => {
                window.close();
              }, 500);
            }
          };
        </script>
      </body>
      </html>
    `;
    
    printWindow.document.write(billHTML);
    printWindow.document.close();
    printWindow.focus();
  };

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

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Shell variant={variant} onBack={() => router.push('/cashier')}>
      <div className="relative flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] lg:h-[calc(100vh)] overflow-hidden">
        {/* Products Section */}
        <div className="flex-1 flex flex-col bg-gradient-to-br from-blue-50 to-white min-h-0 min-w-0">
          <header className="bg-white border-b border-blue-200 px-3 sm:px-6 py-3 sm:py-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {variant === 'cashier' && (
                  <button
                    type="button"
                    onClick={() => router.push('/cashier')}
                    className="hidden lg:inline-flex p-2 rounded-lg text-stone-600 hover:bg-stone-100"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                  {variant === 'cashier' ? 'Walk-in Billing' : 'Point of Sale'}
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
              >
                <Sparkles className="w-4 h-4" />
                Custom item
              </button>
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
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  selectedCategory === 'all'
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(String(cat.id))}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
                    String(selectedCategory) === String(cat.id)
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-700 border-stone-200'
                  }`}
                >
                  <span className="text-base leading-none">{cat.icon || '🍽️'}</span>
                  {cat.name}
                </button>
              ))}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 lg:pb-6">
            {filteredProducts.length === 0 ? (
              <div className="text-center text-slate-500 py-16">
                <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No menu items found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    className="bg-white rounded-xl border border-blue-100 p-3 sm:p-4 text-left active:scale-[0.98] hover:border-blue-400 hover:shadow-md transition-transform overflow-hidden"
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
                    </div>
                    <h3 className="font-semibold text-slate-900 text-xs sm:text-sm line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
                    <p className="text-[11px] text-slate-500 truncate mb-1">{product.category_name || product.category || 'Menu'}</p>
                    <p className="text-base sm:text-lg font-bold text-blue-600">{formatCurrency(product.price || product.base_price || 0)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

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
                  className="w-full py-2.5 rounded-xl bg-stone-900 text-white font-semibold"
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile cart FAB */}
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="lg:hidden fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full bg-blue-600 text-white pl-4 pr-5 py-3 shadow-xl active:scale-95"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-bold">{formatCurrency(calculateTotal())}</span>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1 rounded-full bg-red-500 text-xs font-bold flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </button>

        {/* Cart Section — sheet on mobile, side panel on desktop */}
        {mobileCartOpen && (
          <button
            type="button"
            aria-label="Close cart"
            className="lg:hidden fixed inset-0 z-40 bg-black/30"
            onClick={() => setMobileCartOpen(false)}
          />
        )}
        <div
          className={`
            bg-white border-blue-200 flex flex-col shadow-xl min-h-0
            fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] rounded-t-2xl border-t-2 transition-transform duration-200
            lg:static lg:z-auto lg:h-full lg:max-h-none lg:rounded-none lg:translate-y-0 lg:w-[380px] xl:w-[440px] lg:border-t-0 lg:border-l-2
            ${mobileCartOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
            ${mobileCartOpen ? '' : 'lg:flex'}
          `}
        >
          <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          {/* Header: title + Walk-in / Customer toggle only */}
          <div className="px-3 sm:px-4 pt-3 pb-2 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-white shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Current Bill</h2>
              <button
                type="button"
                className="lg:hidden text-sm font-semibold text-blue-600 px-2 py-1"
                onClick={() => setMobileCartOpen(false)}
              >
                Done
              </button>
            </div>
            <CustomerModePicker
              value={customerSelection}
              onChange={setCustomerSelection}
              compact
              section="toggle"
            />
          </div>

          {/* Cart items — always keeps the main vertical space */}
          <div className="flex-1 min-h-[160px] overflow-y-auto p-3 sm:p-4">
            {cart.length === 0 ? (
              <div className="text-center text-slate-500 py-8">
                <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="font-semibold text-sm">Cart is empty</p>
                <p className="text-xs">Add items to get started</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {cart.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl p-2.5 border border-blue-200 shadow-sm">
                    <div className="flex gap-2.5">
                      <MenuItemImage
                        src={item.image_url}
                        alt={item.name}
                        size="md"
                        className="!w-14 !h-14 rounded-xl ring-1 ring-blue-100"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <h4 className="font-bold text-slate-900 text-sm leading-tight line-clamp-2">{item.name}</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                              {item.category_name || (item.is_custom ? 'Custom' : 'Item')}
                            </p>
                            <p className="text-xs text-blue-600 font-semibold mt-0.5">
                              {formatCurrency(item.price || 0)} each
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.id)}
                            className="text-red-500 p-1.5 rounded-lg active:bg-red-100 flex-shrink-0"
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <QtyInput value={item.quantity} onCommit={(q) => updateQuantity(item.id, q - item.quantity)} />
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="font-bold text-blue-700 text-sm">
                            {formatCurrency((item.price || 0) * item.quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Customer details under cart (doesn't steal item space) */}
          {customerSelection.mode === 'customer' && (
            <div className="shrink-0 max-h-[28vh] overflow-y-auto border-t border-blue-100 px-3 py-2 bg-white">
              <CustomerModePicker
                value={customerSelection}
                onChange={setCustomerSelection}
                compact
                section="details"
              />
            </div>
          )}

          <div className="shrink-0 border-t border-blue-200 max-h-[42vh] overflow-y-auto">
            <div className="p-3 sm:p-4 space-y-2.5 bg-gradient-to-r from-blue-50 to-white">
              <div>
                <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                  <label className="text-xs font-bold text-slate-900">Offer / coupon</label>
                  <div className="mt-1.5 flex gap-2"><input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase().replace(/\s/g, ''))} className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-bold uppercase" placeholder="Coupon code" /><button type="button" disabled={couponBusy || !couponCode.trim()} onClick={() => checkPromotion(couponCode)} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{couponBusy ? 'Checking…' : 'Apply'}</button></div>
                  {promotion && <p className="mt-2 text-xs font-bold text-emerald-700"><Sparkles className="mr-1 inline h-3.5 w-3.5" />{promotion.name} · save {formatCurrency(promotion.discount)}</p>}
                  {!promotion && <button type="button" onClick={() => checkPromotion('')} className="mt-2 text-xs font-semibold text-violet-700">Check automatic offers</button>}
                </div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-xs font-bold text-slate-900">Discount</label>
                  <div className="flex rounded-lg bg-slate-100 p-0.5">
                    {[
                      { id: 'percent', label: '%' },
                      { id: 'amount', label: 'Rs' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setDiscountMode(opt.id);
                          setDiscount(0);
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${
                          discountMode === opt.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {discountMode === 'amount' ? 'Rs' : '%'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={discountMode === 'percent' ? 100 : undefined}
                    step={discountMode === 'amount' ? '0.01' : '1'}
                    value={discount || ''}
                    onChange={(e) => { const value = parseFloat(e.target.value) || 0; setDiscount(value); if (value > 0) { setPromotion(null); setCouponCode(''); } }}
                    className="w-full rounded-lg border-2 border-blue-200 py-2 pl-9 pr-3 text-sm font-semibold text-slate-900"
                    placeholder="0"
                  />
                </div>
              </div>

              <ServiceChargeField value={serviceCharge} onChange={setServiceCharge} className="mb-2.5" />

              <div className="space-y-1 text-sm bg-white rounded-xl p-2.5 border border-blue-100">
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                  Rates from Settings · Tax {Number(settings.vat_percentage)}% · Service {Number(settings.service_charge_percentage)}%
                </p>
                <div className="flex justify-between">
                  <span className="text-slate-700">Subtotal</span>
                  <span className="font-bold text-slate-900">{formatCurrency(calculateSubtotal())}</span>
                </div>
                {(discount > 0 || promotion) && (
                  <div className="flex justify-between text-green-600">
                    <span>{promotion ? promotion.name : `Discount (${discountMode === 'amount' ? 'Rs' : `${discount}%`})`}</span>
                    <span className="font-bold">- {formatCurrency(calculateDiscount())}</span>
                  </div>
                )}
                {Number(getTotals().serviceCharge || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-700">
                      Service{Number(getTotals().servicePercent || 0) > 0 ? ` (${Number(getTotals().servicePercent)}%)` : ''}
                    </span>
                    <span className="font-bold text-slate-900">{formatCurrency(calculateService())}</span>
                  </div>
                )}
                {Number(settings.vat_percentage) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-700">Tax ({Number(settings.vat_percentage)}%)</span>
                    <span className="font-bold text-slate-900">{formatCurrency(calculateTax())}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold pt-1.5 border-t border-blue-200">
                  <span className="text-slate-900">Total</span>
                  <span className="text-blue-600">{formatCurrency(calculateTotal())}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1.5">Payment</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'cash', label: 'Cash', Icon: Wallet },
                    { id: 'online', label: 'Online', Icon: QrCode },
                    { id: 'credit', label: 'Credit', Icon: Building2 },
                    { id: 'split', label: 'Split', Icon: Sparkles },
                  ].map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(id);
                        if (id === 'cash' && !amountPaid) setAmountPaid(String(calculateTotal()));
                        if (id === 'credit') {
                          setCustomerSelection((prev) => ({
                            ...prev,
                            mode: 'customer',
                            name: prev.mode === 'customer' ? prev.name : '',
                            phone: prev.mode === 'customer' ? prev.phone : '',
                            address: prev.mode === 'customer' ? prev.address : '',
                            customer: prev.mode === 'customer' ? prev.customer : null,
                            isNew: prev.mode === 'customer' ? prev.isNew : false,
                          }));
                        }
                      }}
                      className={`p-1.5 rounded-lg border-2 transition-colors ${
                        paymentMethod === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-700 border-blue-200'
                      }`}
                    >
                      <Icon className="w-4 h-4 mx-auto mb-0.5" />
                      <span className="font-bold text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'cash' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Amount due</span>
                    <span className="font-bold tabular-nums">{formatCurrency(calculateTotal())}</span>
                  </div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Amount Received</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amountPaid}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.]/g, '');
                      const parts = raw.split('.');
                      setAmountPaid(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw);
                    }}
                    onFocus={(e) => e.target.select()}
                    className="w-full px-3 py-2 border-2 border-blue-200 rounded-lg text-slate-900 font-bold tabular-nums"
                    placeholder={String(calculateTotal() || '0.00')}
                  />
                  {amountPaid !== '' && (
                    calculateChange() >= -0.009 ? (
                      <p className="mt-1.5 text-green-800 font-semibold text-sm">
                        Change: {formatCurrency(Math.max(0, calculateChange()))}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-amber-700 font-semibold text-sm">
                        Still short by {formatCurrency(Math.abs(calculateChange()))}
                      </p>
                    )
                  )}
                </div>
              )}

              {paymentMethod === 'online' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">Confirm the Online payment, then complete the bill.</p>
                  {paymentQr.image && (
                    <button
                      type="button"
                      onClick={() =>
                        setQrModal({
                          open: true,
                          title: 'Online payment',
                          image: paymentQr.image,
                        })
                      }
                      className="w-full bg-white rounded-lg border border-blue-200 p-2 text-center hover:border-blue-400 hover:shadow-sm transition-all"
                    >
                      <p className="font-bold text-slate-900 mb-1 text-xs">Online</p>
                      <img
                        src={paymentQr.image}
                        alt="Online payment code"
                        className="w-24 h-24 mx-auto object-contain"
                      />
                      {paymentQr.amountInQr && <p className="text-[11px] text-slate-700 font-semibold mt-1">{formatCurrency(calculateTotal())} is set in this QR</p>}
                      <p className="text-[11px] text-blue-600 font-semibold mt-1">Tap to enlarge</p>
                    </button>
                  )}
                  {!settings.esewa_qr_image && !settings.bank_qr_image && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-center text-xs text-yellow-800">
                      No Online payment code configured in settings
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'credit' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <p className="font-semibold">{customerSelection.customer ? `Credit customer: ${customerSelection.customer.name}` : 'Select an existing customer above before using Credit.'}</p>
                  <label className="mt-2 block">Due date (optional)
                    <DateInput value={splitPayment.creditDueDate} onChange={(v) => setSplitPayment((sp) => ({ ...sp, creditDueDate: v }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2" />
                  </label>
                </div>
              )}

              {paymentMethod === 'split' && (
                <SplitPaymentFields
                  total={calculateTotal()}
                  value={splitPayment}
                  onChange={setSplitPayment}
                  customer={customerSelection.customer}
                  settings={settings}
                />
              )}

              <div className="flex gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => setCart([])}
                  disabled={cart.length === 0}
                  className="flex-1 py-2.5 bg-red-100 text-red-700 rounded-xl font-bold disabled:opacity-40 text-sm"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={cart.length === 0}
                  className="flex-[1.4] py-2.5 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 text-sm"
                >
                  Complete Sale
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BillConfirmModal
        open={confirmOpen}
        bill={pendingBill}
        confirming={confirming}
        onCancel={() => {
          if (confirming) return;
          setConfirmOpen(false);
          setPendingBill(null);
        }}
        onPrint={() => pendingBill && printThermalBill(pendingBill)}
        onConfirm={confirmSale}
      />

      <QrEnlargeModal
        open={qrModal.open}
        title={qrModal.title}
        image={qrModal.image}
        onClose={() => setQrModal({ open: false, title: '', image: '' })}
      />
    </Shell>
  );
}

function Shell({ variant, children, onBack }) {
  if (variant === 'cashier') {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-stone-200 px-3 py-2 flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-2 rounded-lg text-stone-600 hover:bg-stone-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-stone-900">Walk-in Billing</span>
        </div>
        {children}
      </div>
    );
  }
  return <AdminLayout>{children}</AdminLayout>;
}
