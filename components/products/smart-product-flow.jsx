'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Camera, X, AlertCircle, CheckCircle, Loader } from 'lucide-react'
import BarcodeScanner from './barcode-scanner'
import ProductExistsFlow from './product-exists-flow'
import ApiProductFlow from './api-product-flow'
import ManualAddFlow from './manual-add-flow'

export default function SmartProductFlow({ products, onProductAdded, onCancel }) {
  const [step, setStep] = useState('input') // input, checking, exists, api-found, manual, scanning
  const [barcode, setBarcode] = useState('')
  const [loading, setLoading] = useState(false)
  const [foundProduct, setFoundProduct] = useState(null)
  const [apiProduct, setApiProduct] = useState(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('') // 'info', 'success', 'error'
  const [showScanner, setShowScanner] = useState(false)
  const barcodeInputRef = useRef(null)

  // Case A: Check if product exists in local DB
  const handleBarcodeSubmit = async (e) => {
    e.preventDefault()
    if (!barcode.trim()) {
      showMessage('Please enter a barcode', 'error')
      return
    }

    setLoading(true)
    setStep('checking')

    try {
      // Check local database via API
      const response = await fetch(`/api/products?search=${barcode}`)
      const data = await response.json()
      
      if (data.success && data.products.length > 0) {
        const existingProduct = data.products.find(p => p.barcode === barcode)
        
        if (existingProduct) {
          // Case A: Product exists in local database
          setFoundProduct(existingProduct)
          setStep('exists')
          setLoading(false)
          return
        }
      }
      
      // Product not in local DB, try external APIs
      await lookupProductInAPIs(barcode)
    } catch (error) {
      console.error('Error checking local database:', error)
      // If local check fails, try external APIs anyway
      await lookupProductInAPIs(barcode)
    }
    
    setLoading(false)
  }

  // Try multiple APIs for product lookup
  const lookupProductInAPIs = async (barcodeValue) => {
    try {
      // Try OpenFoodFacts first
      const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcodeValue}.json`)
      
      if (response.ok) {
        const data = await response.json()
        if (data.product) {
          const apiProd = {
            name: data.product.product_name || 'Unknown Product',
            brand: data.product.brands || '',
            category: data.product.categories || 'General',
            image: data.product.image_url || '',
            description: data.product.generic_name || '',
            barcode: barcodeValue
          }
          setApiProduct(apiProd)
          setStep('api-found')
          showMessage('Product found online! Please review and confirm details.', 'success')
          return
        }
      }
      
      // If not found in APIs, show manual form
      setStep('manual')
      showMessage('Product not found in database. Please add manually.', 'info')
      setApiProduct(null)
    } catch (error) {
      console.error('API lookup error:', error)
      setStep('manual')
      showMessage('Could not reach product databases. Please add manually.', 'info')
    }
  }

  const showMessage = (msg, type) => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const handleProductAdded = (newProduct) => {
    showMessage('Product added successfully!', 'success')
    setTimeout(() => {
      onProductAdded(newProduct)
    }, 1000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-2xl max-w-2xl w-full max-h-96 overflow-y-auto border border-border">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border p-6 flex justify-between items-center">
          <h2 className="text-2xl font-bold">Smart Product Addition</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X size={28} />
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-6 mt-4 p-4 rounded-lg flex gap-2 ${
            messageType === 'error' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
            messageType === 'success' ? 'bg-green-500/10 text-green-600 border border-green-500/20' :
            'bg-blue-500/10 text-blue-600 border border-blue-500/20'
          }`}>
            {messageType === 'error' && <AlertCircle size={20} />}
            {messageType === 'success' && <CheckCircle size={20} />}
            <span>{message}</span>
          </div>
        )}

        {/* Content */}
        <div className="p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <p className="text-muted-foreground mb-6">Scan barcode or enter manually. System will check local DB and online databases.</p>
              
              <form onSubmit={handleBarcodeSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">Barcode *</label>
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    autoFocus
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Scan or type barcode..."
                    className="w-full px-4 py-3 border border-border rounded-lg bg-input text-foreground text-lg tracking-widest"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 pos-button-primary py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader size={20} className="animate-spin" /> : <Search size={20} />}
                    {loading ? 'Checking...' : 'Lookup Product'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="px-4 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
                  >
                    <Camera size={20} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 'checking' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader size={40} className="text-primary animate-spin" />
              <p className="text-muted-foreground">Checking local database...</p>
            </div>
          )}

          {step === 'exists' && (
            <ProductExistsFlow
              product={foundProduct}
              onUpdateStock={() => {
                handleProductAdded({ ...foundProduct, stock: foundProduct.stock })
              }}
              onEdit={() => {
                // Open edit mode
              }}
              onCancel={() => setStep('input')}
            />
          )}

          {step === 'api-found' && (
            <ApiProductFlow
              apiProduct={apiProduct}
              barcode={barcode}
              onSave={handleProductAdded}
              onManual={() => setStep('manual')}
              onCancel={() => setStep('input')}
            />
          )}

          {step === 'manual' && (
            <ManualAddFlow
              barcode={barcode}
              onSave={handleProductAdded}
              onCancel={() => setStep('input')}
            />
          )}
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onBarcodeDetected={(scannedBarcode) => {
            setBarcode(scannedBarcode)
            setShowScanner(false)
            // Auto-submit after scan
            setTimeout(() => {
              handleBarcodeSubmit({ preventDefault: () => {} })
            }, 100)
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
