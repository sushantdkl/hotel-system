/** Creates and removes only its own disposable PostgreSQL databases on localhost (one per test file). */
import pg from 'pg';
import { spawnSync } from 'node:child_process';
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL to an isolated local PostgreSQL server; this test never runs against production.');
}
const url = new URL(process.env.TEST_DATABASE_URL);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('TEST_DATABASE_URL must point to an isolated local PostgreSQL test server.');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/integration/production.test.js', 'tests/integration/hotel-pms.test.js'];
const client = new pg.Client({connectionString:url.href});
await client.connect();
try {
  for (const file of files) {
    const name = `km_test_${Date.now()}_${process.pid}`;
    let created=false;
    try {
      await client.query(`CREATE DATABASE "${name}"`); created=true;
      const target=new URL(url);target.pathname=`/${name}`;
      const env={...process.env,DATABASE_URL:target.href,ADMIN_PASSWORD:'KmTestOnly123',RESTAURANT_NAME:'Kathmandu Momo',SKIP_DB_ON_BUILD:''};
      const run=(args)=>{ const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(r.status!==0)throw new Error(`Validation failed (${r.status}): ${args.join(' ')}`); };
      run(['scripts/migrate.mjs']);run(['scripts/seed-postgres.mjs']);
      run(['--import','./tests/unit/loader-register.mjs','--test',file]);
    } finally {
      if(created)await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  }
} finally {
  await client.end();
}
