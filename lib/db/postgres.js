import pg from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { adaptSqlForPostgres, toPgParams } from './sql.js';
import { logger } from '../logger.js';

const { Pool, types } = pg;

export const PG_TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;
export const PG_TIMESTAMP_WITH_TIME_ZONE_OID = 1184;
export const PG_DATE_OID = 1082;

/**
 * OID 1114 is a wall-clock reading, not an instant. Operational timestamps in
 * this database use the established Nepal wall-clock contract. Convert that
 * clock reading at the database boundary so the cPanel process timezone can
 * never supply a different implicit meaning. OID 1184 and OID 1082 are not
 * changed: genuine instants and date-only values keep their native semantics.
 */
export function parseNepalWallClockTimestamp(value) {
  if (value == null || value === '') return value;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) return value;
  const parsed = new Date(`${raw.replace(' ', 'T')}+05:45`);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

types.setTypeParser(PG_TIMESTAMP_WITHOUT_TIME_ZONE_OID, parseNepalWallClockTimestamp);
types.setTypeParser(PG_DATE_OID, (value) => value);

let pool = null;
export const pgTxStore = new AsyncLocalStorage();

function sslConfig() {
  if (process.env.PGSSL !== 'true') return undefined;
  if (process.env.PGSSL_REJECT_UNAUTHORIZED === 'true') {
    return { rejectUnauthorized: true };
  }
  // Shared / self-signed remote endpoints
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Postgres mode');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
      // CURRENT_TIMESTAMP is assigned to legacy timestamp-without-time-zone
      // columns throughout the operational schema. Historical rows contain
      // Nepal wall clocks, so writers must keep using that same contract.
      // A UTC session here would create mixed semantics without a migration.
      options: '-c timezone=Asia/Kathmandu',
    });
    pool.on('error', (err) => {
      logger.error('postgres_pool_error', { message: err.message });
    });
    // Confirm the startup option actually took; some poolers strip options.
    pool.on('connect', (client) => {
      client.query('SHOW TimeZone').then(({ rows }) => {
        const tz = rows?.[0]?.TimeZone ?? rows?.[0]?.timezone;
        if (tz && tz !== 'Asia/Kathmandu') {
          logger.error('postgres_timezone_mismatch', { tz });
        }
      }).catch((err) => {
        logger.error('postgres_timezone_check_failed', { message: err.message });
      });
    });
  }
  return pool;
}

let startupDiagnosticsLogged = false;

const asIso = (value) => value instanceof Date && !Number.isNaN(value.getTime())
  ? value.toISOString()
  : String(value ?? '');

/** Log timestamp semantics once at production startup, never connection data. */
export async function logPostgresStartupDiagnostics() {
  if (startupDiagnosticsLogged) return;
  startupDiagnosticsLogged = true;
  const client = await getPool().connect();
  try {
    const [zone, clock, sample] = await Promise.all([
      client.query('SHOW TimeZone'),
      client.query('SELECT CURRENT_TIMESTAMP AS current_timestamp'),
      client.query("SELECT TIMESTAMP '2026-08-29 21:28:00.552194' AS parser_sample"),
    ]);
    const parsedSample = sample.rows?.[0]?.parser_sample;
    logger.info('postgres_timezone_startup_diagnostic', {
      processEnvTZ: process.env.TZ || null,
      sessionTimeZone: zone.rows?.[0]?.TimeZone ?? zone.rows?.[0]?.timezone ?? null,
      currentTimestampIso: asIso(clock.rows?.[0]?.current_timestamp),
      timestampWithoutTimeZoneSample: '2026-08-29 21:28:00.552194',
      parserResultType: parsedSample instanceof Date ? 'Date' : typeof parsedSample,
      parserResultIso: asIso(parsedSample),
    });
  } catch (error) {
    startupDiagnosticsLogged = false;
    logger.error('postgres_timezone_startup_diagnostic_failed', { message: error.message });
    throw error;
  } finally {
    client.release();
  }
}

function activeClient() {
  return pgTxStore.getStore() || null;
}

export async function pgQuery(sql, params = [], client = null) {
  const adapted = adaptSqlForPostgres(sql);
  const { text, values } = toPgParams(adapted, params);
  const runner = client || activeClient() || getPool();
  if (process.env.DEBUG_SQL === '1') {
    logger.debug('pg_query', { text });
  }
  return runner.query(text, values);
}

// Tables keyed by something other than an `id` column — `RETURNING id` fails on them.
const NO_ID_TABLE_INSERT = /^INSERT\s+INTO\s+"?(role_permissions|user_permissions|staff_custom_roles|hotel_checkout_statements|hotel_command_receipts|hotel_night_audits|hotel_ota_bookings|hotel_folio_windows|hotel_package_settlements)"?[\s(]/i;

export async function pgRun(sql, params = [], client = null) {
  let statement = sql.trim();
  const isInsert = /^INSERT\s+/i.test(statement);
  if (isInsert && !/\bRETURNING\b/i.test(statement) && !NO_ID_TABLE_INSERT.test(statement)) {
    statement = `${statement.replace(/;?\s*$/, '')} RETURNING id`;
  }
  const result = await pgQuery(statement, params, client);
  const row = result.rows?.[0];
  return {
    lastInsertRowid: row?.id ?? null,
    changes: result.rowCount ?? 0,
    rows: result.rows,
  };
}

export async function pgGet(sql, params = [], client = null) {
  const result = await pgQuery(sql, params, client);
  return result.rows[0] || undefined;
}

export async function pgAll(sql, params = [], client = null) {
  const result = await pgQuery(sql, params, client);
  return result.rows;
}

export async function pgTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      driver: 'postgres',
      run: (sql, params) => pgRun(sql, params, client),
      get: (sql, params) => pgGet(sql, params, client),
      all: (sql, params) => pgAll(sql, params, client),
      query: (sql, params) => pgQuery(sql, params, client),
      prepare(sql) {
        return {
          all: async (...args) => pgAll(sql, normalizeParams(args), client),
          get: async (...args) => pgGet(sql, normalizeParams(args), client),
          run: async (...args) => pgRun(sql, normalizeParams(args), client),
        };
      },
    };
    const result = await pgTxStore.run(client, () => fn(tx));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function normalizeParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export async function pingDatabase() {
  const result = await pgQuery('SELECT 1 AS ok');
  return result.rows?.[0]?.ok === 1;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
