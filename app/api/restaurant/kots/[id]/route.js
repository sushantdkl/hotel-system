import { NextResponse } from 'next/server';
import { KotRepository } from '@/lib/db/repositories/kots.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';

export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'kots.view' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const kot = await new KotRepository().getById(id);
    return kot ? NextResponse.json({ success: true, kot }) : NextResponse.json({ error: 'KOT not found' }, { status: 404 });
  } catch (error) { return handleRouteError(error, 'Failed to fetch KOT'); }
}

async function update(request, context, itemOnly) {
  try {
    const auth = await requireAuth(request, { permission: 'kots.update' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const body = await request.json();
    const valid = itemOnly ? ['pending', 'preparing', 'ready', 'served', 'completed'] : ['pending', 'preparing', 'ready', 'served'];
    if (!valid.includes(body.status)) return NextResponse.json({ error: 'Invalid KOT status.' }, { status: 400 });
    const repo = new KotRepository();
    const kot = await repo.db.transaction(async (tx) => {
      const row = await tx.get(`SELECT * FROM kots WHERE id=?${tx.driver === 'postgres' ? ' FOR UPDATE' : ''}`, [id]);
      if (!row) throw Object.assign(new Error('KOT not found.'), { status: 404 });
      if (['cancelled', 'voided', 'completed', 'served'].includes(row.status) || Number(row.voided)) throw Object.assign(new Error('A closed or cancelled kitchen ticket cannot be changed.'), { status: 409 });
      repo.db = tx;
      if (itemOnly) {
        const item = await tx.get('SELECT * FROM kot_items WHERE id=? AND kot_id=?', [Number(body.item_id) || 0, id]);
        if (!item) throw Object.assign(new Error('Item does not belong to this kitchen ticket.'), { status: 404 });
        if (['cancelled', 'voided'].includes(item.status)) throw Object.assign(new Error('A cancelled item cannot be changed.'), { status: 409 });
        await repo.updateItemStatus(item.id, body.status);
      } else if (body.status !== row.status) {
        await repo.updateStatus(id, body.status, auth.user.id);
      }
      return repo.getById(id);
    });
    return NextResponse.json({ success: true, message: 'KOT updated.', kot });
  } catch (error) { return handleRouteError(error, 'Failed to update KOT'); }
}

export const PUT = (request, context) => update(request, context, false);
export const PATCH = (request, context) => update(request, context, true);
