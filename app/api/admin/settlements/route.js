import { NextResponse } from 'next/server';

const removed = () => NextResponse.json(
  { error: 'Payment settlements were removed. All non-cash payments now post directly to Online.' },
  { status: 410 }
);

export const GET = removed;
export const POST = removed;
