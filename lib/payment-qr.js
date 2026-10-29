/**
 * Payment QR with the amount filled in.
 *
 * Fonepay, NepalPay and bank merchant QRs follow the EMVCo format: a string of
 * tag/length/value fields ending in a CRC. A static code has no amount, so we
 * add tag 54 (amount), mark it dynamic (tag 01 = 12), recompute the CRC and
 * draw a fresh QR. Personal wallet codes (eSewa/Khalti ID) are not EMVCo and
 * stay as the uploaded image, with the amount typed by the customer.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

function parseTlv(payload) {
  const fields = [];
  for (let i = 0; i < payload.length;) {
    const tag = payload.slice(i, i + 2);
    const len = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(len) || i + 4 + Number(len) > payload.length) return null;
    fields.push([tag, payload.slice(i + 4, i + 4 + Number(len))]);
    i += 4 + Number(len);
  }
  return fields;
}

/** CRC-16/CCITT-FALSE, as EMVCo tag 63 requires. */
export function emvCrc(text) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function isEmvQr(payload) {
  const fields = /^000201/.test(payload || '') && parseTlv(payload);
  return Boolean(fields && fields.some(([tag]) => tag === '63'));
}

/** The same merchant QR, marked dynamic with the amount fixed. Field order is kept; new tags go in numeric position. */
export function emvWithAmount(payload, amount) {
  const fields = parseTlv(payload).filter(([tag]) => tag !== '63');
  const put = (tag, value) => {
    const at = fields.findIndex(([t]) => t === tag);
    if (at >= 0) { fields[at] = [tag, value]; return; }
    const before = fields.findIndex(([t]) => t > tag);
    fields.splice(before < 0 ? fields.length : before, 0, [tag, value]);
  };
  put('01', '12');
  put('54', Number(amount).toFixed(2));
  const body = `${fields.map(([tag, value]) => `${tag}${String(value.length).padStart(2, '0')}${value}`).join('')}6304`;
  return body + emvCrc(body);
}

/**
 * Payment QR image for a bill: a generated code with the amount when the
 * uploaded QR is EMVCo, otherwise the uploaded image as-is.
 */
export function usePaymentQr(settings, amount) {
  const uploaded = settings?.bank_qr_image || settings?.esewa_qr_image || '';
  const payload = settings?.payment_qr_payload || '';
  const text = uploaded && Number(amount) > 0.009 && isEmvQr(payload) ? emvWithAmount(payload, amount) : '';
  const [made, setMade] = useState({ text: '', image: '' });

  useEffect(() => {
    if (!text) return undefined;
    let live = true;
    QRCode.toDataURL(text, { width: 480, margin: 2 })
      .then((image) => { if (live) setMade({ text, image }); })
      .catch(() => {});
    return () => { live = false; };
  }, [text]);

  return text && made.text === text
    ? { image: made.image, amountInQr: true }
    : { image: uploaded, amountInQr: false };
}

/**
 * Printable inline SVG of the payment QR with the amount set, or '' when the
 * uploaded code is not EMVCo. Synchronous so print windows still open inside the click.
 */
export function paymentQrSvg(payload, amount) {
  if (!(Number(amount) > 0.009) || !isEmvQr(payload)) return '';
  const { modules } = QRCode.create(emvWithAmount(payload, amount), { errorCorrectionLevel: 'M' });
  const size = modules.size;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (modules.get(y, x)) path += `M${x + 2} ${y + 2}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${size + 4}" shape-rendering="crispEdges" style="display:block;width:100%;height:auto"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}
