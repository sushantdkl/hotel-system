'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Plus, Edit, Trash2, Users, Grid, List, Eye, EyeOff, X, QrCode
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import TableQrModal from '@/components/tables/table-qr-modal';

export default function TableManagementPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [tables, setTables] = useState([]);
  const [filteredTables, setFilteredTables] = useState([]);
  const [floors, setFloors] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [qrTable, setQrTable] = useState(null);
  const closeQr = useCallback(() => setQrTable(null), []);
  const [formData, setFormData] = useState({
    table_number: '',
    table_type: 'regular',
    floor: 'Ground',
    section: '',
    capacity: 4,
    min_capacity: 1,
    shape: 'square',
    color: '#3b82f6',
    notes: ''
  });

  useEffect(() => {
    fetchMeta();
  }, []);

  useEffect(() => {
    fetchTables();
  }, [showInactive]);

  useEffect(() => {
    filterTables();
  }, [tables, filterFloor, filterType]);

  const fetchMeta = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [fRes, tRes] = await Promise.all([
        fetch('/api/admin/table-floors', { headers }),
        fetch('/api/admin/table-types', { headers }),
      ]);
      if (fRes.ok) {
        const data = await fRes.json();
        setFloors(data.floors || []);
      }
      if (tRes.ok) {
        const data = await tRes.json();
        setTypes(data.types || []);
      }
    } catch {
      /* ignore — fall back to hardcoded options */
    }
  };

  const fetchTables = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/tables?includeInactive=${showInactive}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setTables(data.tables);
      }
    } catch (error) {
      console.error('Error fetching tables:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTables = () => {
    let filtered = [...tables];

    if (filterFloor !== 'all') {
      filtered = filtered.filter(t => t.floor === filterFloor);
    }

    if (filterType !== 'all') {
      filtered = filtered.filter(t => t.table_type === filterType);
    }

    setFilteredTables(filtered);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('pos_token');
      const method = editingTable ? 'PATCH' : 'POST';

      const payload = editingTable
        ? { id: editingTable.id, ...formData }
        : formData;

      const response = await fetch('/api/admin/tables', {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        await fetchTables();
        resetForm();
        setShowDialog(false);
        addToast(friendlyMessage('save_success', { description: 'Table was saved.' }));
      } else {
        const data = await response.json();
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error saving table:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Deactivate table?',
      message: 'Are you sure you want to deactivate this table?',
      tone: 'delete',
    });
    if (!ok) return;

    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/tables?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        await fetchTables();
        addToast(friendlyMessage('delete_success', { description: 'Table was deactivated.' }));
      } else {
        const data = await response.json();
        addToast(friendlyFromError(data, 'delete_failed'));
      }
    } catch (error) {
      console.error('Error deleting table:', error);
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  const handleEdit = (table) => {
    setEditingTable(table);
    setFormData({
      table_number: table.table_number,
      table_type: table.table_type,
      floor: table.floor,
      section: table.section || '',
      capacity: table.capacity,
      min_capacity: table.min_capacity,
      shape: table.shape,
      color: table.color,
      notes: table.notes || ''
    });
    setShowDialog(true);
  };

  const resetForm = () => {
    setEditingTable(null);
    setFormData({
      table_number: '',
      table_type: 'regular',
      floor: 'Ground',
      section: '',
      capacity: 4,
      min_capacity: 1,
      shape: 'square',
      color: '#3b82f6',
      notes: ''
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      available: 'bg-green-100 text-green-800 border-green-300',
      occupied: 'bg-blue-100 text-blue-800 border-blue-300',
      reserved: 'bg-red-100 text-red-800 border-red-300',
      cleaning: 'bg-amber-100 text-amber-800 border-amber-300',
      maintenance: 'bg-gray-100 text-gray-800 border-gray-300'
    };
    return colors[status] || colors.available;
  };

  const getStatusLabel = (status) => status === 'occupied'
    ? 'Running'
    : String(status || '').replace(/_/g, ' ');

  const getTypeLabel = (type) => {
    const labels = {
      regular: 'Regular',
      vip: 'VIP',
      outdoor: 'Outdoor',
      event: 'Event',
      counter: 'Counter',
      booth: 'Booth'
    };
    return labels[type] || type;
  };

  const getTypeIcon = (type) => {
    if (type === 'vip') return '👑';
    if (type === 'outdoor') return '🌳';
    if (type === 'event') return '🎉';
    if (type === 'counter') return '🪑';
    if (type === 'booth') return '🛋️';
    return '🪑';
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Tables</h1>
            <p className="text-slate-700 mt-1">Add tables and manage the live floor layout</p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowDialog(true);
            }}
            className="flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold w-full sm:w-auto"
          >
            <Plus className="w-5 h-5" />
            <span>Add New Table</span>
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">Floor</label>
              <select
                value={filterFloor}
                onChange={(e) => setFilterFloor(e.target.value)}
                className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 bg-white"
              >
                <option value="all">All Floors</option>
                {(floors.length
                  ? floors.map((f) => f.name)
                  : ['Ground', 'First', 'Second', 'Rooftop', 'Basement', 'Outdoor']
                ).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">Table Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 bg-white"
              >
                <option value="all">All Types</option>
                {(types.length
                  ? types.map((t) => t.name)
                  : ['regular', 'vip', 'outdoor', 'event', 'counter', 'booth']
                ).map((name) => (
                  <option key={name} value={name} className="capitalize">{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">View Mode</label>
              <div className="flex space-x-2">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Grid className="w-5 h-5 mx-auto" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-colors ${
                    viewMode === 'list'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <List className="w-5 h-5 mx-auto" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">Options</label>
              <button
                onClick={() => setShowInactive(!showInactive)}
                className={`w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                  showInactive
                    ? 'bg-yellow-100 text-yellow-800 border-2 border-yellow-300'
                    : 'bg-gray-100 text-gray-700 border-2 border-gray-200'
                }`}
              >
                {showInactive ? <Eye className="w-5 h-5 mx-auto" /> : <EyeOff className="w-5 h-5 mx-auto" />}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border-2 border-blue-200">
            <p className="text-slate-700 text-sm font-medium">Total Tables</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{filteredTables.length}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-4 border-2 border-green-200">
            <p className="text-green-700 text-sm font-medium">Available</p>
            <p className="text-2xl font-bold text-green-900 mt-1">
              {filteredTables.filter(t => t.status === 'available').length}
            </p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 border-2 border-blue-200">
            <p className="text-blue-700 text-sm font-medium">Running</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">
              {filteredTables.filter(t => t.status === 'occupied').length}
            </p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 border-2 border-red-200">
            <p className="text-red-700 text-sm font-medium">Reserved</p>
            <p className="text-2xl font-bold text-red-900 mt-1">
              {filteredTables.filter(t => t.status === 'reserved').length}
            </p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 border-2 border-blue-200">
            <p className="text-blue-700 text-sm font-medium">Total Capacity</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">
              {filteredTables.reduce((sum, t) => sum + t.capacity, 0)}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <p className="text-slate-700">Loading tables...</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredTables.map((table) => (
              <div
                key={table.id}
                className={`bg-white rounded-xl p-6 shadow-sm border-2 ${
                  !table.is_active ? 'opacity-50 border-gray-300' : 'border-gray-200'
                } hover:shadow-md transition-all`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl">{getTypeIcon(table.table_type)}</span>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{table.table_number}</h3>
                      <p className="text-sm text-slate-700">{getTypeLabel(table.table_type)}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${getStatusColor(table.status)}`}>
                    {getStatusLabel(table.status)}
                  </span>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Floor:</span>
                    <span className="font-semibold text-slate-900">{table.floor}</span>
                  </div>
                  {table.section && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">Section:</span>
                      <span className="font-semibold text-slate-900">{table.section}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Capacity:</span>
                    <span className="font-semibold text-slate-900 flex items-center">
                      <Users className="w-4 h-4 mr-1" />
                      {table.min_capacity}-{table.capacity}
                    </span>
                  </div>
                </div>

                {!table.is_active && (
                  <div className="mb-4 px-3 py-2 bg-yellow-50 border-2 border-yellow-200 rounded-lg text-center">
                    <p className="text-xs font-semibold text-yellow-800">INACTIVE</p>
                  </div>
                )}

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setQrTable(table)}
                    className="flex-1 px-4 py-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors font-semibold text-sm"
                    title="View and print QR code"
                    aria-label={`QR code for table ${table.table_number}`}
                  >
                    <QrCode className="w-4 h-4 mx-auto" />
                  </button>
                  <button
                    onClick={() => handleEdit(table)}
                    className="flex-1 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-semibold text-sm"
                  >
                    <Edit className="w-4 h-4 mx-auto" />
                  </button>
                  <button
                    onClick={() => handleDelete(table.id)}
                    className="flex-1 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-semibold text-sm"
                    disabled={table.status === 'occupied'}
                  >
                    <Trash2 className="w-4 h-4 mx-auto" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Mobile list cards */}
            <div className="md:hidden space-y-3">
              {filteredTables.map((table) => (
                <div
                  key={table.id}
                  className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm ${
                    !table.is_active ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xl">{getTypeIcon(table.table_type)}</span>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 truncate">{table.table_number}</h3>
                        <p className="text-xs text-slate-500">{getTypeLabel(table.table_type)}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border-2 flex-shrink-0 ${getStatusColor(table.status)}`}>
                      {getStatusLabel(table.status)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div><span className="text-slate-500">Floor:</span> <span className="font-semibold text-slate-900">{table.floor}{table.section ? ` / ${table.section}` : ''}</span></div>
                    <div><span className="text-slate-500">Capacity:</span> <span className="font-semibold text-slate-900">{table.min_capacity}-{table.capacity}</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setQrTable(table)} className="flex-1 py-2 text-violet-700 bg-violet-50 rounded-lg text-sm font-semibold">QR</button>
                    <button onClick={() => handleEdit(table)} className="flex-1 py-2 text-blue-600 bg-blue-50 rounded-lg text-sm font-semibold">Edit</button>
                    <button
                      onClick={() => handleDelete(table.id)}
                      className="flex-1 py-2 text-red-600 bg-red-50 rounded-lg text-sm font-semibold"
                      disabled={table.status === 'occupied'}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop list table */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-blue-50 border-b-2 border-blue-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-800 uppercase">Table</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-800 uppercase">Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-800 uppercase">Floor/Section</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-800 uppercase">Capacity</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-800 uppercase">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-800 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredTables.map((table) => (
                  <tr key={table.id} className={!table.is_active ? 'opacity-50 bg-gray-50' : 'hover:bg-gray-50'}>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <span className="text-xl">{getTypeIcon(table.table_type)}</span>
                        <span className="font-bold text-slate-900">{table.table_number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-800">{getTypeLabel(table.table_type)}</td>
                    <td className="px-6 py-4 text-sm text-slate-800">
                      {table.floor}{table.section ? ` / ${table.section}` : ''}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-800">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 mr-1 text-slate-600" />
                        {table.min_capacity}-{table.capacity}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${getStatusColor(table.status)}`}>
                        {getStatusLabel(table.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setQrTable(table)}
                          className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors"
                          title="View and print QR code"
                          aria-label={`QR code for table ${table.table_number}`}
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(table)}
                          className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(table.id)}
                          className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                          disabled={table.status === 'occupied'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </div>
          </>
        )}
      </div>

      {qrTable && <TableQrModal key={qrTable.id} table={qrTable} onClose={closeQr} />}

      {showDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-blue-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">
                {editingTable ? 'Edit Table' : 'Add New Table'}
              </h2>
              <button
                onClick={() => {
                  setShowDialog(false);
                  resetForm();
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Table Number *
                  </label>
                  <input
                    type="text"
                    value={formData.table_number}
                    onChange={(e) => setFormData({ ...formData, table_number: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Table Type *
                  </label>
                  <select
                    value={formData.table_type}
                    onChange={(e) => setFormData({ ...formData, table_type: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 bg-white"
                  >
                    {(types.length
                      ? types.map((t) => t.name)
                      : ['regular', 'vip', 'outdoor', 'event', 'counter', 'booth']
                    ).map((name) => (
                      <option key={name} value={name} className="capitalize">{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Floor *
                  </label>
                  <select
                    value={formData.floor}
                    onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 bg-white"
                  >
                    {(floors.length
                      ? floors.map((f) => f.name)
                      : ['Ground', 'First', 'Second', 'Rooftop', 'Basement', 'Outdoor']
                    ).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Room / Section
                  </label>
                  <input
                    type="text"
                    value={formData.section}
                    onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                    placeholder="e.g. Ground Floor, Cabin, Terrace"
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 placeholder-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Min Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formData.min_capacity || 1}
                    onChange={(e) => setFormData({ ...formData, min_capacity: parseInt(e.target.value) || 1 })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Max Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formData.capacity || 4}
                    onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 4 })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Shape
                  </label>
                  <select
                    value={formData.shape}
                    onChange={(e) => setFormData({ ...formData, shape: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 bg-white"
                  >
                    <option value="square">Square</option>
                    <option value="round">Round</option>
                    <option value="rectangular">Rectangular</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Color
                  </label>
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full h-[42px] border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes about this table..."
                  rows="3"
                  className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-900 placeholder-slate-400"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowDialog(false);
                    resetForm();
                  }}
                  className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  {editingTable ? 'Update Table' : 'Create Table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
