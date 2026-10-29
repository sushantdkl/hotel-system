-- 071: CMS media library on Postgres.
-- lib/cms.js only created cms_media at runtime on SQLite (ensureSqliteTable
-- skips DDL on Postgres), so every CMS upload on a Postgres deploy failed with
-- "Failed to upload media." when recording the file.

CREATE TABLE IF NOT EXISTS cms_media (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  alt TEXT,
  section TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cms_media_section ON cms_media(section, created_at DESC);
