'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Plus, Minus, Search, ShoppingCart, Send, X } from 'lucide-react'
import QtyInput from '@/components/ui/qty-input'
import { useToast } from '@/components/ui/toast'
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message'
import MenuItemImage from '@/components/menu-item-image'
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function NewOrderContent() {
  const { apiCall } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()

  const [menuItems, setMenuItems] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [tables, setTables] = useState([])
  const [showTableDialog, setShowTableDialog] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [orderType, setOrderType] = useState(() => (searchParams.get('type') === 'takeaway' ? 'takeaway' : 'dine-in'))
  const [customerSelection, setCustomerSelection] = useState(emptyCustomerSelection)
  const [submitting, setSubmitting] = useState(false)
  const [existingOrderId, setExistingOrderId] = useState(null)
  const [existingReopened, setExistingReopened] = useState(false)
  const [kotNote, setKotNote] = useState('')
  const [pulseId, setPulseId] = useState(null)
  const [variantPicker, setVariantPicker] = useState(null) // menu item with variants, awaiting a pick
  const pulseTimer = useRef(null)

  useEffect(() => {
    fetchMenuAndTables()
    const tableId = searchParams.get('table')
    const orderId = searchParams.get('order')
    if (tableId) fetchTableDetails(tableId)
    if (orderId) {
      setExistingOrderId(orderId)
      fetchExistingOrder(orderId)
    }
  }, [])

  const fetchMenuAndTables = async () => {
    try {
      const [menuRes, tablesRes] = await Promise.all([
        apiCall('/api/restaurant/menu'),
        apiCall('/api/restaurant/tables?status=available'),
      ])
      if (menuRes.ok) {
        const data = await menuRes.json()
        setMenuItems(data.items || [])
        const cats = [...new Set((data.items || []).map((i) => i.category).filter(Boolean))]
        setCategories(cats)
      }
      if (tablesRes.ok) {
        const data = await tablesRes.json()
        setTables(data.tables || [])
      }
    } catch (e) {
      addToast(friendlyFromError(e, 'load_failed'))
    }
  }

  const fetchTableDetails = async (tableId) => {
    try {
      const res = await apiCall(`/api/restaurant/tables/${tableId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedTable(data.table)
        setOrderType('dine-in')
      }
    } catch {
      /* ignore */
    }
  }

  const fetchExistingOrder = async (orderId) => {
    try {
      const res = await apiCall(`/api/admin/pos/orders/${orderId}`)
      if (res.ok) {
        const data = await res.json()
        const order = data.workspace?.order
        if (!order) return
        setExistingReopened(Boolean(data.workspace?.reopened))
        setOrderType(order.order_type?.includes('take') ? 'takeaway' : 'dine-in')
        if (order.table_id) await fetchTableDetails(order.table_id)
        if (order.customer_phone || order.customer_name) {
          setCustomerSelection({
            mode: 'customer',
            phone: String(order.customer_phone || '').replace(/\D/g, ''),
            name: order.customer_name || '',
            address: '',
            customer: null,
            isNew: false,
          })
        }
      }
    } catch {
      /* ignore */
    }
  }

  const availableItems = menuItems.filter((item) => {
    const available = item.is_available === 1 || item.is_available === true || item.is_available === '1'
    return available
  })

  const categoryCounts = availableItems.reduce((map, item) => {
    if (item.category) map.set(item.category, (map.get(item.category) || 0) + 1)
    return map
  }, new Map())

  const filteredItems = menuItems.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory
    const name = (item.item_name || item.name || '').toLowerCase()
    const matchesSearch = name.includes(searchQuery.toLowerCase())
    const available = item.is_available === 1 || item.is_available === true || item.is_available === '1'
    return matchesCategory && matchesSearch && available
  })

  const flash = (id) => {
    setPulseId(id)
    clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulseId(null), 280)
  }

  const addToCart = (item, variant = null) => {
    const itemId = item.item_id || item.id
    const variantName = variant?.variant_name || null
    const cartKey = `${itemId}::${variantName || ''}`
    const baseName = item.item_name || item.name
    const price = variant ? Number(variant.price ?? 0) : Number(item.price ?? 0)
    flash(itemId)
    setCart((prev) => {
      const existing = prev.find((i) => i.cart_key === cartKey)
      if (existing) {
        return prev.map((i) =>
          i.cart_key === cartKey ? { ...i, quantity: i.quantity + 1 } : i
        )
      }
      return [
        ...prev,
        {
          ...item,
          cart_key: cartKey,
          item_id: itemId,
          item_name: variantName ? `${baseName} (${variantName})` : baseName,
          variant_name: variantName,
          price,
          quantity: 1,
          special_instructions: '',
        },
      ]
    })
  }

  const updateQuantity = (cartKey, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.cart_key !== cartKey) return item
          const q = item.quantity + delta
          return q <= 0 ? null : { ...item, quantity: q }
        })
        .filter(Boolean)
    )
  }

  const pickItem = (item) => {
    if (Array.isArray(item.variants) && item.variants.length > 0) {
      setVariantPicker(item)
    } else {
      addToCart(item)
    }
  }

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0)
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const getQty = (id) => cart.filter((i) => (i.item_id || i.id) === id).reduce((s, i) => s + i.quantity, 0)

  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      addToast(friendlyMessage('empty_cart'))
      return
    }
    if (!existingOrderId) {
      if (orderType === 'dine-in' && !selectedTable) {
        setShowTableDialog(true)
        return
      }
      if (orderType === 'takeaway') {
        const check = validateCustomerSelection(customerSelection)
        if (!check.ok) {
          addToast({
            title: check.message || 'Customer details needed',
            description: 'Enter phone first. Existing customers load automatically; new numbers need a name.',
            variant: 'warning',
          })
          return
        }
      }
    }

    setSubmitting(true)
    try {
      const payloadItems = cart.map((item) => ({
        menu_item_id: item.item_id,
        quantity: item.quantity,
        price: item.price,
        variant_name: item.variant_name || null,
        special_instructions: item.special_instructions || null,
      }))

      let orderId = existingOrderId

      if (!orderId) {
        const customerCheck =
          orderType === 'takeaway' ? validateCustomerSelection(customerSelection) : { ok: true }
        const createRes = await apiCall('/api/admin/pos/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table_id: orderType === 'dine-in' ? (selectedTable.table_id || selectedTable.id) : null,
            order_type: orderType,
            customer_name: orderType === 'takeaway' ? customerCheck.name : null,
            customer_phone: orderType === 'takeaway' ? customerCheck.phone : null,
            notes: kotNote.trim() || null,
          }),
        })
        const createData = await createRes.json().catch(() => ({}))
        if (!createRes.ok) throw new Error(createData.error || 'Failed')
        orderId = createData.order_id
      }

      const itemsRes = await apiCall(`/api/admin/pos/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payloadItems }),
      })
      const itemsData = await itemsRes.json().catch(() => ({}))
      if (!itemsRes.ok) throw new Error(itemsData.error || 'Failed')

      if (existingReopened) {
        const kotRes = await apiCall(`/api/admin/pos/orders/${orderId}/kot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotency_key: uid(), order_notes: kotNote.trim() || undefined }),
        })
        const kotData = await kotRes.json().catch(() => ({}))
        if (kotRes.ok) {
          addToast(friendlyMessage('items_added', {
            description: `${kotData.kot?.kot_number || 'New KOT'} sent to kitchen. The revised bill can now go to the cashier.`,
          }))
          router.push(`/waiter/order/${orderId}`)
          return
        }
        addToast({
          title: 'Items saved; KOT still needed',
          description: kotData.error || 'Open the order and tap Send KOT.',
          variant: 'warning',
        })
        router.push(`/waiter/order/${orderId}`)
        return
      }

      // Normal additions remain unsent until the waiter confirms the kitchen ticket.
      addToast(friendlyMessage(existingOrderId ? 'items_added' : 'order_success', {
        description: 'Items saved. Open the order and tap Send KOT when ready for the kitchen.',
      }))
      router.push(`/waiter/order/${orderId}`)
    } catch (e) {
      addToast(friendlyFromError(e, 'order_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const renderCartPanel = (mobile) => (
    <div className={`flex flex-col min-h-0 ${mobile ? 'max-h-[85vh]' : 'h-[calc(100vh-8rem)]'}`}>
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Cart ({cartItemCount})
        </h2>
        {mobile && (
          <button type="button" onClick={() => setShowCart(false)} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <p className="text-center text-slate-400 py-12 text-sm">Tap a dish to add it</p>
        ) : (
          cart.map((item) => (
            <div key={item.cart_key} className="flex gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <MenuItemImage src={item.image_url} alt={item.item_name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 line-clamp-1">{item.item_name}</p>
                <p className="text-xs text-slate-500">Rs {item.price}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.cart_key, -1)}
                    className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <QtyInput value={item.quantity} onCommit={(q) => updateQuantity(item.cart_key, q - item.quantity)} />
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.cart_key, 1)}
                    className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm font-bold text-slate-900">
                Rs {(item.price * item.quantity).toFixed(0)}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 p-4 border-t border-slate-100 space-y-3 bg-white">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            KOT Note / Special Request
          </label>
          <textarea
            rows={2}
            value={kotNote}
            onChange={(e) => setKotNote(e.target.value)}
            placeholder="Less spicy, no onion, allergy: peanuts..."
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div className="flex justify-between text-lg font-bold text-slate-900">
          <span>Total</span>
          <span>Rs {cartTotal.toFixed(0)}</span>
        </div>
        <button
          type="button"
          disabled={submitting || cart.length === 0}
          onClick={handleSubmitOrder}
          className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
          {submitting ? 'Saving…' : existingReopened ? 'Add & send KOT' : existingOrderId ? 'Save items' : 'Save order'}
        </button>
        <p className="text-[11px] text-center text-slate-500">
          {existingReopened
            ? 'Reopened bill: this saves the items and immediately sends the new KOT.'
            : 'Items are saved unsent. Use Send KOT on the order screen to fire the kitchen.'}
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 truncate">
              {existingOrderId ? 'Add items' : 'New order'}
            </h1>
            <p className="text-xs text-slate-500 truncate">
              {selectedTable
                ? `Table ${selectedTable.table_number}`
                : existingOrderId
                  ? 'Adding to open order'
                  : orderType === 'takeaway'
                    ? 'Takeaway'
                    : 'Select a table'}
            </p>
          </div>
          {!existingOrderId && (
            <div className="flex rounded-xl bg-slate-100 p-0.5">
              {['dine-in', 'takeaway'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setOrderType(t)
                    if (t === 'takeaway') setCustomerSelection(emptyCustomerSelection)
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${
                    orderType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {t === 'dine-in' ? 'Dine in' : 'Takeaway'}
                </button>
              ))}
            </div>
          )}
        </div>

        {!existingOrderId && orderType === 'dine-in' && !selectedTable && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={() => setShowTableDialog(true)}
              className="w-full h-10 rounded-xl border border-dashed border-slate-300 text-sm font-medium text-slate-600"
            >
              Select table
            </button>
          </div>
        )}
        {!existingOrderId && orderType === 'takeaway' && (
          <div className="px-4 pb-3">
            <CustomerModePicker
              value={customerSelection}
              onChange={setCustomerSelection}
              compact
            />
          </div>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="min-w-0 lg:col-span-2 space-y-3 pb-28 lg:pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search menu…"
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-base sm:text-sm"
              />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  selectedCategory === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                All ({availableItems.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    selectedCategory === cat ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {cat} ({categoryCounts.get(cat) || 0})
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
              {filteredItems.map((item) => {
                const id = item.item_id || item.id
                const qty = getQty(id)
                const name = item.item_name || item.name
                const pulsing = pulseId === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickItem(item)}
                    className={`text-left rounded-xl bg-white border-2 overflow-hidden shadow-sm transition-transform duration-150 active:scale-[0.97] hover:border-slate-400 hover:shadow-md ${
                      pulsing ? 'ring-2 ring-slate-900' : ''
                    } ${qty > 0 ? 'border-slate-900' : 'border-slate-200'}`}
                  >
                    <div className="relative aspect-[4/3] sm:aspect-square bg-slate-100">
                      <MenuItemImage
                        src={item.image_url}
                        alt={name}
                        size="card"
                        className="!w-full !h-full !rounded-none object-cover"
                      />
                      {qty > 0 && (
                        <span className="absolute top-1.5 right-1.5 min-w-6 h-6 px-1.5 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shadow">
                          {qty}
                        </span>
                      )}
                      {item.stock_quantity != null && (
                        <span
                          className={`absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${
                            Number(item.stock_quantity) <= 0
                              ? 'bg-red-600'
                              : Number(item.stock_quantity) <= 5
                                ? 'bg-amber-500'
                                : 'bg-emerald-600'
                          }`}
                        >
                          {item.stock_quantity} {item.stock_unit || ''}
                        </span>
                      )}
                      {item.combo && <span className="absolute left-1.5 top-1.5 rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold text-white">COMBO</span>}
                    </div>
                    <div className="px-2 py-2 sm:px-2.5 sm:py-2.5">
                      <p className="font-semibold text-xs sm:text-sm text-slate-900 leading-snug line-clamp-2 min-h-[2.2em]">
                        {name}
                      </p>
                      {item.combo && <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-500">{item.combo.components.map((component) => `${component.quantity}× ${component.name}${component.variant_name ? ` (${component.variant_name})` : ''}`).join(' · ')}</p>}
                      {item.variants?.length > 0 ? (
                        <p className="mt-1 text-xs sm:text-sm font-bold text-blue-600">{item.variants.length} options</p>
                      ) : (
                        <p className="mt-1 text-xs sm:text-sm font-bold text-blue-600">Rs {item.price}</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
            {filteredItems.length === 0 && (
              <p className="text-center text-slate-400 py-16">No menu items found</p>
            )}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              {renderCartPanel(false)}
            </div>
          </div>
        </div>
      </div>

      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold flex items-center justify-between px-4"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              {cartItemCount} items
            </span>
            <span>Rs {cartTotal.toFixed(0)}</span>
          </button>
        </div>
      )}

      {showCart && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40 flex items-end" onClick={(e) => e.target === e.currentTarget && setShowCart(false)}>
          <div className="w-full max-h-[85vh] bg-white rounded-t-3xl overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)] md:mx-auto md:max-w-xl">
            {renderCartPanel(true)}
          </div>
        </div>
      )}

      {variantPicker && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">{variantPicker.item_name || variantPicker.name}</h3>
              <button type="button" onClick={() => setVariantPicker(null)} className="p-1 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-3">Choose an option</p>
            <div className="space-y-2">
              {variantPicker.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => { addToCart(variantPicker, variant); setVariantPicker(null) }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 hover:border-slate-900 active:scale-[0.98] transition-transform"
                >
                  <span className="font-medium text-slate-900">{variant.variant_name}</span>
                  <span className="flex items-center gap-2">
                    {variant.pos_stock_quantity != null && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${Number(variant.pos_stock_quantity) <= 0 ? 'bg-red-600' : Number(variant.pos_stock_quantity) <= 5 ? 'bg-amber-500' : 'bg-emerald-600'}`}>{variant.pos_stock_quantity} {variant.pos_stock_unit || ''}</span>}
                    <span className="font-bold text-slate-900">Rs {variant.price}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showTableDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Select table</h3>
              <button type="button" onClick={() => setShowTableDialog(false)} className="p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto">
              {tables.map((table) => (
                <button
                  key={table.table_id || table.id}
                  type="button"
                  onClick={() => {
                    setSelectedTable(table)
                    setShowTableDialog(false)
                  }}
                  className="rounded-xl border border-slate-200 p-4 text-center hover:border-slate-900"
                >
                  <p className="text-xl font-bold">{table.table_number}</p>
                  <p className="text-[10px] text-slate-500">{table.capacity} seats</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NewOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>
      }
    >
      <NewOrderContent />
    </Suspense>
  )
}
