'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminLayout from '@/components/admin/admin-layout'
import SearchableMultiPicker from '@/components/admin/searchable-multi-picker'
import MenuItemImage from '@/components/menu-item-image'
import { BadgePercent, CalendarDays, Loader2, Pencil, Plus, Power, Save, Star, Trash2, Upload, X } from 'lucide-react'
import { formatCalendarDateTime } from '@/lib/calendar-system.js'
import DateTimeInput from '@/components/ui/date-time-input.jsx'

const emptyForm = () => ({
  name: '', code: '', description: '', offer_type: 'discount', discount_type: 'percent', discount_value: '', scope: 'order',
  buy_quantity: 1, reward_quantity: 1, reward_discount_percent: 100,
  minimum_order_amount: '', maximum_discount_amount: '', starts_at: '', ends_at: '', days_of_week: [],
  daily_start_time: '', daily_end_time: '', usage_limit: '', per_customer_limit: '', stackable: false,
  channels: ['pos', 'website', 'qr'], target_ids: [], auto_apply: true, is_active: true, image_url: '', website_featured: false,
})
const days = [['sun','Sun'],['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat']]
const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** DB datetimes → YYYY-MM-DDTHH:mm for DateTimeInput. */
function toFormDateTime(value) {
  if (!value) return ''
  const raw = String(value).trim().replace(' ', 'T')
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/)
  if (!match) return ''
  return `${match[1]}T${match[2] || '00:00'}`
}

function promoToForm(promo) {
  return {
    name: promo.name || '',
    code: promo.code || '',
    description: promo.description || '',
    offer_type: promo.offer_type || 'discount',
    discount_type: promo.discount_type || 'percent',
    discount_value: promo.discount_value != null ? String(promo.discount_value) : '',
    scope: promo.scope || 'order',
    buy_quantity: promo.buy_quantity || 1,
    reward_quantity: promo.reward_quantity || 1,
    reward_discount_percent: promo.reward_discount_percent ?? 100,
    minimum_order_amount: promo.minimum_order_amount ? String(promo.minimum_order_amount) : '',
    maximum_discount_amount: promo.maximum_discount_amount != null ? String(promo.maximum_discount_amount) : '',
    starts_at: toFormDateTime(promo.starts_at),
    ends_at: toFormDateTime(promo.ends_at),
    days_of_week: Array.isArray(promo.days_of_week) ? promo.days_of_week : [],
    daily_start_time: promo.daily_start_time || '',
    daily_end_time: promo.daily_end_time || '',
    usage_limit: promo.usage_limit != null ? String(promo.usage_limit) : '',
    per_customer_limit: promo.per_customer_limit != null ? String(promo.per_customer_limit) : '',
    stackable: Boolean(promo.stackable),
    channels: Array.isArray(promo.channels) && promo.channels.length ? promo.channels : ['pos', 'website', 'qr'],
    target_ids: Array.isArray(promo.target_ids) ? promo.target_ids.map(Number) : [],
    auto_apply: Boolean(promo.auto_apply),
    is_active: Boolean(promo.is_active),
    image_url: promo.image_url || '',
    website_featured: Boolean(promo.website_featured),
  }
}

export default function PromotionsPage() {
  const [data, setData] = useState({ promotions: [], categories: [], items: [], usage_history: [] })
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)
  const set = (patch) => setForm((value) => ({ ...value, ...patch }))
  const reset = () => { setForm(emptyForm()); setEditingId(null) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/promotions', { headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load offers.')
      setData(json)
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const targets = useMemo(() => form.scope === 'category' ? data.categories : form.scope === 'item' ? data.items : [], [data, form.scope])
  const toggleArray = (key, value) => set({ [key]: form[key].includes(value) ? form[key].filter((item) => item !== value) : [...form[key], value] })

  const edit = (promo) => {
    setEditingId(promo.id)
    setForm(promoToForm(promo))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function uploadImage(event) {
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
      if (!response.ok) throw new Error(payload.error || 'Could not upload the offer image.')
      set({ image_url: payload.url || payload.image_url || '' })
      setMessage({ type: 'success', text: 'Offer image uploaded.' })
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setUploading(false); event.target.value = '' }
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true); setMessage(null)
    try {
      const res = await fetch(editingId ? `/api/admin/promotions/${editingId}` : '/api/admin/promotions', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || (editingId ? 'Could not update offer.' : 'Could not create offer.'))
      reset()
      setMessage({ type: 'success', text: json.message || (editingId ? 'Offer updated.' : 'Offer created.') })
      await load()
    } catch (error) { setMessage({ type: 'error', text: error.message }) }
    finally { setSaving(false) }
  }

  async function mutate(id, method, body) {
    setMessage(null)
    const res = await fetch(`/api/admin/promotions/${id}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pos_token')}` }, body: body ? JSON.stringify(body) : undefined })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setMessage({ type: 'error', text: json.error || 'Could not update offer.' }); return }
    if (editingId === id && method === 'DELETE') reset()
    setMessage({ type: 'success', text: json.message }); await load()
  }

  return <AdminLayout>
    <header className="border-b border-gray-200 bg-white px-5 py-5 lg:px-8">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-rose-50 p-2.5 text-rose-700"><BadgePercent className="h-6 w-6" /></span><div><h1 className="text-2xl font-bold text-gray-950">Offers & discounts</h1><p className="text-sm text-gray-500">Automatic offers and coupon codes. Mark one as Featured for the home page hero banner (only one across offers + combos).</p></div></div>
    </header>
    <main className="grid gap-6 bg-gray-50 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.75fr)] lg:p-8">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-950">{editingId ? 'Edit offer' : 'Create an offer'}</h2>
          {editingId && <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-800"><X className="h-4 w-4" /> Cancel edit</button>}
        </div>
        <form onSubmit={save} className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Offer name"><input required value={form.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="Monsoon momo offer" /></Field>
            <Field label="Coupon code (optional)"><input value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, '') })} className={input} placeholder="MOMO10" /></Field>
          </div>
          <Field label="Customer-facing description"><input value={form.description} onChange={(e) => set({ description: e.target.value })} className={input} placeholder="Save on selected momo dishes" /></Field>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-gray-700">Website image <span className="font-normal text-gray-400">(optional)</span></span>
            <div className="flex flex-wrap items-center gap-3">
              <MenuItemImage src={form.image_url} alt={form.name || 'Offer preview'} size="md" />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload className="h-4 w-4" />{uploading ? 'Uploading…' : 'Upload image'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={uploadImage} />
              </label>
              {form.image_url && <button type="button" onClick={() => set({ image_url: '' })} className="text-xs font-semibold text-rose-600 hover:underline">Remove</button>}
            </div>
            <input value={form.image_url} onChange={(e) => set({ image_url: e.target.value })} className={`${input} mt-2`} placeholder="Or paste an image URL" />
          </div>
          <Field label="Offer rule"><select value={form.offer_type} onChange={(e) => set({ offer_type: e.target.value, scope: e.target.value === 'buy_x_get_y' && form.scope === 'order' ? 'item' : form.scope, target_ids: [] })} className={input}><option value="discount">Percentage / fixed discount</option><option value="buy_x_get_y">Buy X, get Y discounted</option></select></Field>
          {form.offer_type === 'discount' ? <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Discount type"><select value={form.discount_type} onChange={(e) => set({ discount_type: e.target.value })} className={input}><option value="percent">Percentage</option><option value="fixed">Fixed rupees</option></select></Field>
            <Field label={form.discount_type === 'percent' ? 'Discount (%)' : 'Discount (Rs)'}><input required type="number" min="0.01" max={form.discount_type === 'percent' ? 100 : undefined} step="0.01" value={form.discount_value} onChange={(e) => set({ discount_value: e.target.value })} className={input} /></Field>
            <Field label="Maximum discount (Rs)"><input type="number" min="0" step="0.01" value={form.maximum_discount_amount} onChange={(e) => set({ maximum_discount_amount: e.target.value })} className={input} placeholder="No maximum" /></Field>
          </div> : <div className="grid gap-4 sm:grid-cols-3"><Field label="Customer buys"><input required type="number" min="1" max="99" value={form.buy_quantity} onChange={(e) => set({ buy_quantity: e.target.value })} className={input} /></Field><Field label="Customer gets"><input required type="number" min="1" max="99" value={form.reward_quantity} onChange={(e) => set({ reward_quantity: e.target.value })} className={input} /></Field><Field label="Reward discount (%)"><input required type="number" min="1" max="100" value={form.reward_discount_percent} onChange={(e) => set({ reward_discount_percent: e.target.value })} className={input} /><span className="mt-1 block text-xs text-gray-400">Use 100 for free.</span></Field></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applies to"><select value={form.scope} onChange={(e) => set({ scope: e.target.value, target_ids: [] })} className={input}>{form.offer_type === 'discount' && <option value="order">Entire order</option>}<option value="category">Selected categories</option><option value="item">Selected menu items</option></select></Field>
            <Field label="Minimum order (Rs)"><input type="number" min="0" step="0.01" value={form.minimum_order_amount} onChange={(e) => set({ minimum_order_amount: e.target.value })} className={input} placeholder="0" /></Field>
          </div>
          {form.scope !== 'order' && (
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-gray-700">
                {form.scope === 'category' ? 'Eligible categories' : 'Eligible menu items'}
              </span>
              <SearchableMultiPicker
                options={targets}
                value={form.target_ids}
                onChange={(target_ids) => set({ target_ids })}
                placeholder={form.scope === 'category' ? 'Search categories…' : 'Search menu items…'}
                emptyLabel={form.scope === 'category' ? 'No matching categories.' : 'No matching menu items.'}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Starts (optional)"><DateTimeInput value={form.starts_at} onChange={(starts_at) => set({ starts_at })} className={input} /></Field><Field label="Ends (optional)"><DateTimeInput value={form.ends_at} onChange={(ends_at) => set({ ends_at })} className={input} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Daily start time (optional)"><input type="time" value={form.daily_start_time} onChange={(e) => set({ daily_start_time: e.target.value })} className={input} /></Field><Field label="Daily end time (optional)"><input type="time" value={form.daily_end_time} onChange={(e) => set({ daily_end_time: e.target.value })} className={input} /><span className="mt-1 block text-xs text-gray-400">Nepal time. End is exclusive — 07:00–12:00 means off from 12:00. Overnight windows supported.</span></Field></div>
          <ChoiceGroup label="Active days (none means every day)" values={days} selected={form.days_of_week} onToggle={(value) => toggleArray('days_of_week', value)} />
          <ChoiceGroup label="Sales channels" values={[["pos","POS"],["website","Website"],["qr","Table QR"]]} selected={form.channels} onToggle={(value) => toggleArray('channels', value)} />
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Total usage limit"><input type="number" min="1" value={form.usage_limit} onChange={(e) => set({ usage_limit: e.target.value })} className={input} placeholder="Unlimited" /></Field><Field label="Limit per customer phone"><input type="number" min="1" value={form.per_customer_limit} onChange={(e) => set({ per_customer_limit: e.target.value })} className={input} placeholder="Unlimited" /></Field></div>
          {!form.code && <label className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><input type="checkbox" checked={form.auto_apply} onChange={(e) => set({ auto_apply: e.target.checked })} className="h-4 w-4" /><span><strong className="block text-sm text-gray-900">Apply automatically</strong><span className="text-xs text-gray-500">The best eligible automatic offer wins.</span></span></label>}
          <label className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><input type="checkbox" checked={form.website_featured} onChange={(e) => set({ website_featured: e.target.checked })} className="h-4 w-4" /><span><strong className="block text-sm text-gray-900">Feature on website banner</strong><span className="text-xs text-gray-500">Replaces any current featured offer/combo. Needs Website channel + a good image.</span></span></label>
          <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3"><input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="h-4 w-4" /><span><strong className="block text-sm text-gray-900">Active</strong><span className="text-xs text-gray-500">Paused offers stay in history but stop applying.</span></span></label>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create offer'}
          </button>
        </form>
      </section>
      <section className="space-y-3">
        {message && <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{message.text}</p>}
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-gray-950">Current offers</h2><p className="text-xs text-gray-500">Past usage stays in reports even after an offer is paused.</p></div><CalendarDays className="h-5 w-5 text-gray-400" /></div>
        {loading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : data.promotions.length === 0 ? <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No offers created yet.</p> : data.promotions.map((promo) => <article key={promo.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${promo.is_active ? 'border-emerald-200' : 'border-gray-200 opacity-70'} ${editingId === promo.id ? 'ring-2 ring-rose-300' : ''}`}>
          <div className="flex items-start gap-3">
            {promo.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={promo.image_url.startsWith('/uploads/') ? `/api/media/${promo.image_url.slice('/uploads/'.length)}` : promo.image_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-gray-950">{promo.name}</h3>{promo.website_featured ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900"><Star className="h-3 w-3 fill-current" /> Featured</span> : null}{promo.code && <span className="rounded-md bg-violet-100 px-2 py-0.5 font-mono text-xs font-bold text-violet-800">{promo.code}</span>}<span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">{promo.auto_apply ? 'Automatic' : 'Coupon'}</span></div><p className="mt-1 text-sm font-semibold text-rose-700">{promo.offer_type === 'buy_x_get_y' ? `Buy ${promo.buy_quantity}, get ${promo.reward_quantity} ${promo.reward_discount_percent === 100 ? 'free' : `${promo.reward_discount_percent}% off`}` : promo.discount_type === 'percent' ? `${promo.discount_value}% off` : `${money(promo.discount_value)} off`} · {promo.scope}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${promo.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>{promo.is_active ? 'Active' : 'Paused'}</span></div>
              <p className="mt-2 text-xs text-gray-500">{promo.channels.join(' · ')}{promo.minimum_order_amount > 0 ? ` · Min ${money(promo.minimum_order_amount)}` : ''}{promo.maximum_discount_amount != null ? ` · Max ${money(promo.maximum_discount_amount)}` : ''}</p>
              {(promo.daily_start_time || promo.daily_end_time || promo.usage_limit || promo.per_customer_limit) && <p className="mt-1 text-xs text-gray-500">{promo.daily_start_time || '00:00'}–{promo.daily_end_time || '23:59'} Nepal time (end exclusive){promo.usage_limit ? ` · ${promo.uses}/${promo.usage_limit} total uses` : ''}{promo.per_customer_limit ? ` · ${promo.per_customer_limit}/customer` : ''}</p>}
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500">{promo.uses} uses · {money(promo.saved)} discounted</p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => edit(promo)} className="rounded-lg p-2 text-gray-700 hover:bg-rose-50 hover:text-rose-700" title="Edit offer"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => mutate(promo.id, 'PATCH', { website_featured: !promo.website_featured })} className={`rounded-lg p-2 hover:bg-amber-50 ${promo.website_featured ? 'text-amber-600' : 'text-gray-400'}`} title={promo.website_featured ? 'Unfeature banner' : 'Feature on website banner'}><Star className={`h-4 w-4 ${promo.website_featured ? 'fill-current' : ''}`} /></button>
                  <button type="button" onClick={() => mutate(promo.id, 'PATCH', { is_active: !promo.is_active })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title={promo.is_active ? 'Pause' : 'Activate'}><Power className="h-4 w-4" /></button>
                  <button type="button" onClick={() => mutate(promo.id, 'DELETE')} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          </div>
        </article>)}
      </section>
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:col-span-2">
        <div className="border-b border-gray-100 px-5 py-4"><h2 className="font-bold text-gray-950">Recent offer usage</h2><p className="text-xs text-gray-500">Finalized and in-progress redemptions across every sales channel. Voided bills are excluded.</p></div>
        {!data.usage_history?.length ? <p className="p-6 text-sm text-gray-500">No offer usage yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">Offer</th><th className="px-4 py-3">Order / bill</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3">Used</th></tr></thead><tbody>{data.usage_history.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="px-4 py-3 font-semibold">{row.promotion_name}{row.promotion_code ? <span className="ml-2 font-mono text-xs text-violet-700">{row.promotion_code}</span> : null}</td><td className="px-4 py-3 text-gray-600">{row.bill_number || row.order_number || 'Pending order'}</td><td className="px-4 py-3 uppercase text-gray-500">{row.channel}</td><td className="px-4 py-3 text-gray-500">{row.customer_phone || 'Walk-in'}</td><td className="px-4 py-3 text-right font-bold text-rose-700">−{money(row.discount_amount)}</td><td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatCalendarDateTime(row.created_at)}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  </AdminLayout>
}

const input = 'h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-100'
function Field({ label, children }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</span>{children}</label> }
function ChoiceGroup({ label, values, selected, onToggle }) { return <fieldset><legend className="mb-2 text-sm font-semibold text-gray-700">{label}</legend><div className="flex flex-wrap gap-2">{values.map(([value, text]) => <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold ${selected.includes(value) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'}`}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} className="sr-only" />{text}</label>)}</div></fieldset> }
