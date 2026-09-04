\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swp_backend') THEN
    CREATE ROLE swp_backend LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swp_migrator') THEN
    CREATE ROLE swp_migrator LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swp_backup') THEN
    CREATE ROLE swp_backup LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swp_restore') THEN
    CREATE ROLE swp_restore LOGIN NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swp_maintenance') THEN
    CREATE ROLE swp_maintenance LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

ALTER ROLE swp_backend WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;
ALTER ROLE swp_migrator WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;
ALTER ROLE swp_backup WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;
ALTER ROLE swp_restore WITH LOGIN NOSUPERUSER NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;
ALTER ROLE swp_maintenance WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;

DO $$
DECLARE
  membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members AS auth_membership
    JOIN pg_roles AS granted ON granted.oid = auth_membership.roleid
    JOIN pg_roles AS member ON member.oid = auth_membership.member
    WHERE member.rolname IN (
      'swp_backend', 'swp_migrator', 'swp_backup', 'swp_restore', 'swp_maintenance'
    )
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$$;

SELECT 'CREATE DATABASE spotify_wallpaper OWNER swp_migrator'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'spotify_wallpaper'
) \gexec

SELECT 'CREATE DATABASE spotify_wallpaper_deletion_ledger OWNER swp_migrator'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'spotify_wallpaper_deletion_ledger'
) \gexec

ALTER DATABASE spotify_wallpaper OWNER TO swp_migrator;
ALTER DATABASE spotify_wallpaper_deletion_ledger OWNER TO swp_migrator;
REVOKE ALL ON DATABASE spotify_wallpaper FROM PUBLIC;
REVOKE ALL ON DATABASE spotify_wallpaper_deletion_ledger FROM PUBLIC;
GRANT CONNECT ON DATABASE spotify_wallpaper TO swp_backend, swp_migrator, swp_backup, swp_restore, swp_maintenance;
GRANT CONNECT ON DATABASE spotify_wallpaper_deletion_ledger TO swp_backend, swp_migrator, swp_backup, swp_restore, swp_maintenance;
