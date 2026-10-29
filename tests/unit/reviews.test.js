import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReviewForm, createReview, slugifyReviewForm } from '../../lib/reviews.js';

test('review form builder normalizes its slug, choices, and order', () => {
  assert.equal(slugifyReviewForm('  Dinner & Service  '), 'dinner-service');
  const form = cleanReviewForm({
    title: 'Dinner feedback',
    questions: [
      { label: 'Overall?', field_type: 'rating', is_required: true },
      { label: 'Choose dishes', field_type: 'checkbox', options: ['Momo', ' Thukpa ', 'Momo'] },
    ],
  });
  assert.equal(form.slug, 'dinner-feedback');
  assert.deepEqual(form.questions[1].options, ['Momo', 'Thukpa']);
  assert.equal(form.questions[1].sortOrder, 1);
});

test('review submission validates required answers and records cashier attribution', async () => {
  const writes = [];
  const db = {
    transaction: (fn) => fn({
      run: async (sql, params) => { writes.push({ sql, params }); return { lastInsertRowid: 42 }; },
    }),
  };
  const form = { id: 7, questions: [{ id: 9, label: 'Overall?', field_type: 'rating', options: [], is_required: true }] };
  await assert.rejects(() => createReview({ form, answers: {}, db }), /Please answer/);
  const id = await createReview({ form, customerName: 'Sita', answers: { 9: '5' }, source: 'cashier', user: { id: 3, full_name: 'Ram' }, db });
  assert.equal(id, 42);
  assert.deepEqual(writes[0].params.slice(0, 6), [7, 'Sita', null, 'cashier', 3, 'Ram']);
  assert.equal(writes[1].params[2], '"5"');
});

