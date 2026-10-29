'use client'

import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Phone, User, MapPin, ShoppingBag, DollarSign, Search, Calendar } from 'lucide-react'
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils'

export default function CustomerManagement() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerTransactions, setCustomerTransactions] = useState([])

  const [formData, setFormData] = useState({
    phone: '',
    name: '',
    age: '',
    address: ''
  })

  // Credit payment state
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [creditPayments, setCreditPayments] = useState([])

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/customers')
      const data = await response.json()
      if (data.success) {
        setCustomers(data.customers || [])
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCustomerTransactions = async (customerId) => {
    try {
      const response = await fetch(`/api/transactions?customer_id=${customerId}`)
      const data = await response.json()
      if (data.success) {
        setCustomerTransactions(data.transactions || [])
      }
    } catch (error) {
      console.error('Error fetching customer transactions:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      const url = editingCustomer ? '/api/customers' : '/api/customers'
      const method = editingCustomer ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingCustomer ? { ...formData, id: editingCustomer.id } : formData)
      })

      const data = await response.json()
      
      if (data.success) {
        alert(`✅ Customer ${editingCustomer ? 'updated' : 'added'} successfully`)
        setShowForm(false)
        setEditingCustomer(null)
        setFormData({ phone: '', name: '', age: '', address: '' })
        fetchCustomers()
      } else {
        alert(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`)
    }
  }

  const handleEdit = (customer) => {
    setEditingCustomer(customer)
    setFormData({
      phone: customer.phone,
      name: customer.name,
      age: customer.age || '',
      address: customer.address || ''
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this customer?')) return

    try {
      const response = await fetch(`/api/customers?id=${id}`, { method: 'DELETE' })
      const data = await response.json()
      
      if (data.success) {
        alert('✅ Customer deleted successfully')
        fetchCustomers()
      } else {
        alert('❌ Error: ' + data.error)
      }
    } catch (error) {
      alert('❌ Error deleting customer')
    }
  }

  const handleViewDetails = async (customer) => {
    setSelectedCustomer(customer)
    fetchCustomerTransactions(customer.id)
    
    // Fetch credit payments
    try {
      const response = await fetch(`/api/credit-payments?customer_id=${customer.id}`)
      const data = await response.json()
      if (data.success) {
        setCreditPayments(data.payments || [])
      }
    } catch (error) {
      console.error('Error fetching credit payments:', error)
    }
  }

  const handleCreditPayment = async (e) => {
    e.preventDefault()
    
    if (!selectedCustomer) return

    try {
      const response = await fetch('/api/credit-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          amount: parseFloat(paymentAmount),
          payment_method: paymentMethod,
          notes: paymentNotes
        })
      })

      const data = await response.json()
      
      if (data.success) {
        alert(`✅ ${data.message}`)
        setShowPaymentForm(false)
        setPaymentAmount('')
        setPaymentNotes('')
        // Update customer in local state
        setCustomers(customers.map(c => 
          c.id === selectedCustomer.id ? data.customer : c
        ))
        setSelectedCustomer(data.customer)
        // Refresh credit payments
        const paymentsResponse = await fetch(`/api/credit-payments?customer_id=${selectedCustomer.id}`)
        const paymentsData = await paymentsResponse.json()
        if (paymentsData.success) {
          setCreditPayments(paymentsData.payments || [])
        }
      } else {
        alert(`❌ Error: ${data.error}`)
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`)
    }
  }

  const filteredCustomers = customers.filter(c => 
    c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone?.includes(searchTerm)
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Customer Management</h2>
          <p className="text-muted-foreground mt-1">Manage customer information and purchase history</p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm)
            setEditingCustomer(null)
            setFormData({ phone: '', name: '', age: '', address: '' })
          }}
          className="pos-button-primary px-6 py-3 rounded-lg font-semibold flex items-center gap-2"
        >
          <Plus size={20} />
          Add Customer
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="pos-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-lg">
              <User className="text-primary" size={24} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Customers</p>
              <h3 className="text-2xl font-bold">{customers.length}</h3>
            </div>
          </div>
        </div>

        <div className="pos-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <ShoppingBag className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Purchases</p>
              <h3 className="text-2xl font-bold">
                {customers.reduce((sum, c) => sum + (c.total_purchases || 0), 0)}
              </h3>
            </div>
          </div>
        </div>

        <div className="pos-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <DollarSign className="text-blue-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <h3 className="text-2xl font-bold">
                Rs {customers.reduce((sum, c) => sum + (c.total_spent || 0), 0).toFixed(2)}
              </h3>
            </div>
          </div>
        </div>

        <div className="pos-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 rounded-lg">
              <DollarSign className="text-amber-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Credit</p>
              <h3 className="text-2xl font-bold">
                Rs {customers.reduce((sum, c) => sum + (c.credit_balance || 0), 0).toFixed(2)}
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="pos-stat-card">
          <h3 className="text-xl font-bold mb-4">{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Phone Number *</label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-input"
                placeholder="98XXXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Full Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-input"
                placeholder="Customer name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Age</label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-input"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-input"
                placeholder="Customer address"
              />
            </div>

            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="pos-button-primary px-6 py-2 rounded-lg font-semibold">
                {editingCustomer ? 'Update Customer' : 'Add Customer'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setEditingCustomer(null)
                  setFormData({ phone: '', name: '', age: '', address: '' })
                }}
                className="px-6 py-2 border border-border rounded-lg font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="pos-stat-card">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-border rounded-lg bg-input"
          />
        </div>
      </div>

      {/* Customer List */}
      <div className="pos-stat-card">
        {loading ? (
          <p className="text-center py-8 text-muted-foreground">Loading customers...</p>
        ) : filteredCustomers.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No customers found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground font-semibold">
                  <th className="text-left py-3 px-4">Name</th>
                  <th className="text-left py-3 px-4">Phone</th>
                  <th className="text-left py-3 px-4">Address</th>
                  <th className="text-right py-3 px-4">Purchases</th>
                  <th className="text-right py-3 px-4">Total Spent</th>
                  <th className="text-right py-3 px-4">Credit</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map(customer => (
                  <tr key={customer.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-semibold">{customer.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-muted-foreground" />
                        {customer.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{customer.address || 'N/A'}</td>
                    <td className="py-3 px-4 text-right">{customer.total_purchases || 0}</td>
                    <td className="py-3 px-4 text-right font-bold text-green-600">
                      Rs {(customer.total_spent || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {customer.credit_balance > 0 ? (
                        <span className="font-bold text-red-600 dark:text-red-400">
                          Rs {(customer.credit_balance || 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className="font-bold text-green-600 dark:text-green-400">Rs 0.00</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleViewDetails(customer)}
                          className="text-primary hover:bg-primary/10 p-2 rounded transition-colors"
                          title="View Details"
                        >
                          <ShoppingBag size={16} />
                        </button>
                        {customer.credit_balance > 0 && (
                          <button
                            onClick={() => {
                              setSelectedCustomer(customer)
                              setShowPaymentForm(true)
                              setPaymentAmount(customer.credit_balance.toString())
                              fetchCustomerTransactions(customer.id)
                            }}
                            className="text-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/20 p-2 rounded transition-colors"
                            title="Add Payment"
                          >
                            <DollarSign size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(customer)}
                          className="text-secondary hover:bg-secondary/10 p-2 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(customer.id)}
                          className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors"
                          title="Delete"
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

      {/* Customer Details Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center sticky top-0">
              <h3 className="text-lg font-semibold">Customer Details</h3>
              <button onClick={() => setSelectedCustomer(null)} className="hover:bg-primary-foreground/20 p-1 rounded text-2xl">×</button>
            </div>

            <div className="p-6 space-y-6">
              {/* Customer Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-bold">{selectedCustomer.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-bold">{selectedCustomer.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Purchases</p>
                  <p className="font-bold">{selectedCustomer.total_purchases || 0}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Spent</p>
                  <p className="font-bold text-green-600">Rs {(selectedCustomer.total_spent || 0).toFixed(2)}</p>
                </div>
              </div>

              {/* Credit Balance Section */}
              {selectedCustomer.credit_balance > 0 && (
                <div className="bg-orange-50 dark:bg-orange-950/20 border-2 border-orange-300 dark:border-orange-800 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Outstanding Credit Balance</p>
                      <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                        Rs {(selectedCustomer.credit_balance || 0).toFixed(2)}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setShowPaymentForm(!showPaymentForm)
                        setPaymentAmount(selectedCustomer.credit_balance.toString())
                      }}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      {showPaymentForm ? 'Cancel' : 'Add Payment'}
                    </button>
                  </div>

                  {/* Payment Form */}
                  {showPaymentForm && (
                    <form onSubmit={handleCreditPayment} className="mt-4 pt-4 border-t border-orange-300 dark:border-orange-800 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold mb-1">Payment Amount (Rs) *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            max={selectedCustomer.credit_balance}
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            className="w-full px-3 py-2 border border-orange-300 dark:border-orange-700 rounded-lg bg-input"
                            placeholder="0.00"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Max: Rs {selectedCustomer.credit_balance.toFixed(2)}
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-semibold mb-1">Payment Method *</label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                          >
                            <option value="cash">Cash</option>
                            <option value="online">Online</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold mb-1">Notes (Optional)</label>
                        <textarea
                          value={paymentNotes}
                          onChange={(e) => setPaymentNotes(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded-lg bg-input"
                          rows="2"
                          placeholder="Add payment notes..."
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-semibold transition-colors"
                      >
                        Record Payment
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Credit Payment History */}
              {creditPayments.length > 0 && (
                <div>
                  <h4 className="text-xl font-bold mb-4">Credit Payment History</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/50">
                        <tr className="text-muted-foreground">
                          <th className="text-left py-2 px-3">Date</th>
                          <th className="text-right py-2 px-3">Amount Paid</th>
                          <th className="text-left py-2 px-3">Method</th>
                          <th className="text-left py-2 px-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditPayments.map(payment => (
                          <tr key={payment.id} className="border-b border-border">
                            <td className="py-2 px-3">{formatNepalTime(payment.created_at)}</td>
                            <td className="py-2 px-3 text-right font-bold text-green-600">
                              Rs {parseFloat(payment.amount || 0).toFixed(2)}
                            </td>
                            <td className="py-2 px-3">{String(payment.payment_method || 'cash').toLowerCase() === 'cash' ? 'Cash' : 'Online'}</td>
                            <td className="py-2 px-3 text-muted-foreground">{payment.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Purchase History */}
              <div>
                <h4 className="text-xl font-bold mb-4">Purchase History</h4>
                {customerTransactions.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No purchase history</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/50">
                        <tr className="text-muted-foreground">
                          <th className="text-left py-2 px-3">Date</th>
                          <th className="text-left py-2 px-3">Transaction #</th>
                          <th className="text-right py-2 px-3">Amount</th>
                          <th className="text-left py-2 px-3">Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerTransactions.map(txn => (
                          <tr key={txn.id} className="border-b border-border">
                            <td className="py-2 px-3">{formatNepalDate(txn.created_at)}</td>
                            <td className="py-2 px-3 font-mono text-xs">#{txn.transaction_number}</td>
                            <td className="py-2 px-3 text-right font-bold">Rs {parseFloat(txn.final_total || 0).toFixed(2)}</td>
                            <td className="py-2 px-3">{String(txn.payment_method || 'cash').toLowerCase() === 'cash' ? 'Cash' : String(txn.payment_method).toLowerCase() === 'credit' ? 'Credit' : 'Online'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
