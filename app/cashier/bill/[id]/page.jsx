'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CreditCard, Tag, Receipt, Printer, Check, AlertCircle, Ban, RotateCcw,
} from 'lucide-react';
import MenuItemImage from '@/components/menu-item-image';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import BillConfirmModal from '@/components/billing/bill-confirm-modal';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';
import { usePaymentQr } from '@/lib/payment-qr.js';
import { calculateBillTotals, parseSettingsRates, resolveServiceCharge } from '@/lib/billing-totals';
import ServiceChargeField, { emptyServiceCharge, serviceChargePayload } from '@/components/billing/service-charge-field';
import { useConfirm } from '@/components/ui/confirm';
import { useAuth } from '@/lib/auth-context';
import { printFinalBill, printProforma } from '@/lib/pos-print.js';
import { formatNepalTime } from '@/lib/time-utils';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function BillDetailsPage({ params }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { prompt, confirm } = useConfirm();
  const { apiCall } = useAuth();
  const resolvedParams = use(params);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [bill, setBillRow] = useState(null);
  const [unsentCount, setUnsentCount] = useState(0);

  // Payment form state
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState('percent'); // percent | amount
  const [discountReason, setDiscountReason] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [serviceCharge, setServiceCharge] = useState(emptyServiceCharge);
  const [customerSelection, setCustomerSelection] = useState(emptyCustomerSelection);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBill, setPendingBill] = useState(null);
  const [splitPaymentMode, setSplitPaymentMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState([
    { method: 'cash', amount: 0 }
  ]);
  const [showQRModal, setShowQRModal] = useState(false);
  const [selectedQR, setSelectedQR] = useState({ image: '', title: '' });
  const [settings, setSettings] = useState({
    vat_percentage: 13,
    service_charge_percentage: 10,
    restaurant_name: 'Restaurant',
    restaurant_address: '',
    restaurant_phone: '',
    vat_number: '',
    pan_number: '',
    website: '',
    receipt_footer: '',
    receipt_paper_size: '80',
    bank_qr_image: '',
    esewa_qr_image: ''
  });

  useEffect(() => {
    fetchOrderDetails();
    fetchSettings();
    const onFocus = () => fetchSettings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [resolvedParams.id]);

  const fetchSettings = async () => {
    try {
      const res = await apiCall('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        const s = data.settings || {};
        setSettings({
          ...s,
          vat_percentage: Number(s.vat_percentage ?? 13),
          service_charge_percentage: Number(s.service_charge_percentage ?? 10),
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchOrderDetails = async () => {
    try {
      const res = await apiCall(`/api/admin/pos/orders/${resolvedParams.id}`);
      if (res.ok) {
        const data = await res.json();
        const ws = data.workspace;
        setOrder(ws.order);
        setDeliveryFee(Math.max(0, Number(ws.order?.delivery_fee || 0)));
        setOrderItems(ws.items || []);
        setBillRow(ws.bill || null);
        setUnsentCount(ws.unsent_count || 0);
        if (ws.order?.customer_phone) {
          setCustomerSelection({
            mode: 'customer',
            phone: ws.order.customer_phone,
            name: ws.order.customer_name || '',
            address: '',
            customer: {
              id: ws.order.customer_id || null,
              name: ws.order.customer_name || '',
              phone: ws.order.customer_phone,
            },
            isNew: !ws.order.customer_id,
          });
          try {
            const cRes = await apiCall(`/api/admin/customers?phone=${encodeURIComponent(ws.order.customer_phone)}`);
            if (cRes.ok) {
              const cData = await cRes.json();
              const found = cData.customer || cData.customers?.[0];
              if (found) {
                setCustomerSelection({
                  mode: 'customer',
                  phone: found.phone || ws.order.customer_phone,
                  name: found.name || ws.order.customer_name || '',
                  address: found.address || '',
                  customer: found,
                  isNew: false,
                });
              }
            }
          } catch {
            /* keep order fallback */
          }
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching order:', error);
      setLoading(false);
    }
  };

  const activeItems = orderItems.filter((i) => !['voided', 'cancelled'].includes(i.status));
  const subtotal = activeItems.reduce((s, i) => s + Number(i.subtotal ?? i.price * i.quantity), 0);

  const calculateBill = () => {
    const rates = parseSettingsRates(settings);
    // Per-bill service / extra charge; unticked keeps the house rate.
    const service = resolveServiceCharge(serviceCharge, rates.servicePercent);
    const totals = calculateBillTotals(subtotal, {
      ...(discountMode === 'amount'
        ? { discountAmount: Math.max(0, discount) }
        : { discountPercent: Math.max(0, discount) }),
      vatPercent: rates.vatPercent,
      servicePercent: service.servicePercent,
      serviceAmount: service.serviceAmount,
      deliveryFee: order?.order_type === 'delivery' ? Math.max(0, deliveryFee) : 0,
    });

    return {
      subtotal: totals.subtotal,
      taxAmount: totals.tax,
      serviceCharge: totals.serviceCharge,
      deliveryFee: totals.deliveryFee,
      discountAmount: totals.discount,
      finalAmount: totals.total,
      vatPercent: totals.taxPercent,
      servicePercent: totals.servicePercent,
    };
  };

  const addSplitPayment = () => {
    setSplitPayments([...splitPayments, { method: 'cash', amount: 0 }]);
  };

  const removeSplitPayment = (index) => {
    if (splitPayments.length > 1) {
      setSplitPayments(splitPayments.filter((_, i) => i !== index));
    }
  };

  const updateSplitPayment = (index, field, value) => {
    const updated = [...splitPayments];
    updated[index][field] = field === 'amount' ? parseFloat(value) || 0 : value;
    setSplitPayments(updated);
  };

  const validateSplitPayments = () => {
    const total = splitPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const { finalAmount } = calculateBill();
    return Math.abs(total - finalAmount) < 0.01;
  };

  const normalizeMethod = (m) => ['card', 'bank', 'bank_transfer', 'qr', 'fonepay', 'esewa', 'khalti'].includes(String(m).toLowerCase()) ? 'online' : m;

  const buildAllocations = (finalAmount) => {
    if (splitPaymentMode) {
      return splitPayments.map((sp) => ({ method: normalizeMethod(sp.method), amount: sp.amount }));
    }
    const method = normalizeMethod(paymentMethod);
    return [{ method, amount: finalAmount, cash_tendered: method === 'cash' ? finalAmount : undefined }];
  };

  const openPaymentConfirm = () => {
    const { finalAmount, subtotal: st, taxAmount, serviceCharge, deliveryFee: fee, discountAmount: disc, vatPercent, servicePercent } = calculateBill();

    if (unsentCount > 0) {
      addToast({ title: 'Unsent items', description: 'Ask the waiter to send the remaining items to the kitchen first.', variant: 'warning' });
      return;
    }

    if (finalAmount === 0 && !String(discountReason || '').trim()) {
      addToast(friendlyMessage('zero_reason_required'));
      return;
    }

    if (splitPaymentMode && !validateSplitPayments()) {
      addToast(friendlyMessage('payment_failed', {
        description: 'Split payment amounts must add up to the bill total.',
      }));
      return;
    }

    const customerCheck = validateCustomerSelection(customerSelection);
    if (!customerCheck.ok) {
      addToast(friendlyMessage('customer_required', { description: customerCheck.message }));
      return;
    }

    if (paymentMethod === 'credit' && customerSelection.mode !== 'customer') {
      addToast(friendlyMessage('customer_required', {
        description: 'Credit payments need a saved customer. Choose Customer and enter their phone.',
      }));
      return;
    }

    if (paymentMethod === 'credit' && finalAmount === 0) {
      addToast(friendlyMessage('payment_failed', {
        description: 'Credit cannot be used for a Rs 0 bill.',
      }));
      return;
    }

    setPendingBill({
      restaurant_name: settings.restaurant_name,
      restaurant_address: settings.restaurant_address,
      order_number: order?.order_number,
      customer_mode: customerSelection.mode,
      customer_name: customerCheck.name,
      customer_phone: customerCheck.phone,
      customer_address: customerCheck.address || '',
      items: activeItems.map((item) => ({
        name: item.item_name || item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal ?? item.price * item.quantity,
      })),
      subtotal: st,
      discount: disc,
      tax: taxAmount,
      tax_percent: vatPercent,
      service_charge: serviceCharge,
      delivery_fee: fee,
      service_percent: servicePercent,
      total: finalAmount,
      payment_method: splitPaymentMode ? 'split' : paymentMethod,
      allocations: buildAllocations(finalAmount),
      amount_paid: finalAmount,
      change: 0,
      discount_reason: discountReason,
      zero_bill: finalAmount === 0,
      date: new Date().toISOString(),
    });
    setConfirmOpen(true);
  };

  const processPayment = async () => {
    if (!pendingBill) return;
    try {
      setProcessing(true);
      const { finalAmount, discountAmount: resolvedDiscount } = calculateBill();

      const res = await apiCall(`/api/admin/pos/orders/${resolvedParams.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: uid(),
          discount: resolvedDiscount,
          discount_reason: discountReason,
          delivery_fee: order?.order_type === 'delivery' ? Math.max(0, deliveryFee) : 0,
          allocations: buildAllocations(finalAmount),
          customer_mode: customerSelection.mode,
          customer_name: pendingBill.customer_name,
          customer_phone: pendingBill.customer_phone,
          customer_address: pendingBill.customer_address || '',
          // Mode + value, never a computed amount: the pay route re-prices.
          ...serviceChargePayload(serviceCharge),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setConfirmOpen(false);
        setPendingBill(null);
        setProcessing(false);
        if (data.receipt) printFinalBill(data.receipt, { size: settings.receipt_paper_size || '80', settings });
        addToast(friendlyMessage('payment_success'));
        router.push('/cashier');
        return;
      }
      addToast(friendlyFromError(data, 'payment_failed'));
      setProcessing(false);
    } catch (error) {
      console.error('Payment error:', error);
      addToast(friendlyFromError(error, 'payment_failed'));
      setProcessing(false);
    }
  };

  const cancelOrder = async () => {
    const emptyOrder = activeItems.length === 0;
    const reason = await prompt({
      title: emptyOrder ? 'Cancel empty order' : 'Cancel order',
      message: 'This will release the table and keep the cancellation in order history.',
      label: 'Cancellation reason',
      placeholder: 'Example: Customer left / wrong table',
      required: true,
      multiline: true,
      tone: 'danger',
      confirmLabel: 'Cancel order',
    });
    if (reason == null) return;
    try {
      setProcessing(true);
      const res = await apiCall(`/api/admin/orders/${resolvedParams.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(friendlyMessage('order_cancelled'));
        router.push('/cashier');
      } else {
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setProcessing(false);
    }
  };

  const voidBill = async () => {
    if (!bill) return;
    const reason = await prompt({
      title: 'Void this bill?',
      message: 'This reverses the sale and restocks items. Keep the paper trail — a reason is required.',
      label: 'Void reason',
      required: true,
      multiline: true,
      tone: 'danger',
      confirmLabel: 'Void bill',
    });
    if (!reason || !String(reason).trim()) return;
    setProcessing(true);
    try {
      const res = await apiCall(`/api/admin/bills/${bill.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'void', reason: reason.trim(), restock: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not void bill');
      addToast(friendlyMessage('save_success', { description: 'Bill voided.' }));
      router.push('/cashier');
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setProcessing(false);
    }
  };

  const reopenBillForEdit = async () => {
    if (!bill) return;
    const reason = await prompt({
      title: 'Reopen this bill?',
      message: 'Use this to fix a payment mistake (wrong split, wrong discount). The order becomes editable again.',
      label: 'Reopen reason',
      required: true,
      multiline: true,
      tone: 'warning',
      confirmLabel: 'Reopen',
    });
    if (!reason || !String(reason).trim()) return;
    setProcessing(true);
    try {
      const res = await apiCall(`/api/admin/bills/${bill.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reopen bill');
      addToast(friendlyMessage('save_success', { description: 'Bill reopened — settle it again below.' }));
      await fetchOrderDetails();
    } catch (e) {
      addToast(friendlyFromError(e, 'save_failed'));
    } finally {
      setProcessing(false);
    }
  };

  const formatCurrency = (amount) => {
    const n = Number(amount);
    return `Rs ${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
  };

  const status = String(order?.status || '');
  const isOrderCompleted = status === 'completed' && bill && bill.status !== 'reopened';
  const canProcessPayment = order && !['cancelled'].includes(status) && !isOrderCompleted;
  const paymentQr = usePaymentQr(settings, calculateBill().finalAmount);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-800 text-lg">Loading bill details...</p>
        </div>
      </div>
    );
  }

  const billTotals = calculateBill();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
          <button
            onClick={() => router.push('/cashier')}
            className="flex items-center space-x-2 text-gray-800 hover:text-gray-900 transition-colors self-start"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">
              <span className="sm:hidden">Back</span>
              <span className="hidden sm:inline">Back to Dashboard</span>
            </span>
          </button>
          <h1 className="text-xl sm:text-3xl font-bold text-gray-800">{isOrderCompleted ? 'Bill Details' : 'Process Payment'}</h1>
        </div>

        {unsentCount > 0 && !isOrderCompleted && (
          <div className="mb-6 bg-amber-50 border-2 border-amber-200 text-amber-900 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <p className="text-sm font-semibold">{unsentCount} item(s) not sent to the kitchen yet — ask the waiter to send a KOT before billing.</p>
          </div>
        )}

        {isOrderCompleted && (
          <div className="mb-6 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl shadow-xl p-4 sm:p-6">
            <div className="flex items-start sm:items-center space-x-3 sm:space-x-4">
              <div className="bg-white/20 p-2 sm:p-3 rounded-full flex-shrink-0">
                <Check className="w-6 h-6 sm:w-8 sm:h-8" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold">Order Completed</h3>
                <p className="text-purple-100 text-sm sm:text-base">
                  Bill {bill?.bill_number} · {String(bill?.status || 'paid')} · {formatCurrency(bill?.grand_total)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
          {/* Order Details */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-black mb-4 flex items-center">
                <Receipt className="w-6 h-6 mr-2 text-blue-600" />
                Order Details
              </h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-black">Order:</span>
                  <span className="font-bold text-black">{order?.order_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black">Table:</span>
                  <span className="font-bold text-black">{order?.table_number || 'Takeaway'}{order?.party_label ? ` · ${order.party_label}` : ''}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black">Status:</span>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 capitalize">
                    {order?.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black">Time:</span>
                  <span className="font-semibold text-black">{order?.created_at ? formatNepalTime(order.created_at) : '—'}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <h3 className="font-bold text-black mb-3">Items</h3>
                <div className="space-y-2">
                  {activeItems.map((item, index) => (
                    <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 gap-3">
                      <MenuItemImage src={item.image_url} alt={item.item_name} size="sm" />
                      <div className="flex-1">
                        <p className="font-semibold text-black">{item.item_name}</p>
                        <p className="text-sm text-black">Qty: {item.quantity} × {formatCurrency(item.price)}</p>
                      </div>
                      <span className="font-bold text-black">
                        {formatCurrency(item.quantity * item.price)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bill Summary */}
            <div className="bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl shadow-lg p-6 text-white">
              <h2 className="text-xl font-bold mb-4">Bill Summary</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-lg">
                  <span>Subtotal:</span>
                  <span className="font-semibold">{formatCurrency(billTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-100">Tax ({billTotals.vatPercent}%):</span>
                  <span>{formatCurrency(billTotals.taxAmount)}</span>
                </div>
                {billTotals.servicePercent > 0 && (
                  <div className="flex justify-between">
                    <span className="text-blue-100">Service Charge ({billTotals.servicePercent}%):</span>
                    <span>{formatCurrency(billTotals.serviceCharge)}</span>
                  </div>
                )}
                {billTotals.deliveryFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-blue-100">Delivery:</span>
                    <span>{formatCurrency(billTotals.deliveryFee)}</span>
                  </div>
                )}
                {billTotals.discountAmount > 0 && (
                  <div className="flex justify-between text-yellow-300">
                    <span>Discount:</span>
                    <span>- {formatCurrency(billTotals.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xl font-bold pt-3 border-t-2 border-white/30">
                  <span>Total:</span>
                  <span>{formatCurrency(billTotals.finalAmount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Form */}
          <div className="space-y-6">
            {isOrderCompleted ? (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                  <Check className="w-6 h-6 mr-2 text-green-600" />
                  Payment Completed
                </h2>
                <div className="text-center py-8">
                  <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-12 h-12 text-green-600" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mb-2">Payment Processed</p>
                  <p className="text-gray-600">This order has been completed and paid.</p>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={async () => {
                      const res = await apiCall(`/api/admin/bills/${bill.id}`);
                      const data = await res.json().catch(() => ({}));
                      if (res.ok && data.bill) {
                        const { receiptFromBillDetail } = await import('@/lib/bill-receipt.js');
                        printFinalBill(receiptFromBillDetail(data.bill, settings), { size: settings.receipt_paper_size || '80', reprint: true, settings });
                      }
                    }}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-semibold flex items-center justify-center gap-2"
                  >
                    <Printer className="w-5 h-5" />
                    Print bill
                  </button>
                  {bill && (
                    <button
                      onClick={reopenBillForEdit}
                      disabled={processing}
                      className="w-full py-3 bg-amber-50 border-2 border-amber-200 text-amber-800 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-5 h-5" />
                      Reopen (fix payment mistake)
                    </button>
                  )}
                  {bill && (
                    <button
                      onClick={voidBill}
                      disabled={processing}
                      className="w-full py-3 bg-white border-2 border-red-200 text-red-700 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Ban className="w-5 h-5" />
                      Void bill
                    </button>
                  )}
                  <button
                    onClick={() => router.push('/cashier')}
                    className="w-full py-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-all font-semibold"
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                  <CreditCard className="w-6 h-6 mr-2 text-blue-600" />
                  Payment Details
                </h2>

              {/* Payment Method Dropdown */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900 font-semibold"
                >
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                  <option value="credit">Credit (Customer Account)</option>
                </select>
              </div>

              {/* QR Payment Options */}
              {paymentMethod === 'online' && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <h3 className="font-semibold text-gray-900 mb-1 text-center">Scan to Pay</h3>
                  {/* An EMVCo merchant QR gets the amount set in it; any other
                      code carries none and the guest types it in — so the
                      figure is the biggest thing here, directly above the codes. */}
                  <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    {paymentQr.amountInQr ? 'Amount (already set in the QR)' : 'Amount to enter'}
                  </p>
                  <p className="mb-4 text-center text-4xl font-extrabold tabular-nums text-gray-900">
                    {formatCurrency(billTotals.finalAmount)}
                  </p>
                  <div className="grid grid-cols-1 gap-4">
                    {paymentQr.image && (
                      <div className="text-center cursor-pointer" onClick={() => {
                        setSelectedQR({ image: paymentQr.image, title: 'Online payment' });
                        setShowQRModal(true);
                      }}>
                        <p className="text-sm font-semibold text-gray-900 mb-2">Online</p>
                        <img
                          src={paymentQr.image}
                          alt="Online payment code"
                          className="w-full max-w-[200px] mx-auto border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:shadow-lg transition-all"
                        />
                        <p className="text-xs text-blue-600 mt-1">Click to enlarge</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Customer: Walk-in or saved */}
              <div className="mb-6 p-4 bg-stone-50 rounded-lg border-2 border-stone-200">
                <p className="text-sm font-bold text-stone-900 mb-3">Customer</p>
                <CustomerModePicker
                  value={customerSelection}
                  onChange={setCustomerSelection}
                />
              </div>

              {/* Discount */}
              {order?.order_type === 'delivery' && (
                <div className="mb-6 rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
                  <label className="mb-2 block text-sm font-semibold text-gray-900">Delivery fee</label>
                  <div className="flex items-center rounded-lg border-2 border-blue-300 bg-white px-3 focus-within:border-blue-500">
                    <span className="text-sm font-semibold text-gray-500">Rs</span>
                    <input type="number" min="0" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))} className="h-12 min-w-0 flex-1 px-2 text-base font-semibold text-gray-900 outline-none" />
                  </div>
                  <p className="mt-1.5 text-xs text-blue-700">Saved on this bill. Adjust it here if the confirmed address changes the distance.</p>
                </div>
              )}

              {/* Discount */}
              <div className="space-y-4 mb-6 p-4 bg-yellow-50 rounded-lg border-2 border-yellow-200">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="text-sm font-semibold text-gray-900 flex items-center">
                      <Tag className="w-4 h-4 mr-2" />
                      Discount
                    </label>
                    <div className="flex rounded-lg bg-yellow-100 p-0.5">
                      {[
                        { id: 'percent', label: '%' },
                        { id: 'amount', label: 'Rs' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => { setDiscountMode(opt.id); setDiscount(0); }}
                          className={`rounded-md px-3 py-1 text-xs font-bold ${
                            discountMode === opt.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">
                      {discountMode === 'amount' ? 'Rs' : '%'}
                    </span>
                    <input
                      type="number"
                      value={discount}
                      onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                      className="w-full pl-10 pr-4 py-3 border-2 border-yellow-300 rounded-lg focus:border-yellow-500 focus:outline-none text-gray-900"
                      placeholder="0"
                      min="0"
                      max={discountMode === 'percent' ? 100 : undefined}
                      step={discountMode === 'amount' ? '0.01' : '1'}
                    />
                  </div>
                </div>
                {/* Per-bill service / extra charge, beside the other money
                    decisions made at this checkout. */}
                <ServiceChargeField value={serviceCharge} onChange={setServiceCharge} />
                {discount > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Discount Reason
                    </label>
                    <input
                      type="text"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-yellow-300 rounded-lg focus:border-yellow-500 focus:outline-none text-gray-900"
                      placeholder="e.g., Senior citizen, Promotional offer"
                      required
                    />
                  </div>
                )}
                {billTotals.finalAmount === 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Reason for Rs 0 bill
                    </label>
                    <input
                      type="text"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-amber-400 rounded-lg focus:border-amber-500 focus:outline-none text-gray-900"
                      placeholder="e.g., Guest left, mistaken order, complimentary"
                      required
                    />
                    <p className="text-xs text-amber-800 mt-1">
                      Required to close empty or free bills and free the table.
                    </p>
                  </div>
                )}
              </div>

              {/* Split Payment Toggle */}
              <div className="mb-6">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitPaymentMode}
                    onChange={(e) => setSplitPaymentMode(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-gray-900">Split Payment</span>
                </label>
              </div>

              {/* Split Payment */}
              {splitPaymentMode && (
                <div className="space-y-4 mb-6">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-gray-900">
                      Split Payment Methods
                    </label>
                    <button
                      onClick={addSplitPayment}
                      className="text-sm px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-semibold"
                    >
                      + Add Method
                    </button>
                  </div>

                  {splitPayments.map((sp, index) => (
                    <div key={index} className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={sp.method}
                        onChange={(e) => updateSplitPayment(index, 'method', e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                      >
                        <option value="cash">Cash</option>
                        <option value="online">Online</option>
                        <option value="credit">Credit</option>
                      </select>
                      <input
                        type="number"
                        value={sp.amount}
                        onChange={(e) => updateSplitPayment(index, 'amount', e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                        placeholder="Amount"
                        min="0"
                        step="0.01"
                      />
                      {splitPayments.length > 1 && (
                        <button
                          onClick={() => removeSplitPayment(index)}
                          className="px-4 py-3 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                  {splitPaymentMode && (
                    <div className="p-3 bg-gray-100 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span>Split Total:</span>
                        <span className="font-bold">
                          {formatCurrency(splitPayments.reduce((sum, p) => sum + (p.amount || 0), 0))}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span>Required:</span>
                        <span className="font-bold">{formatCurrency(billTotals.finalAmount)}</span>
                      </div>
                      {!validateSplitPayments() && (
                        <p className="text-xs text-red-600 mt-2 flex items-center">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Split amounts must equal total
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Process Payment Button */}
              <button
                onClick={openPaymentConfirm}
                disabled={processing || (splitPaymentMode && !validateSplitPayments()) || !canProcessPayment || unsentCount > 0}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:from-green-600 hover:to-green-700 transition-all font-bold text-lg shadow-xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                <Check className="w-6 h-6" />
                <span>
                  {billTotals.finalAmount === 0
                    ? 'Complete Rs 0 bill'
                    : `Complete Order - ${formatCurrency(billTotals.finalAmount)}`}
                </span>
              </button>
              {canProcessPayment && (
                <button
                  type="button"
                  disabled={processing}
                  onClick={cancelOrder}
                  className="w-full mt-2 py-3 bg-white border-2 border-red-200 text-red-700 rounded-xl font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel order / release table
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      </div>

      <BillConfirmModal
        open={confirmOpen}
        bill={pendingBill}
        confirming={processing}
        onCancel={() => {
          if (processing) return;
          setConfirmOpen(false);
          setPendingBill(null);
        }}
        onPrint={() => pendingBill && printProforma({
          order,
          items: activeItems,
          kots: [],
          totals: {
            subtotal: pendingBill.subtotal,
            discount: pendingBill.discount,
            tax: pendingBill.tax,
            taxPercent: pendingBill.tax_percent,
            serviceCharge: pendingBill.service_charge,
            servicePercent: pendingBill.service_percent,
            total: pendingBill.total,
          },
        }, { size: settings.receipt_paper_size || '80', settings })}
        onConfirm={processPayment}
      />

      <QrEnlargeModal
        open={showQRModal}
        title={selectedQR.title}
        image={selectedQR.image}
        onClose={() => setShowQRModal(false)}
      />
    </div>
  );
}
