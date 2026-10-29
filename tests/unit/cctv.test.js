import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { listCameras, ptzNudge, pushToMediaMtx, refreshCameraStatus, saveCamera, wsseHeader } from '../../lib/cctv.js';
import { isPermissionAllowedSync } from '../../lib/permissions.js';

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const env = { ...process.env };
  process.env.CCTV_STREAM_BASE_URL = 'https://cctv.test/';
  process.env.MEDIAMTX_API_URL = 'http://mtx.test:9997';
  try { await fn(db); } finally {
    process.env = env;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('cameras: validation, viewers never see credentials, edit keeps secrets', async () => fixture(async (db) => {
  await assert.rejects(saveCamera(db, { name: 'Gate', sourceUrl: 'ftp://x' }), /must start with rtsp/);
  await assert.rejects(saveCamera(db, { name: 'Gate', sourceUrl: 'rtsp://u:p@10.0.0.2/s', ptzSupported: true }), /ONVIF PTZ service URL/);
  const { id } = await saveCamera(db, { name: 'Gate', zone: 'Gate', sourceUrl: 'rtsp://u:p@10.0.0.2/s', ptzSupported: true, onvifUrl: 'http://10.0.0.2/onvif/ptz', onvifUser: 'admin', onvifPassword: 'secret' });
  const [viewer] = await listCameras(db);
  assert.equal(viewer.sourceUrl, undefined);
  assert.equal(JSON.stringify(viewer).includes('secret'), false);
  assert.equal(viewer.streamUrl.startsWith(`https://cctv.test/cam-${id}/`), true);
  assert.equal(viewer.ptz, true);
  await saveCamera(db, { id, name: 'Main gate', zone: 'Gate', sourceUrl: '', ptzSupported: true, onvifUrl: 'http://10.0.0.2/onvif/ptz', onvifUser: 'admin', onvifPassword: '' });
  const [setup] = await listCameras(db, { withSecrets: true });
  assert.deepEqual([setup.name, setup.sourceUrl, setup.hasOnvifPassword], ['Main gate', 'rtsp://u:p@10.0.0.2/s', true]);
}));

test('MediaMTX push and status use the config API', async () => fixture(async (db) => {
  await saveCamera(db, { name: 'Lobby', zone: 'Lobby', sourceUrl: 'rtsp://10.0.0.3/s' });
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([init.method, url, init.body]); return { ok: true, json: async () => ({ ready: false, source: { type: 'rtspSource' } }) }; };
  assert.match((await pushToMediaMtx(db, { fetchImpl })).message, /Pushed 1 camera/);
  assert.equal(calls[0][0], 'POST');
  assert.match(calls[0][1], /^http:\/\/mtx\.test:9997\/v3\/config\/paths\/replace\/cam-/);
  assert.deepEqual(JSON.parse(calls[0][2]), { source: 'rtsp://10.0.0.3/s', sourceOnDemand: true });
  await refreshCameraStatus(db, { fetchImpl });
  assert.equal((await listCameras(db))[0].status, 'online');
  await refreshCameraStatus(db, { fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal((await listCameras(db))[0].status, 'offline');
  delete process.env.MEDIAMTX_API_URL;
  await assert.rejects(pushToMediaMtx(db, { fetchImpl }), /Set MEDIAMTX_API_URL/);
}));

test('ONVIF PTZ: WS-Security digest, move then stop', async () => fixture(async (db) => {
  const nonce = Buffer.from('0123456789abcdef');
  const created = '2026-10-28T00:00:00.000Z';
  const header = wsseHeader('admin', 'pw', { nonce, created });
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from('pw')])).digest('base64');
  assert.ok(header.includes(`>${digest}</Password>`));
  assert.ok(header.includes(`<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>`));

  const plain = await saveCamera(db, { name: 'Kitchen', sourceUrl: 'rtsp://10.0.0.4/s' });
  await assert.rejects(ptzNudge(db, plain.id, 'left'), /no PTZ control/);
  const { id } = await saveCamera(db, { name: 'Cash', sourceUrl: 'rtsp://10.0.0.5/s', ptzSupported: true, onvifUrl: 'http://10.0.0.5/onvif/ptz', onvifUser: 'u', onvifPassword: 'p', onvifProfile: 'Main<1>' });
  const bodies = [];
  await ptzNudge(db, id, 'left', { fetchImpl: async (url, init) => { bodies.push(init.body); return { ok: true }; }, wait: async () => {} });
  assert.equal(bodies.length, 2);
  assert.match(bodies[0], /<tptz:ContinuousMove><tptz:ProfileToken>Main&lt;1&gt;<\/tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="-0.5" y="0"\/>/);
  assert.match(bodies[1], /<tptz:Stop>/);
  await assert.rejects(ptzNudge(db, id, 'spin'), /Choose up/);
  await assert.rejects(ptzNudge(db, id, 'up', { fetchImpl: async () => ({ ok: false, status: 401 }), wait: async () => {} }), /rejected the PTZ command \(401\)/);
  await assert.rejects(ptzNudge(db, id, 'up', { fetchImpl: async () => { throw new TypeError('fetch failed'); }, wait: async () => {} }), /Could not reach the camera at 10\.0\.0\.5/);
}));

test('CCTV permissions default to the watchman viewing only', () => {
  assert.ok(isPermissionAllowedSync('watchman', 'cctv.view'));
  assert.ok(!isPermissionAllowedSync('watchman', 'cctv.ptz_control'));
  assert.ok(!isPermissionAllowedSync('waiter', 'cctv.view'));
  assert.ok(isPermissionAllowedSync('manager', 'cctv.ptz_control'));
});
