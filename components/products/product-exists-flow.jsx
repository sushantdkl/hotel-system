'use client'

import { AlertCircle, Plus, Edit2 } from 'lucide-react'

export default function ProductExistsFlow({ product, onUpdateStock, onEdit, onCancel }) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex gap-3">
        <AlertCircle className="text-blue-600 flex-shrink-0" size={20} />
        <div>
          <p className="font-semibold text-blue-600">Product Already Exists</p>
          <p className="text-sm text-muted-foreground">Found in inventory. You can update stock or edit details.</p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Product Name</p>
            <p className="font-semibold text-lg">{product.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Barcode</p>
            <p className="font-mono text-lg">{product.barcode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Category</p>
            <p className="font-semibold">{product.category}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Stock</p>
            <p className="font-semibold text-lg text-primary">{product.stock} units</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Price</p>
            <p className="font-semibold">Rs {product.price.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Cost</p>
            <p className="font-semibold">Rs {product.cost.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onUpdateStock}
          className="flex-1 pos-button-primary py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <Plus size={20} />
          Increase Stock
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-4 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
        >
          <Edit2 size={20} />
          Edit Product
        </button>
      </div>

      <button
        onClick={onCancel}
        className="w-full px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
