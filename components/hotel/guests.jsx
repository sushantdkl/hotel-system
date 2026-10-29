'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { money, shortDate } from '@/lib/hotel/view';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

const ID_TYPES = ['Citizenship', 'Passport', 'Driving licence', 'National ID', 'Voter ID', 'Other'];
const STAY_TONE = { confirmed: 'green', in_house: 'blue', checked_out: 'gray', cancelled: 'rose' };
const empty = { name: '', phone: '', email: '', nationality: '', idType: '', idNumber: '', address: '', vip: false, blacklisted: false, notes: '' };

export default function Guests({ initialId }) {
  const { confirm } = useHotel();
  const [modal, setModal] = useState(null); // 'edit' | 'new' | 'upload'
  const [query, setQuery] = useState('');
  const [guests, setGuests] = useState([]);
  const [selectedId, setSelectedId] = useState(initialId || null);
  const [guest, setGuest] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async (q) => {
    try { setGuests((await apiJson(`/api/hotel/guests?q=${encodeURIComponent(q)}`)).guests || []); }
    catch (err) { setError(err.error || 'Could not load guests.'); }
  }, []);
  const loadGuest = useCallback(async (id) => {
    if (!id) { setGuest({ ...empty, stays: [], documents: [] }); return; }
    try { setGuest((await apiJson(`/api/hotel/guests/${id}`)).guest); setError(''); }
    catch (err) { setError(err.error || 'Could not load this guest.'); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadList(query); }, 250);
    return () => clearTimeout(timer);
  }, [query, loadList]);
  useEffect(() => { if (selectedId !== null) void Promise.resolve().then(() => loadGuest(selectedId)); }, [selectedId, loadGuest]);

  const run = async (fn, okMessage) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await fn(); setNotice(okMessage || result?.message || 'Saved.'); return result; }
    catch (err) { setError(err.error || err.message || 'Could not save.'); return null; }
    finally { setBusy(false); }
  };

  const save = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const result = await run(() => apiJson('/api/hotel/guests', { method: 'POST', body: JSON.stringify({ ...form, id: modal === 'edit' ? guest.id : undefined, vip: form.vip === 'on', blacklisted: form.blacklisted === 'on' }) }));
    if (result) { setModal(null); setSelectedId(result.id); await loadGuest(result.id); await loadList(query); }
  };

  const upload = async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const result = await run(async () => {
      const response = await authedRequest(`/api/hotel/guests/${guest.id}`, { method: 'POST', body: new FormData(formEl) });
      const data = await response.json();
      if (!response.ok) throw data;
      return data;
    });
    if (result) { setModal(null); await loadGuest(guest.id); await loadList(query); }
  };

  const removeDocument = async (doc) => {
    if (!(await confirm({ title: `Remove ${doc.label}?`, message: `${doc.fileName} is deleted from ${guest.name}’s profile. This cannot be undone.`, confirmLabel: 'Remove', danger: true }))) return;
    if (await run(() => apiJson(`/api/hotel/guest-documents/${doc.id}`, { method: 'DELETE' }))) { await loadGuest(guest.id); await loadList(query); }
  };
  const open = (kind) => { setError(''); setNotice(''); setModal(kind); };
  const formGuest = modal === 'edit' ? guest : empty;

  const viewDocument = async (doc) => {
    const response = await authedRequest(`/api/hotel/guest-documents/${doc.id}`);
    if (!response.ok) { setError('Could not open this document.'); return; }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return <div className={s.guestLayout}>
    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Guests</h2><button className={s.secondary} onClick={() => open('new')}><Plus size={14} />New</button></div>
      <div className={s.panelBody}><label className={s.search}><Search size={15} /><input aria-label="Search guests" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone or ID number…" /></label></div>
      <div>{guests.map((g) => <button key={g.id} className={s.folioChoice} aria-pressed={g.id === selectedId} onClick={() => setSelectedId(g.id)}>
        <div className={s.name}>{g.name}</div>
        <p className={s.small}>{g.phone || 'No phone'} · {g.stays} stay{g.stays === 1 ? '' : 's'} · {g.documents} ID file{g.documents === 1 ? '' : 's'}</p>
        <div className={`${s.actions} mt-2`}>{g.vip && <Badge tone="amber">VIP</Badge>}{g.blacklisted && <Badge tone="rose">Blacklisted</Badge>}</div>
      </button>)}{!guests.length && <p className={s.empty}>No guests found.</p>}</div>
    </section>

    <div className={s.stack}>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {notice && <p role="status" className={s.formNote}>{notice}</p>}
      {!guest?.id ? <p className={s.empty}>Select a guest, or create a new profile.</p> : <>
        <section className={s.panel}>
          <div className={s.panelHeader}><h2 className={s.panelTitle}>{guest.name}<span className={`${s.small} ml-2`}>{guest.id}</span></h2><button className={s.secondary} onClick={() => open('edit')}><Pencil size={14} />Edit profile</button></div>
          <div className={s.panelBody}>
            <div className={s.formRow}><div><p className={s.small}>Phone</p><strong>{guest.phone || '—'}</strong></div><div><p className={s.small}>Email</p><strong>{guest.email || '—'}</strong></div></div>
            <div className={`${s.formRow} mt-3`}><div><p className={s.small}>Nationality</p><strong>{guest.nationality || '—'}</strong></div><div><p className={s.small}>ID</p><strong>{guest.idType ? `${guest.idType} · ${guest.idNumber || 'no number'}` : 'Not recorded'}</strong></div></div>
            {guest.address && <div className="mt-3"><p className={s.small}>Address</p><strong>{guest.address}</strong></div>}
            {guest.notes && <p className={`${s.formNote} mt-3`}>{guest.notes}</p>}
            {(guest.vip || guest.blacklisted) && <div className={`${s.actions} mt-3`}>{guest.vip && <Badge tone="amber">VIP</Badge>}{guest.blacklisted && <Badge tone="rose">Blacklisted · cannot be booked</Badge>}</div>}
          </div>
        </section>

        {guest.id && <section className={s.panel}>
          <div className={s.panelHeader}><h2 className={s.panelTitle}>ID & KYC documents<span className={s.count}>{guest.documents.length}</span></h2><button className={s.secondary} disabled={busy} onClick={() => open('upload')}><Upload size={14} />Upload</button></div>
          <div className={s.panelBody}>
            {guest.documents.map((d) => <div key={d.id} className={`${s.actions} justify-between py-2`}>
              <button className={s.textButton} onClick={() => viewDocument(d)}><FileText size={14} />{d.label} · {d.fileName}</button>
              <span className={s.actions}><span className={s.small}>{Math.ceil(d.size / 1024)} KB</span><button className={s.iconButton} aria-label={`Remove ${d.label}`} disabled={busy} onClick={() => removeDocument(d)}><Trash2 size={15} /></button></span>
            </div>)}
            {!guest.documents.length && <p className={s.small}>No ID documents yet.</p>}
            <p className={`${s.small} mt-2`}>Documents are private: they are stored in the database and only staff with front-desk access can open them.</p>
          </div>
        </section>}

        {guest.id && <section className={s.panel}>
          <div className={s.panelHeader}><h2 className={s.panelTitle}>Stay history<span className={s.count}>{guest.stays.length}</span></h2></div>
          <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Reservation</th><th>Room</th><th>Dates</th><th>Rate</th><th>Status</th></tr></thead><tbody>
            {guest.stays.map((st) => <tr key={st.id}><td>{st.id}{st.groupId && <p className={s.small}>{st.groupId}</p>}</td><td>{st.room}</td><td>{shortDate(st.start)} → {shortDate(st.end)}</td><td>{money(st.rate)}</td><td><Badge tone={STAY_TONE[st.status] || 'gray'}>{st.status.replace('_', ' ')}</Badge></td></tr>)}
          </tbody></table>{!guest.stays.length && <p className={s.empty}>No stays yet.</p>}</div>
        </section>}
      </>}
    </div>

    {(modal === 'edit' || modal === 'new') && <Modal title={modal === 'edit' ? `Edit ${guest.name}` : 'New guest'} onClose={() => setModal(null)}>
      <form className={s.form} onSubmit={save}>
        <div className={s.formRow}><label>Full name<input name="name" required maxLength={100} defaultValue={formGuest.name} /></label><label>Phone<input name="phone" type="tel" maxLength={30} defaultValue={formGuest.phone} /></label></div>
        <div className={s.formRow}><label>Email<input name="email" type="email" maxLength={120} defaultValue={formGuest.email} /></label><label>Nationality<input name="nationality" maxLength={60} defaultValue={formGuest.nationality} /></label></div>
        <div className={s.formRow}><label>ID type<select name="idType" defaultValue={formGuest.idType}><option value="">Not recorded</option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label><label>ID number<input name="idNumber" maxLength={60} defaultValue={formGuest.idNumber} /></label></div>
        <label>Address<input name="address" maxLength={300} defaultValue={formGuest.address} /></label>
        <label>Notes & preferences<textarea name="notes" rows={2} maxLength={1000} defaultValue={formGuest.notes} /></label>
        <div className={s.actions}><label className={s.checkLabel}><input type="checkbox" name="vip" defaultChecked={formGuest.vip} />VIP</label><label className={s.checkLabel}><input type="checkbox" name="blacklisted" defaultChecked={formGuest.blacklisted} />Blacklisted (cannot be booked)</label></div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : modal === 'edit' ? 'Save profile' : 'Create guest'}</button></div>
      </form>
    </Modal>}
    {modal === 'upload' && <Modal title={`Upload ID for ${guest.name}`} onClose={() => setModal(null)}>
      <form className={s.form} onSubmit={upload}>
        <label>Label<input name="label" maxLength={60} placeholder="e.g. Passport front" /></label>
        <label>File (JPG, PNG, WebP or PDF, up to 2 MB)<input name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button></div>
      </form>
    </Modal>}
  </div>;
}
