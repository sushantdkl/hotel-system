'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, Edit2, Trash2 } from 'lucide-react'
import ProductForm from './product-form'
import ProductTable from './product-table'
import SmartProductFlow from './smart-product-flow'

export default function ProductManagement() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showSmartFlow, setShowSmartFlow] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState(null)

  // Fetch products from API
  const fetchProducts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/products')
      const data = await response.json()
      if (data.success) {
        setProducts(data.products)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  const handleAddProduct = async (product) => {
    try {
      if (editingId) {
        // Update existing product
        const response = await fetch('/api/products', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...product, id: editingId })
        })
        const data = await response.json()
        if (data.success) {
          setProducts(products.map(p => p.id === editingId ? data.product : p))
          setEditingId(null)
        }
      } else {
        // Create new product
        const response = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product)
        })
        const data = await response.json()
        if (data.success) {
          setProducts([...products, data.product])
        } else {
          alert(data.error || 'Failed to add product')
          return
        }
      }
      setShowForm(false)
    } catch (error) {
      console.error('Error saving product:', error)
      alert('Failed to save product')
    }
  }

  const handleSmartProductAdded = (product) => {
    setProducts([...products, product])
    setShowSmartFlow(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this product?')) return

    try {
      const response = await fetch(`/api/products?id=${id}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      if (data.success) {
        setProducts(products.filter(p => p.id !== id))
      } else {
        alert(data.error || 'Failed to delete product')
      }
    } catch (error) {
      console.error('Error deleting product:', error)
      alert('Failed to delete product')
    }
  }

  const handleEdit = (product) => {
    setEditingId(product.id)
    setShowForm(true)
  }

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.barcode.includes(searchTerm)
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold">Product Management</h2>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={() => setShowSmartFlow(true)}
            className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-sm sm:text-base"
          >
            <Plus size={20} />
            <span className="hidden sm:inline">Smart Add</span>
            <span className="sm:hidden">Smart</span>
          </button>
          <button
            onClick={() => {
              setEditingId(null)
              setShowForm(!showForm)
            }}
            className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            <Plus size={20} />
            <span className="hidden sm:inline">Manual Add</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {showForm && (
        <ProductForm
          onSubmit={handleAddProduct}
          onCancel={() => {
            setShowForm(false)
            setEditingId(null)
          }}
          editingProduct={editingId ? products.find(p => p.id === editingId) : null}
        />
      )}

      {showSmartFlow && (
        <SmartProductFlow
          products={products}
          onProductAdded={handleSmartProductAdded}
          onCancel={() => setShowSmartFlow(false)}
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
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-input text-foreground placeholder-muted-foreground text-xs sm:text-base"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading products...</div>
        ) : (
          <ProductTable
            products={filteredProducts}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  )
}
