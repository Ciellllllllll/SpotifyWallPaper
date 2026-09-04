\set ON_ERROR_STOP on

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO swp_backend, swp_backup, swp_maintenance;
GRANT SELECT, INSERT, UPDATE, DELETE ON credentials, setup_sessions, oauth_sessions, callback_confirmations, spotify_backoff TO swp_backend;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO swp_backup;
GRANT SELECT ON schema_migrations, credentials, setup_sessions, oauth_sessions, callback_confirmations, spotify_backoff TO swp_maintenance;
GRANT DELETE ON credentials, setup_sessions, oauth_sessions, callback_confirmations, spotify_backoff TO swp_maintenance;
