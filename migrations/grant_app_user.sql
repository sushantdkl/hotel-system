-- If login works for wrong PIN (401) but correct PIN returns 500,
-- the app DB user may lack INSERT on sessions. Run as a privileged Postgres user:

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO thehairc_sundar;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO thehairc_sundar;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO thehairc_sundar;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO thehairc_sundar;
