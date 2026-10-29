import { NextResponse } from 'next/server';
import { createInquiry } from '@/lib/leads.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import { logger } from '@/lib/logger.js';

export async function POST(request) {
  try {
    const ip = clientIp(request);
    const limited = await checkRateLimit({
      key: `inquiry:${ip}`,
      limit: Number(process.env.RATE_LIMIT_PUBLIC || 8),
      windowSeconds: 60,
    });
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const inquiry = await createInquiry({
      name: body.name,
      email: body.email,
      phone: body.phone,
      subject: body.subject,
      message: body.message,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Message received. We will respond within 24 hours.',
        id: inquiry?.id,
      },
      { status: 201 }
    );
  } catch (error) {
    const msg = error?.message || 'Could not submit inquiry.';
    const clientError =
      msg.includes('Please') || msg.includes('valid') || msg.includes('enter');
    if (!clientError) logger.error('public_inquiry_failed', { message: error?.message });
    return NextResponse.json(
      { error: clientError ? msg : 'Could not submit inquiry.' },
      { status: clientError ? 400 : 500 }
    );
  }
}
