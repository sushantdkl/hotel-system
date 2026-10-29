'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, AlertTriangle, Minus, Save, X } from 'lucide-react'
import StockForm from './stock-form'
import StockHistory from './stock-history'

export default function InventoryManagement() {
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingStocks, setEditingStocks] = useState({})

  // Fetch products from API
  useEffect(() => {
    fetchInventory()
  }, [])

  const fetchInventory = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/products')
      const data = await response.json()
      if (data.success) {
        setInventory(data.products)
      }
    } catch (error) {
      console.error('Error fetching inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredInventory = inventory.filter(item =>
    item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.barcode?.includes(searchTerm)
  )

  const handleAddStock = async (data) => {
    try {
      const product = inventory.find(p => p.id === data.productId)
      
      // Calculate new stock based on change type and direction
      let newStock
      if (data.changeType === 'damage' || (data.changeType === 'adjustment' && data.adjustmentDirection === 'remove')) {
        newStock = product.stock - parseInt(data.quantity)
      } else {
        newStock = product.stock + parseInt(data.quantity)
      }
      
      // Prevent negative stock
      if (newStock < 0) {
        alert(`Cannot remove ${data.quantity} items. Current stock is only ${product.stock}.`)
        return
      }
      
      // Update product stock via API
      const response = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.productId,
          stock: newStock
        })
      })

      const result = await response.json()
      
      if (result.success) {
        // Refresh inventory
        fetchInventory()
        setShowForm(false)
      } else {
        alert(result.error || 'Failed to update stock')
      }
    } catch (error) {
      console.error('Error updating stock:', error)
      alert('Failed to update stock')
    }
  }

  const handleProductAdded = (newProduct) => {
    fetchInventory()
    setShowForm(false)
  }

  const handleStockChange = (productId, delta) => {
    setEditingStocks(prev => {
      const currentStock = prev[productId]?.newStock ?? inventory.find(p => p.id === productId)?.stock ?? 0
      const newStock = Math.max(0, currentStock + delta)
      return {
        ...prev,
        [productId]: {
          newStock,
          hasChanges: newStock !== inventory.find(p => p.id === productId)?.stock
        }
      }
    })
  }

  const handleSaveStock = async (productId) => {
    const editData = editingStocks[productId]
    if (!editData?.hasChanges) return

    try {
      const response = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: productId,
          stock: editData.newStock
        })
      })

      const result = await response.json()
      if (result.success) {
        await fetchInventory()
        setEditingStocks(prev => {
          const updated = { ...prev }
          delete updated[productId]
          return updated
        })
      } else {
        alert(result.error || 'Failed to update stock')
      }
    } catch (error) {
      console.error('Error updating stock:', error)
      alert('Failed to update stock')
    }
  }

  const handleCancelEdit = (productId) => {
    setEditingStocks(prev => {
      const updated = { ...prev }
      delete updated[productId]
      return updated
    })
  }

  const criticalItems = inventory.filter(i => i.stock < (i.min_stock || 10))
  const totalValue = inventory.reduce((sum, item) => sum + (item.stock * item.price), 0)
  const totalItems = inventory.reduce((sum, i) => sum + i.stock, 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold">Inventory Management</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center justify-center gap-2 text-sm sm:text-base w-full sm:w-auto"
        >
          <Plus size={20} />
          Add Stock
        </button>
      </div>

      {criticalItems.length > 0 && (
        <div className="pos-stat-card border-l-4 border-destructive bg-destructive/5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-destructive font-semibold mb-3">
            <AlertTriangle size={24} className="flex-shrink-0" />
            <span className="text-sm sm:text-base">{criticalItems.length} items running low on stock!</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs sm:text-sm">
            {criticalItems.map(item => (
              <div key={item.id} className="p-2 bg-background/50 rounded">
                {item.product}: {item.stock}/{item.minStock}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
        <div className="pos-stat-card">
          <p className="text-xs sm:text-sm text-muted-foreground mb-1 sm:mb-2">Total Items</p>
          <h3 className="text-2xl sm:text-3xl font-bold text-foreground">{totalItems}</h3>
        </div>
        <div className="pos-stat-card">
          <p className="text-xs sm:text-sm text-muted-foreground mb-1 sm:mb-2">Critical Alerts</p>
          <h3 className="text-2xl sm:text-3xl font-bold text-destructive">{criticalItems.length}</h3>
        </div>
        <div className="pos-stat-card">
          <p className="text-xs sm:text-sm text-muted-foreground mb-1 sm:mb-2">Inventory Value</p>
          <h3 className="text-2xl sm:text-3xl font-bold text-primary">Rs {totalValue.toFixed(2)}</h3>
        </div>
      </div>

      {showForm && (
        <StockForm 
          onSubmit={handleAddStock} 
          onCancel={() => setShowForm(false)} 
          inventory={inventory}
          onProductAdded={handleProductAdded}
        />
      )}

      <div className="pos-stat-card">
        <div className="flex gap-2 sm:gap-4 mb-4 sm:mb-6">
          <div className="flex-1 relative min-w-0">
            <Search size={20} className="absolute left-3 top-2 sm:top-3 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 sm:py-2 border border-border rounded-lg bg-input text-xs sm:text-base"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading inventory...</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-xs sm:text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground font-semibold">
                  <th className="text-left py-2 sm:py-3 px-3 sm:px-4">Product</th>
                  <th className="text-left py-2 sm:py-3 px-3 sm:px-4 hidden sm:table-cell">Category</th>
                  <th className="text-center py-2 sm:py-3 px-3 sm:px-4">Stock</th>
                  <th className="text-right py-2 sm:py-3 px-3 sm:px-4 hidden md:table-cell">Min Stock</th>
                  <th className="text-right py-2 sm:py-3 px-3 sm:px-4 hidden lg:table-cell">Value</th>
                  <th className="text-left py-2 sm:py-3 px-3 sm:px-4">Status</th>
                  <th className="text-center py-2 sm:py-3 px-3 sm:px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-8 text-muted-foreground">
                      No products found
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map(item => {
                    const isCritical = item.stock < (item.min_stock || 10)
                    const editData = editingStocks[item.id]
                    const displayStock = editData?.newStock ?? item.stock
                    const hasChanges = editData?.hasChanges ?? false
                    
                    return (
                      <tr key={item.id} className={`border-b border-border hover:bg-muted/30 transition-colors ${hasChanges ? 'bg-primary/5' : ''}`}>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 font-semibold">{item.name}</td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 hidden sm:table-cell">{item.category}</td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4">
                          <div className="flex items-center justify-center gap-1 sm:gap-2">
                            <button
                              onClick={() => handleStockChange(item.id, -1)}
                              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center bg-destructive/20 hover:bg-destructive/30 text-destructive rounded transition-colors"
                              title="Decrease stock"
                            >
                              <Minus size={14} />
                            </button>
                            <span className={`font-bold text-base sm:text-lg min-w-[2rem] sm:min-w-[3rem] text-center ${hasChanges ? 'text-primary' : ''}`}>
                              {displayStock}
                            </span>
                            <button
                              onClick={() => handleStockChange(item.id, 1)}
                              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center bg-primary/20 hover:bg-primary/30 text-primary rounded transition-colors"
                              title="Increase stock"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 text-right hidden md:table-cell">{item.min_stock || 10}</td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 text-right hidden lg:table-cell">
                          Rs {(displayStock * item.price).toFixed(2)}
                        </td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            isCritical
                              ? 'bg-destructive/20 text-destructive'
                              : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          }`}>
                            {isCritical ? 'Critical' : 'Optimal'}
                          </span>
                        </td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4">
                          {hasChanges ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleSaveStock(item.id)}
                                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors"
                                title="Save changes"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                onClick={() => handleCancelEdit(item.id)}
                                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground rounded transition-colors"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground text-xs">-</div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StockHistory />
    </div>
  )
}
