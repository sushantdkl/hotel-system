'use client';

/**
 * Two-step CSV importer: map columns -> preview -> commit. Nothing is written
 * until the owner presses Commit; the preview call is the same endpoint with
 * mode:'preview', which both import APIs already implement.
 *
 * ponytail: CSV only. lib/csv.js parses it in the browser and the routes take
 * plain row objects, so no parser lives on the server. Adding .xlsx is a
 * client-side swap — parse the workbook to `{headers, rows}` in `readFile()`
 * below and everything downstream is unchanged. No xlsx library is installed
 * and none is added here, because a real one (SheetJS/exceljs) is a large
 * dependency for a file format the owner can export as CSV in one click.
 */

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { parseCsv, toCsv } from '@/lib/csv';
import { apiJson } from '@/lib/authed-fetch';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const TONES = {
  added: 'bg-emerald-50 text-emerald-700',
  updated: 'bg-blue-50 text-blue-700',
  duplicate_conflict: 'bg-amber-50 text-amber-700',
  validation_error: 'bg-red-50 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
};

/**
 * @param {object[]} expected      { key, label, required, hint }
 * @param {Function} summarize     apiResponse -> { ok, counts:[{label,value,key}], issues:[{row,status,reason}], detail: JSX }
 * @param {Function} onCommitted   apiResponse -> void
 */
export default function ImportWizard({
  expected,
  sampleRows,
  templateName,
  endpoint,
  summarize,
  onCommitted,
  commitLabel = 'Commit import',
}) {
  const { addToast } = useToast();
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [raw, setRaw] = useState([]);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]); // mapped + editable

  const step = preview ? 3 : raw.length ? 2 : 1;

  function readFile(file) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      addToast(
        friendlyMessage('validation', {
          description: 'Excel files are not supported yet — export the sheet as CSV and upload that.',
        })
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: fileHeaders, rows: parsed } = parseCsv(String(reader.result));
      if (!parsed.length) {
        addToast(friendlyMessage('validation', { description: 'That file has a header row but no data rows.' }));
        return;
      }
      setFileName(file.name);
      setHeaders(fileHeaders);
      setRaw(parsed);
      setPreview(null);
      // Auto-map on a loose name match so a tidy file needs no mapping at all.
      setMapping(
        Object.fromEntries(
          expected.map((col) => [col.key, fileHeaders.find((h) => norm(h) === norm(col.key) || norm(h) === norm(col.label)) || ''])
        )
      );
    };
    reader.readAsText(file);
  }

  const mappedRows = useMemo(
    () =>
      raw.map((row) =>
        Object.fromEntries(expected.map((col) => [col.key, mapping[col.key] ? (row[mapping[col.key]] ?? '') : '']))
      ),
    [raw, mapping, expected]
  );

  const missingRequired = expected.filter((c) => c.required && !mapping[c.key]);

  async function runPreview(sourceRows) {
    setBusy(true);
    try {
      const data = await apiJson(endpoint, {
        method: 'POST',
        body: JSON.stringify({ mode: 'preview', rows: sourceRows }),
      });
      setRows(sourceRows);
      setPreview(data);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const data = await apiJson(endpoint, { method: 'POST', body: JSON.stringify({ mode: 'commit', rows }) });
      addToast(friendlyMessage('save_success', { description: data.message || 'Import committed.' }));
      onCommitted?.(data);
      setRaw([]);
      setRows([]);
      setPreview(null);
      setFileName('');
    } catch (error) {
      // The API hands back its own preview when a row went bad between steps.
      if (error?.preview) setPreview(error.preview);
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const csv = toCsv(expected.map((c) => c.key), sampleRows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${templateName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = preview ? summarize(preview) : null;

  return (
    <div className="space-y-5">
      <Steps step={step} />

      {step === 1 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="text-base font-semibold text-gray-900">Start from the template</h2>
            <p className="mt-1 text-sm text-gray-500">
              These are the columns the importer understands. Your own headers can differ — you map them in the next step.
            </p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    {expected.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {c.label}
                        {c.required && <span className="text-red-500"> *</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sampleRows.map((row, i) => (
                    <tr key={i} className="text-gray-600">
                      {expected.map((c) => (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2">{row[c.key] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={downloadTemplate} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">
              <Download className="h-4 w-4" /> Download template
            </button>
          </Card>

          <div
            className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center ${
              dragOver ? 'border-gray-900 bg-gray-50' : 'border-gray-300 bg-white'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              readFile(e.dataTransfer.files?.[0]);
            }}
          >
            <UploadCloud className="h-8 w-8 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">Upload your CSV</h2>
            <p className="text-sm text-gray-500">Drop the file here, or pick it from your computer.</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Browse files
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          </div>
        </div>
      )}

      {step === 2 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Match your columns</h2>
              <p className="mt-1 text-sm text-gray-500">
                <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
                {fileName} — {raw.length} row{raw.length === 1 ? '' : 's'}. Anything already matched is filled in.
              </p>
            </div>
            <button type="button" onClick={() => setRaw([])} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <ArrowLeft className="h-4 w-4" /> Choose another file
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {expected.map((col) => (
              <label key={col.key} className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {col.label}
                  {col.required && <span className="text-red-600"> *</span>}
                </span>
                <select
                  value={mapping[col.key] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [col.key]: e.target.value }))}
                  className={`h-10 w-full rounded-lg border px-3 text-sm ${
                    col.required && !mapping[col.key] ? 'border-red-300 bg-red-50' : 'border-gray-300'
                  }`}
                >
                  <option value="">Not in my file</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                {col.hint && <span className="mt-1 block text-xs text-gray-400">{col.hint}</span>}
              </label>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  {expected.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappedRows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="text-gray-600">
                    {expected.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2">{row[c.key] || <span className="text-gray-300">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappedRows.length > 5 && (
            <p className="mt-2 text-xs text-gray-400">Showing the first 5 of {mappedRows.length} rows.</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || missingRequired.length > 0}
              onClick={() => runPreview(mappedRows)}
              className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {busy ? 'Checking…' : 'Preview import'}
            </button>
            {missingRequired.length > 0 && (
              <p className="text-sm text-red-600">
                Still need a column for {missingRequired.map((c) => c.label).join(', ')}.
              </p>
            )}
            <p className="text-sm text-gray-500">Nothing is saved until you confirm on the next step.</p>
          </div>
        </Card>
      )}

      {step === 3 && summary && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            {summary.counts.map((c) => (
              <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{c.label}</p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>

          <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${summary.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {summary.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
            <p className="text-sm">{summary.message}</p>
          </div>

          {summary.detail}

          {summary.issues.length > 0 && (
            <Card>
              <h2 className="text-base font-semibold text-gray-900">Rows that need attention</h2>
              <p className="mt-1 text-sm text-gray-500">Fix them in the grid below and preview again, or fix the file and re-upload.</p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Row</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">What is wrong</th>
                      {expected.map((c) => (
                        <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.issues.map((issue) => {
                      const index = issue.row - 1;
                      return (
                        <tr key={issue.row}>
                          <td className="px-3 py-2 text-gray-400">{issue.row}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TONES[issue.status] || TONES.skipped}`}>
                              {String(issue.status).replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{issue.reason}</td>
                          {expected.map((c) => (
                            <td key={c.key} className="px-3 py-2">
                              <input
                                value={rows[index]?.[c.key] ?? ''}
                                onChange={(e) =>
                                  setRows((prev) => {
                                    const next = [...prev];
                                    next[index] = { ...next[index], [c.key]: e.target.value };
                                    return next;
                                  })
                                }
                                className="h-9 w-32 rounded-md border border-gray-300 px-2 text-sm"
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => runPreview(rows)}
                className="mt-4 h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Re-check these rows
              </button>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" /> Back to mapping
            </button>
            <button
              type="button"
              disabled={busy || summary.blockCommit}
              onClick={commit}
              className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {busy ? 'Importing…' : commitLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 animate-in fade-in duration-300">{children}</div>;
}

function Steps({ step }) {
  const labels = ['Upload file', 'Match columns', 'Preview & commit'];
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {labels.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step > n ? 'bg-gray-900 text-white' : step === n ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {n}
            </span>
            <span className={step >= n ? 'font-medium text-gray-900' : 'text-gray-400'}>{label}</span>
            {n < labels.length && <span className="hidden h-px w-8 bg-gray-200 sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}
