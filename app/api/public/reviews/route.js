import { NextResponse } from 'next/server';
import { listReviews } from '@/lib/reviews.js';

export async function GET() {
  try {
    const reviews = await listReviews({ status: 'published', limit: 60 });
    const publicReviews = reviews.map(({ id, customer_name, created_at, form_title, answers }) => ({ id, customer_name, created_at, form_title, answers }));
    return NextResponse.json({ reviews: publicReviews }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (error) {
    console.error('Public reviews GET:', error);
    return NextResponse.json({ reviews: [] }, { status: 500 });
  }
}
