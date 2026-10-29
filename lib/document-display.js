const PREFIX_MAP = {
  ORD: 'O',
  ORDER: 'O',
  BILL: 'B',
  WEB: 'W',
};

export function compactDocumentNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^([A-Z]+)-(.+)$/i);
  if (!match) return raw;

  const prefix = PREFIX_MAP[match[1].toUpperCase()];
  if (!prefix) return raw;

  const tail = match[2];
  const numeric = tail.match(/(\d+)$/)?.[1];
  if (!numeric) return raw;
  return `${prefix}${String(Number(numeric)).padStart(Math.min(3, numeric.length), '0')}`;
}

export const compactOrderNumber = compactDocumentNumber;
export const compactBillNumber = compactDocumentNumber;
