'use client';

/**
 * Shared click-to-open drawers/modals for Analytics tables — same containers
 * as Purchases page, Sales report bills, KOT popup, and report expense detail.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import PurchaseDrawer from '@/components/purchases/purchase-drawer';
import BillInvoiceModal from '@/components/admin/bill-invoice-modal';
import KotPopup from '@/components/admin/kot-popup';
import { RecordDetailsModal } from '@/components/admin/report-kit';
import { apiJson } from '@/lib/authed-fetch';

const AnalyticsRecordContext = createContext(null);

const noopApi = {
  openPurchase() {},
  openBill() {},
  openKot() {},
  openExpense() {},
  openOrder() {},
  openReportRow() {},
};

export function useAnalyticsRecords() {
  return useContext(AnalyticsRecordContext) || noopApi;
}

export function AnalyticsRecordProvider({ children, range = null }) {
  const [purchaseId, setPurchaseId] = useState(null);
  const [billId, setBillId] = useState(null);
  const [kotId, setKotId] = useState(null);
  const [record, setRecord] = useState(null);

  const openReportRow = useCallback(async ({ tab, tableId = '', row = {}, title = 'Record details' }) => {
    setRecord({
      tableTitle: title,
      columns: [],
      row,
      detail: null,
      loading: true,
      error: null,
    });
    try {
      const data = await apiJson('/api/admin/reports/details', {
        method: 'POST',
        body: JSON.stringify({ tab, tableId, row, range }),
      });
      setRecord((prev) => (prev ? { ...prev, detail: data.detail, loading: false } : null));
    } catch (error) {
      setRecord((prev) => (prev ? {
        ...prev,
        loading: false,
        error: error?.error || error?.message || 'Full details could not be loaded.',
      } : null));
    }
  }, [range]);

  const openPurchase = useCallback((id) => {
    const purchaseIdValue = Number(id);
    if (!purchaseIdValue) return;
    setPurchaseId(purchaseIdValue);
  }, []);

  const openBill = useCallback((id) => {
    const billIdValue = Number(id);
    if (!billIdValue) return;
    setBillId(billIdValue);
  }, []);

  const openKot = useCallback((id) => {
    const kotIdValue = Number(id);
    if (!kotIdValue) return;
    setKotId(kotIdValue);
  }, []);

  const openExpense = useCallback((rowOrId) => {
    const row = typeof rowOrId === 'object' && rowOrId
      ? { ...rowOrId, _record_id: rowOrId._record_id || rowOrId.id }
      : { _record_id: rowOrId };
    if (!row._record_id) return;
    openReportRow({
      tab: 'expenses',
      tableId: 'expense_records',
      row,
      title: 'Expense details',
    });
  }, [openReportRow]);

  const openOrder = useCallback((row) => {
    const billIdValue = Number(row?.billId || row?.bill_id || row?._bill_id);
    if (billIdValue) {
      setBillId(billIdValue);
      return;
    }
    const orderId = Number(row?.orderId || row?.order_id || row?.id);
    const orderNumber = row?.orderNumber || row?.order_number;
    if (orderId || orderNumber) {
      openReportRow({
        tab: 'orders',
        tableId: 'orders',
        row: {
          ...(orderId ? { _order_id: orderId, order_id: orderId } : {}),
          ...(orderNumber ? { order_number: orderNumber } : {}),
          bill_number: row.billNumber || row.bill_number || null,
        },
        title: 'Order details',
      });
    }
  }, [openReportRow]);

  const value = useMemo(() => ({
    openPurchase,
    openBill,
    openKot,
    openExpense,
    openOrder,
    openReportRow,
  }), [openPurchase, openBill, openKot, openExpense, openOrder, openReportRow]);

  return (
    <AnalyticsRecordContext.Provider value={value}>
      {children}
      {purchaseId ? (
        <PurchaseDrawer
          purchaseId={purchaseId}
          onClose={() => setPurchaseId(null)}
          canEdit={false}
          canVoid={false}
        />
      ) : null}
      {billId ? <BillInvoiceModal billId={billId} onClose={() => setBillId(null)} /> : null}
      {kotId ? <KotPopup kotId={kotId} onClose={() => setKotId(null)} /> : null}
      {record && typeof document !== 'undefined'
        ? createPortal(
          <RecordDetailsModal
            tableTitle={record.tableTitle}
            columns={record.columns}
            row={record.row}
            detail={record.detail}
            loading={record.loading}
            error={record.error}
            onClose={() => setRecord(null)}
          />,
          document.body,
        )
        : null}
    </AnalyticsRecordContext.Provider>
  );
}

/** Shared clickable table-row styles. */
export const clickableRowClass = 'cursor-pointer transition-colors hover:bg-gray-50/90 active:bg-gray-100/80';
