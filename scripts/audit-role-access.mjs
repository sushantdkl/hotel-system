/**
 * Audit what the cashier and waiter UIs can actually reach.
 *
 * For every page granted to a role it resolves the page file (following
 * one-line `export { default } from ...` re-exports), walks its local component
 * imports transitively, extracts every /api/... call together with the HTTP
 * method the UI uses, then reads that route's requireAuth() guard FOR THAT
 * METHOD and reports the mismatches.
 *
 * Usage: node scripts/audit-role-access.mjs [--role cashier|waiter] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const only = args.includes('--role') ? args[args.indexOf('--role') + 1] : null;
const asJson = args.includes('--json');

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const exists = (p) => fs.existsSync(p);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* ── 1. resolve a route href to a page file ────────────────────────────── */
const EXTS = ['.jsx', '.js', '.tsx', '.ts'];

function pageFileFor(href) {
  const clean = href.split('?')[0].replace(/\/$/, '');
  const base = path.join(ROOT, 'app', clean);
  for (const e of EXTS) if (exists(base + '/page' + e)) return base + '/page' + e;
  // dynamic segment fallback: /admin/orders/5 -> app/admin/orders/[id]/page.jsx
  const parts = clean.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = path.join(ROOT, 'app', ...parts.slice(0, i));
    if (!exists(dir) || !fs.statSync(dir).isDirectory()) continue;
    const dyn = fs.readdirSync(dir).find((d) => d.startsWith('[') && d.endsWith(']'));
    if (dyn) {
      const cand = path.join(dir, dyn, 'page');
      for (const e of EXTS) if (exists(cand + e)) return cand + e;
    }
  }
  return null;
}

/* ── 2. resolve an import specifier to a file ──────────────────────────── */
function resolveImport(spec, fromFile) {
  if (!spec.startsWith('@/') && !spec.startsWith('.')) return null;
  const raw = spec.startsWith('@/')
    ? path.join(ROOT, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  for (const e of ['', ...EXTS]) {
    if (exists(raw + e) && fs.statSync(raw + e).isFile()) return raw + e;
  }
  for (const e of EXTS) if (exists(path.join(raw, 'index' + e))) return path.join(raw, 'index' + e);
  return null;
}

/* ── 3. walk a page into its component graph ───────────────────────────── */
const IMPORT_RE = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const REEXPORT_RE = /export\s*\{\s*default[^}]*\}\s*from\s*['"]([^'"]+)['"]/;

function collectFiles(entry, seen = new Set()) {
  if (!entry || seen.has(entry)) return seen;
  seen.add(entry);
  const src = read(entry);
  if (!src) return seen;

  const reexport = src.match(REEXPORT_RE);
  if (reexport) {
    const target = resolveImport(reexport[1], entry);
    if (target) collectFiles(target, seen);
  }
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveImport(m[1], entry);
    if (target && !target.includes('node_modules')) collectFiles(target, seen);
  }
  return seen;
}

/* ── 4. extract /api calls + the method the UI uses ────────────────────── */
const API_RE = /['"`](\/api\/[A-Za-z0-9_\-/[\]${}.:]*)['"`]/g;

function apiCallsIn(file) {
  const src = read(file);
  if (!src) return [];
  const out = [];
  for (const m of src.matchAll(API_RE)) {
    const url = m[1];
    const after = src.slice(m.index, m.index + 400);
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    const explicit = after.match(/method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i);
    const dynamic = !explicit && /method:\s*[A-Za-z_$]/.test(after);
    const line = src.slice(0, m.index).split('\n').length;
    // A 403 swallowed by .catch(() => fallback) degrades the feature silently.
    const swallowed =
      /\.catch\(\s*\(\s*\)\s*=>/.test(after) || /\.catch\(\s*\(\s*\)\s*=>/.test(before.slice(-140));
    out.push({
      url,
      method: explicit ? explicit[1].toUpperCase() : dynamic ? 'DYNAMIC' : 'GET',
      file,
      line,
      swallowed,
    });
  }
  return out;
}

/* ── 5. resolve an /api url to a route file and read its guards ────────── */
function routeFileFor(url) {
  const clean = url
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, ':p')
    .replace(/\/$/, '');
  const parts = clean.split('/').filter(Boolean);
  let dir = path.join(ROOT, 'app');
  for (const part of parts) {
    const direct = path.join(dir, part);
    if (exists(direct) && fs.statSync(direct).isDirectory()) {
      dir = direct;
      continue;
    }
    if (!exists(dir)) return null;
    const dyn = fs.readdirSync(dir).find((d) => d.startsWith('[') && d.endsWith(']'));
    if (dyn) {
      dir = path.join(dir, dyn);
      continue;
    }
    return null;
  }
  for (const e of ['.js', '.ts']) if (exists(path.join(dir, 'route' + e))) return path.join(dir, 'route' + e);
  return null;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Role names mentioned in a role check: `!== 'admin'` or `[...].includes(x.role)`. */
function extractRoles(scope) {
  const roles = new Set();
  for (const m of scope.matchAll(/\.role\s*!==?\s*['"]([a-z]+)['"]/g)) roles.add(m[1]);
  for (const m of scope.matchAll(/\[([^\]]*)\]\s*\.includes\s*\(\s*\w+\.role\s*\)/g)) {
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .forEach((r) => roles.add(r));
  }
  return [...roles];
}

/**
 * `roles: ADMIN_ONLY` is as much a guard as `roles: ['admin']` — resolve the
 * module-level constant so a named array is not reported as "no role check".
 */
function resolveRoleList(raw, src) {
  const literal = raw.match(/roles:\s*\[([^\]]*)\]/);
  if (literal) {
    return literal[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
  }
  const ident = raw.match(/roles:\s*([A-Za-z_$][\w$]*)/);
  if (!ident) return null;
  const decl = src.match(new RegExp(`const\\s+${ident[1]}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!decl) return null;
  return decl[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);
}

/** Guards per exported handler, so a GET-only admin lock is not blamed on POST. */
function guardsFor(routeFile) {
  const src = read(routeFile);
  if (!src) return null;
  const found = {};
  for (const method of METHODS) {
    const m = src.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`));
    if (!m) continue;
    const start = m.index;
    let end = src.length;
    for (const other of METHODS) {
      if (other === method) continue;
      const om = src.slice(start + 1).match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${other}\\s*\\(`));
      if (om) end = Math.min(end, start + 1 + om.index);
    }
    const body = src.slice(start, end);

    // Retired endpoints answer 410 for everyone.
    if (/goneLegacy\s*\(/.test(body)) {
      found[method] = { roles: null, permission: null, note: 'RETIRED (410)' };
      continue;
    }

    const auth = body.match(/requireAuth\s*\(\s*request\s*,\s*\{([\s\S]{0,300}?)\}\s*\)/);
    if (!auth) {
      // requireAuth(request, <non-literal>) — e.g. a ternary picking the guard.
      if (/requireAuth\s*\(\s*request\s*,/.test(body)) {
        found[method] = { roles: null, permission: null, note: 'CONDITIONAL requireAuth — review by hand' };
        continue;
      }
      if (/requireAuth\s*\(\s*request\s*\)/.test(body)) {
        found[method] = { roles: null, permission: null, note: 'requireAuth(request) — any signed-in user' };
        continue;
      }
      // Legacy idiom: inline verifySession(), or a module-level guard helper
      // the handler awaits (verifyAuth/requireStaff/...). Scan both the handler
      // body and, if it delegates, the helper's own definition.
      let scope = body;
      // `await helper(request)` or `return helper(request, context)`
      const delegate = body.match(/(?:await|return)\s+([A-Za-z_$][\w$]*)\s*\(\s*request\b/);
      if (delegate && delegate[1] !== 'requireAuth') {
        const helper = src.match(
          new RegExp(`(?:async\\s+)?function\\s+${delegate[1]}\\s*\\([\\s\\S]{0,4000}?\\n\\}`)
        );
        if (helper) scope = body + '\n' + helper[0];
      }

      // A delegated handler inherits whatever guard the helper runs.
      const viaHelper = scope.match(/requireAuth\s*\(\s*request\s*,\s*\{([\s\S]{0,300}?)\}\s*\)/);
      if (viaHelper) {
        const permH = viaHelper[1].match(/permission:\s*['"]([^'"]+)['"]/);
        found[method] = {
          roles: resolveRoleList(viaHelper[1], src),
          permission: permH ? permH[1] : /permission:/.test(viaHelper[1]) ? '(computed)' : null,
          note: null,
        };
        continue;
      }

      if (/verifySession\s*\(/.test(scope)) {
        const roles = extractRoles(scope);
        found[method] = roles.length
          ? { roles, permission: null, note: 'legacy inline guard' }
          : { roles: null, permission: null, note: 'legacy inline guard — signed-in only, NO role check' };
        continue;
      }
      found[method] = { roles: null, permission: null, note: 'NO GUARD' };
      continue;
    }
    const permM =
      auth[1].match(/permission:\s*['"]([^'"]+)['"]/) ||
      (/permission:/.test(auth[1]) ? [null, '(computed)'] : null);
    found[method] = {
      roles: resolveRoleList(auth[1], src),
      permission: permM ? permM[1] : null,
      note: null,
    };
  }
  return found;
}

/* ── 6. the pages each role is offered ─────────────────────────────────── */
function cashierHrefs() {
  const src = read(path.join(ROOT, 'components/admin/admin-layout.jsx')) || '';
  const block = src.slice(src.indexOf('const cashierNavGroups'), src.indexOf('const rawNavGroups'));
  const out = [];
  for (const m of block.matchAll(/label:\s*'([^']+)',\s*href:\s*'([^']+)'([^}]*)/g)) {
    const perm = m[3].match(/requiredPermission:\s*'([^']+)'/);
    out.push({ label: m[1], href: m[2], permission: perm ? perm[1] : null });
  }
  return out;
}

function waiterHrefs() {
  const out = [];
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, base + '/' + entry.name);
      else if (/^page\.(jsx?|tsx?)$/.test(entry.name)) out.push({ label: base, href: base, permission: null });
    }
  };
  walk(path.join(ROOT, 'app/waiter'), '/waiter');
  // Anything the waiter UI links to that lives outside /waiter.
  for (const { href } of [...out]) {
    const f = pageFileFor(href);
    if (!f) continue;
    const src = read(f) || '';
    for (const m of src.matchAll(/(?:href|push)\(?\s*['"`](\/(?!api\/)[a-z0-9/_-]+)['"`]/gi)) {
      if (!out.some((o) => o.href === m[1])) out.push({ label: m[1], href: m[1], permission: null });
    }
  }
  return out;
}

/* ── 7. run ────────────────────────────────────────────────────────────── */
const ROLES = { cashier: cashierHrefs(), waiter: waiterHrefs() };
const report = { missingPages: [], adminOnly: [], unguarded: [], swallowed: [], anySignedIn: [], retired: [], conditional: [] };

for (const [role, entries] of Object.entries(ROLES)) {
  if (only && role !== only) continue;
  for (const entry of entries) {
    const pageFile = pageFileFor(entry.href);
    if (!pageFile) {
      report.missingPages.push({ role, ...entry });
      continue;
    }

    const calls = [];
    for (const f of collectFiles(pageFile)) calls.push(...apiCallsIn(f));

    const seen = new Set();
    for (const call of calls) {
      const key = `${role}|${call.url}|${call.method}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const routeFile = routeFileFor(call.url);
      if (!routeFile) continue;
      const guards = guardsFor(routeFile);
      if (!guards) continue;

      const methods = call.method === 'DYNAMIC' ? Object.keys(guards) : [call.method];
      for (const method of methods) {
        const g = guards[method];
        if (!g) continue;
        const rec = {
          role,
          page: entry.href,
          url: call.url,
          method,
          route: rel(routeFile),
          at: `${rel(call.file)}:${call.line}`,
          guard: g,
        };

        if (g.note === 'NO GUARD') report.unguarded.push(rec);
        else if (g.note === 'RETIRED (410)') report.retired.push(rec);
        else if (g.note && g.note.startsWith('CONDITIONAL')) report.conditional.push(rec);
        else if (g.roles && !g.roles.includes(role)) {
          // Legacy and modern guards alike: the role is not on the list.
          report.adminOnly.push(rec);
          if (call.swallowed) report.swallowed.push(rec);
        } else if (!g.roles && !g.permission) {
          // No role list AND no permission key: any signed-in user gets in.
          report.anySignedIn.push(rec);
        }
      }
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const dedupe = (rows) => {
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${r.role}|${r.method}|${r.url}|${r.at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const show = (title, rows, fmt) => {
  const list = dedupe(rows);
  console.log(`\n${'='.repeat(78)}\n${title}  (${list.length})\n${'='.repeat(78)}`);
  if (!list.length) {
    console.log('  none');
    return;
  }
  list.forEach((r) => console.log('  ' + fmt(r)));
};

show('NAV ENTRIES POINTING AT A PAGE THAT DOES NOT EXIST', report.missingPages, (r) => `[${r.role}] "${r.label}" -> ${r.href}`);
show(
  'REACHABLE FROM UI BUT GUARD EXCLUDES THE ROLE (visible button that 403s)',
  report.adminOnly,
  (r) =>
    `[${r.role}] ${r.method} ${r.url}\n      route: ${r.route}  roles=[${r.guard.roles}]${r.guard.permission ? ` permission=${r.guard.permission}` : ''}\n      called from ${r.at}   (page ${r.page})`
);
show('SILENTLY DEGRADED (403 swallowed in a catch)', report.swallowed, (r) => `[${r.role}] ${r.method} ${r.url}  at ${r.at}`);
show('ENDPOINTS WITH NO AUTH GUARD AT ALL', report.unguarded, (r) => `${r.method} ${r.url} -> ${r.route}`);
show('ENDPOINTS OPEN TO ANY SIGNED-IN USER (no role check)', report.anySignedIn, (r) => `${r.method} ${r.url} -> ${r.route}   [${r.guard.note || 'requireAuth, no roles'}]`);
show('GUARD IS CONDITIONAL — VERIFY BY HAND', report.conditional, (r) => `[${r.role}] ${r.method} ${r.url} -> ${r.route}`);
show('RETIRED ENDPOINTS STILL CALLED BY UI (410 for everyone)', report.retired, (r) => `[${r.role}] ${r.method} ${r.url}  at ${r.at}`);
