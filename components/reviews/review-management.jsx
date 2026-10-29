'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, MessageSquareHeart, Pencil, Plus, Printer, QrCode, Save, Star, X } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';

const TYPES = [
  ['rating', 'Star rating'], ['radio', 'One choice (radio)'], ['checkbox', 'Multiple choices (checkboxes)'],
  ['short_text', 'Short answer'], ['long_text', 'Long answer'],
];
const emptyQuestion = () => ({ label: '', field_type: 'rating', options: [], is_required: true });
const emptyForm = () => ({ title: 'Tell us about your visit', slug: 'guest-feedback', description: 'Your honest feedback helps us serve you better.', thank_you_message: 'Thank you. Your feedback means a lot to our team.', is_active: true, questions: [{ ...emptyQuestion(), label: 'How would you rate your overall experience?' }, { label: 'What did you enjoy, and what could we improve?', field_type: 'long_text', options: [], is_required: false }] });

export default function ReviewManagement({ cashierOnly = false }) {
  const [data, setData] = useState({ forms: [], reviews: [], role: cashierOnly ? 'cashier' : 'admin', canManage: !cashierOnly });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);
  const [entrySlug, setEntrySlug] = useState('');
  const [entryForm, setEntryForm] = useState(null);
  const [entry, setEntry] = useState({ customer_name: '', customer_phone: '', answers: {} });
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiJson('/api/admin/reviews');
      setData(payload);
      if (!entrySlug && payload.forms?.length) setEntrySlug(payload.forms.find((f) => f.is_active)?.slug || '');
    } catch (error) { setMessage({ type: 'error', text: error.error || 'Could not load reviews.' }); }
    finally { setLoading(false); }
  }, [entrySlug]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadForm(slug, target = 'entry') {
    if (!slug) { setEntryForm(null); return; }
    try {
      const payload = await apiJson(`/api/admin/reviews?slug=${encodeURIComponent(slug)}`);
      if (target === 'editor') setEditor(payload.form); else { setEntryForm(payload.form); setEntry({ customer_name: '', customer_phone: '', answers: {} }); }
    } catch (error) { setMessage({ type: 'error', text: error.error || 'Could not load the form.' }); }
  }
  useEffect(() => { if (!data.canManage && entrySlug) loadForm(entrySlug); }, [data.canManage, entrySlug]);

  async function saveForm(event) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const editing = Boolean(editor.id);
      const result = await apiJson('/api/admin/reviews', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(editor) });
      setMessage({ type: 'success', text: result.message }); setEditor(null); await load();
    } catch (error) { setMessage({ type: 'error', text: error.error || 'Could not save the form.' }); }
    finally { setSaving(false); }
  }

  async function submitCashier(event) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const result = await apiJson('/api/admin/reviews', { method: 'POST', body: JSON.stringify({ action: 'submit_review', slug: entrySlug, ...entry }) });
      setMessage({ type: 'success', text: result.message }); setEntry({ customer_name: '', customer_phone: '', answers: {} });
    } catch (error) { setMessage({ type: 'error', text: error.error || 'Could not save the review.' }); }
    finally { setSaving(false); }
  }

  async function updateStatus(id, status) {
    try { const result = await apiJson('/api/admin/reviews', { method: 'PUT', body: JSON.stringify({ action: 'review_status', id, status }) }); setMessage({ type: 'success', text: result.message }); await load(); }
    catch (error) { setMessage({ type: 'error', text: error.error || 'Could not update the review.' }); }
  }

  async function openQr(slug) {
    setQr('loading');
    try { setQr(await apiJson(`/api/admin/reviews?slug=${encodeURIComponent(slug)}&qr=1`)); }
    catch (error) { setQr(null); setMessage({ type: 'error', text: error.error || 'Could not generate the QR code.' }); }
  }

  return <AdminLayout>
    <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-gray-950"><MessageSquareHeart className="h-7 w-7 text-rose-600" /> Customer reviews</h1><p className="mt-1 text-sm text-gray-500">{data.canManage ? 'Build feedback forms, print QR codes, moderate responses, and publish selected reviews.' : 'Record customer feedback with their name. Entries are labelled with the cashier who saved them.'}</p></div>{data.canManage ? <button onClick={() => setEditor(emptyForm())} className="inline-flex items-center gap-2 self-start rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New form</button> : null}</div></header>
    <main className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
      {message ? <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{message.text}</div> : null}
      {loading ? <div className="py-16 text-center text-sm text-gray-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading reviews…</div> : data.canManage ? <AdminPanels data={data} setEditor={(form) => loadForm(form.slug, 'editor')} onQr={openQr} onStatus={updateStatus} /> : <CashierEntry forms={data.forms} slug={entrySlug} setSlug={setEntrySlug} form={entryForm} entry={entry} setEntry={setEntry} onSubmit={submitCashier} saving={saving} />}
    </main>
    {editor ? <FormEditor form={editor} setForm={setEditor} onClose={() => setEditor(null)} onSubmit={saveForm} saving={saving} /> : null}
    {qr ? <QrModal qr={qr} onClose={() => setQr(null)} /> : null}
  </AdminLayout>;
}

function AdminPanels({ data, setEditor, onQr, onStatus }) {
  return <><section className="rounded-2xl border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="font-bold text-gray-950">Feedback forms</h2></div>{data.forms.length ? <div className="divide-y divide-gray-100">{data.forms.map((form) => <div key={form.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-gray-950">{form.title}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${form.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{form.is_active ? 'Active' : 'Paused'}</span></div><p className="mt-1 break-words text-xs text-gray-500">/review/{form.slug} · {form.question_count} questions · {form.response_count} responses</p></div><div className="flex flex-wrap gap-2"><button onClick={() => onQr(form.slug)} className="rounded-lg border border-gray-200 p-2 text-gray-600" title="QR and print"><QrCode className="h-4 w-4" /></button><button onClick={() => setEditor(form)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700"><Pencil className="h-3.5 w-3.5" /> Edit</button></div></div>)}</div> : <Empty text="No feedback form yet." />}</section>
    <section className="rounded-2xl border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="font-bold text-gray-950">Responses</h2><p className="mt-1 text-xs text-gray-500">Pending responses stay private until you publish them.</p></div>{data.reviews.length ? <div className="divide-y divide-gray-100">{data.reviews.map((review) => <ReviewCard key={review.id} review={review} onStatus={onStatus} />)}</div> : <Empty text="No customer responses yet." />}</section></>;
}

function ReviewCard({ review, onStatus }) {
  const rating = review.answers.find((a) => a.field_type === 'rating');
  return <article className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="break-words">{review.customer_name || 'Anonymous guest'}</strong><Status status={review.status} />{rating ? <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{rating.value}/5</span> : null}</div><p className="mt-1 break-words text-xs text-gray-500">{review.form_title} · {new Date(review.created_at).toLocaleString('en-NP')}{review.source === 'cashier' ? ` · entered by ${review.submitted_by_name || 'cashier'}` : ' · customer QR'}</p>{review.customer_phone ? <p className="mt-1 break-all text-xs text-gray-400">Phone: {review.customer_phone}</p> : null}</div><div className="flex flex-wrap gap-2">{review.status !== 'published' ? <button onClick={() => onStatus(review.id, 'published')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><Eye className="h-3.5 w-3.5" /> Publish</button> : null}{review.status !== 'hidden' ? <button onClick={() => onStatus(review.id, 'hidden')} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700"><EyeOff className="h-3.5 w-3.5" /> Hide</button> : <button onClick={() => onStatus(review.id, 'pending')} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">Restore</button>}</div></div><dl className="mt-4 grid gap-3 sm:grid-cols-2">{review.answers.map((answer, i) => <div key={i} className="min-w-0 rounded-xl bg-gray-50 p-3"><dt className="break-words text-xs font-semibold text-gray-500">{answer.label}</dt><dd className="mt-1 break-words whitespace-pre-wrap text-sm text-gray-900">{Array.isArray(answer.value) ? answer.value.join(', ') : answer.value}</dd></div>)}</dl></article>;
}
function Status({ status }) { const tone = status === 'published' ? 'bg-emerald-50 text-emerald-700' : status === 'hidden' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone}`}>{status}</span>; }

function CashierEntry({ forms, slug, setSlug, form, entry, setEntry, onSubmit, saving }) {
  const active = forms.filter((f) => f.is_active);
  return <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-5 sm:p-7"><form onSubmit={onSubmit} className="space-y-6"><label className="block"><span className="mb-2 block text-sm font-semibold">Review form</span><select value={slug} onChange={(e) => setSlug(e.target.value)} className="admin-review-input"><option value="">Choose a form</option>{active.map((f) => <option key={f.id} value={f.slug}>{f.title}</option>)}</select></label>{!form && slug ? <p className="text-sm text-gray-500">Loading form…</p> : null}{form ? <><div className="grid gap-4 sm:grid-cols-2"><Input label="Customer name"><input required value={entry.customer_name} onChange={(e) => setEntry({ ...entry, customer_name: e.target.value })} className="admin-review-input" /></Input><Input label="Customer phone (optional)"><input value={entry.customer_phone} onChange={(e) => setEntry({ ...entry, customer_phone: e.target.value })} className="admin-review-input" /></Input></div>{form.questions.map((q) => <EntryQuestion key={q.id} question={q} value={entry.answers[q.id]} onChange={(value) => setEntry({ ...entry, answers: { ...entry.answers, [q.id]: value } })} />)}<button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save customer review</button></> : null}{!active.length ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">An admin needs to create and activate a review form first.</p> : null}</form></section>;
}

function EntryQuestion({ question, value, onChange }) {
  return <fieldset><legend className="mb-2 text-sm font-semibold">{question.label}{question.is_required ? ' *' : ''}</legend>{question.field_type === 'rating' ? <div className="flex gap-1">{[1,2,3,4,5].map((n) => <button type="button" key={n} onClick={() => onChange(String(n))} aria-label={`${n} stars`}><Star className={`h-8 w-8 ${Number(value) >= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} /></button>)}</div> : null}{question.field_type === 'radio' ? <div className="grid gap-2 sm:grid-cols-2">{question.options.map((o) => <label key={o} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" required={question.is_required} name={`entry-${question.id}`} checked={value === o} onChange={() => onChange(o)} />{o}</label>)}</div> : null}{question.field_type === 'checkbox' ? <div className="grid gap-2 sm:grid-cols-2">{question.options.map((o) => { const checked = Array.isArray(value) && value.includes(o); return <label key={o} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((x) => x !== o) : [...(value || []), o])} />{o}</label>; })}</div> : null}{question.field_type === 'short_text' ? <input required={question.is_required} value={value || ''} onChange={(e) => onChange(e.target.value)} className="admin-review-input" /> : null}{question.field_type === 'long_text' ? <textarea required={question.is_required} rows={4} value={value || ''} onChange={(e) => onChange(e.target.value)} className="admin-review-input" /> : null}</fieldset>;
}

function FormEditor({ form, setForm, onClose, onSubmit, saving }) {
  const patch = (values) => setForm({ ...form, ...values });
  const updateQuestion = (index, values) => patch({ questions: form.questions.map((q, i) => i === index ? { ...q, ...values } : q) });
  const move = (index, offset) => { const questions = [...form.questions]; const [item] = questions.splice(index, 1); questions.splice(index + offset, 0, item); patch({ questions }); };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-2 sm:p-6"><form onSubmit={onSubmit} className="mx-auto max-w-3xl rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between gap-3 rounded-t-2xl border-b bg-white px-4 py-4 sm:px-5"><div className="min-w-0"><h2 className="font-bold text-gray-950">{form.id ? 'Edit review form' : 'Create review form'}</h2><p className="text-xs text-gray-500">Changes affect the public QR questionnaire.</p></div><button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-gray-100"><X className="h-5 w-5" /></button></header><div className="space-y-5 p-4 sm:p-7"><div className="grid gap-4 sm:grid-cols-2"><Input label="Form title"><input required value={form.title} onChange={(e) => patch({ title: e.target.value })} className="admin-review-input" /></Input><Input label="Public link"><div className="flex min-w-0 items-center rounded-xl border border-gray-300 bg-white focus-within:ring-2"><span className="shrink-0 pl-3 text-sm text-gray-400">/review/</span><input required value={form.slug} onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="min-w-0 flex-1 rounded-xl px-2 py-3 text-sm outline-none" /></div></Input></div><Input label="Introduction"><textarea rows={2} value={form.description || ''} onChange={(e) => patch({ description: e.target.value })} className="admin-review-input" /></Input><Input label="Thank-you message"><input value={form.thank_you_message || ''} onChange={(e) => patch({ thank_you_message: e.target.value })} className="admin-review-input" /></Input><label className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900"><input type="checkbox" checked={form.is_active} onChange={(e) => patch({ is_active: e.target.checked })} className="mt-0.5 shrink-0" /> Active and accepting responses</label><div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Questions</h3><button type="button" onClick={() => patch({ questions: [...form.questions, emptyQuestion()] })} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"><Plus className="h-3.5 w-3.5" /> Add question</button></div><div className="space-y-3">{form.questions.map((q, index) => <div key={q.id || index} className="rounded-xl border border-gray-200 p-3 sm:p-4"><div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2"><span className="pt-3 text-xs font-bold text-gray-400">{index + 1}</span><input required value={q.label} onChange={(e) => updateQuestion(index, { label: e.target.value })} placeholder="Write the question" className="admin-review-input min-w-0" /><div className="col-start-2 flex justify-end"><button type="button" disabled={!index} onClick={() => move(index, -1)} className="p-2 disabled:opacity-25"><ChevronUp className="h-4 w-4" /></button><button type="button" disabled={index === form.questions.length - 1} onClick={() => move(index, 1)} className="p-2 disabled:opacity-25"><ChevronDown className="h-4 w-4" /></button><button type="button" onClick={() => patch({ questions: form.questions.filter((_, i) => i !== index) })} className="p-2 text-red-500"><X className="h-4 w-4" /></button></div></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><select value={q.field_type} onChange={(e) => updateQuestion(index, { field_type: e.target.value, options: ['radio','checkbox'].includes(e.target.value) ? q.options : [] })} className="admin-review-input">{TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.is_required} onChange={(e) => updateQuestion(index, { is_required: e.target.checked })} /> Required</label></div>{['radio','checkbox'].includes(q.field_type) ? <Input label="Choices (one per line)"><textarea rows={3} value={(q.options || []).join('\n')} onChange={(e) => updateQuestion(index, { options: e.target.value.split('\n') })} className="admin-review-input" placeholder={'Excellent\nGood\nNeeds improvement'} /></Input> : null}</div>)}</div></div></div><footer className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t bg-white px-4 py-4 sm:flex-row sm:gap-3 sm:px-5"><button disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white"><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save form'}</button><button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-5 text-sm font-semibold sm:order-none">Cancel</button></footer></form></div>;
}

function QrModal({ qr, onClose }) {
  function print() {
    if (qr === 'loading') return;
    const win = window.open('', '_blank', 'width=680,height=850'); if (!win) return;
    const title = String(qr.form.title).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    win.document.write(`<!doctype html><title>${title}</title><style>body{font-family:Arial;text-align:center;padding:48px;color:#171717}h1{font-size:30px;margin:0 0 8px}p{color:#555}.qr{width:380px;margin:30px auto}.url{font-size:12px;word-break:break-all}@media print{button{display:none}}</style><h1>${title}</h1><p>Scan to share your experience</p><div class="qr">${qr.svg}</div><p class="url">${qr.url}</p><button onclick="window.print()">Print</button>`); win.document.close(); win.focus(); setTimeout(() => win.print(), 250);
  }
  return <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/50 p-3 sm:p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-4 text-center sm:p-6">{qr === 'loading' ? <div className="py-12"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-2 text-sm text-gray-500">Generating QR…</p></div> : <><h3 className="break-words text-lg font-bold">{qr.form.title}</h3><p className="mt-1 text-xs text-gray-500">Customers scan to open this feedback form.</p><div className="mx-auto mt-4 w-full max-w-64 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} /><p className="mt-2 break-all text-[11px] text-gray-400">{qr.url}</p><button onClick={print} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white"><Printer className="h-4 w-4" /> Print QR poster</button></>}<button onClick={onClose} className="mt-2 min-h-11 w-full rounded-xl px-4 py-2 text-sm font-semibold text-gray-600">Close</button></div></div>;
}

function Input({ label, children }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</span>{children}</label>; }
function Empty({ text }) { return <p className="p-10 text-center text-sm text-gray-500">{text}</p>; }
