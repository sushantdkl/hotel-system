/** Compare the data section of two db-upgrade-snapshot outputs. */
import fs from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: node scripts/compare-db-snapshots.mjs BEFORE.json AFTER.json');
  process.exit(1);
}

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const changes = [];

function compare(path, left, right) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of [...keys].sort()) {
    const nextPath = path ? `${path}.${key}` : key;
    const a = left?.[key];
    const b = right?.[key];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      compare(nextPath, a, b);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ metric: nextPath, before: a ?? null, after: b ?? null });
    }
  }
}

compare('data', before.data, after.data);
if (changes.length) {
  console.error('Data fingerprint changed during the upgrade:');
  console.table(changes);
  process.exit(2);
}

const addedMigrations = (after.schema_migrations || []).filter(
  (version) => !(before.schema_migrations || []).includes(version)
);
console.log('Data counts and financial aggregates match.');
console.log(`New migration records: ${addedMigrations.length}`);
for (const version of addedMigrations) console.log(`  + ${version}`);
