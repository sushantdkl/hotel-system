'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, AlertTriangle, Edit2, Trash2, Package } from 'lucide-react'

export default function IngredientManagement() {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    unit: 'kg',
    stock: 0,
    min_stock: 5,
    cost_per_unit: 0
  })

  const units = ['kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'packet']

  const fetchIngredients = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/ingredients')
      const data = await response.json()
      if (data.success) {
        setIngredients(data.ingredients)
      }
    } catch (error) {
      console.error('Error fetching ingredients:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIngredients()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const url = '/api/ingredients'
      const method = editingId ? 'PUT' : 'POST'
      const payload = editingId ? { ...formData, id: editingId } : formData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      
      if (data.success) {
        await fetchIngredients()
        resetForm()
      } else {
        alert(data.error || 'Failed to save ingredient')
      }
    } catch (error) {
      console.error('Error saving ingredient:', error)
      alert('Failed to save ingredient')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this ingredient?')) return

    try {
      const response = await fetch(`/api/ingredients?id=${id}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      if (data.success) {
        setIngredients(ingredients.filter(item => item.id !== id))
      } else {
        alert(data.error || 'Failed to delete ingredient')
      }
    } catch (error) {
      console.error('Error deleting ingredient:', error)
      alert('Failed to delete ingredient')
    }
  }

  const handleEdit = (ingredient) => {
    setEditingId(ingredient.id)
    setFormData({
      name: ingredient.name,
      unit: ingredient.unit,
      stock: ingredient.stock,
      min_stock: ingredient.min_stock,
      cost_per_unit: ingredient.cost_per_unit
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      unit: 'kg',
      stock: 0,
      min_stock: 5,
      cost_per_unit: 0
    })
    setEditingId(null)
    setShowForm(false)
  }

  const filteredIngredients = ingredients.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const criticalIngredients = ingredients.filter(item => item.stock < item.min_stock)
  const totalValue = ingredients.reduce((sum, item) => sum + (item.stock * item.cost_per_unit), 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Package className="text-primary" />
          Ingredient Inventory
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center justify-center gap-2 text-sm sm:text-base"
        >
          <Plus size={20} />
          Add Ingredient
        </button>
      </div>

      {criticalIngredients.length > 0 && (
        <div className="pos-stat-card border-l-4 border-destructive bg-destructive/5">
          <div className="flex items-center gap-3 text-destructive font-semibold mb-3">
            <AlertTriangle size={24} />
            <span>{criticalIngredients.length} ingredients running low!</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
            {criticalIngredients.map(item => (
              <div key={item.id} className="p-2 bg-background/50 rounded">
                {item.name}: {item.stock} {item.unit} (Min: {item.min_stock} {item.unit})
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
        <div className="pos-stat-card">
          <p className="text-sm text-muted-foreground mb-2">Total Ingredients</p>
          <h3 className="text-3xl font-bold text-foreground">{ingredients.length}</h3>
        </div>
        <div className="pos-stat-card">
          <p className="text-sm text-muted-foreground mb-2">Critical Alerts</p>
          <h3 className="text-3xl font-bold text-destructive">{criticalIngredients.length}</h3>
        </div>
      </div>

      {showForm && (
        <div className="pos-stat-card">
          <h3 className="text-xl font-bold mb-4">
            {editingId ? 'Edit Ingredient' : 'Add New Ingredient'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Ingredient Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  placeholder="e.g., Tomatoes, Chicken Breast"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Unit *</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                >
                  {units.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Current Stock *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.stock}
                  onChange={(e) => setFormData({ ...formData, stock: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Minimum Stock Level *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.min_stock}
                  onChange={(e) => setFormData({ ...formData, min_stock: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Cost per Unit (Rs)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.cost_per_unit}
                  onChange={(e) => setFormData({ ...formData, cost_per_unit: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="pos-button-primary px-6 py-2 rounded-lg font-semibold"
              >
                {editingId ? 'Update' : 'Add'} Ingredient
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 border border-border rounded-lg font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="pos-stat-card">
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search size={20} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search ingredients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-input"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading ingredients...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground font-semibold">
                  <th className="text-left py-3 px-4">Ingredient</th>
                  <th className="text-center py-3 px-4">Current Stock</th>
                  <th className="text-center py-3 px-4">Min Stock</th>
                  <th className="text-right py-3 px-4">Cost/Unit</th>
                  <th className="text-right py-3 px-4">Total Value</th>
                  <th className="text-center py-3 px-4">Status</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIngredients.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-8 text-muted-foreground">
                      No ingredients found
                    </td>
                  </tr>
                ) : (
                  filteredIngredients.map(item => {
                    const isCritical = item.stock < item.min_stock
                    const totalValue = item.stock * item.cost_per_unit
                    
                    return (
                      <tr key={item.id} className="border-b border-border hover:bg-muted/30">
                        <td className="py-3 px-4 font-semibold">{item.name}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={isCritical ? 'text-destructive font-bold' : ''}>
                            {item.stock} {item.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center text-muted-foreground">
                          {item.min_stock} {item.unit}
                        </td>
                        <td className="py-3 px-4 text-right">
                          Rs {item.cost_per_unit.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-primary">
                          Rs {totalValue.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            isCritical
                              ? 'bg-destructive/20 text-destructive'
                              : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          }`}>
                            {isCritical ? 'Low Stock' : 'Sufficient'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => handleEdit(item)}
                              className="p-2 hover:bg-primary/10 rounded text-primary"
                              title="Edit"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-2 hover:bg-destructive/10 rounded text-destructive"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
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
    </div>
  )
}
