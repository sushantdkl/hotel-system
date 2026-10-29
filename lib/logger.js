/**
 * Structured production logging with redaction.
 */

const SENSITIVE = /(password|pin|token|authorization|cookie|secret|hash|database_url)/i;

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SENSITIVE.test(value) && value.length > 8) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  const raw = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function write(level, message, meta) {
  if ((LEVELS[level] ?? 2) > currentLevel()) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};

export function clientError(message = 'Something went wrong. Please try again.') {
  return { error: message };
}
