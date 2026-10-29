'use client'

import { useState } from 'react'
import { CheckCircle, AlertCircle } from 'lucide-react'

export default function ApiProductFlow({ apiProduct, barcode, onSave, onManual, onCancel }) {
  const [formData, setFormData] = useState({
    name: apiProduct.name,
    barcode: barcode,
    brand: apiProduct.brand,
    category: apiProduct.category || 'General',
    image: apiProduct.image,
    description: apiProduct.description,
    costPrice: '',
    sellingPrice: '',
    stock: '',
    supplier: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.sellingPrice || !formData.stock) {
      alert('Please fill Selling Price and Stock Quantity')
      return
    }

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          barcode: formData.barcode,
          category: formData.category,
          price: parseFloat(formData.sellingPrice),
          stock: parseInt(formData.stock),
          unit: 'pcs',
          min_stock: 10
        })
      })

      const data = await response.json()
      
      if (data.success) {
        onSave(data.product)
      } else {
        alert(data.error || 'Failed to add product')
      }
    } catch (error) {
      console.error('Error adding product:', error)
      alert('Failed to add product')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex gap-3">
        <CheckCircle className="text-green-600 flex-shrink-0" size={20} />
        <div>
          <p className="font-semibold text-green-600">Product Found Online!</p>
          <p className="text-sm text-muted-foreground">Auto-filled details. Please complete pricing and stock info.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Product Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Brand</label>
            <input
              type="text"
              value={formData.brand}
              onChange={(e) => setFormData({...formData, brand: e.target.value})}
              className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
              className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
            >
              <option>General</option>
              <option>Electronics</option>
              <option>Cosmetics</option>
              <option>Medicine</option>
              <option>Food</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Barcode</label>
            <input
              type="text"
              disabled
              value={formData.barcode}
              className="w-full px-3 py-2 border border-border rounded-lg bg-muted text-muted-foreground"
            />
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-4">
          <p className="font-semibold text-sm">Complete These Fields:</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Cost Price *</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.costPrice}
                onChange={(e) => setFormData({...formData, costPrice: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Selling Price *</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.sellingPrice}
                onChange={(e) => setFormData({...formData, sellingPrice: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Stock Quantity *</label>
              <input
                type="number"
                required
                value={formData.stock}
                onChange={(e) => setFormData({...formData, stock: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Supplier</label>
              <input
                type="text"
                value={formData.supplier}
                onChange={(e) => setFormData({...formData, supplier: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground"
                placeholder="Optional"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="flex-1 pos-button-primary py-3 rounded-lg font-semibold"
        >
          Save Product
        </button>
        <button
          type="button"
          onClick={onManual}
          className="px-4 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
        >
          Manual Entry
        </button>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="w-full px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </form>
  )
}
