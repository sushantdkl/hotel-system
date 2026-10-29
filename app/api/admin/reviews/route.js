import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { cleanReviewForm, createReview, ensureReviewSchema, getReviewFormBySlug, listReviews } from '@/lib/reviews.js';
import { getPublicAppUrl } from '@/lib/app-url.js';
import { isAdminLike } from '@/lib/roles.js';

async function allForms(db) {
  const forms = await db.all(`SELECT rf.*, COUNT(DISTINCT rq.id) AS question_count, COUNT(DISTINCT cr.id) AS response_count
    FROM review_forms rf LEFT JOIN review_questions rq ON rq.form_id = rf.id LEFT JOIN customer_reviews cr ON cr.form_id = rf.id
    GROUP BY rf.id ORDER BY rf.is_active DESC, rf.created_at DESC`);
  return forms.map((f) => ({ ...f, id: Number(f.id), is_active: Boolean(Number(f.is_active)), question_count: Number(f.question_count || 0), response_count: Number(f.response_count || 0) }));
}

async function replaceQuestions(tx, formId, questions) {
  await tx.run('UPDATE review_questions SET is_active = 0 WHERE form_id = ?', [formId]);
  for (const q of questions) {
    const existing = q.id ? await tx.get('SELECT id FROM review_questions WHERE id = ? AND form_id = ?', [q.id, formId]) : null;
    if (existing) await tx.run(`UPDATE review_questions SET label = ?, field_type = ?, options = ?, is_required = ?, is_active = 1, sort_order = ? WHERE id = ?`, [q.label, q.fieldType, JSON.stringify(q.options), q.required ? 1 : 0, q.sortOrder, q.id]);
    else await tx.run(`INSERT INTO review_questions (form_id, label, field_type, options, is_required, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)`, [formId, q.label, q.fieldType, JSON.stringify(q.options), q.required ? 1 : 0, q.sortOrder]);
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reviews.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureReviewSchema(db);
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (slug) {
      const form = await getReviewFormBySlug(slug, { includeInactive: isAdminLike(auth.user.role), db });
      if (!form) return NextResponse.json({ error: 'Review form not found.' }, { status: 404 });
      if (url.searchParams.get('qr') === '1') {
        const origin = getPublicAppUrl(request);
        if (!origin) return NextResponse.json({ error: 'Set APP_URL so the QR code can use the public website address.' }, { status: 500 });
        const link = `${origin}/review/${encodeURIComponent(form.slug)}`;
        return NextResponse.json({ form: { id: form.id, title: form.title, slug: form.slug }, url: link, svg: await QRCode.toString(link, { type: 'svg', margin: 1, width: 360 }) });
      }
      return NextResponse.json({ form });
    }
    const manageAuth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reviews.manage' });
    const canManage = !manageAuth.error;
    const forms = await allForms(db);
    const reviews = canManage ? await listReviews({ db }) : [];
    return NextResponse.json({ forms, reviews, role: auth.user.role, canManage });
  } catch (error) { return handleRouteError(error, 'Could not load customer reviews.'); }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reviews.access' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const db = Database.getInstance();
    await ensureReviewSchema(db);
    if (body.action === 'submit_review') {
      const form = await getReviewFormBySlug(String(body.slug || ''), { includeInactive: false, db });
      if (!form) return NextResponse.json({ error: 'Choose an active review form.' }, { status: 404 });
      const id = await createReview({ form, customerName: body.customer_name, customerPhone: body.customer_phone, answers: body.answers, source: 'cashier', user: auth.user, db });
      return NextResponse.json({ message: 'Customer review saved for admin approval.', id }, { status: 201 });
    }
    const manageAuth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reviews.manage' });
    if (manageAuth.error) return manageAuth.error;
    const data = cleanReviewForm(body);
    const id = await db.transaction(async (tx) => {
      const result = await tx.run(`INSERT INTO review_forms (title, description, slug, thank_you_message, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)`, [data.title, data.description || null, data.slug, data.thankYou, data.active ? 1 : 0, auth.user.id]);
      await replaceQuestions(tx, result.lastInsertRowid, data.questions);
      return result.lastInsertRowid;
    });
    return NextResponse.json({ message: 'Review form created.', id }, { status: 201 });
  } catch (error) { return handleRouteError(error, 'Could not save the review form.'); }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reviews.manage' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const db = Database.getInstance();
    await ensureReviewSchema(db);
    if (body.action === 'review_status') {
      const status = ['pending', 'published', 'hidden'].includes(body.status) ? body.status : null;
      if (!status) return NextResponse.json({ error: 'Invalid review status.' }, { status: 400 });
      await db.run('UPDATE customer_reviews SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, Number(body.id)]);
      return NextResponse.json({ message: status === 'published' ? 'Review published on the website.' : 'Review updated.' });
    }
    const id = Number(body.id);
    const existing = await db.get('SELECT id FROM review_forms WHERE id = ?', [id]);
    if (!existing) return NextResponse.json({ error: 'Review form not found.' }, { status: 404 });
    const data = cleanReviewForm(body);
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE review_forms SET title = ?, description = ?, slug = ?, thank_you_message = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [data.title, data.description || null, data.slug, data.thankYou, data.active ? 1 : 0, id]);
      await replaceQuestions(tx, id, data.questions);
    });
    return NextResponse.json({ message: 'Review form updated.' });
  } catch (error) { return handleRouteError(error, 'Could not update customer reviews.'); }
}
