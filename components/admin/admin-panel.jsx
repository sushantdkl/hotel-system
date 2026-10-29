'use client'

import { useState, useEffect, useCallback } from 'react'
import { Store, TrendingUp, Users, DollarSign, Plus, Search, Filter, Edit, Trash2, Eye, RefreshCw, Moon, Sun } from 'lucide-react'

export default function AdminPanel() {
  const [stats, setStats] = useState(null)
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddShop, setShowAddShop] = useState(false)
  const [showEditShop, setShowEditShop] = useState(false)
  const [editingShop, setEditingShop] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentView, setCurrentView] = useState('dashboard') // dashboard, products, shops
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('adminTheme') || 'light'
    setTheme(savedTheme)
    document.documentElement.classList.toggle('dark', savedTheme === 'dark')
  }, [])

  useEffect(() => {
    fetchDashboard()
    fetchShops()
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('adminTheme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  const fetchDashboard = async () => {
    try {
      const response = await fetch('/api/admin/dashboard')
      const data = await response.json()
      if (data.success) {
        setStats(data)
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error)
    }
  }

  const fetchShops = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/shops')
      const data = await response.json()
      if (data.success) {
        setShops(data.shops)
      }
    } catch (error) {
      console.error('Error fetching shops:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredShops = shops.filter(shop => 
    shop.shop_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    shop.owner_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    shop.city?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleEditShop = (shop) => {
    setEditingShop(shop)
    setShowEditShop(true)
  }

  const handleDeleteShop = async (shopId) => {
    if (!confirm('Are you sure you want to delete this shop? This action cannot be undone.')) return

    try {
      const response = await fetch(`/api/admin/shops?id=${shopId}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      if (data.success) {
        alert('✅ Shop deleted successfully')
        fetchShops()
      } else {
        alert('❌ Error: ' + data.error)
      }
    } catch (error) {
      alert('❌ Error deleting shop')
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header with Navigation */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Admin Control Panel</h1>
          <p className="text-muted-foreground">Manage all shops across Nepal</p>
        </div>
        <button
          onClick={toggleTheme}
          className="p-3 rounded-lg border border-border hover:bg-muted transition-colors"
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </div>

      <div>
        <div>
          
          {/* View Tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'dashboard' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setCurrentView('shops')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'shops' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              All Shops
            </button>
            <button
              onClick={() => setCurrentView('products')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'products' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              All Products
            </button>
          </div>
        </div>
        {currentView === 'shops' && (
          <button
            onClick={() => setShowAddShop(true)}
            className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold flex items-center gap-2 hover:bg-primary/90"
          >
            <Plus size={20} />
            Add New Shop
          </button>
        )}
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="pos-stat-card border-l-4 border-primary">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Total Shops</p>
              <Store className="text-primary" size={24} />
            </div>
            <h3 className="text-3xl font-bold">{stats.stats.totalShops}</h3>
            <p className="text-xs text-green-600 mt-1">{stats.stats.activeShops} active</p>
          </div>

          <div className="pos-stat-card border-l-4 border-green-500">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Revenue (This Month)</p>
              <DollarSign className="text-green-500" size={24} />
            </div>
            <h3 className="text-3xl font-bold text-green-600">
              Rs {stats.stats.revenueThisMonth.toFixed(2)}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">From subscriptions</p>
          </div>

          <div className="pos-stat-card border-l-4 border-blue-500">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Total Sales</p>
              <TrendingUp className="text-blue-500" size={24} />
            </div>
            <h3 className="text-3xl font-bold text-blue-600">
              Rs {stats.stats.salesThisMonth.toFixed(2)}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">Across all shops</p>
          </div>

          <div className="pos-stat-card border-l-4 border-purple-500">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Transactions</p>
              <Users className="text-purple-500" size={24} />
            </div>
            <h3 className="text-3xl font-bold">{stats.stats.transactionsThisMonth}</h3>
            <p className="text-xs text-muted-foreground mt-1">This month</p>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {currentView === 'dashboard' && stats && stats.topShops && (
        <div className="pos-stat-card">
          <h3 className="text-xl font-bold mb-4">Top Performing Shops</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-muted-foreground">
                  <th className="text-left py-3 px-4">Rank</th>
                  <th className="text-left py-3 px-4">Shop Name</th>
                  <th className="text-left py-3 px-4">City</th>
                  <th className="text-right py-3 px-4">Sales</th>
                  <th className="text-right py-3 px-4">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {stats.topShops.map((shop, index) => (
                  <tr key={shop.id} className="border-b border-border hover:bg-muted/30">
                    <td className="py-3 px-4 font-bold text-primary">#{index + 1}</td>
                    <td className="py-3 px-4 font-semibold">{shop.shop_name}</td>
                    <td className="py-3 px-4">{shop.city || 'N/A'}</td>
                    <td className="py-3 px-4 text-right font-bold text-green-600">
                      Rs {shop.total_sales.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right">{shop.transaction_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shops List View */}
      {currentView === 'shops' && (
        <div className="pos-stat-card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">All Shops</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input
                  type="text"
                  placeholder="Search shops..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-border rounded-lg bg-input"
                />
              </div>
              <button
                onClick={fetchShops}
                className="px-4 py-2 border border-border rounded-lg hover:bg-muted"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>

        {loading ? (
          <p className="text-center py-8 text-muted-foreground">Loading shops...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground">
                  <th className="text-left py-3 px-4">Shop ID</th>
                  <th className="text-left py-3 px-4">Shop Name</th>
                  <th className="text-left py-3 px-4">Owner</th>
                  <th className="text-left py-3 px-4">Location</th>
                  <th className="text-center py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Monthly Fee</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShops.map(shop => (
                  <tr key={shop.id} className="border-b border-border hover:bg-muted/30">
                    <td className="py-3 px-4 font-mono text-xs">{shop.id}</td>
                    <td className="py-3 px-4 font-semibold">{shop.shop_name}</td>
                    <td className="py-3 px-4">{shop.owner_name}</td>
                    <td className="py-3 px-4">{shop.city}, {shop.district}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        shop.subscription_status === 'active' ? 'bg-green-500/20 text-green-600' :
                        shop.subscription_status === 'trial' ? 'bg-blue-500/20 text-blue-600' :
                        'bg-red-500/20 text-red-600'
                      }`}>
                        {shop.subscription_status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold">Rs {shop.monthly_fee}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-2">
                        <button 
                          onClick={() => handleEditShop(shop)}
                          className="p-1 hover:bg-muted rounded"
                          title="Edit Shop"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteShop(shop.id)}
                          className="p-1 hover:bg-muted rounded text-destructive"
                          title="Delete Shop"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}

      {/* Products View */}
      {currentView === 'products' && <AllProductsView shops={shops} />}

      {/* Modals */}
      {showAddShop && <AddShopModal onClose={() => setShowAddShop(false)} onSuccess={fetchShops} />}
      {showEditShop && <EditShopModal shop={editingShop} onClose={() => setShowEditShop(false)} onSuccess={fetchShops} />}
    </div>
  )
}

function AddShopModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    shopName: '',
    ownerName: '',
    ownerPhone: '',
    ownerEmail: '',
    address: '',
    city: '',
    district: '',
    province: '',
    subscriptionPlan: 'basic',
    username: '',
    password: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/admin/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      const data = await response.json()
      
      if (data.success) {
        alert(`✅ ${data.shop.message}`)
        onSuccess()
        onClose()
      } else {
        alert(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Add New Shop</h3>
          <button onClick={onClose} className="hover:bg-primary-foreground/20 p-1 rounded">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Shop Name *</label>
              <input
                type="text"
                required
                value={formData.shopName}
                onChange={(e) => setFormData({...formData, shopName: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-1">Owner Name *</label>
              <input
                type="text"
                required
                value={formData.ownerName}
                onChange={(e) => setFormData({...formData, ownerName: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={formData.ownerPhone}
                onChange={(e) => setFormData({...formData, ownerPhone: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                placeholder="+977-XXX-XXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Email</label>
              <input
                type="email"
                value={formData.ownerEmail}
                onChange={(e) => setFormData({...formData, ownerEmail: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">City *</label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({...formData, city: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">District</label>
              <input
                type="text"
                value={formData.district}
                onChange={(e) => setFormData({...formData, district: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Province</label>
              <select
                value={formData.province}
                onChange={(e) => setFormData({...formData, province: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              >
                <option value="">Select Province</option>
                <option value="Province 1">Province 1</option>
                <option value="Madhesh">Madhesh</option>
                <option value="Bagmati">Bagmati</option>
                <option value="Gandaki">Gandaki</option>
                <option value="Lumbini">Lumbini</option>
                <option value="Karnali">Karnali</option>
                <option value="Sudurpashchim">Sudurpashchim</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Subscription Plan *</label>
              <select
                value={formData.subscriptionPlan}
                onChange={(e) => setFormData({...formData, subscriptionPlan: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              >
                <option value="basic">Basic - Rs 1,500/month</option>
                <option value="premium">Premium - Rs 3,000/month</option>
                <option value="enterprise">Enterprise - Rs 5,000/month</option>
              </select>
            </div>
          </div>

          {/* Shop Login Credentials */}
          <div className="border-t pt-4 mt-4">
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground">Shop Login Credentials</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  placeholder="shop_username"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  placeholder="Minimum 6 characters"
                  required
                  minLength="6"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">⚠️ Save these credentials - shop will need them to login</p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-primary/90"
            >
              Create Shop
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 border border-border py-3 rounded-lg font-semibold hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Edit Shop Modal
function EditShopModal({ shop, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    shopName: shop?.shop_name || '',
    ownerName: shop?.owner_name || '',
    ownerPhone: shop?.owner_phone || '',
    ownerEmail: shop?.owner_email || '',
    address: shop?.address || '',
    city: shop?.city || '',
    district: shop?.district || '',
    province: shop?.province || '',
    subscriptionPlan: shop?.subscription_plan || 'basic',
    username: shop?.username || '',
    password: '' // Leave blank to keep existing
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const updateData = {
        shopId: shop.id,
        shop_name: formData.shopName,
        owner_name: formData.ownerName,
        owner_phone: formData.ownerPhone,
        owner_email: formData.ownerEmail,
        address: formData.address,
        city: formData.city,
        district: formData.district,
        province: formData.province,
        subscription_plan: formData.subscriptionPlan,
        username: formData.username
      }

      // Only include password if changed
      if (formData.password) {
        updateData.password = formData.password
      }

      const response = await fetch('/api/admin/shops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      const data = await response.json()
      
      if (data.success) {
        alert('✅ Shop updated successfully')
        onSuccess()
        onClose()
      } else {
        alert(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Edit Shop</h3>
          <button onClick={onClose} className="hover:bg-primary-foreground/20 p-1 rounded text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Shop Name *</label>
              <input
                type="text"
                required
                value={formData.shopName}
                onChange={(e) => setFormData({...formData, shopName: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-1">Owner Name *</label>
              <input
                type="text"
                required
                value={formData.ownerName}
                onChange={(e) => setFormData({...formData, ownerName: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={formData.ownerPhone}
                onChange={(e) => setFormData({...formData, ownerPhone: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Email</label>
              <input
                type="email"
                value={formData.ownerEmail}
                onChange={(e) => setFormData({...formData, ownerEmail: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">City *</label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({...formData, city: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">District</label>
              <input
                type="text"
                value={formData.district}
                onChange={(e) => setFormData({...formData, district: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Province</label>
              <select
                value={formData.province}
                onChange={(e) => setFormData({...formData, province: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              >
                <option value="">Select Province</option>
                <option value="Province 1">Province 1</option>
                <option value="Madhesh">Madhesh</option>
                <option value="Bagmati">Bagmati</option>
                <option value="Gandaki">Gandaki</option>
                <option value="Lumbini">Lumbini</option>
                <option value="Karnali">Karnali</option>
                <option value="Sudurpashchim">Sudurpashchim</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Subscription Plan *</label>
              <select
                value={formData.subscriptionPlan}
                onChange={(e) => setFormData({...formData, subscriptionPlan: e.target.value})}
                className="w-full px-3 py-2 border border-border rounded-lg bg-input"
              >
                <option value="basic">Basic - Rs 1,500/month</option>
                <option value="premium">Premium - Rs 3,000/month</option>
                <option value="enterprise">Enterprise - Rs 5,000/month</option>
              </select>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground">Update Login Credentials (Optional)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">New Password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                  placeholder="Leave blank to keep existing"
                  minLength="6"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-primary/90"
            >
              Update Shop
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 border border-border py-3 rounded-lg font-semibold hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// All Products View
function AllProductsView({ shops }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Memoised and declared before the effect that runs it: as a plain arrow
  // below, it was read before its own declaration and rebuilt every render.
  const fetchAllProducts = useCallback(async () => {
    setLoading(true)
    const allProducts = []
    
    for (const shop of shops) {
      try {
        const response = await fetch('/api/admin/products?shopId=' + shop.id)
        const data = await response.json()
        if (data.success && data.products) {
          allProducts.push(...data.products.map(p => ({ ...p, shop_name: shop.shop_name, shop_id: shop.id })))
        }
      } catch (error) {
        console.error(`Error fetching products for ${shop.shop_name}:`, error)
      }
    }
    
    setProducts(allProducts)
    setLoading(false)
  }, [shops])

  useEffect(() => {
    let cancelled = false
    ;(async () => { if (!cancelled) await fetchAllProducts() })()
    return () => { cancelled = true }
  }, [fetchAllProducts])

  const filteredProducts = products.filter(p => 
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.barcode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.shop_name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="pos-stat-card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold">All Products Across All Shops</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-border rounded-lg bg-input"
            />
          </div>
          <button
            onClick={fetchAllProducts}
            className="px-4 py-2 border border-border rounded-lg hover:bg-muted"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center py-8 text-muted-foreground">Loading products...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-muted-foreground">
                <th className="text-left py-3 px-4">Shop</th>
                <th className="text-left py-3 px-4">Product Name</th>
                <th className="text-left py-3 px-4">Barcode</th>
                <th className="text-left py-3 px-4">Category</th>
                <th className="text-right py-3 px-4">Price</th>
                <th className="text-right py-3 px-4">Stock</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product, index) => (
                <tr key={`${product.shop_id}-${product.id}-${index}`} className="border-b border-border hover:bg-muted/30">
                  <td className="py-3 px-4 font-semibold text-primary">{product.shop_name}</td>
                  <td className="py-3 px-4">{product.name}</td>
                  <td className="py-3 px-4 font-mono text-xs">{product.barcode}</td>
                  <td className="py-3 px-4">{product.category}</td>
                  <td className="py-3 px-4 text-right font-bold">Rs {product.price}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={product.stock < product.min_stock ? 'text-destructive font-bold' : ''}>
                      {product.stock}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-muted-foreground">
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
