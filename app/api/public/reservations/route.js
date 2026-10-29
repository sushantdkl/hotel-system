import { NextResponse } from 'next/server';
import { createReservation } from '@/lib/leads.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import { logger } from '@/lib/logger.js';

export async function POST(request) {
  try {
    const ip = clientIp(request);
    const limited = await checkRateLimit({
      key: `reservation:${ip}`,
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
    const reservation = await createReservation({
      name: body.name,
      phone: body.phone,
      date: body.date,
      time: body.time,
      guests: body.guests,
      occasion: body.occasion,
      message: body.message,
      source: 'web',
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Reservation received. We will confirm via phone or WhatsApp soon.',
        id: reservation?.id,
      },
      { status: 201 }
    );
  } catch (error) {
    const msg = error?.message || 'Could not submit reservation.';
    const clientErr =
      msg.includes('Please') || msg.includes('valid') || msg.includes('select');
    if (!clientErr) logger.error('public_reservation_failed', { message: error?.message });
    return NextResponse.json({ error: clientErr ? msg : 'Could not submit reservation.' }, {
      status: clientErr ? 400 : 500,
    });
  }
}
