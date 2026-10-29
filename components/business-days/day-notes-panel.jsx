'use client';

/**
 * "Notes & closing history" — the one place the free text people typed during a
 * business day is surfaced: the opening note, the closing note, the
 * force-close reason, and every audit entry that carries a reason.
 *
 * Used on the open-day screen and in the closing-report dialog. The dialog
 * already fetches the audit array from /api/admin/business-days/[id]; it just
 * has to pass it in.
 */

/** 'store_session_opened' -> 'Store session opened' */
function actionName(action) {
  const clean = String(action || '').replaceAll('_', ' ').trim();
  if (!clean) return 'Change';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function Note({ label, text, tone = 'default' }) {
  const rule = tone === 'warn' ? 'border-amber-400' : 'border-gray-300';
  const labelTone = tone === 'warn' ? 'text-amber-800' : 'text-gray-500';
  return (
    <div className={`border-l-2 pl-3 ${rule}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${labelTone}`}>{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{text}</p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.day    business_days row (opening/closing note, force close)
 * @param {Array}  [props.audit] business_day_audit rows, newest first
 */
export default function DayNotesPanel({ day, audit = [], className = '' }) {
  if (!day) return null;

  const notes = [
    day.opening_note && { key: 'opening', label: 'Opening note', text: day.opening_note },
    day.closing_note && { key: 'closing', label: 'Closing note', text: day.closing_note },
    day.force_closed && day.force_close_reason
      ? { key: 'force', label: 'Force-close reason', text: day.force_close_reason, tone: 'warn' }
      : null,
  ].filter(Boolean);

  const reasons = (Array.isArray(audit) ? audit : []).filter((row) => String(row?.reason || '').trim());

  if (!notes.length && !reasons.length) return null;

  return (
    <section className={`border border-gray-200 bg-white px-4 py-4 sm:px-5 ${className}`}>
      <h2 className="text-sm font-semibold text-gray-950">Notes &amp; closing history</h2>

      {notes.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {notes.map((note) => (
            <Note key={note.key} label={note.label} text={note.text} tone={note.tone} />
          ))}
        </div>
      )}

      {reasons.length > 0 && (
        <>
          <div className="mt-4 border-t border-gray-200" />
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Recorded reasons
          </p>
          <ul className="mt-2 space-y-1.5">
            {reasons.map((row) => (
              <li key={row.id} className="text-sm text-gray-700">
                <span className="font-semibold text-gray-950">{actionName(row.action)}</span>
                <span className="text-gray-400"> · </span>
                {/* Legacy/system actions may have no actor. */}
                <span className="text-gray-600">{row.actor_full_name || row.actor_name || 'System'}</span>
                <span className="text-gray-400">: </span>
                <span className="whitespace-pre-wrap">{row.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
