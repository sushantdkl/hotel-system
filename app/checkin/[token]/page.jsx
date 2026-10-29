'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

const input = 'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-stone-900';

export default function OnlineCheckinPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/public/checkin/${token}`, { cache: 'no-store' })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || 'This link is not valid.'); setData(body); })
      .catch((err) => setError(err.message));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/checkin/${token}`, { method: 'POST', body: new FormData(event.currentTarget) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save your details.');
      setDone(body.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-lg space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{data?.property || 'Online check-in'}</p>
          <h1 className="mt-1 text-2xl font-bold text-stone-950">Check in before you arrive</h1>
          {data && <p className="mt-1 text-sm text-stone-600">{data.roomType} · {data.arrival} → {data.departure} · {data.guests} guest{data.guests > 1 ? 's' : ''}</p>}
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {done ? (
          <div role="status" className="rounded-2xl border border-emerald-200 bg-white p-6 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><p className="mt-3 font-semibold text-stone-900">{done}</p><p className="mt-1 text-sm text-stone-500">Please bring the same ID with you.</p></div>
        ) : data && (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            {data.completedAt && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">You already checked in online. You can update your details below.</p>}
            <label className="block text-sm font-medium text-stone-700">Full name (as on ID)<input name="name" required maxLength={100} defaultValue={data.guest} autoComplete="name" className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-stone-700">Phone<input name="phone" required maxLength={30} type="tel" defaultValue={data.phone} autoComplete="tel" className={input} /></label>
              <label className="block text-sm font-medium text-stone-700">Email<input name="email" type="email" maxLength={120} defaultValue={data.email} autoComplete="email" className={input} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-stone-700">Nationality<input name="nationality" maxLength={60} defaultValue={data.nationality} className={input} /></label>
              <label className="block text-sm font-medium text-stone-700">Arrival time<input name="eta" type="time" defaultValue={data.eta} className={input} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-stone-700">ID type<select name="idType" required defaultValue={data.idType} className={input}><option value="" disabled>Choose</option>{data.idTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="block text-sm font-medium text-stone-700">ID number<input name="idNumber" required maxLength={60} defaultValue={data.idNumber} className={input} /></label>
            </div>
            <label className="block text-sm font-medium text-stone-700">Address<input name="address" maxLength={300} defaultValue={data.address} autoComplete="street-address" className={input} /></label>
            <label className="block text-sm font-medium text-stone-700">Photo of your ID (optional, JPG/PNG/PDF up to 2 MB)<input name="idPhoto" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1 block w-full text-sm" /></label>
            <p className="text-xs text-stone-500">Your details are used only for your stay and the hotel’s legal guest register.</p>
            <button disabled={busy} className="w-full rounded-xl bg-stone-900 px-4 py-3 font-bold text-white hover:bg-stone-800 disabled:opacity-50">{busy ? 'Saving…' : 'Complete online check-in'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
