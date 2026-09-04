\set ON_ERROR_STOP on

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO swp_backend, swp_backup, swp_maintenance;
GRANT SELECT, INSERT, UPDATE ON deletion_tombstones TO swp_backend;
GRANT SELECT ON schema_migrations, deletion_tombstones TO swp_backup;
GRANT SELECT ON schema_migrations, deletion_tombstones TO swp_maintenance;
GRANT UPDATE, DELETE ON deletion_tombstones TO swp_maintenance;
