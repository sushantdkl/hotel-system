'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, Plus, Edit, Trash2, Phone, Mail, Eye, Users, Crown, ShieldAlert, Wallet, ShoppingBag, MessageCircle } from 'lucide-react';
import WhatsappBulkModal from '@/components/customers/whatsapp-bulk-modal';
import { DEFAULT_CUSTOMER_MESSAGE, fillTemplate, openWhatsapp, whatsappNumber } from '@/lib/whatsapp.js';
import { formatCurrency } from '@/lib/currency';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import FieldError, { inputErrorClass } from '@/components/ui/field-error';
import { useCapabilities } from '@/lib/use-capabilities.js';
import {
  digitsOnly,
  numbersOnlyInput,
  validateName,
  validatePhone,
  validateEmail,
  validatePositiveNumber,
  firstError,
} from '@/lib/form-validation';

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  credit_limit: '',
  is_vip: false,
  is_blacklisted: false,
  notes: '',
};

const panelCustomerPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/customers'
  : '/admin/customers';

export default function AdminCustomers() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  // Was gated on the URL, which let a cashier who opened /admin/customers
  // directly see a button the route rejects. Now gated on the permission the
  // route actually checks, so the two can never disagree.
  const { can } = useCapabilities();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [quickFilter, setQuickFilter] = useState('all'); // all | vip | credit | blacklisted
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [waSettings, setWaSettings] = useState({ restaurant: '', template: DEFAULT_CUSTOMER_MESSAGE });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    fetchCustomers();
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const s = (await res.json()).settings || {};
        setWaSettings({
          restaurant: s.restaurant_name || '',
          template: s.whatsapp_customer_message || DEFAULT_CUSTOMER_MESSAGE,
        });
      } catch { /* defaults */ }
    })();
  }, []);

  const toggleSelected = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const sendWhatsapp = (customer) => {
    const text = fillTemplate(waSettings.template, { name: customer.name, restaurant: waSettings.restaurant, phone: customer.phone });
    if (!openWhatsapp(customer.phone, text)) addToast({ title: 'Could not open WhatsApp', description: 'Check the phone number and allow pop-ups.' });
  };

  const fetchCustomers = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/customers', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(friendlyFromError(data, 'load_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (data = formData) => {
    const next = {
      name: validateName(data.name, 'customer name'),
      phone: validatePhone(data.phone, { required: true }),
      email: validateEmail(data.email, { required: false }),
      credit_limit: validatePositiveNumber(data.credit_limit === '' ? 0 : data.credit_limit, 'credit limit', {
        allowZero: true,
        required: false,
      }),
    };
    setErrors(next);
    return next;
  };

  const setField = (field, value) => {
    const next = { ...formData, [field]: value };
    setFormData(next);
    if (touched[field] || errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]:
          field === 'name'
            ? validateName(value, 'customer name')
            : field === 'phone'
              ? validatePhone(value, { required: true })
              : field === 'email'
                ? validateEmail(value, { required: false })
                : field === 'credit_limit'
                  ? validatePositiveNumber(value === '' ? 0 : value, 'credit limit', {
                      allowZero: true,
                      required: false,
                    })
                  : null,
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true, credit_limit: true });
    const nextErrors = validateForm();
    const msg = firstError(nextErrors);
    if (msg) {
      addToast(friendlyMessage('validation', { description: msg }));
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem('pos_token');
      const body = editingCustomer
        ? {
            id: editingCustomer.id,
            name: formData.name.trim(),
            phone: digitsOnly(formData.phone),
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
            credit_limit: Number(formData.credit_limit) || 0,
            is_vip: !!formData.is_vip,
            is_blacklisted: !!formData.is_blacklisted,
            notes: formData.notes?.trim() || null,
          }
        : {
            name: formData.name.trim(),
            phone: digitsOnly(formData.phone),
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
            credit_limit: Number(formData.credit_limit) || 0,
            is_vip: !!formData.is_vip,
            is_blacklisted: !!formData.is_blacklisted,
            notes: formData.notes?.trim() || null,
          };

      const response = await fetch('/api/admin/customers', {
        method: editingCustomer ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        addToast(
          friendlyMessage('save_success', {
            description: editingCustomer ? 'Customer details were updated.' : 'Customer was added.',
          })
        );
        fetchCustomers();
        closeModal();
      } else {
        if (data.fields) setErrors((prev) => ({ ...prev, ...data.fields }));
        if (data.code === 'duplicate_phone') {
          setErrors((prev) => ({
            ...prev,
            phone: 'This phone number is already used by another customer.',
          }));
        }
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCustomer(null);
    setFormData(emptyForm);
    setErrors({});
    setTouched({});
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      credit_limit: customer.credit_limit ?? '',
      is_vip: !!customer.is_vip,
      is_blacklisted: !!customer.is_blacklisted,
      notes: customer.notes || '',
    });
    setErrors({});
    setTouched({});
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Remove customer?',
      message: 'Remove this customer from your list?',
      tone: 'delete',
    });
    if (!ok) return;

    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/customers?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        addToast(friendlyMessage('delete_success', { description: 'Customer was removed.' }));
        fetchCustomers();
      } else {
        addToast(friendlyFromError(data, 'delete_failed'));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  const searchedCustomers = customers.filter(
    (customer) =>
      customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.includes(searchTerm) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredCustomers = searchedCustomers.filter((c) => {
    if (quickFilter === 'vip') return !!c.is_vip;
    if (quickFilter === 'credit') return Number(c.current_credit || 0) > 0.009;
    if (quickFilter === 'blacklisted') return !!c.is_blacklisted;
    return true;
  });

  const selectedCustomers = customers.filter((c) => selectedIds.has(c.id));
  const allFilteredSelected = filteredCustomers.length > 0 && filteredCustomers.every((c) => selectedIds.has(c.id));

  const summary = {
    total: customers.length,
    vip: customers.filter((c) => c.is_vip).length,
    withCredit: customers.filter((c) => Number(c.current_credit || 0) > 0.009).length,
    outstanding: customers.reduce((s, c) => s + Number(c.current_credit || 0), 0),
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Customers</h1>
            <p className="text-gray-700 mt-1 text-sm sm:text-base">Manage customer information</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setFormData(emptyForm);
              setErrors({});
              setTouched({});
              setShowModal(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto"
          >
            <Plus className="w-5 h-5" />
            Add Customer
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            { label: 'Total Customers', value: summary.total.toLocaleString(), icon: Users, tone: 'text-gray-900' },
            { label: 'VIP', value: summary.vip.toLocaleString(), icon: Crown, tone: 'text-amber-600' },
            { label: 'With Credit Due', value: summary.withCredit.toLocaleString(), icon: Wallet, tone: 'text-rose-600' },
            { label: 'Total Outstanding', value: formatCurrency(summary.outstanding), icon: Wallet, tone: 'text-rose-600' },
          ].map((t) => (
            <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 sm:text-sm">
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </div>
              <h3 className={`mt-2 truncate text-lg font-bold tabular-nums sm:text-xl ${t.tone}`}>{t.value}</h3>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-700 w-5 h-5" />
            <input
              type="text"
              placeholder="Search customers by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-700 text-gray-900"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: `All (${summary.total})` },
              { id: 'vip', label: `VIP (${summary.vip})` },
              { id: 'credit', label: `Has credit due (${summary.withCredit})` },
              { id: 'blacklisted', label: `Blacklisted (${customers.filter((c) => c.is_blacklisted).length})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setQuickFilter(f.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  quickFilter === f.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredCustomers.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (allFilteredSelected) filteredCustomers.forEach((c) => next.delete(c.id));
                  else filteredCustomers.forEach((c) => next.add(c.id));
                  return next;
                })}
                className="h-4 w-4 accent-green-600"
              />
              Select all shown
            </label>
            <span className="text-sm text-gray-600">{selectedCustomers.length} selected</span>
            {selectedCustomers.length > 0 && (
              <>
                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm font-medium text-gray-600 hover:text-gray-900">Clear</button>
                <button type="button" onClick={() => setShowBulk(true)} className="ml-auto flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
                  <MessageCircle className="h-4 w-4" /> WhatsApp to selected
                </button>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full text-center py-12 text-gray-800">Loading customers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-800">No customers found</div>
          ) : (
            filteredCustomers.map((customer) => {
              const credit = Number(customer.current_credit || customer.credit_balance || 0);
              return (
              <div
                key={customer.id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(customer.id)}
                    onChange={() => toggleSelected(customer.id)}
                    aria-label={`Select ${customer.name}`}
                    className="mr-3 mt-1.5 h-4 w-4 shrink-0 accent-green-600"
                  />
                  <button type="button" onClick={() => router.push(`${panelCustomerPath()}/${customer.id}`)} className="mr-auto text-left">
                    <h3 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900 hover:text-blue-700">
                      {customer.name}
                      {customer.is_vip ? <Crown className="h-4 w-4 text-amber-500" /> : null}
                      {customer.is_blacklisted ? <ShieldAlert className="h-4 w-4 text-red-500" /> : null}
                    </h3>
                    <p className="text-sm text-gray-700">ID: {customer.id}</p>
                  </button>
                  <div className="flex gap-2">
                    {whatsappNumber(customer.phone) && (
                      <button
                        type="button"
                        onClick={() => sendWhatsapp(customer)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Send WhatsApp message"
                        aria-label={`WhatsApp ${customer.name}`}
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`${panelCustomerPath()}/${customer.id}`)}
                      className="p-2 text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                      title="View profile"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(customer)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {can('customers.delete') && (
                      <button
                        type="button"
                        onClick={() => handleDelete(customer.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-800">
                      <Phone className="w-4 h-4" />
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-800">
                      <Mail className="w-4 h-4" />
                      <span>{customer.email}</span>
                    </div>
                  )}
                  {customer.address && <p className="text-sm text-gray-800 mt-2">{customer.address}</p>}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-4">
                  <div className="rounded-xl bg-gray-50 px-2.5 py-2 text-center">
                    <p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-gray-400"><ShoppingBag className="h-3 w-3" /> Visits</p>
                    <p className="mt-0.5 text-sm font-bold text-gray-900">{Number(customer.total_visits || 0)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-2.5 py-2 text-center">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Lifetime</p>
                    <p className="mt-0.5 truncate text-sm font-bold text-gray-900">{formatCurrency(customer.total_spent || 0)}</p>
                  </div>
                  <div className={`rounded-xl px-2.5 py-2 text-center ${credit > 0.009 ? 'bg-rose-50' : 'bg-gray-50'}`}>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Credit due</p>
                    <p className={`mt-0.5 truncate text-sm font-bold ${credit > 0.009 ? 'text-rose-700' : 'text-gray-900'}`}>{formatCurrency(credit)}</p>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>

      <WhatsappBulkModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        recipients={selectedCustomers}
        template={waSettings.template}
        restaurant={waSettings.restaurant}
        title="WhatsApp to selected customers"
      />

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[94dvh] overflow-y-auto p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Customer full name"
                  className={inputErrorClass(
                    !!errors.name,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.name} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Phone number *</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formData.phone}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  onChange={(e) => setField('phone', digitsOnly(e.target.value))}
                  placeholder="98XXXXXXXX"
                  className={inputErrorClass(
                    !!errors.phone,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.phone} />
                <p className="mt-1 text-xs text-gray-500">Required — digits only, at least 10 numbers.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="name@email.com (optional)"
                  className={inputErrorClass(
                    !!errors.email,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.email} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setField('address', e.target.value)}
                  rows={3}
                  placeholder="Area / street (optional)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Credit Limit</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.credit_limit}
                  onBlur={() => setTouched((t) => ({ ...t, credit_limit: true }))}
                  onChange={(e) => setField('credit_limit', numbersOnlyInput(e.target.value, { allowDecimal: true }))}
                  placeholder="0"
                  className={inputErrorClass(
                    !!errors.credit_limit,
                    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900'
                  )}
                />
                <FieldError message={errors.credit_limit} />
                <div className="flex flex-wrap gap-4 text-sm pt-1">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!formData.is_vip}
                      onChange={(e) => setFormData((f) => ({ ...f, is_vip: e.target.checked }))}
                    />
                    VIP
                  </label>
                  <label className="inline-flex items-center gap-2 text-red-700">
                    <input
                      type="checkbox"
                      checked={!!formData.is_blacklisted}
                      onChange={(e) => setFormData((f) => ({ ...f, is_blacklisted: e.target.checked }))}
                    />
                    Blacklisted
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingCustomer ? 'Update Customer' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
