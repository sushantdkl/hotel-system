import { getNepaliDateTime } from './time-utils.js';

const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
let runtimeConfig = {
  enabled: true,
  cutoff: VALID_TIME.test(process.env.CASHIER_CLOSING_CUTOFF || '')
    ? process.env.CASHIER_CLOSING_CUTOFF
    : '20:30',
};

const enabledValue = (value, fallback = true) => {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'off', 'no'].includes(String(value).toLowerCase());
};

/** Refresh the policy from persisted admin settings before authorizing a request. */
export async function refreshCashClosingConfig(db) {
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE setting_key IN ('cashier_expected_cash_schedule_enabled','cashier_expected_cash_reveal_time')`
    );
    const settings = Object.fromEntries((rows || []).map((row) => [row.setting_key, row.setting_value]));
    const candidate = String(settings.cashier_expected_cash_reveal_time || runtimeConfig.cutoff);
    runtimeConfig = {
      enabled: enabledValue(settings.cashier_expected_cash_schedule_enabled, true),
      cutoff: VALID_TIME.test(candidate) ? candidate : '20:30',
    };
  } catch {
    // Older databases may not have settings yet. The safe legacy default remains active.
  }
  return { ...runtimeConfig };
}

export function setCashClosingConfig(config = {}) {
  const candidate = String(config.cutoff || runtimeConfig.cutoff);
  runtimeConfig = {
    enabled: enabledValue(config.enabled, runtimeConfig.enabled),
    cutoff: VALID_TIME.test(candidate) ? candidate : runtimeConfig.cutoff,
  };
}

export function cashClosingPolicy(user, now = new Date()) {
  const restricted = user?.role !== 'admin' && runtimeConfig.enabled;
  const available = !restricted || getNepaliDateTime(now).slice(11, 16) >= runtimeConfig.cutoff;
  return {
    cutoff: runtimeConfig.enabled ? runtimeConfig.cutoff : null,
    scheduleEnabled: runtimeConfig.enabled,
    timeZone: 'Asia/Kathmandu',
    expectedCashVisible: available,
    normalCloseAllowed: available,
  };
}

export function assertCashClosingAllowed(user, now = new Date()) {
  const policy = cashClosingPolicy(user, now);
  if (!policy.normalCloseAllowed) throw Object.assign(new Error(policy.cutoff
    ? `Cash reconciliation and normal closing are available from ${policy.cutoff} Nepal time.`
    : 'Cash reconciliation cutoff is invalid. Ask an administrator to review configuration.'),
  { status: 403, code: 'cash_reconciliation_locked', cashPolicy: policy });
}

/** Strip nested snapshots as well as top-level aliases; audit JSON stays JSON. */
export function redactCashReconciliation(value) {
  if (Array.isArray(value)) return value.map(redactCashReconciliation);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/expected|difference|variance|ledger_movement|cash_balance|cashBalance|closing_snapshot|reconciliation|post_close_adjustments/i.test(key)).map(([key, entry]) => {
    if (key === 'cash' && entry && typeof entry === 'object' && !Array.isArray(entry)) return [key, { hidden: true }];
    if (['previous_value', 'new_value', 'detail'].includes(key) && typeof entry === 'string') {
      try { return [key, JSON.stringify(redactCashReconciliation(JSON.parse(entry)))]; } catch { return [key, entry]; }
    }
    return [key, redactCashReconciliation(entry)];
  }));
}

export function cashSafePayload(value, user, now = new Date()) {
  const cashPolicy = cashClosingPolicy(user, now);
  return { ...(cashPolicy.expectedCashVisible ? value : redactCashReconciliation(value)), cashPolicy };
}

/** Aggregate ledger balances can expose the same drawer reconciliation indirectly. */
export function guardReconciliationRead(request, user) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) return;
  const path = new URL(request.url).pathname;
  if (/^\/api\/admin\/(ledger|accounts|finance-dashboard|financial-reports|summary-report)(\/|$)/.test(path)) assertCashClosingAllowed(user);
}
