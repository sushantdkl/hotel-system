'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Globe, Home, Info, Image as ImageIcon, Video, Phone, Search as SeoIcon, RotateCcw,
  Save, UploadCloud, X, Trash2, Plus, Eye, EyeOff, AlertCircle, CheckCircle2,
  Sparkles, ChevronUp, ChevronDown, UtensilsCrossed,
} from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm';
import { toPublicImageUrl } from '@/lib/public-image-url.js';

/**
 * Website CMS — /admin/cms
 * Manages public content in system_settings and images via the persistent
 * media system. Menu prices are NOT editable here (POS remains the source).
 */

const TABS = [
  { id: 'brand', label: 'Brand', icon: Globe },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'festive', label: 'Festive Banners', icon: Sparkles },
  { id: 'about', label: 'About', icon: Info },
  { id: 'gallery', label: 'Gallery', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Video },
  { id: 'menu', label: 'Menu page', icon: UtensilsCrossed },
  { id: 'contact', label: 'Contact', icon: Phone },
  { id: 'seo', label: 'SEO', icon: SeoIcon },
  { id: 'media', label: 'Media Library', icon: ImageIcon },
];

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
  return { Authorization: `Bearer ${token}` };
}

/** Prefer /api/media for uploads so previews work on cPanel without /uploads rewrites. */
function normalizeCmsMediaPath(raw) {
  if (raw == null || raw === '') return '';
  const text = String(raw).trim();
  if (!text) return '';
  if (/^(https?:|data:|\/\/)/i.test(text)) return text;
  return toPublicImageUrl(text) || text;
}

export default function CmsPage() {
  const [tab, setTab] = useState('brand');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/cms', { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Request failed (${res.status})`);
      const data = await res.json();
      setContent(data.content);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Inside an async callback rather than the effect body, and guarded so a
    // slow response cannot set state after unmount.
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  const saveSection = async (section, data) => {
    try {
      const res = await fetch('/api/admin/cms', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Save failed');
      setContent((c) => ({ ...c, [section]: { ...c[section], ...data } }));
      showToast('Saved');
    } catch (e) {
      showToast(e.message, 'err');
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Website CMS</h1>
            <p className="mt-1 text-sm text-gray-500">Manage public content, images, and videos. Menu prices stay controlled by the POS.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <RotateCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="mt-4 overflow-x-auto border-b border-gray-200">
          <div className="flex gap-1 pb-2">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="mt-3 text-sm text-gray-700">{error}</p>
            <button onClick={load} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">Try again</button>
          </div>
        ) : loading || !content ? (
          <div className="mt-6 h-96 animate-pulse rounded-2xl bg-gray-100" />
        ) : (
          <div className="mt-6 pb-24">
            {tab === 'brand' && <BrandForm data={content.brand} onSave={(d) => saveSection('brand', d)} />}
            {tab === 'home' && <HomeForm data={content.home} onSave={(d) => saveSection('home', d)} />}
            {tab === 'festive' && <FestiveForm data={content.festive || { heading: 'Festive highlights', lead: '', visible: true, items: [] }} onSave={(d) => saveSection('festive', d)} />}
            {tab === 'about' && <AboutForm data={content.about} onSave={(d) => saveSection('about', d)} />}
            {tab === 'gallery' && <GalleryForm data={content.gallery} onSave={(d) => saveSection('gallery', d)} />}
            {tab === 'videos' && <VideosForm data={content.videos || { heading: 'Videos', lead: '', items: [] }} onSave={(d) => saveSection('videos', d)} />}
            {tab === 'menu' && <MenuPageForm data={content.menu || {}} onSave={(d) => saveSection('menu', d)} />}
            {tab === 'contact' && <ContactForm data={content.contact} onSave={(d) => saveSection('contact', d)} />}
            {tab === 'seo' && <SeoForm data={content.seo} onSave={(d) => saveSection('seo', d)} />}
            {tab === 'media' && <MediaLibrary />}
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${toast.kind === 'err' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          <span className="inline-flex items-center gap-2">
            {toast.kind === 'err' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {toast.msg}
          </span>
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------- shared field components ---------- */

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

function Text({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
  );
}

function SaveBar({ onSave, dirty }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-8">
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty}
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition ${
          dirty
            ? 'bg-indigo-600 hover:bg-indigo-700 ring-4 ring-indigo-600/20'
            : 'cursor-not-allowed bg-gray-300'
        }`}
      >
        <Save className="h-4 w-4" /> Save changes
      </button>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {title && <h3 className="mb-4 text-sm font-semibold text-gray-900">{title}</h3>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/** Upload, preview, or paste a path (e.g. /images/… or /api/media/cms/…). */
function ImageUpload({ value, alt, onChange, section, label = 'Image' }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);
  const previewSrc = normalizeCmsMediaPath(value) || value;

  // Same reset-during-render rule as useDraft: the effect version briefly
  // rendered the previous image's alt text before correcting itself.
  const [altText, setAltText] = useState(alt || '');
  const [altSource, setAltSource] = useState(alt);
  if (altSource !== alt) {
    setAltSource(alt);
    setAltText(alt || '');
  }

  const upload = (file) => {
    if (!file) return;
    setErr(null);
    if (!altText.trim()) { setErr('Please enter alt text before uploading (accessibility).'); return; }
    setBusy(true);
    setProgress(0);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alt', altText);
    if (section) fd.append('section', section);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/cms/media');
    const token = localStorage.getItem('pos_token');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      try {
        const r = JSON.parse(xhr.responseText);
        const url = r.media?.url || r.url;
        if (xhr.status >= 200 && xhr.status < 300 && url) onChange(url, altText);
        else setErr(r.error || 'Upload failed');
      } catch { setErr('Upload failed'); }
    };
    xhr.onerror = () => { setBusy(false); setErr('Network error'); };
    xhr.send(fd);
  };

  return (
    <div className="sm:col-span-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
        {value ? (
          <div className="relative">
            <img src={previewSrc} alt={alt || ''} className="h-28 w-28 rounded-lg border border-gray-200 object-cover" />
            <button type="button" onClick={() => onChange('', altText)} className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
            className="flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 sm:w-64"
          >
            <UploadCloud className="h-6 w-6" />
            <span className="mt-1 text-xs">Click or drag an image (max 5MB)</span>
          </div>
        )}
        <div className="flex-1 space-y-2">
          <input
            value={value || ''}
            onChange={(e) => onChange(normalizeCmsMediaPath(e.target.value), altText)}
            placeholder="/images/your-photo.jpg or /api/media/cms/…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono text-xs"
          />
          <input value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Alt text"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              Upload new
            </button>
            <span className="text-[11px] text-gray-400 self-center">Keep `/images/…` for shipped assets; uploads use `/api/media/cms/…`</span>
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          {busy && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------- section forms ---------- */

/**
 * An editable copy of a prop.
 *
 * Resets during render when `data` changes rather than in an effect. The effect
 * version rendered the form once with the *previous* section's values and then
 * corrected itself, which showed as a flash of the last-edited section when
 * switching between them. Adjusting state during render is React's documented
 * pattern for this and commits no extra render.
 */
function useDraft(data) {
  const [draft, setDraft] = useState(data);
  const [source, setSource] = useState(data);
  if (source !== data) {
    setSource(data);
    setDraft(data);
  }
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  return [draft, set, dirty];
}

function BrandForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const social = d.social || {};
  return (
    <>
      <Card title="Brand & Contact identity">
        <Field label="Full business name"><Text value={d.businessName} onChange={(v) => set({ businessName: v })} /></Field>
        <Field label="Short name"><Text value={d.shortName} onChange={(v) => set({ shortName: v })} /></Field>
        <Field label="Tagline"><Text value={d.tagline} onChange={(v) => set({ tagline: v })} /></Field>
        <Field label="Public email"><Text value={d.email} onChange={(v) => set({ email: v })} type="email" /></Field>
        <Field label="Phone"><Text value={d.phone} onChange={(v) => set({ phone: v })} /></Field>
        <Field label="WhatsApp"><Text value={d.whatsapp} onChange={(v) => set({ whatsapp: v })} /></Field>
        <Field label="Location"><Text value={d.location} onChange={(v) => set({ location: v })} /></Field>
        <Field label="Map embed URL" hint="Google Maps embed src"><Text value={d.mapEmbed} onChange={(v) => set({ mapEmbed: v })} /></Field>
        <ImageUpload label="Logo" value={d.logo} alt={d.businessName} section="brand" onChange={(url) => set({ logo: url })} />
      </Card>
      <div className="mt-4" />
      <Card title="Website look">
        <div className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-700">Colour scheme</span>
          <p className="text-xs text-gray-400">The colour of the lower wall band, buttons and the visit section.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SITE_THEME_OPTIONS.map((theme) => (
              <button key={theme.id} type="button" onClick={() => set({ theme: theme.id })} aria-pressed={(d.theme || 'rato-mato') === theme.id}
                className={`flex items-center gap-3 rounded-xl border-2 p-2.5 text-left text-sm transition-transform duration-150 active:scale-[.97] ${(d.theme || 'rato-mato') === theme.id ? 'border-gray-900' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-gray-200" style={{ background: `linear-gradient(#edebe6 50%, ${theme.color} 50%)` }} />
                <span><span className="block font-semibold text-gray-900">{theme.label}</span><span className="block text-xs text-gray-500">{theme.note}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label="Opening hours" hint="One line per row, e.g. Every day 7am – 9pm. Leave empty to hide hours on the website.">
            <TextArea rows={3} value={d.hours} onChange={(v) => set({ hours: v })} placeholder="Every day 7am – 9pm" />
          </Field>
        </div>
      </Card>
      <div className="mt-4" />
      <Card title="Social links">
        <Field label="Facebook"><Text value={social.facebook} onChange={(v) => set({ social: { ...social, facebook: v } })} /></Field>
        <Field label="Instagram"><Text value={social.instagram} onChange={(v) => set({ social: { ...social, instagram: v } })} /></Field>
        <Field label="TikTok"><Text value={social.tiktok} onChange={(v) => set({ social: { ...social, tiktok: v } })} /></Field>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function HomeForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const sec = d.sections || {};
  const popular = d.popularCategories || [];
  const signature = d.signatureItems || [];
  const steps = d.howItWorksSteps || [];

  const setPopular = (i, patch) => set({
    popularCategories: popular.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });
  const setSignature = (i, patch) => set({
    signatureItems: signature.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });
  const setStep = (i, patch) => set({
    howItWorksSteps: steps.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        All fields below are pre-filled from the live site. Images under <code className="font-mono text-xs">/images/…</code> ship with the app on cPanel.
        Upload only when replacing a photo — uploads go to persistent <code className="font-mono text-xs">/api/media/cms/</code>.
      </p>

      <Card title="Hero">
        <Field label="Heading line 1"><Text value={d.heroHeadingLine1} onChange={(v) => set({ heroHeadingLine1: v })} /></Field>
        <Field label="Heading line 2 (brand color)"><Text value={d.heroHeadingLine2} onChange={(v) => set({ heroHeadingLine2: v })} /></Field>
        <Field label="Heading line 3"><Text value={d.heroHeadingLine3} onChange={(v) => set({ heroHeadingLine3: v })} /></Field>
        <Field label="Eyebrow / microcopy"><Text value={d.heroEyebrow} onChange={(v) => set({ heroEyebrow: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Hero description"><TextArea rows={4} value={d.heroDescription} onChange={(v) => set({ heroDescription: v })} /></Field>
        </div>
        <Field label="Primary CTA label"><Text value={d.primaryCta?.label} onChange={(v) => set({ primaryCta: { ...d.primaryCta, label: v } })} /></Field>
        <Field label="Primary CTA link"><Text value={d.primaryCta?.href} onChange={(v) => set({ primaryCta: { ...d.primaryCta, href: v } })} /></Field>
        <Field label="Secondary CTA label"><Text value={d.secondaryCta?.label} onChange={(v) => set({ secondaryCta: { ...d.secondaryCta, label: v } })} /></Field>
        <Field label="Secondary CTA link" hint="Use whatsapp, tel, or a path"><Text value={d.secondaryCta?.href} onChange={(v) => set({ secondaryCta: { ...d.secondaryCta, href: v } })} /></Field>
        <Field label="Badge value"><Text value={d.heroBadgeValue} onChange={(v) => set({ heroBadgeValue: v })} /></Field>
        <Field label="Badge label"><Text value={d.heroBadgeLabel} onChange={(v) => set({ heroBadgeLabel: v })} /></Field>
        <ImageUpload label="Hero main image" value={d.heroImage} alt={d.heroImageAlt} section="home"
          onChange={(url, a) => set({ heroImage: url, heroImageAlt: a || d.heroImageAlt })} />
        <ImageUpload label="Round photo beside the story (e.g. the fire)" value={d.heroInsetImage} alt={d.heroInsetAlt} section="home"
          onChange={(url, a) => set({ heroInsetImage: url, heroInsetAlt: a || d.heroInsetAlt })} />
      </Card>

      <Card title="Popular categories">
        <Field label="Section title"><Text value={d.popularTitle} onChange={(v) => set({ popularTitle: v })} /></Field>
        <Field label="Section lead"><Text value={d.popularLead} onChange={(v) => set({ popularLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {popular.map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Title"><Text value={c.title} onChange={(v) => setPopular(i, { title: v })} /></Field>
              <Field label="Note"><Text value={c.note} onChange={(v) => setPopular(i, { note: v })} /></Field>
              <ImageUpload label="Image (blank = text tile)" value={c.img} alt={c.title} section="home"
                onChange={(url) => setPopular(i, { img: url })} />
              <button type="button" onClick={() => set({ popularCategories: popular.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove category</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ popularCategories: [...popular, { title: 'New', note: '', img: '', href: '/menu' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add category
          </button>
        </div>
      </Card>

      <Card title="Signature dishes">
        <Field label="Section title"><Text value={d.signatureTitle} onChange={(v) => set({ signatureTitle: v })} /></Field>
        <Field label="Section lead"><Text value={d.signatureLead} onChange={(v) => set({ signatureLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {signature.map((it, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Name"><Text value={it.name} onChange={(v) => setSignature(i, { name: v })} /></Field>
              <Field label="Category"><Text value={it.category} onChange={(v) => setSignature(i, { category: v })} /></Field>
              <ImageUpload label="Image" value={it.img} alt={it.name} section="home"
                onChange={(url) => setSignature(i, { img: url })} />
              <button type="button" onClick={() => set({ signatureItems: signature.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove dish</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ signatureItems: [...signature, { name: 'New dish', category: '', img: '', href: '/menu' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add dish
          </button>
        </div>
      </Card>

      <Card title="How it works">
        <Field label="Title"><Text value={d.howItWorksTitle} onChange={(v) => set({ howItWorksTitle: v })} /></Field>
        <Field label="Lead"><Text value={d.howItWorksLead} onChange={(v) => set({ howItWorksLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label={`Step ${i + 1} title`}><Text value={s.title} onChange={(v) => setStep(i, { title: v })} /></Field>
              <Field label="Text"><Text value={s.text} onChange={(v) => setStep(i, { text: v })} /></Field>
            </div>
          ))}
        </div>
      </Card>

      <Card title="On the menu (preview band)">
        <Field label="Title"><Text value={d.menuTitle} onChange={(v) => set({ menuTitle: v })} /></Field>
        <Field label="Lead"><Text value={d.menuLead} onChange={(v) => set({ menuLead: v })} /></Field>
        <Field label="CTA label"><Text value={d.menuCtaLabel} onChange={(v) => set({ menuCtaLabel: v })} /></Field>
        <Field label="CTA link"><Text value={d.menuCtaHref} onChange={(v) => set({ menuCtaHref: v })} /></Field>
        <p className="sm:col-span-2 text-xs text-gray-500">Menu items and prices always come from the POS menu — edit dishes there.</p>
      </Card>

      <Card title="About strip (home)">
        <Field label="Title"><Text value={d.aboutStripTitle} onChange={(v) => set({ aboutStripTitle: v })} /></Field>
        <Field label="CTA label"><Text value={d.aboutStripCtaLabel} onChange={(v) => set({ aboutStripCtaLabel: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Body text"><TextArea rows={4} value={d.aboutStripText} onChange={(v) => set({ aboutStripText: v })} /></Field>
        </div>
        <ImageUpload label="Story photo" value={d.aboutStripImage} alt={d.aboutStripImageAlt} section="home"
          onChange={(url, a) => set({ aboutStripImage: url, aboutStripImageAlt: a || d.aboutStripImageAlt })} />
      </Card>

      <Card title="Gallery strip + Find us">
        <Field label="Gallery title"><Text value={d.galleryTitle} onChange={(v) => set({ galleryTitle: v })} /></Field>
        <Field label="Gallery CTA"><Text value={d.galleryCtaLabel} onChange={(v) => set({ galleryCtaLabel: v })} /></Field>
        <Field label="Home gallery count"><Text type="number" value={d.galleryLimit} onChange={(v) => set({ galleryLimit: Number(v) || 6 })} /></Field>
        <Field label="Find us title"><Text value={d.findUsTitle} onChange={(v) => set({ findUsTitle: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Find us lead"><Text value={d.findUsLead} onChange={(v) => set({ findUsLead: v })} /></Field>
        </div>
        <p className="sm:col-span-2 text-xs text-gray-500">Gallery photos themselves are edited under the Gallery tab.</p>
      </Card>

      <Card title="Section visibility">
        {['hero', 'popular', 'signature', 'howItWorks', 'menu', 'about', 'gallery', 'findUs'].map((s) => (
          <label key={s} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
            <span className="text-sm capitalize text-gray-700">{s.replace(/([A-Z])/g, ' $1')}</span>
            <button type="button" onClick={() => set({ sections: { ...sec, [s]: !sec[s] } })}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${sec[s] !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {sec[s] !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {sec[s] !== false ? 'Visible' : 'Hidden'}
            </button>
          </label>
        ))}
      </Card>

      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </div>
  );
}

function FestiveForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const items = d.items || [];
  const setItem = (index, patch) => set({
    items: items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
  });
  const moveItem = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    set({ items: next });
  };
  const addItem = () => set({
    items: [...items, {
      id: globalThis.crypto?.randomUUID?.() || `festive-${Date.now()}`,
      image: '', alt: '', eyebrow: '', title: '', linkLabel: '', href: '', visible: true,
    }],
  });

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
        These wide banners appear directly after the home hero and before Special Offers. For the best result, upload a horizontal image around <strong>21:8</strong> and at least <strong>1800px wide</strong>.
      </p>

      <Card title="Festive section">
        <Field label="Section heading"><Text value={d.heading} onChange={(value) => set({ heading: value })} /></Field>
        <Field label="Section introduction"><Text value={d.lead} onChange={(value) => set({ lead: value })} /></Field>
        <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 sm:col-span-2">
          <span className="text-sm text-gray-700">Show festive section on the website</span>
          <button type="button" onClick={() => set({ visible: d.visible === false })}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-transform duration-150 active:scale-[.97] ${d.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {d.visible !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {d.visible !== false ? 'Visible' : 'Hidden'}
          </button>
        </label>
      </Card>

      <Card title={`Festive banners (${items.length})`}>
        <div className="space-y-4 sm:col-span-2">
          {items.map((item, index) => (
            <div key={`${item.id || item.image || 'festive'}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">Banner {index + 1}</p>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={index === 0} onClick={() => moveItem(index, -1)} title="Move up" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-transform duration-150 hover:bg-gray-100 active:scale-[.97] disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} title="Move down" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-transform duration-150 hover:bg-gray-100 active:scale-[.97] disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setItem(index, { visible: item.visible === false })} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium transition-transform duration-150 active:scale-[.97] ${item.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                    {item.visible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {item.visible !== false ? 'Visible' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => set({ items: items.filter((_, itemIndex) => itemIndex !== index) })} title="Remove banner" className="rounded-lg border border-red-200 bg-white p-2 text-red-600 transition-transform duration-150 hover:bg-red-50 active:scale-[.97]"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Small label" hint="For example: Dashain 2083"><Text value={item.eyebrow} onChange={(value) => setItem(index, { eyebrow: value })} /></Field>
                <Field label="Banner title"><Text value={item.title} onChange={(value) => setItem(index, { title: value })} /></Field>
                <Field label="Link label" hint="Leave blank for an image-only banner"><Text value={item.linkLabel} onChange={(value) => setItem(index, { linkLabel: value })} /></Field>
                <Field label="Link destination" hint="Internal path such as /menu, or a complete https:// URL"><Text value={item.href} onChange={(value) => setItem(index, { href: value })} /></Field>
                <Field label="Image alt text" hint="Describe the image for screen readers"><Text value={item.alt} onChange={(value) => setItem(index, { alt: value })} /></Field>
                <ImageUpload label="Wide banner image" value={item.image} alt={item.alt || item.title || 'Festive banner'} section="festive"
                  onChange={(url, alt) => setItem(index, { image: url, alt: alt || item.alt })} />
              </div>
            </div>
          ))}

          {!items.length ? <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">No festive banners yet. The public section stays hidden until you add and save one.</p> : null}
          <button type="button" onClick={addItem} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-transform duration-150 hover:bg-gray-50 active:scale-[.97]">
            <Plus className="h-4 w-4" /> Add festive banner
          </button>
        </div>
      </Card>

      <SaveBar dirty={dirty} onSave={() => onSave({
        ...d,
        items: items.map((item, index) => ({ ...item, order: index })),
      })} />
    </div>
  );
}

function AboutForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const features = d.features || [];
  const images = d.images || [];

  const setFeature = (i, patch) => set({
    features: features.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });

  return (
    <div className="space-y-4">
      <Card title="About page">
        <Field label="Heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <Field label="Visit heading"><Text value={d.visitHeading} onChange={(v) => set({ visitHeading: v })} /></Field>
        <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-sm text-gray-700">Visible on site</span>
          <button type="button" onClick={() => set({ visible: !d.visible })}
            className={`rounded-full px-2 py-1 text-xs font-medium ${d.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {d.visible !== false ? 'Visible' : 'Hidden'}
          </button>
        </label>
        <div className="sm:col-span-2">
          <Field label="Main description"><TextArea rows={4} value={d.description} onChange={(v) => set({ description: v })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Extra paragraph"><TextArea rows={5} value={d.descriptionExtra} onChange={(v) => set({ descriptionExtra: v })} /></Field>
        </div>
        <ImageUpload label="Lead image" value={images[0] || ''} alt={d.heading} section="about"
          onChange={(url) => {
            const next = [...images];
            if (url) next[0] = url; else next.shift();
            set({ images: next.filter(Boolean) });
          }} />
        <ImageUpload label="Second image (optional)" value={images[1] || ''} alt={d.heading} section="about"
          onChange={(url) => {
            const next = [images[0] || ''].filter(Boolean);
            if (url) next.push(url);
            set({ images: next });
          }} />
      </Card>

      <Card title="Feature cards">
        <div className="sm:col-span-2 space-y-3">
          {features.map((f, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Title"><Text value={f.title} onChange={(v) => setFeature(i, { title: v })} /></Field>
              <Field label="Text"><Text value={f.text} onChange={(v) => setFeature(i, { text: v })} /></Field>
              <button type="button" onClick={() => set({ features: features.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ features: [...features, { title: 'New feature', text: '' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add feature
          </button>
        </div>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </div>
  );
}

function GalleryForm({ data, onSave }) {
  // Was its own copy of the useDraft effect; share the hook so there is one
  // definition of "editable copy of a prop" in this file.
  const [d, setDraftPatch, dirty] = useDraft(data);
  const setDraft = (next) => setDraftPatch(typeof next === 'function' ? next(d) : next);
  const items = d.items || [];
  const [newAlt, setNewAlt] = useState('');
  const inputRef = useRef(null);
  const [err, setErr] = useState(null);
  const [pathInput, setPathInput] = useState('');

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setItems = (next) => set({ items: typeof next === 'function' ? next(items) : next });

  const uploadNew = (file) => {
    if (!file) return;
    if (!newAlt.trim()) { setErr('Enter alt text before uploading.'); return; }
    setErr(null);
    const fd = new FormData();
    fd.append('file', file); fd.append('alt', newAlt); fd.append('section', 'gallery');
    fetch('/api/admin/cms/media', { method: 'POST', headers: authHeaders(), body: fd })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Upload failed');
        const url = j.media?.url || j.url;
        if (!url) throw new Error('Upload succeeded but no image URL was returned.');
        setItems((it) => [...it, { url, title: '', alt: newAlt, order: it.length, visible: true }]);
        setNewAlt('');
      })
      .catch((e) => setErr(e.message || 'Upload failed'));
  };

  const addPath = () => {
    const url = normalizeCmsMediaPath(pathInput);
    if (!url) return;
    setItems((it) => [...it, { url, title: '', alt: newAlt || 'Raithane Daure Chulo', order: it.length, visible: true }]);
    setPathInput('');
    setNewAlt('');
  };

  const update = (i, patch) => setItems((it) => it.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i) => setItems((it) => it.filter((_, idx) => idx !== i));

  return (
    <>
      <Card title="Gallery page copy">
        <Field label="Heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <Field label="Lead"><Text value={d.lead} onChange={(v) => set({ lead: v })} /></Field>
      </Card>
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm text-gray-500">
          Prefills use <code className="font-mono text-xs">/images/…</code> from the project folder (also used on cPanel).
          Paste a path or upload a new file to <code className="font-mono text-xs">/api/media/cms/…</code>.
        </p>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={newAlt} onChange={(e) => setNewAlt(e.target.value)} placeholder="Alt text"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="/images/photo.jpg or /api/media/cms/…"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono text-xs" />
          <button type="button" onClick={addPath} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <Plus className="h-4 w-4" /> Add path
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <UploadCloud className="h-4 w-4" /> Upload
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadNew(e.target.files?.[0])} />
        </div>
        {err && <p className="mb-3 text-xs text-red-600">{err}</p>}
        {!items.length ? (
          <p className="py-8 text-center text-sm text-gray-400">No gallery images yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3">
                <img src={normalizeCmsMediaPath(it.url) || it.url} alt={it.alt || ''} className="h-36 w-full rounded-lg object-cover" />
                <input value={it.url || ''} onChange={(e) => update(i, { url: normalizeCmsMediaPath(e.target.value) })} placeholder="Image path"
                  className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono" />
                <input value={it.title || ''} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <input value={it.alt || ''} onChange={(e) => update(i, { alt: e.target.value })} placeholder="Alt text"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={() => update(i, { visible: it.visible === false })}
                    className={`rounded-full px-2 py-0.5 text-xs ${it.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {it.visible !== false ? 'Visible' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <SaveBar dirty={dirty} onSave={() => onSave({ ...d, items: items.map((x, i) => ({ ...x, order: i })) })} />
    </>
  );
}

function VideosForm({ data, onSave }) {
  const [d, setDraftPatch, dirty] = useDraft(data);
  const setDraft = (next) => setDraftPatch(typeof next === 'function' ? next(d) : next);
  const items = d.items || [];
  const [newTitle, setNewTitle] = useState('');
  const inputRef = useRef(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pathInput, setPathInput] = useState('');

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setItems = (next) => set({ items: typeof next === 'function' ? next(items) : next });

  const uploadNew = (file) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', newTitle || file.name || 'Video');
    fd.append('alt', newTitle || 'Video');
    fd.append('section', 'videos');
    fetch('/api/admin/cms/media', { method: 'POST', headers: authHeaders(), body: fd })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
        const url = j.media?.url || j.url;
        if (!url) throw new Error('Upload succeeded but no video URL was returned.');
        setItems((it) => [
          ...it,
          {
            url,
            title: newTitle || '',
            description: '',
            order: it.length,
            visible: true,
          },
        ]);
        setNewTitle('');
      })
      .catch((e) => setErr(e.message || 'Upload failed'))
      .finally(() => setBusy(false));
  };

  const addPath = () => {
    const raw = pathInput.trim();
    if (!raw) return;
    const url = /^(https?:)/i.test(raw) ? raw : normalizeCmsMediaPath(raw);
    setItems((it) => [
      ...it,
      { url, title: newTitle || '', description: '', order: it.length, visible: true },
    ]);
    setPathInput('');
    setNewTitle('');
  };

  const update = (i, patch) => setItems((it) => it.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i) => setItems((it) => it.filter((_, idx) => idx !== i));
  const isFileVideo = (url) => /\.(mp4|webm)(\?|$)/i.test(url || '') || /^\/(?:uploads|api\/media)\//.test(url || '');

  return (
    <>
      <Card title="Videos page copy">
        <Field label="Heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <Field label="Lead"><Text value={d.lead} onChange={(v) => set({ lead: v })} /></Field>
      </Card>
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm text-gray-500">
          Upload MP4/WebM (max 50MB) or paste a YouTube / Vimeo / file URL. Videos appear on the public{' '}
          <code className="font-mono text-xs">/videos</code> page.
        </p>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title (optional)"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="https://youtube.com/... or /api/media/cms/…"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono text-xs" />
          <button type="button" onClick={addPath} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <Plus className="h-4 w-4" /> Add URL
          </button>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
            <UploadCloud className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={inputRef} type="file" accept="video/mp4,video/webm,.mp4,.webm" className="hidden" onChange={(e) => uploadNew(e.target.files?.[0])} />
        </div>
        {err && <p className="mb-3 text-xs text-red-600">{err}</p>}
        {!items.length ? (
          <p className="py-8 text-center text-sm text-gray-400">No videos yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3">
                <div className="aspect-video overflow-hidden rounded-lg bg-black">
                  {isFileVideo(it.url) ? (
                    <video src={normalizeCmsMediaPath(it.url) || it.url} className="h-full w-full object-contain" muted preload="metadata" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-white/80">
                      External link<br /><span className="break-all opacity-70">{it.url}</span>
                    </div>
                  )}
                </div>
                <input
                  value={it.url || ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    update(i, { url: /^(https?:)/i.test(raw) ? raw : normalizeCmsMediaPath(raw) });
                  }}
                  placeholder="Video URL"
                  className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono" />
                <input value={it.title || ''} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <input value={it.description || ''} onChange={(e) => update(i, { description: e.target.value })} placeholder="Short description"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={() => update(i, { visible: it.visible === false })}
                    className={`rounded-full px-2 py-0.5 text-xs ${it.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {it.visible !== false ? 'Visible' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <SaveBar dirty={dirty} onSave={() => onSave({ ...d, items: items.map((x, i) => ({ ...x, order: i })) })} />
    </>
  );
}

const SITE_THEME_OPTIONS = [
  { id: 'rato-mato', label: 'Rato mato', note: 'Red clay', color: '#8e3b24' },
  { id: 'nilo', label: 'Nilo', note: 'Indigo blue', color: '#2e4a66' },
  { id: 'sal', label: 'Sal', note: 'Forest green', color: '#3f5135' },
  { id: 'dhuwa', label: 'Dhuwa', note: 'Smoke black', color: '#2b2420' },
];

function MenuPageForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  return (
    <>
      <Card title="Menu page">
        <Field label="Page heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Introduction"><TextArea rows={2} value={d.lead} onChange={(v) => set({ lead: v })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Ordering note" hint="Shown under the menu and in the order sheet, e.g. how people pay.">
            <TextArea rows={2} value={d.note} onChange={(v) => set({ note: v })} />
          </Field>
        </div>
        <p className="sm:col-span-2 text-xs text-gray-500">Dishes, photos and prices come from the POS menu. Edit them in Products.</p>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function ContactForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  return (
    <>
      <Card title="Contact page">
        <Field label="Page heading"><Text value={d.pageHeading} onChange={(v) => set({ pageHeading: v })} /></Field>
        <Field label="Message form heading"><Text value={d.formHeading} onChange={(v) => set({ formHeading: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Intro text" hint="Shown under the heading">
            <TextArea value={d.intro} onChange={(v) => set({ intro: v })} rows={3} />
          </Field>
        </div>
      </Card>
      <div className="mt-4" />
      <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Phone, WhatsApp, email, location, map and social links are edited once in the <strong>Brand</strong> tab and used across the whole website.
      </p>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function SeoForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  return (
    <>
      <Card title="SEO & sharing">
        <Field label="Page title"><Text value={d.title} onChange={(v) => set({ title: v })} /></Field>
        <Field label="Canonical URL"><Text value={d.canonical} onChange={(v) => set({ canonical: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Meta description" hint="~155 characters"><TextArea value={d.description} onChange={(v) => set({ description: v })} /></Field>
        </div>
        <ImageUpload label="Open Graph image" value={d.ogImage} alt={d.title} section="seo" onChange={(url) => set({ ogImage: url })} />
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function MediaLibrary() {
  const { confirm, prompt, alert } = useConfirm();
  const [media, setMedia] = useState([]);
  const [counts, setCounts] = useState({ uploads: 0, site: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | site | upload | in_use
  const [copied, setCopied] = useState(null);

  /*
   * `loading` already starts true, so the mount path does not need to set it —
   * doing so was a synchronous setState reached straight from the effect. A
   * manual refresh passes `showSpinner` to get the spinner back.
   */
  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (showSpinner) setLoading(true);
    const res = await fetch('/api/admin/cms/media', { headers: authHeaders() });
    const j = await res.json().catch(() => ({ media: [] }));
    setMedia(j.media || []);
    setCounts(j.counts || { uploads: 0, site: 0 });
    setLoading(false);
  }, []);

  useEffect(() => {
    // Inside an async callback rather than the effect body, and guarded so a
    // slow response cannot set state after unmount.
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  const del = async (m) => {
    if (m.source === 'site') {
      await alert({
        title: 'Cannot delete site image',
        message: 'Site images live in public/images and cannot be deleted from the CMS. Remove the file from the server folder if needed.',
      });
      return;
    }
    let res = await fetch(`/api/admin/cms/media?id=${m.id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status === 409) {
      const ok = await confirm({
        title: 'Delete image?',
        message: 'This image is still used in published content. Delete anyway?',
        tone: 'delete',
      });
      if (!ok) return;
      res = await fetch(`/api/admin/cms/media?id=${m.id}&force=1`, { method: 'DELETE', headers: authHeaders() });
    }
    if (res.ok) setMedia((x) => x.filter((i) => i.id !== m.id));
  };

  const copyPath = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      await prompt({
        title: 'Copy image path',
        message: 'Clipboard unavailable. Copy the path below:',
        defaultValue: url,
        required: false,
      });
    }
  };

  const filtered = media.filter((m) => {
    if (filter === 'site') return m.source === 'site';
    if (filter === 'upload') return m.source === 'upload';
    if (filter === 'in_use') return m.in_use;
    return true;
  });

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-800">{counts.site}</span> site images in <code className="text-xs">public/images</code>
          {' · '}
          <span className="font-medium text-gray-800">{counts.uploads}</span> CMS uploads
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'site', label: 'Site folder' },
            { id: 'upload', label: 'Uploads' },
            { id: 'in_use', label: 'In use' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === f.id ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <p className="py-16 text-center text-sm text-gray-400">
          {filter === 'upload'
            ? 'No CMS uploads yet. Upload from any section form — files go to /api/media/cms/.'
            : 'No images found for this filter.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((m) => (
            <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
              <img src={normalizeCmsMediaPath(m.url) || m.url} alt={m.alt || ''} className="h-32 w-full rounded-lg object-cover bg-gray-50" />
              <p className="mt-2 truncate text-xs text-gray-600" title={m.alt || m.url}>{m.alt || m.url.split('/').pop()}</p>
              <p className="truncate font-mono text-[10px] text-gray-400" title={m.url}>{m.url}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.source === 'site' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>
                  {m.source === 'site' ? 'Site' : 'Upload'}
                </span>
                {m.in_use && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">In use</span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                <button type="button" onClick={() => copyPath(m.url)} className="font-medium text-indigo-600 hover:text-indigo-800">
                  {copied === m.url ? 'Copied' : 'Copy path'}
                </button>
                {m.source === 'upload' ? (
                  <button type="button" onClick={() => del(m)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                ) : (
                  <span className="text-[10px]">Folder file</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
