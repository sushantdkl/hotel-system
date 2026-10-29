/** Normalize old single-table reports and newer multi-table reports for shared UIs. */
export function comparisonTables(data) {
  return data?.tables || (data?.table ? [{ id: 'detail', ...data.table }] : []);
}
