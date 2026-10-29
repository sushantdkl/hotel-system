import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordedCashMovements,
  summarizeBillComposition,
  summaryAccountRows,
} from '../../lib/summary-account.js';

const movement = (debit, credit) => ({ debit, credit, net: debit - credit });

test('Summary Report explains the production closing cash equation including recorded cash out', () => {
  const account = {
    opening: 23320,
    closing: 9235,
    movements: {
      bill: movement(4405, 0),
      purchase: movement(0, 950),
      expense: movement(0, 1700),
      exchange: movement(0, 840),
      cash_movement: movement(0, 15000),
    },
  };

  const rows = summaryAccountRows(account, { cash: true });
  const recordedOut = rows.find((row) => row.label === 'Recorded Cash Out');
  assert.deepEqual(recordedOut, {
    label: 'Recorded Cash Out', value: 15000, sign: '-', signedValue: -15000,
  });

  const explainedClosing = rows.slice(0, -1).reduce((sum, row) => sum + row.signedValue, 0);
  assert.equal(explainedClosing, 9235);
  assert.equal(rows.at(-1).value, 9235);
  assert.deepEqual(recordedCashMovements(account), { cash_in: 0, cash_out: 15000, deposit: 0 });
});

test('all opening adjustment sources are added instead of selecting only the first truthy one', () => {
  const rows = summaryAccountRows({
    opening: 1000,
    closing: 950,
    movements: {
      opening_cash_movement: movement(0, 100),
      opening_cash_alignment: movement(50, 0),
    },
  }, { cash: true });

  assert.equal(rows.find((row) => row.label === 'Opening Adjustment').signedValue, -50);
});

test('an unfamiliar journal source cannot silently disappear from account reconciliation', () => {
  const rows = summaryAccountRows({
    opening: 100,
    closing: 125,
    movements: { future_source: movement(25, 0) },
  });

  assert.equal(rows.find((row) => row.label === 'Other Ledger Movements').signedValue, 25);
  assert.equal(rows.slice(0, -1).reduce((sum, row) => sum + row.signedValue, 0), 125);
});

test('pre-discount category value reconciles visibly to finalized sales', () => {
  assert.deepEqual(summarizeBillComposition({
    subtotal: 12915,
    discounts: 5,
    tax: 0,
    service_charge: 0,
    finalized_total: 12910,
  }, 12910), {
    subtotal: 12915,
    discounts: 5,
    tax: 0,
    service_charge: 0,
    other_bill_adjustments: 0,
    finalized_bill_total: 12910,
    ledger_bill_difference: 0,
  });
});

test('delivery, rounding, and ledger posting differences are never hidden', () => {
  assert.deepEqual(summarizeBillComposition({
    subtotal: 100,
    discounts: 10,
    tax: 5,
    service_charge: 5,
    finalized_total: 107,
  }, 105), {
    subtotal: 100,
    discounts: 10,
    tax: 5,
    service_charge: 5,
    other_bill_adjustments: 7,
    finalized_bill_total: 107,
    ledger_bill_difference: -2,
  });
});
