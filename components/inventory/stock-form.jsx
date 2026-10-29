'use client'

import { useState } from 'react'
import { X, Camera, AlertCircle } from 'lucide-react'
import BarcodeScanner from '../products/barcode-scanner'
import ManualAddFlow from '../products/manual-add-flow'

export default function StockForm({ onSubmit, onCancel, inventory, onProductAdded }) {
  const [formData, setFormData] = useState({
    productId: '',
    quantity: '',
    changeType: 'purchase',
    adjustmentDirection: 'add',
    reason: ''
  })
  const [showScanner, setShowScanner] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [scannedBarcode, setScannedBarcode] = useState('')
  const [scanError, setScanError] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(formData)
    setFormData({ productId: '', quantity: '', changeType: 'purchase', adjustmentDirection: 'add', reason: '' })
  }

  const handleBarcodeScan = async (barcode) => {
    console.log('Scanned barcode:', barcode)
    setScannedBarcode(barcode)
    setShowScanner(false)

    // Check if product exists in inventory
    const product = inventory.find(p => p.barcode === barcode)
    
    if (product) {
      // Product found - auto-select it
      setFormData({ ...formData, productId: product.id })
      setScanError(null)
    } else {
      // Product not found - show add product form
      setScanError(`Product with barcode ${barcode} not found in inventory`)
      setTimeout(() => {
        setShowAddProduct(true)
      }, 1000)
    }
  }

  const handleProductAdded = (newProduct) => {
    setShowAddProduct(false)
    setFormData({ ...formData, productId: newProduct.id })
    setScanError(null)
    onProductAdded(newProduct)
  }

  return (
    <>
      {/* Main Modal Container */}
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-background rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-background border-b border-border p-6 flex justify-between items-center">
            <h3 className="text-2xl font-bold">Add Stock to Inventory</h3>
            <button
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={28} />
            </button>
          </div>

          <div className="p-6">
            {scanError && (
              <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-semibold text-amber-600">Product Not Found</p>
                  <p className="text-sm text-muted-foreground">{scanError}</p>
                  <p className="text-sm text-muted-foreground mt-1">Opening product addition form...</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-2">Product *</label>
            <div className="flex gap-2">
              <select
                required
                value={formData.productId}
                onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                className="flex-1 px-4 py-2 border border-border rounded-lg bg-input"
              >
                <option value="">Select Product</option>
                {inventory.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} - Current: {item.stock} {item.unit || 'pcs'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-6 py-2 rounded-lg flex items-center gap-2 transition-colors font-semibold"
              >
                <Camera size={20} />
                Scan
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Change Type *</label>
            <select
              required
              value={formData.changeType}
              onChange={(e) => setFormData({ ...formData, changeType: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input"
            >
              <option value="purchase">Purchase (Add Stock)</option>
              <option value="adjustment">Adjustment (Add/Remove)</option>
              <option value="damage">Damage/Expired (Remove)</option>
              <option value="return">Customer Return (Add)</option>
            </select>
          </div>

          {formData.changeType === 'adjustment' && (
            <div>
              <label className="block text-sm font-semibold mb-2">Adjustment Direction *</label>
              <select
                required
                value={formData.adjustmentDirection}
                onChange={(e) => setFormData({ ...formData, adjustmentDirection: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-input"
              >
                <option value="add">Add Stock (+)</option>
                <option value="remove">Remove Stock (-)</option>
              </select>
            </div>
          )}

          <div className={formData.changeType === 'adjustment' ? 'md:col-span-2' : ''}>
            <label className="block text-sm font-semibold mb-2">
              Quantity * {
                formData.changeType === 'damage' ? '(will decrease)' : 
                formData.changeType === 'adjustment' && formData.adjustmentDirection === 'remove' ? '(will decrease)' :
                '(will increase)'
              }
            </label>
            <input
              type="number"
              required
              min="1"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input"
              placeholder="0"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Reason/Note</label>
            <input
              type="text"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              className="w-full px-4 py-2 border border-border rounded-lg bg-input"
              placeholder="e.g., Supplier XYZ, Warehouse count"
            />
          </div>
        </div>

        <div className="flex gap-4 pt-4 border-t border-border">
          <button
            type="submit"
            className="pos-button-primary px-6 py-2 rounded-lg font-semibold flex-1"
          >
            Add Stock
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 border border-border rounded-lg font-semibold hover:bg-muted flex-1"
          >
            Cancel
          </button>
        </div>
      </form>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
          <div className="relative">
            <button
              onClick={() => setShowScanner(false)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 flex items-center gap-2"
            >
              <X size={24} /> Close Scanner
            </button>
            <BarcodeScanner
              onBarcodeDetected={(barcode) => {
                setShowScanner(false)
                handleBarcodeScan(barcode)
              }}
              onClose={() => setShowScanner(false)}
            />
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
          <div className="bg-background rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-background border-b border-border p-6 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-bold">Add New Product</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Product not found in inventory. Add it now to continue.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddProduct(false)
                  setScanError(null)
                  setScannedBarcode('')
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={28} />
              </button>
            </div>
            <div className="p-6">
              <ManualAddFlow
                barcode={scannedBarcode}
                onSave={handleProductAdded}
                onCancel={() => {
                  setShowAddProduct(false)
                  setScanError(null)
                  setScannedBarcode('')
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
