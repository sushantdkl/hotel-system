/** Destinations are limited to reports that expose the corresponding measure. */
export function analyticsReportHref(label, range = {}, panelPrefix = '/admin') {
  if (label === 'Expenses') return panelPrefix + '/financial-reports?' + new URLSearchParams({report:'pnl', focus:'operating', from:range.start || '', to:range.end || ''});
  if (label === 'Opening Balance' && range.businessDayId) return panelPrefix + '/business-days';
  if (label === 'Savings & Deposits') {
    return `${panelPrefix}/savings`;
  }
  const destinations = {
    'Total Sales': ['sales'], 'Discounts': ['sales'], 'Service / Extra Charges': ['sales'],
    'Delivery Charges': ['sales'], 'Tax Collected': ['sales'], 'Refunds': ['changes'],
    'Purchases': ['purchases'],
    'Dine-in Sales': ['sales','dine_in'], 'Takeaway Sales': ['sales','takeaway'], 'Delivery Sales': ['sales','delivery'],
    'Table / bill duration': ['tables','dine_in'],
  };
  const target = destinations[label];
  if (!target) return null;
  const q = new URLSearchParams({ tab: target[0], period:'custom', startDate:range.start || '', endDate:range.end || '' });
  // Purchases/expenses on Analytics use invoice/expense date, even for Today.
  if (range.businessDayId && !['Purchases','Expenses'].includes(label)) q.set('businessDayId', range.businessDayId);
  if (target[1]) q.set('orderType',target[1]);
  return `${panelPrefix}/reports?${q}`;
}
