'use client';

import { useState, useEffect, useMemo } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import MenuItemImage from '@/components/menu-item-image';
import { Plus, Edit, Trash2, Search, Package, Upload, Clock3, Link2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import FieldError, { inputErrorClass } from '@/components/ui/field-error';
import { numbersOnlyInput, validateName, validatePositiveNumber, firstError } from '@/lib/form-validation';
import UnitSelect from '@/components/ui/unit-select';
import Combobox from '@/components/ui/combobox';

const emptyVariant = () => ({ variant_name: '', price: '', stock_quantity: '', stock_unit: '', inventory_item_id: '', pos_stock_visible: false });

const emptyForm = {
  name: '',
  category_id: '',
  price: '',
  cost: '',
  description: '',
  image_url: '',
  is_available: true,
  is_vegetarian: false,
  preparation_time: 15,
  inventory_item_id: '',
  pos_stock_visible: false,
  stock_usage: '1',
  unit: '',
  has_variants: false,
  variants: [],
};

function stockVisibilityState(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    const linked = variants.filter((variant) => variant.inventory_item_id);
    return {
      linked: linked.length > 0,
      visible: linked.length > 0 && linked.every((variant) => !!variant.pos_stock_visible),
      variantCount: linked.length,
    };
  }
  return { linked: !!product.inventory_item_id, visible: !!product.pos_stock_visible, variantCount: 0 };
}

export default function ProductsPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [availabilityTab, setAvailabilityTab] = useState('active');
  const [uploading, setUploading] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [quickSaving, setQuickSaving] = useState({});
  
  const [formData, setFormData] = useState({ ...emptyForm });

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchInventoryItems();
  }, []);

  const fetchProducts = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/products', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setProducts((data.products || []).filter((product) => !Number(product.is_combo)));
      }
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
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
        setCategories(data.categories);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const cleanVariants = formData.variants.filter((v) => v.variant_name.trim() && v.price !== '');

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextErrors = {
      name: validateName(formData.name, 'item name'),
      category_id: !formData.category_id ? 'Please choose a category.' : null,
      price: formData.has_variants
        ? (cleanVariants.length ? null : 'Add at least one variation with a name and price.')
        : validatePositiveNumber(formData.price, 'price', { allowZero: false }),
      cost: formData.cost === '' || formData.cost == null
        ? null
        : validatePositiveNumber(formData.cost, 'cost', { allowZero: true }),
    };
    setFormErrors(nextErrors);
    const msg = firstError(nextErrors);
    if (msg) {
      addToast(friendlyMessage('validation', { description: msg }));
      return;
    }

    try {
      const token = localStorage.getItem('pos_token');
      const url = editingProduct
        ? `/api/admin/products/${editingProduct.id}`
        : '/api/admin/products';

      const response = await fetch(url, {
        method: editingProduct ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          price: formData.has_variants ? undefined : Number(formData.price),
          cost: formData.cost === '' ? null : Number(formData.cost),
          variants: formData.has_variants ? cleanVariants : [],
        })
      });

      if (response.ok) {
        fetchProducts();
        setShowForm(false);
        setEditingProduct(null);
        setFormData({ ...emptyForm });
        setFormErrors({});
        addToast(friendlyMessage('save_success', {
          description: editingProduct ? 'Menu item was updated.' : 'Menu item was added.',
        }));
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const token = localStorage.getItem('pos_token');
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/uploads/menu', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (response.ok) {
        const data = await response.json();
        setFormData((prev) => ({ ...prev, image_url: data.url || data.image_url }));
        addToast(friendlyMessage('save_success', { description: 'Image uploaded.' }));
      } else {
        const err = await response.json().catch(() => ({}));
        addToast(friendlyFromError(err, 'upload_failed'));
      }
    } catch (error) {
      console.error('Upload error:', error);
      addToast(friendlyFromError(error, 'upload_failed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    const variants = (product.variants || []).map((v) => ({
      variant_name: v.variant_name || '',
      price: v.price ?? '',
      stock_quantity: v.stock_quantity ?? '',
      stock_unit: v.stock_unit || '',
      inventory_item_id: v.inventory_item_id || '',
      pos_stock_visible: !!v.pos_stock_visible,
      is_default: !!v.is_default,
    }));
    setFormData({
      name: product.name,
      category_id: product.category_id,
      price: product.price,
      cost: product.cost || '',
      description: product.description || '',
      image_url: product.image_url || '',
      is_available: !!product.is_available,
      is_vegetarian: !!product.is_vegetarian,
      preparation_time: product.preparation_time || 15,
      inventory_item_id: product.inventory_item_id || '',
      pos_stock_visible: !!product.pos_stock_visible,
      stock_usage: product.stock_usage != null && product.stock_usage !== '' ? String(product.stock_usage) : '1',
      unit: product.unit || '',
      has_variants: variants.length > 0,
      variants: variants.length > 0 ? variants : [],
    });
    setShowForm(true);
  };

  const quickUpdate = async (product, patch) => {
    const field = Object.keys(patch)[0];
    const key = `${product.id}-${field}`;
    const oldValue = product[field];
    setQuickSaving((current) => ({ ...current, [key]: true }));
    setProducts((current) => current.map((item) => item.id === product.id ? { ...item, ...patch } : item));
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw await response.json().catch(() => ({}));
      addToast(friendlyMessage('save_success', { description: `${product.name} was updated.` }));
    } catch (error) {
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, [field]: oldValue } : item));
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setQuickSaving((current) => ({ ...current, [key]: false }));
    }
  };

  const toggleStockVisibility = async (product) => {
    const state = stockVisibilityState(product);
    if (!state.linked) {
      addToast(friendlyMessage('validation', {
        description: `${product.name} is not linked to inventory. Open Edit and link an inventory item first.`,
      }));
      return;
    }

    const next = !state.visible;
    const key = `${product.id}-pos_stock_visible`;
    const previous = product;
    setQuickSaving((current) => ({ ...current, [key]: true }));
    setProducts((current) => current.map((item) => {
      if (item.id !== product.id) return item;
      if (Array.isArray(item.variants) && item.variants.length > 0) {
        return {
          ...item,
          variants: item.variants.map((variant) => variant.inventory_item_id
            ? { ...variant, pos_stock_visible: next }
            : variant),
        };
      }
      return { ...item, pos_stock_visible: next };
    }));

    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pos_stock_visible: next }),
      });
      if (!response.ok) throw await response.json().catch(() => ({}));
      addToast(friendlyMessage('save_success', {
        description: next ? `Live stock is now shown for ${product.name}.` : `Live stock is now hidden for ${product.name}.`,
      }));
    } catch (error) {
      setProducts((current) => current.map((item) => item.id === product.id ? previous : item));
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setQuickSaving((current) => ({ ...current, [key]: false }));
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete menu item?',
      message: 'Are you sure you want to delete this menu item?',
      tone: 'delete',
    });
    if (!ok) return;
    
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        fetchProducts();
        addToast(friendlyMessage('save_success', { description: 'Menu item deleted.' }));
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const fetchInventoryItems = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/inventory', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        setInventoryItems(data.items || []);
      }
    } catch (error) {
      console.error('Inventory load error:', error);
    }
  };

  const addVariant = () => setFormData((prev) => {
    const inheritedInventoryId = prev.variants.find((variant) => variant.inventory_item_id)?.inventory_item_id || '';
    return { ...prev, variants: [...prev.variants, { ...emptyVariant(), inventory_item_id: inheritedInventoryId }] };
  });
  const removeVariant = (index) => setFormData((prev) => ({ ...prev, variants: prev.variants.filter((_, i) => i !== index) }));
  const updateVariant = (index, patch) => setFormData((prev) => {
    const shouldDefaultInventory = Object.prototype.hasOwnProperty.call(patch, 'inventory_item_id') && patch.inventory_item_id;
    return {
      ...prev,
      variants: prev.variants.map((variant, variantIndex) => {
        if (variantIndex === index) return { ...variant, ...patch };
        if (shouldDefaultInventory && !variant.inventory_item_id) return { ...variant, inventory_item_id: patch.inventory_item_id };
        return variant;
      }),
    };
  });
  const toggleHasVariants = (on) => setFormData((prev) => ({
    ...prev,
    has_variants: on,
    variants: on && prev.variants.length === 0 ? [emptyVariant()] : prev.variants,
  }));

  const activeProducts = useMemo(
    () => products.filter((product) => !!product.is_available),
    [products]
  );
  const inactiveProducts = useMemo(
    () => products.filter((product) => !product.is_available),
    [products]
  );
  const tabProducts = availabilityTab === 'active' ? activeProducts : inactiveProducts;

  // Live count per category, recomputed as products change.
  const categoryCounts = useMemo(() => {
    const map = new Map();
    for (const p of tabProducts) {
      const key = String(p.category_id ?? '');
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [tabProducts]);

  const filteredProducts = tabProducts.filter((p) => {
    const matchesCategory =
      activeCategory === 'all' || String(p.category_id ?? '') === String(activeCategory);
    return matchesCategory && p.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const changeAvailabilityTab = (tab) => {
    setAvailabilityTab(tab);
    setActiveCategory('all');
  };

  const inventoryOptions = useMemo(() => inventoryItems.map((item) => {
    const name = item.item_name || item.name || 'Unnamed inventory item';
    const unit = item.consumption_unit || item.unit || 'units';
    return { value: String(item.id), label: name, hint: `${Number(item.quantity || 0)} ${unit} on hand` };
  }), [inventoryItems]);

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Products Management</h1>
              <p className="text-gray-700 mt-1">Manage menu items and inventory</p>
            </div>
          <button
            onClick={() => {
              setShowForm(true);
              setEditingProduct(null);
              setFormData({ ...emptyForm });
            }}
            className="flex items-center space-x-2 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            <Plus className="w-5 h-5" />
            <span>Add Menu Item</span>
          </button>
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="mb-4 flex gap-2 border-b border-gray-200" role="tablist" aria-label="Menu item availability">
            <button
              type="button"
              role="tab"
              aria-selected={availabilityTab === 'active'}
              onClick={() => changeAvailabilityTab('active')}
              className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                availabilityTab === 'active'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Active ({activeProducts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={availabilityTab === 'inactive'}
              onClick={() => changeAvailabilityTab('inactive')}
              className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                availabilityTab === 'inactive'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Inactive ({inactiveProducts.length})
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-700 w-5 h-5" />
            <input
              type="text"
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent placeholder:text-gray-700 text-gray-900"
            />
          </div>

          {/* Category filter */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeCategory === 'all'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              All ({tabProducts.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  String(activeCategory) === String(cat.id)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {cat.name} ({categoryCounts.get(String(cat.id)) || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Product Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-2xl font-bold text-gray-800">
                  {editingProduct ? 'Edit Menu Item' : 'Add New Menu Item'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">Set the selling details, availability and—when appropriate—the stock item that this menu item consumes.</p>
              </div>
              
              <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5" noValidate>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-900 mb-2">Item Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className={inputErrorClass(!!formErrors.name, 'w-full h-11 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                    placeholder="e.g. Blue Diamond - QTR"
                  />
                  <FieldError message={formErrors.name} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Category *</label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                    className={inputErrorClass(!!formErrors.category_id, 'w-full h-11 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <FieldError message={formErrors.category_id} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Unit</label>
                  <UnitSelect
                    value={formData.unit}
                    onChange={(unit) => setFormData({ ...formData, unit })}
                    placeholder="Select or type a unit"
                    className="w-full h-11 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                  />
                </div>
                {!formData.has_variants && (
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-900"><Link2 className="h-4 w-4 text-gray-500" />Linked Inventory <span className="font-normal text-gray-500">optional</span></label>
                    <Combobox
                      value={formData.inventory_item_id}
                      onChange={(inventory_item_id) => setFormData({ ...formData, inventory_item_id })}
                      options={[{ value: '', label: 'No direct inventory link' }, ...inventoryOptions]}
                      allowCustom={false}
                      placeholder="Search or choose inventory"
                      className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 focus:ring-2 focus:ring-gray-400"
                    />
                    {false && (
                    <select
                      value={formData.inventory_item_id}
                      onChange={(e) => setFormData({ ...formData, inventory_item_id: e.target.value })}
                      className="h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900 focus:ring-2 focus:ring-gray-400"
                    >
                      <option value="">No direct inventory link</option>
                      {inventoryItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.item_name || item.name} · {Number(item.quantity || 0)} {item.unit || ''}</option>
                      ))}
                    </select>
                    )}
                    <p className="mt-1.5 text-xs text-gray-500">Use this for one-unit retail items. QTR/HALF/FULL drinks should use recipes.</p>
                    {formData.inventory_item_id && (
                      <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Used per sale</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formData.stock_usage}
                            onChange={(e) => setFormData({ ...formData, stock_usage: numbersOnlyInput(e.target.value, { allowDecimal: true }) })}
                            placeholder="1"
                            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                          />
                          {(() => {
                            const linked = inventoryItems.find((item) => String(item.id) === String(formData.inventory_item_id));
                            const usage = Number(formData.stock_usage) > 0 ? Number(formData.stock_usage) : 1;
                            const unit = linked?.consumption_unit || linked?.unit || 'units';
                            const onHand = Number(linked?.quantity || 0);
                            return (
                              <p className="mt-1.5 text-xs text-emerald-700">
                                Each sale deducts <span className="font-semibold">{usage} {unit}</span> from{' '}
                                <span className="font-semibold">{linked?.item_name || linked?.name || 'inventory'}</span>
                                {linked ? ` · ${onHand} ${unit} on hand` : ''}.
                              </p>
                            );
                          })()}
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={formData.pos_stock_visible}
                            onChange={(e) => setFormData({ ...formData, pos_stock_visible: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                          />
                          Show live stock count on this item in POS
                        </label>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-gray-400">Only tick stock visibility for exact-count stock — bottles, cans, packs.</p>
                  </div>
                )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    rows={3}
                    placeholder="Short description for the POS and online menu"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {!formData.has_variants && (
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Sale Price *</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formData.price}
                        onChange={(e) => setFormData({...formData, price: numbersOnlyInput(e.target.value, { allowDecimal: true })})}
                        className={inputErrorClass(!!formErrors.price, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                        placeholder="0"
                      />
                      <FieldError message={formErrors.price} />
                    </div>
                  )}
                  {!formData.has_variants && (
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Cost Price</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formData.cost}
                        onChange={(e) => setFormData({...formData, cost: numbersOnlyInput(e.target.value, { allowDecimal: true })})}
                        className={inputErrorClass(!!formErrors.cost, 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 text-gray-900')}
                        placeholder="0"
                      />
                      <FieldError message={formErrors.cost} />
                    </div>
                  )}
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-900"><Clock3 className="h-4 w-4 text-gray-500" />Preparation Time</label>
                    <div className="flex h-11 items-center rounded-lg border border-gray-300 px-3"><input type="number" min="0" value={formData.preparation_time} onChange={(e) => setFormData({ ...formData, preparation_time: numbersOnlyInput(e.target.value) })} className="min-w-0 flex-1 outline-none text-gray-900" /><span className="text-sm text-gray-500">min</span></div>
                  </div>
                </div>
                {formData.has_variants && <FieldError message={formErrors.price} />}

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Food Image</label>
                  <div className="flex items-center gap-4">
                    <MenuItemImage src={formData.image_url} alt={formData.name || 'Preview'} size="md" />
                    <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-800">
                      <Upload className="w-4 h-4" />
                      <span>{uploading ? 'Uploading…' : 'Upload image'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        disabled={uploading}
                        onChange={handleImageUpload}
                      />
                    </label>
                    {formData.image_url && (
                      <button
                        type="button"
                        className="text-sm text-red-600 hover:underline"
                        onClick={() => setFormData({ ...formData, image_url: '' })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.is_available}
                      onChange={(e) => setFormData({...formData, is_available: e.target.checked})}
                      className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-400"
                    />
                    <span className="text-sm text-gray-700">Available</span>
                  </label>
                  <fieldset className="flex items-center gap-2">
                    <legend className="sr-only">Food type</legend>
                    {[
                      { label: 'Veg', value: true },
                      { label: 'Non-Veg', value: false },
                    ].map((option) => (
                      <label
                        key={option.label}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                          formData.is_vegetarian === option.value
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="food_type"
                          checked={formData.is_vegetarian === option.value}
                          onChange={() => setFormData({ ...formData, is_vegetarian: option.value })}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                </div>

                <div className="border-t border-gray-200 pt-5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-900">Has Variations</label>
                    <fieldset className="flex items-center gap-2">
                      <legend className="sr-only">Has variations</legend>
                      {[{ label: 'No', value: false }, { label: 'Yes', value: true }].map((option) => (
                        <label
                          key={option.label}
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                            formData.has_variants === option.value
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="has_variants"
                            checked={formData.has_variants === option.value}
                            onChange={() => toggleHasVariants(option.value)}
                            className="sr-only"
                          />
                          {option.label}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">e.g. Half Plate / Full Plate momo, or 30ml / 60ml drinks — each with its own price and stock usage.</p>

                  {formData.has_variants && (
                    <div className="mt-4 space-y-4">
                      {formData.variants.map((variant, index) => (
                        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900">Variation #{index + 1}</span>
                            {formData.variants.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeVariant(index)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Remove
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Variation Name</label>
                              <input
                                type="text"
                                value={variant.variant_name}
                                onChange={(e) => updateVariant(index, { variant_name: e.target.value })}
                                placeholder="e.g. Half Plate, 60ml, Full"
                                className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Price</label>
                              <div className="flex h-10 items-center rounded-lg border border-gray-300 px-3">
                                <span className="text-sm text-gray-500 mr-1">Rs.</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={variant.price}
                                  onChange={(e) => updateVariant(index, { price: numbersOnlyInput(e.target.value, { allowDecimal: true }) })}
                                  placeholder="0.00"
                                  className="min-w-0 flex-1 outline-none text-sm text-gray-900"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Used per sale</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={variant.stock_quantity}
                                onChange={(e) => updateVariant(index, { stock_quantity: numbersOnlyInput(e.target.value, { allowDecimal: true }) })}
                                placeholder="1 for a whole bottle/can"
                                className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                              />
                              <p className="mt-1 text-[11px] text-gray-400">How much inventory one sale uses — not your on-hand count. Whole packs = 1. Pours e.g. 60 (ml).</p>
                              {variant.inventory_item_id ? (() => {
                                const linked = inventoryItems.find((item) => String(item.id) === String(variant.inventory_item_id));
                                const usage = Number(variant.stock_quantity) > 0 ? Number(variant.stock_quantity) : 1;
                                const unit = variant.stock_unit || linked?.consumption_unit || linked?.unit || 'units';
                                return (
                                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                                    Each sale deducts {usage} {unit}
                                    {linked ? ` from ${linked.item_name || linked.name}` : ''}.
                                  </p>
                                );
                              })() : null}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Unit (ml, gram, etc.)</label>
                              <UnitSelect
                                value={variant.stock_unit}
                                onChange={(stock_unit) => updateVariant(index, { stock_unit })}
                                placeholder="Select or type a unit"
                                className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Inventory Item</label>
                              <Combobox
                                value={variant.inventory_item_id}
                                onChange={(inventory_item_id) => updateVariant(index, { inventory_item_id })}
                                options={[{ value: '', label: '-- Autoselect --' }, ...inventoryOptions]}
                                allowCustom={false}
                                placeholder="Search or choose inventory"
                                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                              />
                              {false && (
                              <select
                                value={variant.inventory_item_id}
                                onChange={(e) => updateVariant(index, { inventory_item_id: e.target.value })}
                                className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-gray-400"
                              >
                                <option value="">-- Autoselect --</option>
                                {inventoryItems.map((item) => (
                                  <option key={item.id} value={item.id}>{item.item_name || item.name} · {Number(item.quantity || 0)} {item.unit || ''}</option>
                                ))}
                              </select>
                              )}
                              <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={!!variant.pos_stock_visible}
                                  disabled={!variant.inventory_item_id}
                                  onChange={(e) => updateVariant(index, { pos_stock_visible: e.target.checked })}
                                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 disabled:cursor-not-allowed"
                                />
                                Show this variation&apos;s live stock in POS
                              </label>
                              {!variant.inventory_item_id && <p className="mt-1 text-xs text-gray-400">Choose its inventory item first to show a live count.</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addVariant}
                        className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-950"
                      >
                        <Plus className="h-4 w-4" /> Add Variation
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex space-x-4 pt-4">
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                  >
                    {editingProduct ? 'Update' : 'Create'} Product
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingProduct(null);
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

        {/* Mobile product cards */}
        <div className="md:hidden space-y-3">
          {filteredProducts.length > 0 ? (
            filteredProducts.map((product) => (
              <div key={product.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{product.name}</h3>
                    <p className="text-xs text-gray-500">{product.category_name || '-'}</p>
                    {product.variants?.length > 0 && <p className="mt-1 text-xs font-semibold text-blue-600">{product.variants.length} options</p>}
                  </div>
                  <select
                    value={product.is_available ? 'available' : 'unavailable'}
                    disabled={quickSaving[`${product.id}-is_available`]}
                    onChange={(event) => quickUpdate(product, { is_available: event.target.value === 'available' })}
                    aria-label={`Status for ${product.name}`}
                    className={`rounded-lg border px-2 py-1 text-xs font-bold ${product.is_available ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'} disabled:opacity-60`}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
                <p className="text-lg font-bold text-gray-900 mb-3">Rs {product.price}</p>
                <button
                  type="button"
                  onClick={() => toggleStockVisibility(product)}
                  disabled={quickSaving[`${product.id}-pos_stock_visible`]}
                  aria-pressed={stockVisibilityState(product).visible}
                  className={`mb-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold ${
                    stockVisibilityState(product).linked
                      ? stockVisibilityState(product).visible
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-gray-300 bg-white text-gray-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  } disabled:opacity-60`}
                >
                  <span>{stockVisibilityState(product).linked ? 'Show stock in POS' : 'Inventory not linked'}</span>
                  <span className={`relative inline-block h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors ${stockVisibilityState(product).visible ? 'bg-blue-600' : 'bg-gray-300'}`}>
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${stockVisibilityState(product).visible ? 'translate-x-5' : 'translate-x-0'}`} />
                  </span>
                </button>
                <select
                  value={product.is_vegetarian ? 'veg' : 'non-veg'}
                  disabled={quickSaving[`${product.id}-is_vegetarian`]}
                  onChange={(event) => quickUpdate(product, { is_vegetarian: event.target.value === 'veg' })}
                  aria-label={`Type for ${product.name}`}
                  className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 disabled:opacity-60"
                >
                  <option value="veg">Veg</option>
                  <option value="non-veg">Non-Veg</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(product)} className="flex-1 py-2 text-blue-600 bg-blue-50 rounded-lg text-sm font-semibold">Edit</button>
                  <button onClick={() => handleDelete(product.id)} className="flex-1 py-2 text-red-600 bg-red-50 rounded-lg text-sm font-semibold">Delete</button>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-xl p-10 text-center text-gray-500">No menu items found</div>
          )}
        </div>

        {/* Desktop products table */}
        <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Image</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Product</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Category</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Price</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Stock visibility</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Type</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.map(product => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <MenuItemImage src={product.image_url} alt={product.name} size="sm" />
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{product.name}</div>
                    {product.description && <div className="text-sm text-gray-800">{product.description}</div>}
                    {product.variants?.length > 0 && <div className="mt-1 text-xs font-semibold text-blue-600">{product.variants.length} options available</div>}
                  </td>
                  <td className="px-6 py-4 text-gray-700">{product.category_name || '-'}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">Rs {product.price}</td>
                  <td className="px-6 py-4">
                    <select
                      value={product.is_available ? 'available' : 'unavailable'}
                      disabled={quickSaving[`${product.id}-is_available`]}
                      onChange={(event) => quickUpdate(product, { is_available: event.target.value === 'available' })}
                      aria-label={`Status for ${product.name}`}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${product.is_available ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'} disabled:opacity-60`}
                    >
                      <option value="available">Available</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => toggleStockVisibility(product)}
                      disabled={quickSaving[`${product.id}-pos_stock_visible`]}
                      aria-pressed={stockVisibilityState(product).visible}
                      title={stockVisibilityState(product).linked ? 'Toggle live stock visibility in POS' : 'Link this menu item to inventory first'}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                        stockVisibilityState(product).linked
                          ? stockVisibilityState(product).visible
                            ? 'border-blue-200 bg-blue-50 text-blue-800'
                            : 'border-gray-300 bg-white text-gray-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      } disabled:opacity-60`}
                    >
                      <span className={`relative inline-block h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors ${stockVisibilityState(product).visible ? 'bg-blue-600' : 'bg-gray-300'}`}>
                        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${stockVisibilityState(product).visible ? 'translate-x-4' : 'translate-x-0'}`} />
                      </span>
                      {stockVisibilityState(product).linked
                        ? stockVisibilityState(product).visible ? 'Shown' : 'Hidden'
                        : 'Not linked'}
                    </button>
                    {stockVisibilityState(product).variantCount > 0 && (
                      <p className="mt-1 text-[10px] text-gray-500">{stockVisibilityState(product).variantCount} linked variation{stockVisibilityState(product).variantCount === 1 ? '' : 's'}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={product.is_vegetarian ? 'veg' : 'non-veg'}
                      disabled={quickSaving[`${product.id}-is_vegetarian`]}
                      onChange={(event) => quickUpdate(product, { is_vegetarian: event.target.value === 'veg' })}
                      aria-label={`Type for ${product.name}`}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${product.is_vegetarian ? 'border-green-200 bg-green-50 text-green-800' : 'border-orange-200 bg-orange-50 text-orange-800'} disabled:opacity-60`}
                    >
                      <option value="veg">Veg</option>
                      <option value="non-veg">Non-Veg</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => handleEdit(product)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
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
          
          {filteredProducts.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-700">No menu items found</p>
            </div>
          )}
        </div>
        </div>
      </div>
    </AdminLayout>
  );
}
