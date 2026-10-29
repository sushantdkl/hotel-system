/**
 * Convert SQLite-style `?` placeholders to Postgres `$1, $2, ...`
 */
export function toPgParams(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

/**
 * Rewrite SQLite `date(expr, '+5 hours', '+45 minutes')` (Nepal offset) for Postgres.
 * Must handle exprs with commas (e.g. COALESCE(a, b)) — a naive `[^,]+` regex cannot.
 */
function rewriteNepalDateSql(sql) {
  const marker = "'+5 hours'";
  const marker2 = "'+45 minutes'";
  let out = '';
  let i = 0;
  const lower = sql.toLowerCase();
  while (i < sql.length) {
    const idx = lower.indexOf('date(', i);
    if (idx === -1) {
      out += sql.slice(i);
      break;
    }
    out += sql.slice(i, idx);
    let depth = 0;
    let j = idx + 4; // at '(' of date(
    let startArgs = j + 1;
    let args = null;
    for (; j < sql.length; j++) {
      const ch = sql[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          args = sql.slice(startArgs, j);
          j += 1;
          break;
        }
      }
    }
    if (args == null) {
      out += sql.slice(idx);
      break;
    }
    // Split top-level args: expr, '+5 hours', '+45 minutes'
    const parts = [];
    let buf = '';
    let d = 0;
    let inStr = null;
    for (let k = 0; k < args.length; k++) {
      const ch = args[k];
      if (inStr) {
        buf += ch;
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        inStr = ch;
        buf += ch;
        continue;
      }
      if (ch === '(') d += 1;
      else if (ch === ')') d -= 1;
      if (ch === ',' && d === 0) {
        parts.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    if (
      parts.length === 3 &&
      parts[1].replace(/\s+/g, ' ').toLowerCase() === marker &&
      parts[2].replace(/\s+/g, ' ').toLowerCase() === marker2
    ) {
      out += `((${parts[0]})::date)`;
    } else {
      out += sql.slice(idx, j);
    }
    i = j;
  }
  return out;
}

/**
 * Light dialect tweaks when running on Postgres.
 */
export function adaptSqlForPostgres(sql) {
  let s = sql;
  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE');
  // Nepal-shifted calendar day must come BEFORE the plain date(col) rewrite.
  s = rewriteNepalDateSql(s);
  s = s.replace(/\bdate\s*\(\s*(\?|[a-zA-Z_][\w.]*)\s*\)/gi, '(($1)::date)');
  // SQLite datetime(col) comparisons → plain timestamp
  s = s.replace(/\bdatetime\s*\(\s*(\?|[a-zA-Z_][\w.]*)\s*\)/gi, '(($1)::timestamp)');
  // SQLite char(10) newline → Postgres chr(10)
  s = s.replace(/\bchar\s*\(\s*10\s*\)/gi, 'chr(10)');
  // SQLite GROUP_CONCAT(col, sep) → string_agg
  s = s.replace(
    /\bGROUP_CONCAT\s*\(\s*([^,]+?)\s*,\s*'([^']*)'\s*\)/gi,
    "string_agg(($1)::text, '$2')"
  );
  s = s.replace(/\bGROUP_CONCAT\s*\(\s*([^)]+?)\s*\)/gi, "string_agg(($1)::text, ',')");
  // julianday differences used for averages — approximate with epoch extract
  s = s.replace(
    /julianday\s*\(\s*([^)]+)\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi,
    '(EXTRACT(EPOCH FROM ($1)::timestamp) - EXTRACT(EPOCH FROM ($2)::timestamp)) / 86400.0'
  );
  return s;
}

export function isPostgresUrl(url = process.env.DATABASE_URL) {
  if (!url) return false;
  return /^postgres(ql)?:\/\//i.test(url);
}

export function requirePostgresInProduction() {
  // Allow SQLite in production on Vercel or when explicitly configured as demo/sqlite
  if (process.env.VERCEL === '1' || process.env.DEMO_MODE === '1') return;
  // `next build` sets NODE_ENV=production while collecting route data — skip then.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SKIP_DB_ON_BUILD === '1') return;
  if (process.env.NODE_ENV === 'production' && !isPostgresUrl()) {
    throw new Error(
      'Production requires DATABASE_URL (PostgreSQL). SQLite is not supported in production.'
    );
  }
}
