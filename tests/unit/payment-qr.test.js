import test from 'node:test';
import assert from 'node:assert/strict';
import { emvCrc, emvWithAmount, isEmvQr, paymentQrSvg } from '../../lib/payment-qr.js';

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;
const withCrc = (body) => `${body}6304${emvCrc(`${body}6304`)}`;
// Static merchant QR in the Fonepay/NepalPay shape (no amount, initiation 11).
const staticQr = withCrc(
  tlv('00', '01') + tlv('01', '11') + tlv('26', tlv('00', 'fonepay.com') + tlv('01', '2222080012345678'))
  + tlv('52', '5812') + tlv('53', '524') + tlv('58', 'NP') + tlv('59', 'Raithane Daure Chulo') + tlv('60', 'Surkhet')
);

test('CRC matches the CRC-16/CCITT-FALSE check value', () => {
  assert.equal(emvCrc('123456789'), '29B1');
});

test('amount is fixed into a static EMV QR with a valid CRC', () => {
  assert.ok(isEmvQr(staticQr));
  const dynamic = emvWithAmount(staticQr, 1722);
  assert.ok(isEmvQr(dynamic));
  assert.equal(dynamic.slice(-4), emvCrc(dynamic.slice(0, -4)));
  assert.ok(dynamic.startsWith('000201010212'));
  assert.ok(dynamic.includes(`${tlv('53', '524')}${tlv('54', '1722.00')}${tlv('58', 'NP')}`));
  assert.ok(dynamic.includes(tlv('59', 'Raithane Daure Chulo')));
});

test('a new amount replaces the old one instead of stacking', () => {
  const twice = emvWithAmount(emvWithAmount(staticQr, 100), 250.5);
  assert.ok(twice.includes(tlv('54', '250.50')));
  assert.ok(!twice.includes(tlv('54', '100.00')));
});

test('non-EMV codes (personal wallet IDs, URLs) are left alone', () => {
  assert.equal(isEmvQr('{"eSewa_id":"9800000001","name":"Asha"}'), false);
  assert.equal(isEmvQr('https://example.com/pay'), false);
  assert.equal(isEmvQr(''), false);
});

test('printable QR is an SVG only for a merchant QR with an amount due', () => {
  const svg = paymentQrSvg(staticQr, 1722);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /<path fill="#000" d="M\d/);
  assert.equal(paymentQrSvg(staticQr, 0), '');
  assert.equal(paymentQrSvg('{"eSewa_id":"9800000001"}', 500), '');
  assert.equal(paymentQrSvg('', 500), '');
});
