import { NextResponse } from 'next/server';
import { getReviewFormBySlug, createReview } from '@/lib/reviews.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';

export async function GET(_request, { params }) {
  try {
    const { slug } = await params;
    const form = await getReviewFormBySlug(slug);
    if (!form) return NextResponse.json({ error: 'This review form is not available.' }, { status: 404 });
    return NextResponse.json({ form }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Public review form GET:', error);
    return NextResponse.json({ error: 'Could not load the review form.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const limited = await checkRateLimit({ key: `review:${clientIp(request)}`, limit: Number(process.env.RATE_LIMIT_PUBLIC || 8), windowSeconds: 60 });
    if (!limited.ok) return NextResponse.json({ error: 'Too many submissions. Please try again shortly.' }, { status: 429 });
    const { slug } = await params;
    const form = await getReviewFormBySlug(slug);
    if (!form) return NextResponse.json({ error: 'This review form is not available.' }, { status: 404 });
    const body = await request.json();
    if (body.website) return NextResponse.json({ success: true }, { status: 201 });
    const id = await createReview({ form, customerName: body.customer_name, customerPhone: body.customer_phone, answers: body.answers, source: 'customer' });
    return NextResponse.json({ success: true, id, message: form.thank_you_message }, { status: 201 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: status < 500 ? error.message : 'Could not save your review.' }, { status });
  }
}

