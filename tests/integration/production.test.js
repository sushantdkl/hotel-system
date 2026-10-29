import test from 'node:test';
import assert from 'node:assert/strict';
import Database from '../../lib/db/index.js';
import { AuthService } from '../../lib/auth/auth.js';
import { openBusinessDay, businessDaySummary, closeBusinessDay } from '../../lib/business-days.js';
import { ensureReportSchema, buildReport, REPORT_TABS } from '../../lib/reports.js';
import { composeAnalytics } from '../../lib/analytics.js';
import { createPurchase } from '../../lib/purchases.js';
import { applyStockChange } from '../../lib/inventory-ledger.js';
import { listStockMovements } from '../../lib/stock-movements.js';
import { addMedia, setCmsSection, getCmsContent } from '../../lib/cms.js';
import { verifyCancellation, listCancellationVerifications } from '../../lib/cancellation-verification.js';
import { nepalDateString } from '../../lib/report-dates.js';
import { parseDbDate } from '../../lib/time-utils.js';
import { recordInitialSplitSettlement, collectCreditBalance, validateAllocations } from '../../lib/split-payments.js';
import { POST as payOrder } from '../../app/api/admin/pos/orders/[id]/pay/route.js';
import { refundBill } from '../../lib/bill-corrections.js';
import { PUT as legacyKotUpdate, PATCH as legacyKotItem } from '../../app/api/restaurant/kots/[id]/route.js';
import { GET as getBusinessDay, PUT as closeDayRoute } from '../../app/api/admin/business-days/route.js';
import { GET as getLedger } from '../../app/api/admin/ledger/route.js';


if (!/^\/km_test_\d+_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) throw Error('Use scripts/run-integration.mjs to isolate this mutating test.');
const db=Database.getInstance();
const admin={id:1,role:'admin',full_name:'Test Admin'};
const today=nepalDateString();
const previous=new Date(`${today}T12:00:00+05:45`);previous.setUTCDate(previous.getUTCDate()-1);
const yesterday=nepalDateString(previous);
let day, itemId;
test.after(async()=>{await Database.close();});

test('PostgreSQL transaction contracts: backdating, stock, CMS, verification, resettlement and credit', async()=>{
  await ensureReportSchema(db);
  const past=await openBusinessDay(db,{business_date:yesterday,opening_cash:10000},admin);
  const pastCustomerId=(await db.run("INSERT INTO customers(name,phone,credit_limit,current_credit) VALUES ('Historical guest','9800000041',10000,0)")).lastInsertRowid;
  const pastCustomer=await db.get('SELECT * FROM customers WHERE id=?',[pastCustomerId]);
  const historicBills={};
  for (const method of ['cash','qr','credit']) {
    const orderId=(await db.run("INSERT INTO orders(order_number,status,order_type,business_day_id) VALUES (?,'completed','takeaway',?)",['HIST-'+method,past.id])).lastInsertRowid;
    const billId=(await db.run("INSERT INTO bills(bill_number,order_id,subtotal,grand_total,tax,vat_amount,status,business_day_id) VALUES (?,?,100,113,13,13,'unpaid',?)",['HIST-'+method,orderId,past.id])).lastInsertRowid;
    const allocations=validateAllocations([{method,amount:113,cash_tendered:113,provider:'test',reference:'historical-qr',verified:true}],113,{customer:pastCustomer,actorRole:'admin'});
    await db.transaction(tx=>recordInitialSplitSettlement(tx,{billId,billNumber:'HIST-'+method,total:113,tax:13,allocations,customer:pastCustomer,actorId:1,requestKey:'hist-'+method,businessDayId:past.id}));
    const bill=await db.get('SELECT * FROM bills WHERE id=?',[billId]);
    assert.equal(Number(bill.business_day_id),Number(past.id));assert.equal(nepalDateString(parseDbDate(bill.created_at)),today);
    const entry=await db.get("SELECT * FROM journal_entries WHERE source_type='bill' AND source_id=?",[billId]);
    assert.equal(Number(entry.business_day_id),Number(past.id));assert.equal(nepalDateString(parseDbDate(entry.created_at)),today);
    historicBills[method]=billId;
  }
  const beforeClose=await businessDaySummary(db,past);assert.equal(Number(beforeClose.cash.expected_cash),10113,'QR and credit do not inflate drawer cash');
  const pastAnalytics=await composeAnalytics(db,{start:yesterday,end:yesterday,period:'business_day'},{},{businessDayId:past.id});assert.equal(Number(pastAnalytics.totals.billedTotal),339);
  await closeBusinessDay(db,{counted_cash:10113},admin);
  day=await openBusinessDay(db,{action:'start_next',confirm_next_day:true,opening_cash:10113},admin);
  const revenueBeforeCollection=Number((await db.get("SELECT SUM(l.credit-l.debit) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='4010'")).n);
  await collectCreditBalance(db,{billId:historicBills.credit,allocations:[{method:'cash',amount:113,cash_tendered:113}],actorId:1,actorRole:'admin',requestKey:'historical-credit-collected'});
  const later=await db.get("SELECT * FROM customer_ledger WHERE bill_id=? AND entry_type='credit_payment'",[historicBills.credit]);assert.equal(Number(later.business_day_id),Number(day.id));assert.equal(nepalDateString(parseDbDate(later.created_at)),today);
  assert.equal(Number((await db.get("SELECT SUM(l.credit-l.debit) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='4010'")).n),revenueBeforeCollection);
  await refundBill(db,{bill_id:historicBills.cash,amount:10,method:'cash',reason:'Later refund of prior-date sale',created_by:1});
  const reversal=await db.get('SELECT * FROM bill_corrections WHERE bill_id=?',[historicBills.cash]);assert.equal(Number(reversal.business_day_id),Number(day.id));assert.equal(nepalDateString(parseDbDate(reversal.created_at)),today);

  itemId=(await db.run(`INSERT INTO inventory_items(item_name,quantity,unit,purchase_unit,conversion_factor,cost_per_unit) VALUES ('Contract flour',100,'g','kg',1000,0.1)`)).lastInsertRowid;
  const purchase=await createPurchase(db,{invoice_number:'BACKDATED-PURCHASE',invoice_date:yesterday,payment_method:'credit',supplier:'Contract supplier',received_by:1,items:[{inventory_item_id:itemId,quantity:2,unit_cost:200}]});
  assert.equal(purchase.invoice_date,yesterday);
  assert.equal(nepalDateString(parseDbDate(purchase.created_at)),today,'Audit timestamp stays today');
  const expense=await db.get('SELECT * FROM expenses WHERE id=?',[purchase.expense_id]);
  assert.equal(String(expense.expense_date),yesterday);assert.equal(Number(expense.business_day_id),Number(past.id));
  const journal=await db.get("SELECT * FROM journal_entries WHERE source_type='expense' AND source_id=?",[expense.id]);
  assert.equal(journal.entry_date,yesterday);assert.equal(nepalDateString(parseDbDate(journal.created_at)),today);
  const ap=await db.get(`SELECT SUM(l.credit-l.debit) AS amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=? AND a.code='2010'`,[journal.id]);assert.equal(Number(ap.amount),400);
  const inventory=await db.get('SELECT * FROM inventory_items WHERE id=?',[itemId]);assert.equal(Number(inventory.quantity),2100);assert.ok(Math.abs(Number(inventory.cost_per_unit)-(410/2100))<0.0001);
  const movements=await listStockMovements(db,{inventoryItemId:itemId,dateBasis:'business',from:yesterday,to:yesterday});
  assert.equal(movements.rows.length,1);assert.equal(Number(movements.rows[0].balance_before),100);assert.equal(movements.rows[0].report_date,yesterday);assert.equal(Number(movements.rows[0].business_day_id),Number(past.id));
  assert.equal(nepalDateString(parseDbDate(movements.rows[0].created_at)),today);
  const historic=await composeAnalytics(db,{start:yesterday,end:yesterday,period:'custom'});assert.equal(Number(historic.inventory.purchaseValue),400);

  // Interleave two read/modify/write operations: the row lock prevents lost stock.
  await Promise.all([10,20].map((quantity)=>db.transaction(async(tx)=>{
    const get=tx.get;const delayed={...tx,get:async(sql,params)=>{const row=await get(sql,params);if(sql.includes('FROM inventory_items'))await new Promise((resolve)=>setTimeout(resolve,35));return row;}};
    await applyStockChange(delayed,{inventory_item_id:itemId,quantity,change_type:'manual_adjustment',reason:'Count check',performed_by:1,business_day_id:day.id});
  })));
  assert.equal(Number((await db.get('SELECT quantity FROM inventory_items WHERE id=?',[itemId])).quantity),2130);
  const adjustments=await listStockMovements(db,{inventoryItemId:itemId,adjustmentsOnly:true});
  assert.equal(adjustments.rows.length,2,'Adjustment report excludes purchase receipts and includes manual corrections');
  assert.ok(adjustments.rows.every((movement)=>movement.change_type==='manual_adjustment'));
  await assert.rejects(db.transaction(async(tx)=>{await applyStockChange(tx,{inventory_item_id:itemId,quantity:3,change_type:'manual_adjustment',reason:'Rollback test',performed_by:1});throw Error('injected failure');}),/injected failure/);
  assert.equal(Number((await db.get('SELECT quantity FROM inventory_items WHERE id=?',[itemId])).quantity),2130);

  const media=await addMedia(db,{url:'/api/media/cms/contract.webm',section:'videos',uploaded_by:1});assert.ok(media.id);
  await setCmsSection(db,'videos',{items:[{url:media.url,visible:true,title:'Contract clip'}]},1);
  assert.equal((await getCmsContent(db)).videos.items[0].url,media.url);
  const cancelled=(await db.run(`INSERT INTO orders(order_number,status,cancel_reason,cancelled_at,business_day_id) VALUES ('CANCEL-CONTRACT','cancelled','Guest left',CURRENT_TIMESTAMP,?)`,[day.id])).lastInsertRowid;
  const kot=(await db.run(`INSERT INTO kots(kot_number,order_id,status,cancel_reason,cancelled_at,cancelled_by,previous_status,business_day_id) VALUES ('CANCEL-KOT',?,'cancelled','Guest left',CURRENT_TIMESTAMP,1,'preparing',?)`,[cancelled,day.id])).lastInsertRowid;
  const original=await db.get('SELECT * FROM kots WHERE id=?',[kot]);
  await verifyCancellation(db,admin,{document_type:'kot',document_id:kot,status:'disputed',note:'Review needed',request_key:'contract-review-1'});
  assert.deepEqual(await db.get('SELECT * FROM kots WHERE id=?',[kot]),original);
  assert.equal((await listCancellationVerifications(db,admin,{businessDayId:day.id,status:'disputed'})).rows.length,1);

  await db.run("UPDATE system_settings SET setting_value='13' WHERE setting_key='vat_percentage'");
  const customerId=(await db.run(`INSERT INTO customers(name,phone,credit_limit,current_credit) VALUES ('Contract guest','9800000012',10000,0)`)).lastInsertRowid;
  const customer=await db.get('SELECT * FROM customers WHERE id=?',[customerId]);
  const makeBill=async(number,subtotal=100)=>{
    const orderId=(await db.run(`INSERT INTO orders(order_number,status,order_type,customer_id,customer_phone,business_day_id) VALUES (?,'dining','takeaway',?,'9800000012',?)`,[`ORDER-${number}`,customerId,day.id])).lastInsertRowid;
    await db.run(`INSERT INTO order_items(order_id,item_name,quantity,price,subtotal,sent_quantity,status) VALUES (?,'Contract food',1,?,?,1,'served')`,[orderId,subtotal,subtotal]);
    const billId=(await db.run(`INSERT INTO bills(bill_number,order_id,subtotal,grand_total,tax,vat_amount,tax_percent,status,customer_id,business_day_id,payment_status) VALUES (?,?,100,113,13,13,13,'unpaid',?,?,'unpaid')`,[number,orderId,customerId,day.id])).lastInsertRowid;
    await db.transaction((tx)=>recordInitialSplitSettlement(tx,{billId,billNumber:number,total:113,tax:13,allocations:validateAllocations([{method:'cash',amount:113,cash_tendered:113}],113,{customer,actorRole:'admin'}),customer,actorId:1,requestKey:`initial-${number}`,businessDayId:day.id}));
    await db.run("UPDATE bills SET status='reopened' WHERE id=?",[billId]);
    return {billId,orderId};
  };
  const reopened=await makeBill('REOPEN-CREDIT',200);
  const realVerify=AuthService.prototype.verifySession;AuthService.prototype.verifySession=async()=>admin;
  try {
    const response=await payOrder(new Request(`http://localhost/api/admin/pos/orders/${reopened.orderId}/pay`,{method:'POST',headers:{authorization:'Bearer contract'},body:JSON.stringify({idempotency_key:'reopen-credit-contract',customer_mode:'customer',customer_phone:customer.phone,payment_method:'credit'})}),{params:Promise.resolve({id:String(reopened.orderId)})});
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
    const bill=await db.get('SELECT * FROM bills WHERE id=?',[reopened.billId]);
    assert.equal(Number(bill.outstanding_amount),113);assert.equal(bill.payment_status,'partially_paid');
    const tax=await db.get(`SELECT SUM(l.credit-l.debit) AS tax FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_id WHERE j.external_ref='reopen-credit-contract:supplement-journal' AND a.code='2020'`);assert.equal(Number(tax.tax),13);
    const revenueBefore=Number((await db.get(`SELECT SUM(l.credit-l.debit) AS n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='4010'`)).n);
    await collectCreditBalance(db,{billId:reopened.billId,allocations:[{method:'cash',amount:113,cash_tendered:113}],actorId:1,actorRole:'admin',requestKey:'later-collection'});
    assert.equal(Number((await db.get(`SELECT SUM(l.credit-l.debit) AS n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='4010'`)).n),revenueBefore,'Credit collection is not a second sale');
    const refundCase=await makeBill('REFUND-FACE-VALUE',50);
    const netBefore=(await composeAnalytics(db,{start:today,end:today,period:'custom'})).totals.netSales;
    const paidRefund=await payOrder(new Request('http://localhost/api/admin/pos/orders/'+refundCase.orderId+'/pay',{method:'POST',headers:{authorization:'Bearer contract'},body:JSON.stringify({idempotency_key:'refund-face-contract',payment_method:'cash'})}),{params:Promise.resolve({id:String(refundCase.orderId)})});
    assert.equal(paidRefund.status,200,JSON.stringify(await paidRefund.json()));
    assert.equal(Number((await db.get('SELECT grand_total FROM bills WHERE id=?',[refundCase.billId])).grand_total),113,'Refund keeps original invoice face value');
    assert.equal(Number((await composeAnalytics(db,{start:today,end:today,period:'custom'})).totals.netSales),Number(netBefore)-56.5,'Refund is deducted once');
    const rollback=await makeBill('REFUND-ROLLBACK',50);
    const orderBefore=await db.get('SELECT * FROM orders WHERE id=?',[rollback.orderId]);
    const billBefore=await db.get('SELECT * FROM bills WHERE id=?',[rollback.billId]);
    const failed=await payOrder(new Request(`http://localhost/api/admin/pos/orders/${rollback.orderId}/pay`,{method:'POST',headers:{authorization:'Bearer contract'},body:JSON.stringify({idempotency_key:'refund-invalid-method',payment_method:'invalid-refund-method'})}),{params:Promise.resolve({id:String(rollback.orderId)})});
    assert.ok(failed.status>=400);assert.deepEqual(await db.get('SELECT * FROM orders WHERE id=?',[rollback.orderId]),orderBefore);assert.deepEqual(await db.get('SELECT * FROM bills WHERE id=?',[rollback.billId]),billBefore);
    const cancelledResponse=await legacyKotUpdate(new Request('http://localhost/api/restaurant/kots/'+kot,{method:'PUT',headers:{authorization:'Bearer contract'},body:JSON.stringify({status:'preparing'})}),{params:Promise.resolve({id:String(kot)})});assert.equal(cancelledResponse.status,409);
    const oldCutoff=process.env.CASHIER_CLOSING_CUTOFF;process.env.CASHIER_CLOSING_CUTOFF='23:59';
    AuthService.prototype.verifySession=async()=>({id:1,role:'cashier'});
    try {
      const context=await getBusinessDay(new Request('http://localhost/api/admin/business-days?view=closing',{headers:{authorization:'Bearer contract'}}));const payload=await context.json();assert.equal(context.status,200,JSON.stringify(payload));assert.equal(payload.cashPolicy.expectedCashVisible,false);assert.equal(JSON.stringify(payload).includes('expected_cash'),false);
      assert.equal((await getLedger(new Request('http://localhost/api/admin/ledger',{headers:{authorization:'Bearer contract'}}))).status,403);
      assert.equal((await closeDayRoute(new Request('http://localhost/api/admin/business-days',{method:'PUT',headers:{authorization:'Bearer contract'},body:JSON.stringify({counted_cash:0})}))).status,403);
    } finally {if(oldCutoff===undefined)delete process.env.CASHIER_CLOSING_CUTOFF;else process.env.CASHIER_CLOSING_CUTOFF=oldCutoff;}
  } finally { AuthService.prototype.verifySession=realVerify; }
  const race=await makeRefundRace();
  const refunds=await Promise.allSettled([1,2].map(i=>refundBill(db,{bill_id:race,amount:80,method:'cash',reason:'Concurrent refund '+i,created_by:1})));
  assert.equal(refunds.filter(r=>r.status==='fulfilled').length,1,'Concurrent over-refunds are rejected under the bill lock');
  assert.equal(Number((await db.get('SELECT refunded_amount FROM bills WHERE id=?',[race])).refunded_amount),80);
  const balance=await db.get('SELECT SUM(debit) AS debit,SUM(credit) AS credit FROM journal_lines');assert.ok(Math.abs(Number(balance.debit)-Number(balance.credit))<0.01);
  for (const tab of REPORT_TABS) {
    assert.ok(await buildReport(db,tab,{start:yesterday,end:today,period:'custom'},{}),tab+' populated calendar report');
    assert.ok(await buildReport(db,tab,{start:today,end:today,period:'business_day'},{businessDayId:day.id}),tab+' populated Business Day report');
  }
  const summary=await businessDaySummary(db,day);assert.ok(Number(summary.cash.expected_cash)>0);
});

async function makeRefundRace(){const order=(await db.run("INSERT INTO orders(order_number,status,order_type,business_day_id) VALUES ('REFUND-RACE','completed','takeaway',?)",[day.id])).lastInsertRowid;const bill=(await db.run("INSERT INTO bills(bill_number,order_id,grand_total,subtotal,status,business_day_id) VALUES ('REFUND-RACE',?,100,100,'unpaid',?)",[order,day.id])).lastInsertRowid;await db.transaction(tx=>recordInitialSplitSettlement(tx,{billId:bill,billNumber:'REFUND-RACE',total:100,allocations:validateAllocations([{method:'cash',amount:100,cash_tendered:100}],100,{actorRole:'admin'}),actorId:1,requestKey:'refund-race-sale',businessDayId:day.id}));return bill;}
