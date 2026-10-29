/** Minimal quoted-comma-aware CSV parser/writer — no external dependency. */
import { pathToFileURL } from 'url';

function splitLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** @returns {{ headers: string[], rows: Record<string,string>[] }} */
export function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });

  return { headers, rows };
}

function escapeCell(value) {
  let str = String(value ?? '');
  // Keep spreadsheet applications from treating user-entered text as a formula.
  // Numeric values (including negative amounts) remain numeric in the export.
  if (typeof value === 'string' && /^[=+@]/.test(str)) str = `'${str}`;
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  // BOM + CRLF makes UTF-8 CSVs open correctly in Excel (including Nepali text
  // and characters such as the em dash) while remaining valid CSV elsewhere.
  return `\uFEFF${lines.join('\r\n')}`;
}

// ponytail: run `node lib/csv.js` to self-check the parser/writer round-trip.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const csv = 'Item Name,Cost\n"Chili, Fresh",12.5\nOil,"8.00"';
  const { headers, rows } = parseCsv(csv);
  console.assert(headers.length === 2, 'expected 2 headers');
  console.assert(rows[0]['Item Name'] === 'Chili, Fresh', 'quoted comma parse failed');
  console.assert(rows[1]['Cost'] === '8.00', 'quoted plain value parse failed');
  console.assert(toCsv(headers, rows).includes('"Chili, Fresh"'), 'round-trip quoting failed');
  console.log('csv.js self-check passed');
}
