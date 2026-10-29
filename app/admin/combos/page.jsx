'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Plus, Pencil, Trash2, X, Save, Power, Upload, Star } from 'lucide-react'
import AdminLayout from '@/components/admin/admin-layout'
import MenuItemImage from '@/components/menu-item-image'

const emptyForm = () => ({ name: '', description: '', category_id: '', price: '', image_url: '', channels: ['pos', 'website', 'qr'], is_active: true, website_featured: false, components: [{ menu_item_id: '', variant_name: '', quantity: 1 }, { menu_item_id: '', variant_name: '', quantity: 1 }] })
const money = (value) => `Rs ${Number(value || 0).toLocaleString()}`

export default function ComboPacksPage() {
  const [data, setData] = useState({ combos: [], categories: [], products: [] })
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)

  const request = useCallback(async (url, options = {}) => {
    const token = localStorage.getItem('pos_token')
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || payload.message || 'Something went wrong.')
    return payload
  }, [])

  const load = useCallback(async () => {
    try { setData(await request('/api/admin/combos')) }
    catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const productById = useMemo(() => new Map(data.products.map((product) => [Number(product.id), product])), [data.products])
  const originalPrice = useMemo(() => form.components.reduce((sum, row) => {
    const product = productById.get(Number(row.menu_item_id))
    if (!product) return sum
    const variant = (product.variants || []).find((entry) => entry.variant_name === row.variant_name)
    return sum + Number(variant?.price ?? product.base_price ?? 0) * Number(row.quantity || 0)
  }, 0), [form.components, productById])
  const savings = Math.max(0, originalPrice - Number(form.price || 0))

  const setComponent = (index, patch) => setForm((current) => ({ ...current, components: current.components.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) }))
  const reset = () => { setForm(emptyForm()); setEditingId(null) }

  const edit = (item) => {
    const components = (item.combo?.components || [])
      .map((row) => ({
        menu_item_id: String(row.component_menu_item_id || ''),
        variant_name: row.variant_name || '',
        quantity: Number(row.quantity || 1),
      }))
      .filter((row) => row.menu_item_id)
    setEditingId(item.id)
    setForm({
      name: item.name || '',
      description: item.description || '',
      category_id: String(item.category_id || ''),
      price: String(item.price || ''),
      image_url: item.image_url || '',
      channels: item.combo?.channels?.length ? item.combo.channels : ['pos', 'website', 'qr'],
      is_active: Boolean(item.combo?.is_active),
      website_featured: Boolean(item.combo?.website_featured),
      // Keep at least two rows so the form stays valid while editing.
      components: components.length >= 2
        ? components
        : [...components, ...Array.from({ length: Math.max(0, 2 - components.length) }, () => ({ menu_item_id: '', variant_name: '', quantity: 1 }))],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setMessage(null)
    try {
      await request(editingId ? `/api/admin/combos/${editingId}` : '/api/admin/combos', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(form) })
      setMessage({ type: 'success', text: editingId ? 'Combo pack updated.' : 'Combo pack created.' }); reset(); await load()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setSaving(false) }
  }

  const uploadImage = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true); setMessage(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/uploads/menu', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
        body,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not upload the combo image.')
      setForm((current) => ({ ...current, image_url: payload.url || payload.image_url || '' }))
      setMessage({ type: 'success', text: 'Combo image uploaded.' })
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setUploading(false); event.target.value = '' }
  }

  const toggle = async (item) => {
    try { await request(`/api/admin/combos/${item.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !item.combo?.is_active }) }); await load() }
    catch (error) { setMessage({ type: 'error', text: error.message }) }
  }

  const toggleFeatured = async (item) => {
    try {
      await request(`/api/admin/combos/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ website_featured: !item.combo?.website_featured }),
      })
      await load()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
  }

  const remove = async (item) => {
    if (!window.confirm(`Delete “${item.name}”? Combos with order history can only be paused.`)) return
    try { await request(`/api/admin/combos/${item.id}`, { method: 'DELETE' }); await load() }
    catch (error) { setMessage({ type: 'error', text: error.message }) }
  }

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Layers className="h-7 w-7 text-orange-600" /> Combo Packs</h1><p className="mt-1 text-sm text-slate-500">Sell several menu items together for one fixed price. Mark one as Featured for the home page hero (only one across offers + combos).</p></div>
        {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit combo' : 'Create a combo'}</h2>{editingId && <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-sm text-slate-500"><X className="h-4 w-4" /> Cancel edit</button>}</div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-slate-700">Combo name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Momo Meal Combo" /></label>
            <label className="text-sm font-medium text-slate-700">Category<select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Choose category</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Fixed selling price<input required min="0.01" step="0.01" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="500" /></label>
            <div className="text-sm font-medium text-slate-700">Combo image <span className="font-normal text-slate-400">(optional)</span><div className="mt-1 flex items-center gap-3"><MenuItemImage src={form.image_url} alt={form.name || 'Combo preview'} size="md" /><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Upload className="h-4 w-4" />{uploading ? 'Uploading…' : 'Upload image'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={uploadImage} /></label>{form.image_url && <button type="button" onClick={() => setForm((current) => ({ ...current, image_url: '' }))} className="text-xs font-semibold text-red-600 hover:underline">Remove</button>}</div></div>
          </div>
          <label className="block text-sm font-medium text-slate-700">Image URL <span className="font-normal text-slate-400">(optional fallback)</span><input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="https://…" /></label>
          <label className="block text-sm font-medium text-slate-700">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="A short description customers will understand" /></label>

          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Items inside this combo</h3><button type="button" onClick={() => setForm((current) => ({ ...current, components: [...current.components, { menu_item_id: '', variant_name: '', quantity: 1 }] }))} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-semibold text-orange-700"><Plus className="h-4 w-4" /> Add item</button></div>
            {form.components.map((row, index) => {
              const product = productById.get(Number(row.menu_item_id)); const variants = product?.variants || []
              return <div key={index} className="grid items-end gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_100px_40px]">
                <label className="text-xs font-semibold text-slate-600">Menu item<select required value={row.menu_item_id} onChange={(e) => setComponent(index, { menu_item_id: e.target.value, variant_name: '' })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Choose item</option>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name} — {money(item.base_price)}{Number(item.is_available) === 0 ? ' (paused)' : ''}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-600">Variation<select value={row.variant_name} disabled={!variants.length} onChange={(e) => setComponent(index, { variant_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"><option value="">{variants.length ? 'Base item' : 'No variations'}</option>{variants.map((variant) => <option key={variant.id || variant.variant_name} value={variant.variant_name}>{variant.variant_name} — {money(variant.price)}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-600">Quantity<input required min="1" max="99" type="number" value={row.quantity} onChange={(e) => setComponent(index, { quantity: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
                <button type="button" disabled={form.components.length <= 2} onClick={() => setForm((current) => ({ ...current, components: current.components.filter((_, rowIndex) => rowIndex !== index) }))} className="grid h-10 w-10 place-items-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
              </div>
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm"><span>Normal total: <b>{money(originalPrice)}</b></span><span>Combo price: <b>{money(form.price)}</b></span><span className="text-emerald-700">Customer saves: <b>{money(savings)}</b></span></div>
          <div className="flex flex-wrap items-center gap-5">
            <span className="text-sm font-semibold text-slate-700">Show on:</span>{['pos', 'website', 'qr'].map((channel) => <label key={channel} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={form.channels.includes(channel)} onChange={() => setForm((current) => ({ ...current, channels: current.channels.includes(channel) ? current.channels.filter((value) => value !== channel) : [...current.channels, channel] }))} /> {channel}</label>)}
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            <label className="flex items-center gap-2 text-sm font-medium text-amber-800"><input type="checkbox" checked={form.website_featured} onChange={(e) => setForm({ ...form, website_featured: e.target.checked })} /> Feature on website banner</label>
          </div>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create combo pack'}</button>
        </form>

        <section className="space-y-3"><h2 className="text-lg font-bold text-slate-900">Your combo packs</h2>{loading ? <p className="text-sm text-slate-500">Loading combo packs…</p> : data.combos.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No combo packs yet.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.combos.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.combo?.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{item.combo?.is_active ? 'ACTIVE' : 'PAUSED'}</span>{item.combo?.website_featured ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900"><Star className="h-3 w-3 fill-current" /> Featured</span> : null}</div><h3 className="mt-2 font-bold text-slate-900">{item.name}</h3><p className="text-xs text-slate-500">{item.category_name}</p></div><p className="text-lg font-bold text-orange-700">{money(item.price)}</p></div>
          <div className="my-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{item.combo?.components?.map((component, index) => <p key={`${component.id}-${index}`}>{component.quantity}× {component.name}{component.variant_name ? ` (${component.variant_name})` : ''}</p>)}</div>
          <div className="mb-3 flex gap-3 text-xs"><span>Normal: <b>{money(item.combo?.original_price)}</b></span><span className="text-emerald-700">Save: <b>{money(Math.max(0, Number(item.combo?.original_price || 0) - Number(item.price || 0)))}</b></span></div>
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-400">{(item.combo?.channels || []).join(' · ')}</p>
          <div className="flex gap-2"><button type="button" onClick={() => edit(item)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"><Pencil className="h-4 w-4" /> Edit</button><button type="button" onClick={() => toggleFeatured(item)} className={`grid h-10 w-10 place-items-center rounded-lg border ${item.combo?.website_featured ? 'border-amber-300 text-amber-600' : 'border-slate-200 text-slate-400'}`} title={item.combo?.website_featured ? 'Unfeature banner' : 'Feature on website banner'}><Star className={`h-4 w-4 ${item.combo?.website_featured ? 'fill-current' : ''}`} /></button><button type="button" onClick={() => toggle(item)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-600" title={item.combo?.is_active ? 'Pause' : 'Activate'}><Power className="h-4 w-4" /></button><button type="button" onClick={() => remove(item)} className="grid h-10 w-10 place-items-center rounded-lg border border-red-200 text-red-600"><Trash2 className="h-4 w-4" /></button></div>
        </article>)}</div>}</section>
      </div>
    </AdminLayout>
  )
}
