import Database from '@/lib/db/index.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';

export const REVIEW_FIELD_TYPES = new Set(['rating', 'radio', 'checkbox', 'short_text', 'long_text']);

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return fallback; }
}

export function slugifyReviewForm(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export async function ensureReviewSchema(db = Database.getInstance()) {
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS review_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, slug TEXT NOT NULL UNIQUE,
    thank_you_message TEXT NOT NULL DEFAULT 'Thank you for sharing your feedback.', is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS review_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL, label TEXT NOT NULL, field_type TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]', is_required INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (form_id) REFERENCES review_forms(id) ON DELETE CASCADE)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS customer_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL, customer_name TEXT, customer_phone TEXT,
    source TEXT NOT NULL DEFAULT 'customer', submitted_by INTEGER, submitted_by_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (form_id) REFERENCES review_forms(id) ON DELETE RESTRICT, FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS review_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer TEXT NOT NULL,
    UNIQUE(review_id, question_id), FOREIGN KEY (review_id) REFERENCES customer_reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES review_questions(id) ON DELETE RESTRICT)`);
  await ensureSqliteTable(db, 'CREATE INDEX IF NOT EXISTS idx_review_questions_form ON review_questions(form_id, sort_order, id)');
  await ensureSqliteTable(db, 'CREATE INDEX IF NOT EXISTS idx_customer_reviews_form_status ON customer_reviews(form_id, status, created_at)');
}

export function normalizeQuestion(row) {
  return { ...row, id: Number(row.id), form_id: Number(row.form_id), options: parseJson(row.options), is_required: Boolean(Number(row.is_required)), sort_order: Number(row.sort_order || 0) };
}

export async function getReviewFormBySlug(slug, { includeInactive = false, db = Database.getInstance() } = {}) {
  await ensureReviewSchema(db);
  const form = await db.get(`SELECT * FROM review_forms WHERE slug = ? ${includeInactive ? '' : 'AND is_active = 1'} LIMIT 1`, [slug]);
  if (!form) return null;
  const questions = await db.all('SELECT * FROM review_questions WHERE form_id = ? AND is_active = 1 ORDER BY sort_order, id', [form.id]);
  return { ...form, id: Number(form.id), is_active: Boolean(Number(form.is_active)), questions: questions.map(normalizeQuestion) };
}

export function cleanReviewForm(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  const slug = slugifyReviewForm(body.slug || title);
  if (!title) throw Object.assign(new Error('Form title is required.'), { status: 400 });
  if (!slug) throw Object.assign(new Error('Enter a valid form link.'), { status: 400 });
  const questions = (Array.isArray(body.questions) ? body.questions : []).slice(0, 30).map((q, index) => {
    const label = String(q.label || '').trim().slice(0, 240);
    const fieldType = REVIEW_FIELD_TYPES.has(q.field_type) ? q.field_type : 'short_text';
    const options = ['radio', 'checkbox'].includes(fieldType)
      ? [...new Set((Array.isArray(q.options) ? q.options : []).map((x) => String(x).trim().slice(0, 100)).filter(Boolean))].slice(0, 20)
      : [];
    if (!label) throw Object.assign(new Error(`Question ${index + 1} needs a label.`), { status: 400 });
    if (['radio', 'checkbox'].includes(fieldType) && options.length < 2) throw Object.assign(new Error(`Question ${index + 1} needs at least two choices.`), { status: 400 });
    return { id: Number(q.id) || null, label, fieldType, options, required: Boolean(q.is_required), sortOrder: index };
  });
  if (!questions.length) throw Object.assign(new Error('Add at least one question.'), { status: 400 });
  return { title, slug, description: String(body.description || '').trim().slice(0, 500), thankYou: String(body.thank_you_message || '').trim().slice(0, 300) || 'Thank you for sharing your feedback.', active: body.is_active !== false, questions };
}

export async function createReview({ form, customerName, customerPhone, answers, source = 'customer', user = null, db = Database.getInstance() }) {
  const answerMap = answers && typeof answers === 'object' ? answers : {};
  const cleaned = [];
  for (const question of form.questions) {
    const raw = answerMap[question.id] ?? answerMap[String(question.id)];
    let value;
    if (question.field_type === 'checkbox') {
      value = (Array.isArray(raw) ? raw : []).map(String).filter((x) => question.options.includes(x)).slice(0, question.options.length);
    } else if (question.field_type === 'rating') {
      const rating = Number(raw);
      value = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? String(rating) : '';
    } else {
      value = String(raw ?? '').trim().slice(0, question.field_type === 'long_text' ? 2000 : 300);
      if (question.field_type === 'radio' && value && !question.options.includes(value)) value = '';
    }
    if (question.is_required && (!value || (Array.isArray(value) && !value.length))) throw Object.assign(new Error(`Please answer “${question.label}”.`), { status: 400 });
    if (value && (!Array.isArray(value) || value.length)) cleaned.push({ questionId: question.id, answer: JSON.stringify(value) });
  }
  const name = String(customerName || '').trim().slice(0, 120);
  const phone = String(customerPhone || '').trim().slice(0, 40);
  return db.transaction(async (tx) => {
    const result = await tx.run(`INSERT INTO customer_reviews
      (form_id, customer_name, customer_phone, source, submitted_by, submitted_by_name, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')`, [form.id, name || null, phone || null, source, user?.id || null, user?.full_name || user?.username || null]);
    for (const row of cleaned) await tx.run('INSERT INTO review_answers (review_id, question_id, answer) VALUES (?, ?, ?)', [result.lastInsertRowid, row.questionId, row.answer]);
    return result.lastInsertRowid;
  });
}

export async function listReviews({ status = null, limit = 200, db = Database.getInstance() } = {}) {
  await ensureReviewSchema(db);
  const params = [];
  const where = status ? (params.push(status), 'WHERE cr.status = ?') : '';
  const rows = await db.all(`SELECT cr.*, rf.title AS form_title FROM customer_reviews cr JOIN review_forms rf ON rf.id = cr.form_id ${where} ORDER BY cr.created_at DESC, cr.id DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))}`, params);
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const answers = await db.all(`SELECT ra.review_id, ra.answer, rq.label, rq.field_type FROM review_answers ra JOIN review_questions rq ON rq.id = ra.question_id WHERE ra.review_id IN (${placeholders}) ORDER BY rq.sort_order, rq.id`, ids);
  return rows.map((row) => ({ ...row, id: Number(row.id), form_id: Number(row.form_id), answers: answers.filter((a) => Number(a.review_id) === Number(row.id)).map((a) => ({ label: a.label, field_type: a.field_type, value: parseJson(a.answer, '') })) }));
}
