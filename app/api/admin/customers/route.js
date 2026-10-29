import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { findCustomerByPhone, ensureCustomersTable, normalizePhone } from '@/lib/customers.js';
import { validatePhone, validateName, validateEmail } from '@/lib/form-validation.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { readListParams, resolveOrderBy, buildSearch, paginateQuery } from '@/lib/paginate.js';

const CUSTOMER_SORTS = {
  name: 'c.name',
  phone: 'c.phone',
  email: 'c.email',
  total_visits: 'c.total_visits',
  total_spent: 'c.total_spent',
  current_credit: 'c.current_credit',
  created_at: 'c.created_at',
};

const CUSTOMER_SEARCH_COLUMNS = ['c.name', 'c.phone', 'c.phone_digits', 'c.email', 'c.address', 'c.notes'];

function friendlyDbError(error, fallback) {
  const msg = String(error?.message || '');
  if (/UNIQUE|unique/i.test(msg) && /phone/i.test(msg)) {
    return {
      error: 'A customer with this phone number is already saved. Please search for them or use a different number.',
      code: 'duplicate_phone',
    };
  }
  if (/UNIQUE|unique/i.test(msg)) {
    return {
      error: 'This customer already exists in your list.',
      code: 'duplicate',
    };
  }
  return { error: fallback, code: 'save_failed' };
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'customers.access' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');

    await ensureCustomersTable(db);

    // Phone lookup is a single-record probe used by the till — never paginated.
    if (phone) {
      const customer = await findCustomerByPhone(db, phone);
      return NextResponse.json({ customer, customers: customer ? [customer] : [] });
    }

    const { page, pageSize, exportAll, sort, dir, search } = readListParams(searchParams, { defaultDir: 'asc' });

    const conditions = ['1=1'];
    const params = [];

    if (searchParams.get('vip') === '1') conditions.push('COALESCE(c.is_vip, 0) = 1');
    if (searchParams.get('blacklisted') === '1') conditions.push('COALESCE(c.is_blacklisted, 0) = 1');

    const searchClause = buildSearch(search, CUSTOMER_SEARCH_COLUMNS);
    if (searchClause.clause) {
      conditions.push(searchClause.clause);
      params.push(...searchClause.params);
    }

    const { rows, pagination } = await paginateQuery(db, {
      columns: 'c.*',
      from: 'customers c',
      where: conditions.join(' AND '),
      params,
      orderBy: resolveOrderBy(sort, dir, CUSTOMER_SORTS, 'name', 'c.id'),
      page,
      pageSize,
      exportAll,
    });

    return NextResponse.json({ customers: rows, pagination });
  } catch (error) {
    return handleRouteError(error, 'Could not load customers. Please try again.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customers.access' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureCustomersTable(db);

    const nameError = validateName(data.name, 'customer name');
    const phoneError = validatePhone(data.phone, { required: true });
    const emailError = validateEmail(data.email, { required: false });

    if (nameError || phoneError || emailError) {
      return NextResponse.json(
        {
          error: nameError || phoneError || emailError,
          code: 'validation',
          fields: {
            name: nameError,
            phone: phoneError,
            email: emailError,
          },
        },
        { status: 400 }
      );
    }

    const phone = normalizePhone(data.phone);
    const existing = await findCustomerByPhone(db, phone);
    if (existing) {
      return NextResponse.json(
        {
          error: 'A customer with this phone number is already saved. Please search for them or use a different number.',
          code: 'duplicate_phone',
          customer: existing,
        },
        { status: 409 }
      );
    }

    const result = await db.run(
      `INSERT INTO customers (name, phone, email, address, credit_limit, is_vip, is_blacklisted, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(data.name).trim(),
        phone,
        data.email?.trim() || null,
        data.address?.trim() || null,
        Number(data.credit_limit) || 0,
        data.is_vip ? 1 : 0,
        data.is_blacklisted ? 1 : 0,
        data.notes?.trim() || null,
      ]
    );

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);

    return NextResponse.json(
      {
        message: 'Customer saved successfully.',
        customer,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create customer error:', error);
    const friendly = friendlyDbError(error, 'Could not save this customer. Please try again.');
    const status = friendly.code === 'duplicate_phone' || friendly.code === 'duplicate' ? 409 : 500;
    return NextResponse.json(friendly, { status });
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customers.access' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureCustomersTable(db);

    if (!data.id) {
      return NextResponse.json({ error: 'Customer id is missing.', code: 'validation' }, { status: 400 });
    }

    const nameError = validateName(data.name, 'customer name');
    const phoneError = validatePhone(data.phone, { required: true });
    const emailError = validateEmail(data.email, { required: false });

    if (nameError || phoneError || emailError) {
      return NextResponse.json(
        {
          error: nameError || phoneError || emailError,
          code: 'validation',
          fields: {
            name: nameError,
            phone: phoneError,
            email: emailError,
          },
        },
        { status: 400 }
      );
    }

    const phone = normalizePhone(data.phone);
    const existing = await findCustomerByPhone(db, phone);
    if (existing && String(existing.id) !== String(data.id)) {
      return NextResponse.json(
        {
          error: 'Another customer already uses this phone number.',
          code: 'duplicate_phone',
          customer: existing,
        },
        { status: 409 }
      );
    }

    await db.run(
      `UPDATE customers
       SET name = ?, phone = ?, email = ?, address = ?, credit_limit = ?,
           is_vip = ?, is_blacklisted = ?, notes = ?
       WHERE id = ?`,
      [
        String(data.name).trim(),
        phone,
        data.email?.trim() || null,
        data.address?.trim() || null,
        Number(data.credit_limit) || 0,
        data.is_vip ? 1 : 0,
        data.is_blacklisted ? 1 : 0,
        data.notes?.trim() || null,
        data.id,
      ]
    );

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [data.id]);

    return NextResponse.json({
      message: 'Customer updated successfully.',
      customer,
    });
  } catch (error) {
    console.error('Update customer error:', error);
    const friendly = friendlyDbError(error, 'Could not update this customer. Please try again.');
    return NextResponse.json(friendly, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customers.delete' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Please choose a customer to remove.' }, { status: 400 });
    }

    const db = Database.getInstance();

    // customer_id on orders/bills/customer_ledger is ON DELETE SET NULL — a
    // hard delete would silently strip customer attribution from real order,
    // billing and credit-ledger history instead of failing loudly.
    const referenced = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE customer_id = ?) +
         (SELECT COUNT(*) FROM bills WHERE customer_id = ?) +
         (SELECT COUNT(*) FROM customer_ledger WHERE customer_id = ?) AS n`,
      [id, id, id]
    ).catch(() => null);
    if (Number(referenced?.n || 0) > 0) {
      return NextResponse.json(
        { error: 'This customer has order, billing or credit history and cannot be deleted.' },
        { status: 409 }
      );
    }

    await db.run('DELETE FROM customers WHERE id = ?', [id]);

    return NextResponse.json({
      message: 'Customer removed successfully.',
    });
  } catch (error) {
    return handleRouteError(error, 'Could not remove this customer. Please try again.');
  }
}
