/**
 * CCTV: camera registry, MediaMTX streaming and ONVIF PTZ.
 *
 * Streaming: cameras speak RTSP; MediaMTX (https://github.com/bluenviron/mediamtx)
 * re-streams each as a low-latency WebRTC page that the browser embeds.
 *   MEDIAMTX_API_URL       e.g. http://127.0.0.1:9997 (config API; server-side only)
 *   MEDIAMTX_API_USER/PASS optional basic auth for that API
 *   CCTV_STREAM_BASE_URL   e.g. https://cctv.example.com (MediaMTX WebRTC, port 8889,
 *                          behind HTTPS; the browser loads <base>/<stream_path>).
 * Keep MediaMTX on the private network / VPN or enable its read authentication:
 * anyone who can reach the stream URL can watch it.
 *
 * Source URLs and ONVIF passwords are stored as entered and are only returned
 * to the camera setup screen, never to viewers.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';

// Messages are written for the operator, so 5xx ones are shown too (expose).
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, expose: true }); };
export const CCTV_ZONES = ['Lobby', 'Reception', 'Kitchen', 'Cash Counter', 'Restaurant', 'Corridors', 'Gate', 'Parking', 'Other'];
export const PTZ_MOVES = {
  up: { x: 0, y: 0.5, zoom: 0 }, down: { x: 0, y: -0.5, zoom: 0 }, left: { x: -0.5, y: 0, zoom: 0 }, right: { x: 0.5, y: 0, zoom: 0 },
  zoom_in: { x: 0, y: 0, zoom: 0.5 }, zoom_out: { x: 0, y: 0, zoom: -0.5 },
};

export async function ensureCctvSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get("SELECT to_regclass('public.cctv_cameras') AS t");
    if (!ready?.t) throw Object.assign(new Error('CCTV schema is not installed. Run database migration 083 (npm run db:migrate).'), { status: 503, expose: true });
    return;
  }
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS cctv_cameras (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, zone TEXT NOT NULL DEFAULT 'Other', source_url TEXT NOT NULL,
    stream_path TEXT NOT NULL UNIQUE, ptz_supported INTEGER NOT NULL DEFAULT 0 CHECK (ptz_supported IN (0, 1)),
    onvif_url TEXT NOT NULL DEFAULT '', onvif_user TEXT NOT NULL DEFAULT '', onvif_password TEXT NOT NULL DEFAULT '',
    onvif_profile TEXT NOT NULL DEFAULT 'Profile_1', status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'offline', 'unknown')),
    status_checked_at DATETIME, sort_order INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
}

export const streamBaseUrl = () => String(process.env.CCTV_STREAM_BASE_URL || '').replace(/\/+$/, '');

/** Cameras for viewers (no credentials) or for setup (`withSecrets`). */
export async function listCameras(db, { withSecrets = false } = {}) {
  await ensureCctvSchema(db);
  const rows = await db.all('SELECT * FROM cctv_cameras ORDER BY sort_order, zone, name');
  const base = streamBaseUrl();
  return rows.map((c) => ({
    id: c.id, name: c.name, zone: c.zone, ptz: Boolean(Number(c.ptz_supported)) && Boolean(c.onvif_url), status: c.status, statusCheckedAt: c.status_checked_at,
    streamUrl: base ? `${base}/${encodeURIComponent(c.stream_path)}/?controls=false&muted=true&autoplay=true&playsinline=true` : null,
    ...(withSecrets ? { sourceUrl: c.source_url, streamPath: c.stream_path, onvifUrl: c.onvif_url, onvifUser: c.onvif_user, hasOnvifPassword: Boolean(c.onvif_password), onvifProfile: c.onvif_profile, sortOrder: Number(c.sort_order), ptzSupported: Boolean(Number(c.ptz_supported)) } : {}),
  }));
}

const httpUrl = (value, label, schemes = ['http', 'https']) => {
  const v = String(value || '').trim();
  if (!v) return '';
  let url;
  try { url = new URL(v); } catch { fail(`${label} is not a valid URL.`); }
  if (!schemes.includes(url.protocol.replace(':', ''))) fail(`${label} must start with ${schemes.join(':// or ')}://.`);
  return v;
};

export async function saveCamera(db, data) {
  await ensureCctvSchema(db);
  const name = String(data?.name || '').trim().slice(0, 60);
  if (!name) fail('Enter a camera name.');
  const zone = CCTV_ZONES.includes(data?.zone) ? data.zone : 'Other';
  const existing = data?.id ? await db.get('SELECT * FROM cctv_cameras WHERE id = ?', [data.id]) : null;
  if (data?.id && !existing) fail('Camera not found.', 404);
  // Blank secret fields on edit keep the stored values.
  const sourceUrl = httpUrl(data?.sourceUrl, 'Stream source', ['rtsp', 'rtsps', 'http', 'https']) || existing?.source_url;
  if (!sourceUrl) fail('Enter the camera stream source (rtsp://...).');
  const ptz = data?.ptzSupported === true || data?.ptzSupported === 'on';
  const onvifUrl = httpUrl(data?.onvifUrl, 'ONVIF PTZ service URL');
  if (ptz && !onvifUrl) fail('PTZ needs the camera’s ONVIF PTZ service URL.');
  const fields = {
    name, zone, source_url: sourceUrl, ptz_supported: ptz ? 1 : 0, onvif_url: onvifUrl,
    onvif_user: String(data?.onvifUser || '').trim().slice(0, 60),
    onvif_password: data?.onvifPassword ? String(data.onvifPassword).slice(0, 120) : existing?.onvif_password || '',
    onvif_profile: String(data?.onvifProfile || 'Profile_1').trim().slice(0, 60) || 'Profile_1',
    sort_order: Number.isInteger(Number(data?.sortOrder)) ? Number(data.sortOrder) : 0,
  };
  const keys = Object.keys(fields);
  if (existing) {
    await db.run(`UPDATE cctv_cameras SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), existing.id]);
    return { id: existing.id, message: `${name} saved. Push to MediaMTX if the source changed.` };
  }
  const id = randomUUID().slice(0, 8);
  await db.run(`INSERT INTO cctv_cameras (id, stream_path, ${keys.join(', ')}) VALUES (?, ?, ${keys.map(() => '?').join(', ')})`, [id, `cam-${id}`, ...keys.map((k) => fields[k])]);
  return { id, message: `${name} added. Push to MediaMTX to start streaming.` };
}

export async function deleteCamera(db, id, { fetchImpl = globalThis.fetch } = {}) {
  await ensureCctvSchema(db);
  const cam = await db.get('SELECT stream_path FROM cctv_cameras WHERE id = ?', [id]);
  if (!cam) fail('Camera not found.', 404);
  await db.run('DELETE FROM cctv_cameras WHERE id = ?', [id]);
  await mediamtx(fetchImpl, 'DELETE', `/v3/config/paths/delete/${encodeURIComponent(cam.stream_path)}`).catch(() => null);
  return { message: 'Camera removed.' };
}

/* ---------------------------------------------------------------- MediaMTX */

async function mediamtx(fetchImpl, method, path, body) {
  const base = String(process.env.MEDIAMTX_API_URL || '').replace(/\/+$/, '');
  if (!base) fail('Set MEDIAMTX_API_URL to the MediaMTX API (e.g. http://127.0.0.1:9997).', 503);
  const user = process.env.MEDIAMTX_API_USER;
  const headers = { 'Content-Type': 'application/json', ...(user ? { Authorization: `Basic ${Buffer.from(`${user}:${process.env.MEDIAMTX_API_PASS || ''}`).toString('base64')}` } : {}) };
  const response = await fetchImpl(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  return response;
}

/** Create or replace every camera's MediaMTX path (pulled on demand from the camera). */
export async function pushToMediaMtx(db, { fetchImpl = globalThis.fetch } = {}) {
  const cams = await db.all('SELECT name, stream_path, source_url FROM cctv_cameras');
  const failed = [];
  for (const cam of cams) {
    try {
      const response = await mediamtx(fetchImpl, 'POST', `/v3/config/paths/replace/${encodeURIComponent(cam.stream_path)}`, { source: cam.source_url, sourceOnDemand: true });
      if (!response.ok) failed.push(`${cam.name} (${response.status})`);
    } catch (error) {
      if (error.status === 503) throw error;
      failed.push(`${cam.name} (${error.message})`);
    }
  }
  return { message: failed.length ? `Pushed ${cams.length - failed.length} of ${cams.length}. Failed: ${failed.join(', ')}.` : `Pushed ${cams.length} camera(s) to MediaMTX.` };
}

/** Ask MediaMTX whether each stream is ready; offline when the path is missing or not ready. */
export async function refreshCameraStatus(db, { fetchImpl = globalThis.fetch } = {}) {
  const cams = await db.all('SELECT id, stream_path FROM cctv_cameras');
  let online = 0;
  for (const cam of cams) {
    let status = 'offline';
    try {
      const response = await mediamtx(fetchImpl, 'GET', `/v3/paths/get/${encodeURIComponent(cam.stream_path)}`);
      // On-demand paths report ready only while someone watches; an existing path with a configured source counts as online.
      if (response.ok) {
        const data = await response.json();
        status = data?.ready || data?.source ? 'online' : 'offline';
      }
    } catch (error) {
      if (error.status === 503) throw error;
    }
    if (status === 'online') online += 1;
    await db.run('UPDATE cctv_cameras SET status = ?, status_checked_at = CURRENT_TIMESTAMP WHERE id = ?', [status, cam.id]);
  }
  return { message: `${online} of ${cams.length} camera(s) online.` };
}

/* ---------------------------------------------------------------- ONVIF PTZ */

const xml = (v) => String(v).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** WS-Security UsernameToken with PasswordDigest = Base64(SHA1(nonce + created + password)). */
export function wsseHeader(user, password, { nonce = randomBytes(16), created = new Date().toISOString() } = {}) {
  if (!user) return '';
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password || '')])).digest('base64');
  return `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${xml(user)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created></UsernameToken></Security></s:Header>`;
}

export function ptzEnvelope(body, user, password, opts) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">${wsseHeader(user, password, opts)}<s:Body>${body}</s:Body></s:Envelope>`;
}

/** Nudge: ContinuousMove for `ms`, then Stop. */
export async function ptzNudge(db, id, direction, { fetchImpl = globalThis.fetch, ms = 500, wait = (t) => new Promise((r) => setTimeout(r, t)) } = {}) {
  await ensureCctvSchema(db);
  const move = PTZ_MOVES[direction];
  if (!move) fail('Choose up, down, left, right, zoom in or zoom out.');
  const cam = await db.get('SELECT * FROM cctv_cameras WHERE id = ?', [id]);
  if (!cam) fail('Camera not found.', 404);
  if (!Number(cam.ptz_supported) || !cam.onvif_url) fail('This camera has no PTZ control configured.', 409);
  const profile = xml(cam.onvif_profile);
  const send = async (body) => {
    let response;
    try {
      response = await fetchImpl(cam.onvif_url, { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: ptzEnvelope(body, cam.onvif_user, cam.onvif_password), signal: AbortSignal.timeout(4000) });
    } catch {
      fail(`Could not reach the camera at ${new URL(cam.onvif_url).host}. Check that it is online and on the same network as this server.`, 502);
    }
    if (!response.ok) fail(`Camera rejected the PTZ command (${response.status}). Check the ONVIF URL, user and profile token.`, 502);
  };
  await send(`<tptz:ContinuousMove><tptz:ProfileToken>${profile}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${move.x}" y="${move.y}"/><tt:Zoom x="${move.zoom}"/></tptz:Velocity></tptz:ContinuousMove>`);
  await wait(ms);
  await send(`<tptz:Stop><tptz:ProfileToken>${profile}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`);
  return { message: 'Moved.' };
}
