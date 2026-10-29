-- CCTV cameras (streams served by MediaMTX, PTZ over ONVIF).
-- Keep in sync with ensureCctvSchema in lib/cctv.js.
CREATE TABLE IF NOT EXISTS cctv_cameras (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT 'Other',
  source_url TEXT NOT NULL,
  stream_path TEXT NOT NULL UNIQUE,
  ptz_supported INTEGER NOT NULL DEFAULT 0 CHECK (ptz_supported IN (0, 1)),
  onvif_url TEXT NOT NULL DEFAULT '',
  onvif_user TEXT NOT NULL DEFAULT '',
  onvif_password TEXT NOT NULL DEFAULT '',
  onvif_profile TEXT NOT NULL DEFAULT 'Profile_1',
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'offline', 'unknown')),
  status_checked_at TIMESTAMP,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
