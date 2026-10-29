'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Plus, Edit, Trash2, Key, Search, Users, UserX, UserCheck, Shield, Wallet,
} from 'lucide-react';
import PayrollDrawer from '@/components/employees/payroll-drawer';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import FieldError, { inputErrorClass } from '@/components/ui/field-error';
import DateInput from '@/components/ui/date-input.jsx';
import {
  digitsOnly,
  validateName,
  validatePhone,
  validateEmail,
  validatePin,
  firstError,
} from '@/lib/form-validation';

export default function EmployeesPage() {
  const { addToast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [changingPinFor, setChangingPinFor] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    role: 'waiter',
    pin: '',
    email: '',
    phone: '',
    is_active: true,
    salary: '',
    position: '',
    hire_date: '',
    department_id: '',
    designation_id: '',
  });
  const [payrollFor, setPayrollFor] = useState(null);

  const [pinData, setPinData] = useState({
    new_pin: '',
    confirm_pin: '',
  });
  const [pinErrors, setPinErrors] = useState({});

  useEffect(() => {
    fetchEmployees();
    apiJson('/api/admin/hrm/departments').then((d) => setDepartments(d.departments || [])).catch(() => {});
    apiJson('/api/admin/hrm/designations').then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, []);

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/employees', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
        setCustomRoles(data.custom_roles || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextErrors = {
      full_name: validateName(formData.full_name, 'full name'),
      username: !String(formData.username || '').trim()
        ? 'Please enter a username.'
        : null,
      pin: editingEmployee ? null : validatePin(formData.pin),
      phone: validatePhone(formData.phone, { required: false }),
      email: validateEmail(formData.email, { required: false }),
    };
    setFormErrors(nextErrors);
    const msg = firstError(nextErrors);
    if (msg) {
      addToast(friendlyMessage('validation', { description: msg }));
      return;
    }

    try {
      const token = localStorage.getItem('pos_token');
      const url = editingEmployee
        ? `/api/admin/employees/${editingEmployee.id}`
        : '/api/admin/employees';

      const response = await fetch(url, {
        method: editingEmployee ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          phone: digitsOnly(formData.phone) || null,
          pin: digitsOnly(formData.pin),
        }),
      });

      if (response.ok) {
        fetchEmployees();
        setShowForm(false);
        setEditingEmployee(null);
        setFormErrors({});
        setFormData({
          username: '',
          full_name: '',
          role: 'waiter',
          pin: '',
          email: '',
          phone: '',
          is_active: true,
          salary: '',
          position: '',
          hire_date: '',
          department_id: '',
          designation_id: '',
        });
        addToast(friendlyMessage('save_success', {
          description: editingEmployee ? 'Employee details were updated.' : 'New employee was added.',
        }));
      } else {
        const data = await response.json();
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const handlePinChange = async (e) => {
    e.preventDefault();

    const nextPinErrors = {
      new_pin: validatePin(pinData.new_pin),
      confirm_pin:
        pinData.new_pin !== pinData.confirm_pin
          ? 'Both PIN fields must match.'
          : validatePin(pinData.confirm_pin),
    };
    setPinErrors(nextPinErrors);
    if (firstError(nextPinErrors)) {
      addToast(friendlyMessage('validation', {
        description: firstError(nextPinErrors),
      }));
      return;
    }

    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/employees/${changingPinFor.id}/pin`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin: pinData.new_pin }),
      });

      if (response.ok) {
        addToast(friendlyMessage('save_success', { description: 'PIN was updated.' }));
        setShowPinModal(false);
        setChangingPinFor(null);
        setPinData({ new_pin: '', confirm_pin: '' });
      } else {
        const data = await response.json();
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setFormData({
      username: employee.username,
      full_name: employee.full_name,
      role: employee.custom_role ? `custom:${employee.custom_role}` : employee.role,
      pin: '',
      email: employee.email || '',
      phone: employee.phone || '',
      is_active: !!employee.is_active,
      salary: employee.salary ?? '',
      position: employee.position || '',
      hire_date: employee.hire_date ? String(employee.hire_date).slice(0, 10) : '',
      department_id: employee.department_id ?? '',
      designation_id: employee.designation_id ?? '',
    });
    setShowForm(true);
  };

  const askDelete = (employee) => {
    if (employee.is_primary_admin) {
      addToast(friendlyMessage('validation', {
        description: 'The main admin account is protected and cannot be deleted.',
      }));
      return;
    }
    setConfirmAction({
      type: 'delete',
      employee,
      title: 'Delete employee?',
      description: `Are you sure you want to permanently delete ${employee.full_name} (@${employee.username})? This cannot be undone. Their login access will be removed immediately.`,
      confirmLabel: 'Yes, delete permanently',
      tone: 'danger',
    });
  };

  const askToggleActive = (employee) => {
    if (employee.is_primary_admin && employee.is_active) {
      addToast(friendlyMessage('validation', {
        description: 'The main admin account cannot be deactivated.',
      }));
      return;
    }
    const deactivating = !!employee.is_active;
    setConfirmAction({
      type: deactivating ? 'deactivate' : 'activate',
      employee,
      title: deactivating ? 'Deactivate employee?' : 'Activate employee?',
      description: deactivating
        ? `Deactivate ${employee.full_name}? They will not be able to log in until you activate them again. Their account stays in the list.`
        : `Activate ${employee.full_name}? They will be able to log in again with their PIN.`,
      confirmLabel: deactivating ? 'Yes, deactivate' : 'Yes, activate',
      tone: deactivating ? 'warning' : 'success',
    });
  };

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    const { type, employee } = confirmAction;
    try {
      const token = localStorage.getItem('pos_token');

      if (type === 'delete') {
        const response = await fetch(`/api/admin/employees/${employee.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          fetchEmployees();
          addToast(friendlyMessage('delete_success', {
            description: `${employee.full_name} was permanently removed.`,
          }));
          setConfirmAction(null);
        } else {
          addToast(friendlyFromError(data, 'delete_failed'));
        }
      } else {
        const response = await fetch(`/api/admin/employees/${employee.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: type }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          fetchEmployees();
          addToast(friendlyMessage('save_success', {
            description: type === 'activate'
              ? `${employee.full_name} is now active.`
              : `${employee.full_name} was deactivated.`,
          }));
          setConfirmAction(null);
        } else {
          addToast(friendlyFromError(data, 'save_failed'));
        }
      }
    } catch (error) {
      addToast(friendlyFromError(error, type === 'delete' ? 'delete_failed' : 'save_failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const filteredEmployees = employees.filter((e) =>
    e.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const roleColors = {
    admin: 'bg-purple-100 text-purple-800',
    cashier: 'bg-blue-100 text-blue-800',
    waiter: 'bg-green-100 text-green-800',
    kitchen: 'bg-orange-100 text-orange-800',
    manager: 'bg-indigo-100 text-indigo-800',
    receptionist: 'bg-teal-100 text-teal-800',
    housekeeping: 'bg-amber-100 text-amber-800',
    maintenance: 'bg-slate-200 text-slate-800',
    watchman: 'bg-stone-200 text-stone-800',
  };

  const ActionButtons = ({ employee }) => (
    <>
      <button
        type="button"
        onClick={() => {
          setChangingPinFor(employee);
          setShowPinModal(true);
        }}
        className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
        title="Change PIN"
      >
        <Key className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => setPayrollFor(employee)}
        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg"
        title="Payroll & payment history"
      >
        <Wallet className="w-4 h-4" />
      </button>
      {!['admin', 'manager'].includes(employee.role) && (
        <a
          href={`/admin/permissions?user=${employee.id}`}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          title="Permissions for this person"
          aria-label={`Permissions for ${employee.full_name || employee.username}`}
        >
          <Shield className="w-4 h-4" />
        </a>
      )}
      <button
        type="button"
        onClick={() => handleEdit(employee)}
        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
        title="Edit"
      >
        <Edit className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => askToggleActive(employee)}
        disabled={employee.is_primary_admin && employee.is_active}
        className={`p-2 rounded-lg ${
          employee.is_active
            ? 'text-amber-600 hover:bg-amber-50'
            : 'text-emerald-600 hover:bg-emerald-50'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title={
          employee.is_primary_admin && employee.is_active
            ? 'Main admin cannot be deactivated'
            : employee.is_active
              ? 'Deactivate'
              : 'Activate'
        }
      >
        {employee.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
      </button>
      {employee.is_primary_admin ? (
        <span
          className="p-2 text-purple-600"
          title="Main admin is protected"
        >
          <Shield className="w-4 h-4" />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => askDelete(employee)}
          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
          title="Delete permanently"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </>
  );

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Employee Management</h1>
              <p className="text-gray-700 mt-1">Manage staff members and access</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowForm(true);
                setEditingEmployee(null);
                setFormData({
                  username: '',
                  full_name: '',
                  role: 'waiter',
                  pin: '',
                  email: '',
                  phone: '',
                  is_active: true,
                  salary: '',
                  position: '',
                  hire_date: '',
                  department_id: '',
                  designation_id: '',
                });
              }}
              className="flex items-center space-x-2 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              <Plus className="w-5 h-5" />
              <span>Add Employee</span>
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 text-gray-700 w-5 h-5" />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent text-gray-900"
              />
            </div>
          </div>

          {showForm && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-800">
                    {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                  </h2>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Username *</label>
                      <input
                        type="text"
                        autoComplete="off"
                        required
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                        disabled={!!editingEmployee}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={formData.full_name}
                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Role *</label>
                      <select
                        required
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                        disabled={editingEmployee?.is_primary_admin}
                      >
                        <optgroup label="Restaurant">
                          <option value="waiter">Waiter</option>
                          <option value="cashier">Cashier</option>
                          <option value="kitchen">Kitchen</option>
                        </optgroup>
                        <optgroup label="Hotel">
                          <option value="receptionist">Receptionist</option>
                          <option value="housekeeping">Housekeeping</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="watchman">Watchman / Security</option>
                        </optgroup>
                        {customRoles.length > 0 && <optgroup label="Custom roles">
                          {customRoles.map((r) => <option key={r.key} value={`custom:${r.key}`}>{r.label}</option>)}
                        </optgroup>}
                        <optgroup label="Management (owner only)">
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </optgroup>
                      </select>
                      {editingEmployee?.is_primary_admin && (
                        <p className="text-xs text-purple-700 mt-1">Main admin role is locked.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        {editingEmployee ? 'PIN (leave empty to keep current)' : 'PIN (4 digits) *'}
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        required={!editingEmployee}
                        maxLength={4}
                        pattern="[0-9]{4}"
                        value={formData.pin}
                        onChange={(e) => setFormData({ ...formData, pin: digitsOnly(e.target.value).slice(0, 4) })}
                        className={inputErrorClass(!!formErrors.pin, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                        placeholder="4 digit PIN"
                      />
                      <FieldError message={formErrors.pin} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className={inputErrorClass(!!formErrors.email, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                      />
                      <FieldError message={formErrors.email} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Phone</label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: digitsOnly(e.target.value) })}
                        className={inputErrorClass(!!formErrors.phone, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                        placeholder="98XXXXXXXX"
                      />
                      <FieldError message={formErrors.phone} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="mb-3 text-sm font-semibold text-gray-900">Employment &amp; payroll</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Job title</label>
                        <input
                          type="text"
                          value={formData.position}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                          placeholder="e.g. Head Waiter"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Monthly salary (Rs)</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={formData.salary}
                          onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Hire date</label>
                        <DateInput
                          value={formData.hire_date}
                          onChange={(hire_date) => setFormData({ ...formData, hire_date })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Department</label>
                        <select
                          value={formData.department_id}
                          onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                        >
                          <option value="">— None —</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Designation</label>
                        <select
                          value={formData.designation_id}
                          onChange={(e) => setFormData({ ...formData, designation_id: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                        >
                          <option value="">— None —</option>
                          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}{d.department_name ? ` (${d.department_name})` : ''}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={`flex items-center space-x-2 ${editingEmployee?.is_primary_admin ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        disabled={editingEmployee?.is_primary_admin}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-400"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>

                  <div className="flex space-x-4 pt-4">
                    <button
                      type="submit"
                      className="flex-1 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                    >
                      {editingEmployee ? 'Update' : 'Create'} Employee
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingEmployee(null);
                      }}
                      className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {showPinModal && changingPinFor && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg max-w-md w-full">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-800">
                    Change PIN for {changingPinFor.full_name}
                  </h2>
                </div>

                <form onSubmit={handlePinChange} className="p-6 space-y-4" noValidate>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">New PIN (4 digits) *</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinData.new_pin}
                      onChange={(e) => setPinData({ ...pinData, new_pin: digitsOnly(e.target.value).slice(0, 4) })}
                      className={inputErrorClass(!!pinErrors.new_pin, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                      placeholder="Enter new PIN"
                    />
                    <FieldError message={pinErrors.new_pin} />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Confirm PIN *</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinData.confirm_pin}
                      onChange={(e) => setPinData({ ...pinData, confirm_pin: digitsOnly(e.target.value).slice(0, 4) })}
                      className={inputErrorClass(!!pinErrors.confirm_pin, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                      placeholder="Confirm new PIN"
                    />
                    <FieldError message={pinErrors.confirm_pin} />
                  </div>

                  <div className="flex space-x-4 pt-4">
                    <button
                      type="submit"
                      className="flex-1 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                    >
                      Change PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPinModal(false);
                        setChangingPinFor(null);
                        setPinData({ new_pin: '', confirm_pin: '' });
                      }}
                      className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {confirmAction && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
              <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                <div className={`px-6 py-4 ${
                  confirmAction.tone === 'danger'
                    ? 'bg-red-50 border-b border-red-100'
                    : confirmAction.tone === 'warning'
                      ? 'bg-amber-50 border-b border-amber-100'
                      : 'bg-emerald-50 border-b border-emerald-100'
                }`}>
                  <h2 className="text-xl font-bold text-gray-900">{confirmAction.title}</h2>
                </div>
                <div className="px-6 py-5">
                  <p className="text-gray-700 leading-relaxed">{confirmAction.description}</p>
                </div>
                <div className="px-6 pb-6 flex flex-col-reverse sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 px-4 py-3 rounded-xl bg-gray-100 text-gray-800 font-semibold hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={runConfirmAction}
                    className={`flex-1 px-4 py-3 rounded-xl text-white font-semibold disabled:opacity-50 ${
                      confirmAction.tone === 'danger'
                        ? 'bg-red-600 hover:bg-red-700'
                        : confirmAction.tone === 'warning'
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {actionLoading ? 'Please wait…' : confirmAction.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="md:hidden space-y-3">
            {loading ? (
              <div className="bg-white rounded-xl p-10 text-center text-gray-500">Loading…</div>
            ) : filteredEmployees.length > 0 ? (
              filteredEmployees.map((employee) => (
                <div key={employee.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 truncate flex items-center gap-1.5">
                        {employee.full_name}
                        {employee.is_primary_admin && (
                          <Shield className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" title="Main admin" />
                        )}
                      </h3>
                      <p className="text-xs text-gray-500">@{employee.username}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 ${
                      employee.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {employee.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[employee.role]}`}>
                      {customRoles.find((r) => r.key === employee.custom_role)?.label || employee.role.charAt(0).toUpperCase() + employee.role.slice(1)}
                    </span>
                    {employee.is_primary_admin && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Main admin
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setChangingPinFor(employee);
                        setShowPinModal(true);
                      }}
                      className="py-2 text-green-600 bg-green-50 rounded-lg text-sm font-semibold"
                    >
                      PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(employee)}
                      className="py-2 text-blue-600 bg-blue-50 rounded-lg text-sm font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => askToggleActive(employee)}
                      disabled={employee.is_primary_admin && employee.is_active}
                      className={`py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${
                        employee.is_active
                          ? 'text-amber-700 bg-amber-50'
                          : 'text-emerald-700 bg-emerald-50'
                      }`}
                    >
                      {employee.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    {employee.is_primary_admin ? (
                      <div className="py-2 text-center text-purple-700 bg-purple-50 rounded-lg text-sm font-semibold">
                        Protected
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => askDelete(employee)}
                        className="py-2 text-red-600 bg-red-50 rounded-lg text-sm font-semibold"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-xl p-10 text-center text-gray-500">No employees found</div>
            )}
          </div>

          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Employee</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Username</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Role</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Contact</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          {employee.full_name}
                          {employee.is_primary_admin && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                              <Shield className="w-3 h-3" />
                              Main
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{employee.username}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${roleColors[employee.role]}`}>
                          {customRoles.find((r) => r.key === employee.custom_role)?.label || employee.role.charAt(0).toUpperCase() + employee.role.slice(1)}
                        </span>
                        {(employee.designation_name || employee.department_name) && (
                          <p className="mt-1 text-xs text-gray-500">
                            {[employee.designation_name, employee.department_name].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {employee.email && <div>{employee.email}</div>}
                        {employee.phone && <div>{employee.phone}</div>}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          employee.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {employee.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end space-x-1">
                          <ActionButtons employee={employee} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredEmployees.length === 0 && !loading && (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-800">No employees found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {payrollFor && <PayrollDrawer employee={payrollFor} onClose={() => setPayrollFor(null)} />}
    </AdminLayout>
  );
}
