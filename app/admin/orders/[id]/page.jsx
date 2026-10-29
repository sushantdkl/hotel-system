'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  ArrowLeft, Printer, Clock, User, Phone, CreditCard, MapPin, ExternalLink, Ban, UserCog,
  X, RotateCcw, Bike,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display.js';
import { latestReopenChanges, buildChangeIndex } from '@/lib/reopen-diff.js';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { printFinalBill } from '@/lib/pos-print.js';
import { receiptFromOrderDetail } from '@/lib/bill-receipt.js';
import ReviseSettlementForm from '@/components/billing/revise-settlement-form';
import { orderTypeLabel, normalizedOrderType } from '@/lib/order-types.js';
import { SittingTime } from '@/components/tables/table-open-duration.jsx';

export default function OrderView() {
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const { confirm, prompt, alert } = useConfirm();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [refundReason, setRefundReason] = useState('');
  const [paySettings, setPaySettings] = useState({});
  const [executives, setExecutives] = useState([]);
  const [assigningExecutive, setAssigningExecutive] = useState(false);

  const fetchOrderDetails = useCallback(async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/orders/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrder(data.order);
        setItems(data.items || []);
        setPayments(data.payments || []);
        setActivity(data.activity || []);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (params.id) fetchOrderDetails();
  }, [params.id, fetchOrderDetails]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const res = await fetch('/api/admin/delivery-executives', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setExecutives(data.executives || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const assignExecutive = async (executiveId) => {
    setAssigningExecutive(true);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/orders/${order.id || params.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_executive_id: executiveId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update assignment');
      addToast({ description: executiveId ? 'Delivery executive assigned.' : 'Assignment cleared.', variant: 'success' });
      await fetchOrderDetails();
    } catch (e) {
      addToast({ description: e.message, variant: 'error' });
    } finally {
      setAssigningExecutive(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPaySettings(data.settings || data || {});
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      preparing: 'bg-blue-100 text-blue-800 border-blue-300',
      ready: 'bg-green-100 text-green-800 border-green-300',
      dining: 'bg-blue-100 text-blue-800 border-blue-300',
      awaiting_payment: 'bg-amber-100 text-amber-900 border-amber-300',
      completed: 'bg-gray-100 text-gray-800 border-gray-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300',
      refunded: 'bg-rose-100 text-rose-800 border-rose-300',
      partially_refunded: 'bg-amber-100 text-amber-900 border-amber-300',
      voided: 'bg-red-100 text-red-900 border-red-400',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-xl text-gray-900">Loading order details...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!order) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-xl text-gray-900">Order not found</div>
        </div>
      </AdminLayout>
    );
  }

  const closed = ['completed', 'cancelled'].includes(String(order.status || ''));
  const cancelled = ['cancelled', 'canceled'].includes(String(order.status || ''));
  const subtotal = Number(order.bill_subtotal ?? order.total_amount ?? 0);
  const discount = Number(order.bill_discount ?? 0);
  const tax = Number(order.bill_tax ?? 0);
  const service = Number(order.bill_service_charge ?? 0);
  const grand = Number(order.bill_grand_total ?? order.total_amount ?? 0);
  const deliveryFee = Number(order.bill_delivery_fee ?? order.delivery_fee ?? 0);
  const outstanding = Number(order.outstanding_amount ?? 0);
  const paid = Number(order.amount_paid ?? Math.max(0, grand - outstanding));
  const refundedAmount = Number(order.refunded_amount || 0);
  const voidedAmount = Number(order.voided_amount || 0);
  const billVoided = ['void', 'voided', 'cancelled', 'canceled'].includes(String(order.bill_status || '').toLowerCase()) || voidedAmount > 0;
  const fullyRefunded = refundedAmount >= grand - 0.009 && grand > 0;
  const financialStatus = billVoided ? 'voided' : fullyRefunded ? 'refunded' : refundedAmount > 0 ? 'partially_refunded' : order.status;
  const payStatus = billVoided ? 'voided' : fullyRefunded ? 'refunded' : refundedAmount > 0 ? 'partially_refunded' : String(order.payment_status || (outstanding > 0 ? 'unpaid' : closed ? 'paid' : 'open'));
  const netRetained = Math.max(0, paid - refundedAmount - voidedAmount);

  // Reopen change annotations for the item list (cut / added effects).
  const reopenChanges = latestReopenChanges(activity);
  const { map: changeMap, removed: removedItems, changeKey } = buildChangeIndex(reopenChanges);
  const itemChangeFor = (item) => changeMap.get(changeKey(item)) || null;

  const voidOrder = async () => {
    const reason = await prompt({
      title: `Void order ${order.order_number}?`,
      message: 'This cancels the order and restores any stock. Enter a reason to continue.',
      label: 'Reason',
      placeholder: 'e.g. Customer left / Wrong order',
      confirmLabel: 'Void order',
      tone: 'danger',
      required: true,
      multiline: true,
    });
    if (reason == null) return;
    setBusy(true);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/orders/${order.id || params.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Void failed');
      addToast({ description: data.message || 'Order voided.', variant: 'success' });
      await fetchOrderDetails();
    } catch (e) {
      await alert({ title: 'Could not void', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  // Completed orders reopen through the same accounting-safe flow as the bills
  // page (marks the bill `reopened`, unlocks sent lines in POS, settles only the
  // delta). Non-completed orders just deep-link to POS for normal editing.
  const openInPos = async () => {
    const orderId = order.id || params.id;
    if (!(closed && !cancelled) || !order.bill_id) {
      router.push(`${panelPath('/cashier/pos', '/admin/pos')}?order=${orderId}`);
      return;
    }
    const reason = await prompt({
      title: 'Reopen this bill in POS?',
      message: `Order ${order.order_number} will reopen for editing. Checkout will only settle the difference vs what was already paid.`,
      label: 'Reason for reopening',
      placeholder: 'e.g. Forgot item / Customer changed order',
      confirmLabel: 'Reopen in POS',
      tone: 'warning',
      required: true,
      multiline: true,
    });
    if (reason == null) return;
    setBusy(true);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/bills/${order.bill_id}/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Reopen failed');
      router.push(`${panelPath('/cashier/pos', '/admin/pos')}?order=${orderId}`);
    } catch (e) {
      await alert({ title: 'Could not reopen', message: e.message, tone: 'danger' });
      setBusy(false);
    }
  };

  const printBill = async () => {
    if (!order.bill_id && !order.bill_number) {
      await alert({
        title: 'No bill yet',
        message: 'This order has no bill to print. Complete payment in POS first.',
        tone: 'warning',
      });
      return;
    }
    const receipt = receiptFromOrderDetail({ order, items, payments, activity, settings: paySettings });
    if (!receipt?.items?.length) {
      await alert({ title: 'Empty bill', message: 'There are no items on this bill to print.', tone: 'warning' });
      return;
    }
    printFinalBill(receipt, { size: paySettings?.receipt_paper_size || '80', reprint: true, settings: paySettings });
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-gray-900" />
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Order #{compactOrderNumber(order.order_number)}
              </h1>
              <p className="text-gray-700 mt-1 text-sm">
                {formatNepalDateTime(order.created_at)}
                {order.table_number ? ` · Table ${order.table_number}` : ''}
                {order.party_label ? ` · ${order.party_label}` : ''}
                {normalizedOrderType(order) === 'dine_in' ? (
                  <>
                    {' · '}
                    <SittingTime
                      openedAt={order.created_at}
                      closedAt={order.paid_at}
                      status={financialStatus || order.status}
                      dineIn
                    />
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`px-4 py-2 rounded-lg border font-semibold ${getStatusColor(financialStatus)}`}>
              {String(financialStatus || '').replace(/_/g, ' ').toUpperCase()}
            </span>
            <span className="px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 font-semibold text-indigo-900 capitalize">
              {payStatus.replace(/_/g, ' ')}
              {outstanding > 0.009 ? ` · Due ${formatCurrency(outstanding)}` : ''}
            </span>
            {!billVoided && !fullyRefunded && (
              <button
                type="button"
                disabled={busy}
                onClick={openInPos}
                className="no-print inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold disabled:opacity-50"
              >
                <ExternalLink className="w-5 h-5" />
                {closed && !cancelled ? 'Reopen in POS' : 'Edit in POS / KOT'}
              </button>
            )}
            {order.bill_id && !cancelled && !billVoided && !fullyRefunded && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setReviseOpen(true)}
                className="no-print inline-flex items-center gap-2 px-4 py-2 border border-indigo-300 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 font-semibold disabled:opacity-50"
              >
                <UserCog className="w-5 h-5" />
                Edit payment / customer
              </button>
            )}
            {order.bill_id && closed && !cancelled && !billVoided && !fullyRefunded && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRefundOpen(true);
                  setRefundAmount('');
                  setRefundReason('');
                }}
                className="no-print inline-flex items-center gap-2 px-4 py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 font-semibold disabled:opacity-50"
              >
                <RotateCcw className="w-5 h-5" />
                Refund
              </button>
            )}
            {!cancelled && !billVoided && refundedAmount <= 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={voidOrder}
                className="no-print inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-semibold disabled:opacity-50"
              >
                <Ban className="w-5 h-5" />
                Void
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={printBill}
              className="no-print flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Printer className="w-5 h-5" />
              Print bill
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-xl font-bold text-gray-900">Order Items</h2>
              </div>
              <div className="p-6 overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="text-left pb-3 font-semibold text-gray-900">Item</th>
                      <th className="text-center pb-3 font-semibold text-gray-900">Qty</th>
                      <th className="text-center pb-3 font-semibold text-gray-900">Sent</th>
                      <th className="text-right pb-3 font-semibold text-gray-900">Price</th>
                      <th className="text-right pb-3 font-semibold text-gray-900">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {items.map((item) => {
                      const chg = itemChangeFor(item);
                      return (
                        <tr key={item.id} className={['voided', 'cancelled'].includes(item.status) ? 'bg-red-50 text-red-800' : ''}>
                          <td className="py-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                                <span>
                                  {item.item_name || item.menu_item_name || `Item #${item.menu_item_id}`}
                                  {item.variant_name ? ` (${item.variant_name})` : ''}
                                </span>
                                {chg?.kind === 'added' && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Added after reopen</span>
                                )}
                                {chg?.kind === 'increased' && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">+{chg.deltaQty} added ({chg.fromQty}→{chg.toQty})</span>
                                )}
                                {chg?.kind === 'decreased' && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Cut {chg.fromQty}→{chg.toQty}</span>
                                )}
                              </div>
                              {item.special_instructions && (
                                <div className="text-sm text-gray-700 mt-1">
                                  Note: {item.special_instructions}
                                </div>
                              )}
                              {item.status && item.status !== 'pending' && (
                                <div className="text-xs text-gray-500 mt-0.5 capitalize">{item.status}</div>
                              )}
                            </div>
                          </td>
                          <td className="py-4 text-center text-gray-900">{item.quantity}</td>
                          <td className="py-4 text-center text-gray-600">{item.sent_quantity ?? '—'}</td>
                          <td className="py-4 text-right text-gray-900">
                            {formatCurrency(item.price ?? ((item.subtotal || 0) / (item.quantity || 1)))}
                          </td>
                          <td className="py-4 text-right font-semibold text-gray-900">
                            {formatCurrency(item.subtotal || 0)}
                          </td>
                        </tr>
                      );
                    })}
                    {removedItems.map((r, i) => (
                      <tr key={`removed-${i}`} className="bg-red-50/40 text-red-500">
                        <td className="py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium line-through">
                              {r.name}{r.variant ? ` (${r.variant})` : ''}
                            </span>
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">Removed after reopen</span>
                          </div>
                        </td>
                        <td className="py-4 text-center line-through">{r.fromQty}</td>
                        <td className="py-4 text-center">—</td>
                        <td className="py-4 text-right line-through">{formatCurrency(r.unitPrice || 0)}</td>
                        <td className="py-4 text-right font-semibold line-through">{formatCurrency(r.total || 0)}</td>
                      </tr>
                    ))}
                    {!items.length && !removedItems.length && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-400">No items</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Order Details</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-gray-700" />
                  <div>
                    <div className="text-sm text-gray-700">Customer</div>
                    <div className="font-medium text-gray-900">{order.customer_name || 'Walk-in'}</div>
                  </div>
                </div>
                {order.customer_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-5 h-5 text-gray-700" />
                    <div>
                      <div className="text-sm text-gray-700">Phone</div>
                      <div className="font-medium text-gray-900">{order.customer_phone}</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-gray-700" />
                  <div>
                    <div className="text-sm text-gray-700">Destination</div>
                    <div className="font-medium text-gray-900">
                      {order.table_number ? `Table ${order.table_number}` : orderTypeLabel(order)}
                      {order.party_label ? ` · ${order.party_label}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-gray-700" />
                  <div>
                    <div className="text-sm text-gray-700">Type / Date</div>
                    <div className="font-medium text-gray-900">
                      {orderTypeLabel(order)} · {formatNepalDateTime(order.created_at)}
                      {normalizedOrderType(order) === 'dine_in' ? (
                        <>
                          {' · '}
                          <SittingTime
                            openedAt={order.created_at}
                            closedAt={order.paid_at}
                            status={financialStatus || order.status}
                            dineIn
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {order.bill_number && (
                  <div className="text-sm text-gray-600">
                    Bill: <span className="font-semibold text-gray-900">{compactBillNumber(order.bill_number)}</span>
                  </div>
                )}
                {normalizedOrderType(order) === 'delivery' && (
                  <div className="flex items-center gap-3 pt-1">
                    <Bike className="w-5 h-5 text-gray-700 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-700">Delivery executive</div>
                      <select
                        disabled={assigningExecutive}
                        value={order.delivery_executive_id || ''}
                        onChange={(e) => assignExecutive(e.target.value ? Number(e.target.value) : null)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
                      >
                        <option value="">Self / Unassigned</option>
                        {executives.map((ex) => (
                          <option key={ex.id} value={ex.id}>{ex.name}{ex.phone ? ` · ${ex.phone}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Payment Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-gray-900">
                  <span>Subtotal</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span className="font-medium">- {formatCurrency(discount)}</span>
                  </div>
                )}
                {service > 0 && (
                  <div className="flex justify-between text-gray-900">
                    <span>Service</span>
                    <span className="font-medium">{formatCurrency(service)}</span>
                  </div>
                )}
                {tax > 0 && (
                  <div className="flex justify-between text-gray-900">
                    <span>Tax / VAT</span>
                    <span className="font-medium">{formatCurrency(tax)}</span>
                  </div>
                )}
                {deliveryFee > 0 && (
                  <div className="flex justify-between text-gray-900">
                    <span>Delivery</span>
                    <span className="font-medium">{formatCurrency(deliveryFee)}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-gray-200 flex justify-between text-lg font-bold text-gray-900">
                  <span>Total</span>
                  <span>{formatCurrency(grand || subtotal)}</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Collected</span>
                  <span className="font-semibold">{formatCurrency(paid)}</span>
                </div>
                {refundedAmount > 0 && (
                  <div className="flex justify-between font-semibold text-rose-700">
                    <span>Refunded</span>
                    <span>- {formatCurrency(refundedAmount)}</span>
                  </div>
                )}
                {voidedAmount > 0 && (
                  <div className="flex justify-between font-semibold text-red-700">
                    <span>Voided / reversed</span>
                    <span>- {formatCurrency(voidedAmount)}</span>
                  </div>
                )}
                {(refundedAmount > 0 || voidedAmount > 0) && (
                  <div className="flex justify-between border-t border-gray-200 pt-3 font-bold text-gray-900">
                    <span>Net retained</span>
                    <span>{formatCurrency(netRetained)}</span>
                  </div>
                )}
                <div className={`flex justify-between font-bold ${outstanding > 0.009 ? 'text-amber-700' : 'text-gray-500'}`}>
                  <span>Due / Credit</span>
                  <span>{formatCurrency(outstanding)}</span>
                </div>
              </div>

              {payments.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200 space-y-2">
                  <div className="flex items-center gap-2 text-gray-700 mb-2">
                    <CreditCard className="w-5 h-5" />
                    <span className="font-medium">Payments</span>
                  </div>
                  {payments.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm text-gray-800">
                      <span className="capitalize">
                        {p.payment_method === 'cash' ? 'Cash' : p.payment_method === 'credit' ? 'Credit' : 'Online'}
                        {p.reference_number ? ` · ${p.reference_number}` : ''}
                      </span>
                      <span className="font-semibold">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {order.notes && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3">Order Notes</h3>
                <p className="text-gray-800">{order.notes}</p>
              </div>
            )}

            {activity.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3">Audit &amp; change history</h3>
                <div className="space-y-3">
                  {activity.map((a) => (
                    <div key={a.id} className="border-l-2 border-gray-200 pl-3">
                      <p className="text-sm font-medium text-gray-900 capitalize">{String(a.event).replace(/_/g, ' ')}{a.actor ? ` · ${a.actor}` : ''}</p>
                      {a.reason && <p className="text-xs text-gray-500">“{a.reason}”</p>}
                      <ReopenActivityDetail value={a.newValue} />
                      <p className="text-[11px] text-gray-400 mt-0.5">{formatNepalDateTime(a.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {reviseOpen && order.bill_id && (
        <ActionPopup title="Edit payment / customer" onClose={() => setReviseOpen(false)}>
          <ReviseSettlementForm
            billTotal={Number(order.bill_grand_total ?? order.total_amount ?? 0)}
            initialCustomer={
              order.customer_id || order.customer_phone
                ? {
                    id: order.customer_id || null,
                    name: order.customer_name || '',
                    phone: order.customer_phone || '',
                    credit_limit: order.credit_limit,
                    current_credit: order.current_credit,
                  }
                : null
            }
            settings={paySettings}
            busy={busy}
            onCancel={() => setReviseOpen(false)}
            onSubmit={async (result) => {
              if (result?.error) {
                await alert({ title: 'Check details', message: result.error, tone: 'warning' });
                return;
              }
              setBusy(true);
              try {
                const token = localStorage.getItem('pos_token');
                const res = await fetch(`/api/admin/bills/${order.bill_id}`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'revise_settlement',
                    reason: result.reason,
                    allocations: result.allocations,
                    customer_id: result.customer_id,
                    customer_name: result.customer_name,
                    customer_phone: result.customer_phone,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Could not save changes');
                setReviseOpen(false);
                addToast({ description: 'Settlement updated.', variant: 'success' });
                await fetchOrderDetails();
              } catch (e) {
                await alert({ title: 'Could not save', message: e.message, tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          />
        </ActionPopup>
      )}
      {refundOpen && order.bill_id && (
        <ActionPopup title="Refund bill" onClose={() => setRefundOpen(false)}>
          <ActionForm
            title="Refund bill"
            tone="amber"
            busy={busy}
            requireReason
            reason={refundReason}
            setReason={setRefundReason}
            onCancel={() => setRefundOpen(false)}
            onConfirm={async () => {
              setBusy(true);
              try {
                const token = localStorage.getItem('pos_token');
                const res = await fetch(`/api/admin/bills/${order.bill_id}`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'refund',
                    amount: Number(refundAmount) || undefined,
                    full: !refundAmount,
                    method: refundMethod,
                    reason: refundReason,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Refund failed');
                setRefundOpen(false);
                setRefundAmount('');
                setRefundReason('');
                addToast({ description: 'Refund posted.', variant: 'success' });
                await fetchOrderDetails();
              } catch (e) {
                await alert({ title: 'Could not refund', message: e.message, tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
            confirmLabel={refundAmount ? `Refund ${formatCurrency(Number(refundAmount))}` : 'Refund full amount'}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                placeholder="Amount (blank = full)"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-44 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <MethodSelect value={refundMethod} onChange={setRefundMethod} />
            </div>
          </ActionForm>
        </ActionPopup>
      )}
    </AdminLayout>
  );
}

function MethodSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
      <option value="cash">Cash</option>
      <option value="online">Online</option>
    </select>
  );
}

const TONE = {
  amber: 'bg-amber-600 hover:bg-amber-700',
};

function ActionForm({ title, tone = 'amber', children, onConfirm, onCancel, confirmLabel, busy, requireReason, reason, setReason }) {
  const blocked = requireReason && !String(reason || '').trim();
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-2 text-sm font-semibold text-gray-900">{title}</p>
      <div className="space-y-3">
        {children}
        {requireReason && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason (required)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || blocked}
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${blocked ? 'bg-gray-300' : TONE[tone]}`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionPopup({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Item-change log + prior/new payment split from a reopen-settle audit entry. */
function ReopenActivityDetail({ value }) {
  if (!value || typeof value !== 'object') return null;
  const ch = value.changes;
  const prior = (value.priorPayments || []).filter((p) => Number(p.amount) > 0);
  const next = (value.newPayments || []).filter((p) => Number(p.amount) > 0);
  const rows = [];
  if (ch) {
    for (const r of ch.added || []) rows.push({ k: `add-${r.name}`, cls: 'text-emerald-600', txt: `+ ${r.toQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
    for (const r of ch.changed || []) rows.push({ k: `chg-${r.name}`, cls: r.deltaQty > 0 ? 'text-emerald-600' : 'text-amber-600', txt: `${r.fromQty}→${r.toQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
    for (const r of ch.removed || []) rows.push({ k: `rem-${r.name}`, cls: 'text-red-500 line-through', txt: `${r.fromQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
  }
  const payLabel = (m) => ({ cash: 'Cash', credit: 'Credit' }[m] || 'Online');
  const hasMoney = Number(value.alreadyPaid) > 0 || next.length || Number(value.refundDue) > 0;
  if (!rows.length && !hasMoney) return null;
  return (
    <div className="my-1 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs">
      {rows.length > 0 && (
        <div className="mb-1 space-y-0.5">
          {rows.map((r) => <p key={r.k} className={r.cls}>{r.txt}</p>)}
        </div>
      )}
      {Number(value.alreadyPaid) > 0 && (
        <p className="text-gray-600">Previously paid {formatCurrency(value.alreadyPaid)}{prior.length ? ` · ${prior.map((p) => `${payLabel(p.method)} ${formatCurrency(p.amount)}`).join(', ')}` : ''}</p>
      )}
      {next.length > 0 && (
        <p className="text-gray-600">New payment {next.map((p) => `${payLabel(p.method)} ${formatCurrency(p.amount)}`).join(', ')}</p>
      )}
      {Number(value.refundDue) > 0 && (
        <p className="text-amber-600">Refunded {formatCurrency(value.refundDue)}</p>
      )}
    </div>
  );
}
const panelPath = (cashierPath, adminPath) =>
  typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
    ? cashierPath
    : adminPath;
