'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, Edit2, Trash2, ChefHat, Clock, Leaf } from 'lucide-react'

export default function MenuManagement() {
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    item_code: '',
    category: 'Appetizers',
    price: '',
    description: '',
    preparation_time: 15,
    is_vegetarian: false,
    is_spicy: false,
    is_available: true
  })

  const categories = [
    'Appetizers', 
    'Soups', 
    'Salads', 
    'Main Course', 
    'Pasta & Rice', 
    'Desserts', 
    'Beverages',
    'Specials'
  ]

  // Fetch menu items from API
  const fetchMenuItems = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/menu-items')
      const data = await response.json()
      if (data.success) {
        setMenuItems(data.menuItems)
      }
    } catch (error) {
      console.error('Error fetching menu items:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMenuItems()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const url = editingId ? '/api/menu-items' : '/api/menu-items'
      const method = editingId ? 'PUT' : 'POST'
      const payload = editingId ? { ...formData, id: editingId } : formData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      
      if (data.success) {
        await fetchMenuItems()
        resetForm()
      } else {
        alert(data.error || 'Failed to save menu item')
      }
    } catch (error) {
      console.error('Error saving menu item:', error)
      alert('Failed to save menu item')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this menu item?')) return

    try {
      const response = await fetch(`/api/menu-items?id=${id}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      if (data.success) {
        setMenuItems(menuItems.filter(item => item.id !== id))
      } else {
        alert(data.error || 'Failed to delete menu item')
      }
    } catch (error) {
      console.error('Error deleting menu item:', error)
      alert('Failed to delete menu item')
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setFormData({
      name: item.name,
      item_code: item.item_code,
      category: item.category,
      price: item.price,
      description: item.description || '',
      preparation_time: item.preparation_time,
      is_vegetarian: item.is_vegetarian === 1,
      is_spicy: item.is_spicy === 1,
      is_available: item.is_available === 1
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      item_code: '',
      category: 'Appetizers',
      price: '',
      description: '',
      preparation_time: 15,
      is_vegetarian: false,
      is_spicy: false,
      is_available: true
    })
    setEditingId(null)
    setShowForm(false)
  }

  const filteredItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.item_code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <ChefHat className="text-primary" />
          Menu Management
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center justify-center gap-2 text-sm sm:text-base"
        >
          <Plus size={20} />
          Add Menu Item
        </button>
      </div>

      {showForm && (
        <div className="pos-stat-card">
          <h3 className="text-xl font-bold mb-4">
            {editingId ? 'Edit Menu Item' : 'Add New Menu Item'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Item Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Item Code *</label>
                <input
                  type="text"
                  value={formData.item_code}
                  onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  placeholder="e.g., APTZ001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Category *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Price (Rs) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Preparation Time (min)</label>
                <input
                  type="number"
                  value={formData.preparation_time}
                  onChange={(e) => setFormData({ ...formData, preparation_time: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-6">
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
                          : 'border-border hover:bg-muted'
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
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_spicy}
                    onChange={(e) => setFormData({ ...formData, is_spicy: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Spicy</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_available}
                    onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Available</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                rows="3"
                placeholder="Brief description of the dish..."
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="pos-button-primary px-6 py-2 rounded-lg font-semibold"
              >
                {editingId ? 'Update' : 'Add'} Menu Item
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
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search size={20} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-input"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-border rounded-lg bg-input"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading menu items...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground font-semibold">
                  <th className="text-left py-3 px-4">Item</th>
                  <th className="text-left py-3 px-4">Code</th>
                  <th className="text-left py-3 px-4">Category</th>
                  <th className="text-right py-3 px-4">Price</th>
                  <th className="text-center py-3 px-4">Time</th>
                  <th className="text-center py-3 px-4">Tags</th>
                  <th className="text-center py-3 px-4">Status</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center py-8 text-muted-foreground">
                      No menu items found
                    </td>
                  </tr>
                ) : (
                  filteredItems.map(item => (
                    <tr key={item.id} className="border-b border-border hover:bg-muted/30">
                      <td className="py-3 px-4">
                        <div className="font-semibold">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {item.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{item.item_code}</td>
                      <td className="py-3 px-4">{item.category}</td>
                      <td className="py-3 px-4 text-right font-semibold text-primary">
                        Rs {parseFloat(item.price).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="flex items-center justify-center gap-1 text-muted-foreground">
                          <Clock size={14} />
                          {item.preparation_time}m
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          {item.is_vegetarian === 1 && (
                            <span className="text-green-600" title="Vegetarian">
                              <Leaf size={16} />
                            </span>
                          )}
                          {item.is_spicy === 1 && (
                            <span className="text-red-600" title="Spicy">🌶️</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          item.is_available === 1
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                        }`}>
                          {item.is_available === 1 ? 'Available' : 'Unavailable'}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
