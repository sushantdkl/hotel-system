'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import DateInput from '@/components/ui/date-input.jsx'

export default function ProductForm({ onSubmit, onCancel, editingProduct }) {
  const [formData, setFormData] = useState({
    name: editingProduct?.name || '',
    barcode: editingProduct?.barcode || '',
    category: editingProduct?.category || 'General',
    price: editingProduct?.price || '',
    cost: editingProduct?.cost || '',
    stock: editingProduct?.stock || '',
    expiry: editingProduct?.expiry || ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(formData)
    setFormData({
      name: '',
      barcode: '',
      category: 'General',
      price: '',
      cost: '',
      stock: '',
      expiry: ''
    })
  }

  return (
    <div className="pos-stat-card border-2 border-primary">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold">
          {editingProduct ? 'Edit Product' : 'Add New Product'}
        </h3>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Product Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
              placeholder="Enter product name"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Barcode</label>
            <input
              type="text"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
              placeholder="Enter barcode"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Category *</label>
            <select
              required
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
            >
              <option>General</option>
              <option>Electronics</option>
              <option>Cosmetics</option>
              <option>Medicine</option>
              <option>Food</option>
              <option>Clothing</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Price *</label>
            <input
              type="number"
              required
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Cost Price *</label>
            <input
              type="number"
              required
              step="0.01"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Stock Quantity *</label>
            <input
              type="number"
              required
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
              placeholder="0"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">Expiry Date (if applicable)</label>
            <DateInput
              value={formData.expiry}
              onChange={(expiry) => setFormData({ ...formData, expiry })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground"
            />
          </div>
        </div>

        <div className="flex gap-4 pt-4 border-t border-border">
          <button
            type="submit"
            className="pos-button-primary px-6 py-2 rounded-lg font-semibold flex-1 transition-all"
          >
            {editingProduct ? 'Update Product' : 'Add Product'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 border border-border rounded-lg font-semibold text-foreground hover:bg-muted transition-colors flex-1"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
