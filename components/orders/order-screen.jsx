'use client'

import { useState, useEffect } from 'react'
import { Search, Plus, Minus, Trash2, Printer, UtensilsCrossed, Clock } from 'lucide-react'

export default function OrderScreen() {
  const [orderItems, setOrderItems] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filteredMenuItems, setFilteredMenuItems] = useState([])
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [discountType, setDiscountType] = useState('amount')
  const [tax] = useState(10)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [processing, setProcessing] = useState(false)
  const [tableNumber, setTableNumber] = useState('')
  const [orderType, setOrderType] = useState('dine-in')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  const categories = ['all', 'Appetizers', 'Soups', 'Salads', 'Main Course', 'Pasta & Rice', 'Desserts', 'Beverages', 'Specials']

  // Fetch menu items from API
  useEffect(() => {
    fetchMenuItems()
  }, [])

  const fetchMenuItems = async () => {
    try {
      const response = await fetch('/api/menu-items?available=true')
      const data = await response.json()
      if (data.success) {
        setMenuItems(data.menuItems)
        setFilteredMenuItems(data.menuItems.slice(0, 8))
      }
    } catch (error) {
      console.error('Error fetching menu items:', error)
    }
  }

  // Handle search input changes
  const handleSearchChange = (value) => {
    setSearchTerm(value)
    
    if (value.trim()) {
      const filtered = menuItems.filter(item =>
        item.name.toLowerCase().includes(value.toLowerCase()) ||
        item.item_code.toLowerCase().includes(value.toLowerCase()) ||
        item.category.toLowerCase().includes(value.toLowerCase())
      )
      setFilteredMenuItems(filtered)
      setShowSearchResults(true)
    } else {
      filterByCategory(selectedCategory)
      setShowSearchResults(false)
    }
  }

  const filterByCategory = (category) => {
    setSelectedCategory(category)
    if (category === 'all') {
      setFilteredMenuItems(menuItems.slice(0, 8))
    } else {
      const filtered = menuItems.filter(item => item.category === category)
      setFilteredMenuItems(filtered)
    }
  }

  // Select menu item from search results
  const selectMenuItemFromSearch = (item) => {
    addItem(item)
    setSearchTerm('')
    setShowSearchResults(false)
  }

  const addItem = (item) => {
    const existing = orderItems.find(orderItem => orderItem.id === item.id)
    if (existing) {
      setOrderItems(orderItems.map(orderItem =>
        orderItem.id === item.id ? { ...orderItem, quantity: orderItem.quantity + 1 } : orderItem
      ))
    } else {
      setOrderItems([...orderItems, { ...item, quantity: 1, special_instructions: '' }])
    }
  }

  const updateQuantity = (id, quantity) => {
    if (quantity <= 0) {
      setOrderItems(orderItems.filter(item => item.id !== id))
    } else {
      setOrderItems(orderItems.map(item =>
        item.id === id ? { ...item, quantity } : item
      ))
    }
  }

  const updateInstructions = (id, instructions) => {
    setOrderItems(orderItems.map(item =>
      item.id === id ? { ...item, special_instructions: instructions } : item
    ))
  }

  const removeItem = (id) => {
    setOrderItems(orderItems.filter(item => item.id !== id))
  }

  const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const discountAmount = discountType === 'amount' ? discount : (subtotal * discount) / 100
  const taxableAmount = subtotal - discountAmount
  const taxAmount = (taxableAmount * tax) / 100
  const total = taxableAmount + taxAmount

  const handlePlaceOrder = async () => {
    if (orderItems.length === 0) {
      alert('Please add items to the order')
      return
    }

    if (orderType === 'dine-in' && !tableNumber) {
      alert('Please enter a table number for dine-in orders')
      return
    }

    try {
      setProcessing(true)
      
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_number: orderType === 'dine-in' ? tableNumber : null,
          order_type: orderType,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          items: orderItems.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            special_instructions: item.special_instructions
          })),
          payment_method: paymentMethod,
          amount_paid: total,
          discount: discountAmount,
          tax: taxAmount,
          notes: orderNotes,
          status: 'pending'
        })
      })

      const data = await response.json()
      
      if (data.success) {
        alert(`Order placed successfully! Order #${data.order.order_number}`)
        // Reset form
        setOrderItems([])
        setDiscount(0)
        setSearchTerm('')
        setTableNumber('')
        setCustomerName('')
        setCustomerPhone('')
        setOrderNotes('')
      } else {
        alert(data.error || 'Failed to place order')
      }
    } catch (error) {
      console.error('Error placing order:', error)
      alert('Failed to place order')
    } finally {
      setProcessing(false)
    }
  }

  const estimatedTime = orderItems.reduce((total, item) => 
    Math.max(total, item.preparation_time * item.quantity), 0
  )

  return (
    <div className="p-4 sm:p-8">
      <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 flex items-center gap-2">
        <UtensilsCrossed className="text-primary" />
        Order Management
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Left side - Menu Selection */}
        <div className="space-y-4">
          {/* Order Type & Table/Customer Info */}
          <div className="pos-stat-card">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Order Type</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input text-sm"
                >
                  <option value="dine-in">Dine-In</option>
                  <option value="takeaway">Takeaway</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>
              {orderType === 'dine-in' && (
                <div>
                  <label className="block text-xs font-semibold mb-1">Table Number *</label>
                  <input
                    type="text"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-input text-sm"
                    placeholder="e.g., T-05"
                  />
                </div>
              )}
              {orderType !== 'dine-in' && (
                <div>
                  <label className="block text-xs font-semibold mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-input text-sm"
                    placeholder="Customer name"
                  />
                </div>
              )}
            </div>
            {orderType !== 'dine-in' && (
              <div>
                <label className="block text-xs font-semibold mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-input text-sm"
                  placeholder="Contact number"
                />
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={20} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filteredMenuItems.length === 1) {
                  selectMenuItemFromSearch(filteredMenuItems[0])
                }
                if (e.key === 'Escape') {
                  setSearchTerm('')
                  setShowSearchResults(false)
                  filterByCategory(selectedCategory)
                }
              }}
              className="w-full pl-10 pr-4 py-3 border border-border rounded-lg bg-input text-lg"
              autoFocus
            />
            
            {/* Search Results Dropdown */}
            {showSearchResults && filteredMenuItems.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-card border border-border rounded-lg shadow-lg z-50 mt-1 max-h-80 overflow-y-auto">
                {filteredMenuItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => selectMenuItemFromSearch(item)}
                    disabled={item.is_available !== 1}
                    className="w-full text-left px-4 py-3 hover:bg-muted border-b border-border last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-bold text-foreground">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.category}</div>
                      </div>
                      <div className="text-sm text-primary font-bold">Rs {item.price}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => {
                  filterByCategory(cat)
                  setShowSearchResults(false)
                }}
                className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* Menu Grid */}
          <div className="pos-stat-card max-h-96 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(!showSearchResults ? filteredMenuItems : []).map(item => (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  disabled={item.is_available !== 1}
                  className="p-4 border border-border rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="font-bold text-foreground">{item.name}</div>
                  <div className="text-xs text-muted-foreground mb-1">{item.category}</div>
                  <div className="flex justify-between items-center">
                    <div className="text-sm text-primary font-bold">Rs {item.price}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock size={12} />
                      {item.preparation_time}m
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right side - Order Summary */}
        <div className="relative" style={{ height: '700px' }}>
          <div className="pos-stat-card border-2 border-primary absolute inset-0 flex flex-col">
            <h3 className="text-xl font-bold mb-4">Current Order</h3>

            {/* Order Items - FIXED HEIGHT with scroll */}
            <div 
              className="bg-muted/30 rounded border border-border p-4 overflow-y-scroll space-y-3"
              style={{ height: '320px' }}
            >
              {orderItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No items added</p>
              ) : (
                orderItems.map(item => (
                  <div key={item.id} className="bg-card p-3 rounded border border-border">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-sm flex-1 mr-2">{item.name}</div>
                      <button onClick={() => removeItem(item.id)} className="text-destructive">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex justify-between items-center gap-2 mb-2">
                      <div className="text-xs text-muted-foreground">Rs {item.price}</div>
                      <div className="flex gap-1 items-center">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-7 h-7 flex items-center justify-center text-xs bg-border rounded hover:bg-primary/20"
                        >
                          <Minus size={12} />
                        </button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value))}
                          className="w-10 text-center text-xs bg-input border border-border rounded"
                        />
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-7 h-7 flex items-center justify-center text-xs bg-border rounded hover:bg-primary/20"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={item.special_instructions || ''}
                      onChange={(e) => updateInstructions(item.id, e.target.value)}
                      placeholder="Special instructions..."
                      className="w-full px-2 py-1 text-xs border border-border rounded bg-input"
                    />
                    <div className="mt-1 text-right text-sm font-bold">
                      Rs {(item.price * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Totals and Payment */}
            {orderItems.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="space-y-2 text-sm border-t border-border pt-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span className="font-bold">Rs {subtotal.toFixed(2)}</span>
                  </div>

                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-muted-foreground">Discount:</span>
                    <input
                      type="number"
                      value={discount}
                      onChange={(e) => setDiscount(parseFloat(e.target.value))}
                      className="flex-1 px-2 py-1 border border-border rounded bg-input text-xs"
                      placeholder="0"
                    />
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value)}
                      className="px-2 py-1 border border-border rounded bg-input text-xs"
                    >
                      <option value="amount">Rs</option>
                      <option value="percent">%</option>
                    </select>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax ({tax}%):</span>
                    <span>Rs {taxAmount.toFixed(2)}</span>
                  </div>

                  <div className="border-t border-border pt-2 flex justify-between text-lg font-bold text-primary">
                    <span>Total:</span>
                    <span>Rs {total.toFixed(2)}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock size={14} />
                    <span>Est. Time: {estimatedTime} min</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded bg-input text-sm font-semibold"
                  >
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                    <option value="pending">Pending Payment</option>
                  </select>

                  <button 
                    onClick={handlePlaceOrder}
                    disabled={processing}
                    className="w-full bg-green-600 dark:bg-green-700 text-white py-3 rounded-lg font-bold hover:bg-green-700 dark:hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? 'Processing...' : 'Place Order'}
                  </button>

                  <button className="w-full flex items-center justify-center gap-2 border border-border py-2 rounded-lg hover:bg-muted transition-colors font-semibold text-sm">
                    <Printer size={16} />
                    Print KOT
                  </button>

                  <button
                    onClick={() => {
                      if (confirm('Clear all items?')) {
                        setOrderItems([])
                        setDiscount(0)
                      }
                    }}
                    className="w-full text-destructive border border-destructive py-2 rounded-lg hover:bg-destructive/10 transition-colors font-semibold text-sm"
                  >
                    Clear Order
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
