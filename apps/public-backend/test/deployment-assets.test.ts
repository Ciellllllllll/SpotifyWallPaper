import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deploy = new URL('../../../deploy/public-backend/', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, deploy), 'utf8');
}

function readRepository(path: string): string {
  return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('production-locked VPS deployment assets', () => {
  it('does not keep retired Cloudflare fixture exceptions alive', () => {
    const gitignore = readRepository('.gitignore');
    const authority = readRepository('config/repository-authority.json');
    const docs = readRepository('docs/05-repository-authority.md');

    for (const fixture of [
      'deploy-config.test.ts',
      'provider-contract.test.ts',
      'secret-scan.test.ts'
    ]) {
      expect(gitignore).not.toContain(
        `!/apps/cloudflare-worker/node-test/${fixture}`
      );
      expect(authority).not.toContain(
        `!/apps/cloudflare-worker/node-test/${fixture}`
      );
    }
    expect(gitignore).not.toContain('/apps/cloudflare-worker/node-test/');
    expect(authority).not.toContain(
      '"ignorePattern": "/apps/cloudflare-worker/node-test/*"'
    );
    expect(docs).not.toContain(
      'The three retired tracked TypeScript fixture names are explicit non-ignored exceptions'
    );
    expect(docs).not.toContain('either `node-test` directory');
    expect(docs).toContain('active public-backend tests live under');
  });

  it('keeps CI pointed at the current public backend workspace', () => {
    const workflow = readRepository('.github/workflows/cloudflare-worker-ci.yml');
    const packageJson = readRepository('package.json');

    expect(workflow).toContain('name: Public Backend CI');
    expect(workflow).toContain('apps/public-backend/**');
    expect(workflow).toContain('deploy/public-backend/**');
    expect(workflow).toContain('apps/spotify-auth/**');
    expect(workflow).toContain('apps/configurator/**');
    expect(workflow).toContain('scripts/check-public-backend-secrets.test.mjs');
    expect(workflow).toContain('packages/wallpaper-view/**');
    expect(workflow).toContain(
      'npm run test -w @spotify-wallpaper/public-backend'
    );
    expect(workflow).toContain(
      'npm run check -w @spotify-wallpaper/public-backend'
    );
    expect(workflow).toContain('npm run test:public-backend-secrets');
    expect(
      workflow.match(
        /^\s+- scripts\/build-public-backend-artifact\.test\.mjs$/gmu
      )
    ).toHaveLength(2);
    expect(workflow).toContain(
      'node scripts/build-public-backend-artifact.mjs $artifact $env:GITHUB_SHA'
    );
    expect(workflow).toContain(
      'node scripts/check-public-backend-secrets.mjs $artifact'
    );
    expect(workflow).toContain(
      'npm run build -w @spotify-wallpaper/spotify-auth'
    );
    expect(workflow).toContain(
      'npm run build -w @spotify-wallpaper/configurator'
    );
    expect(workflow).toContain(
      'npm run build:workshop -w @spotify-wallpaper/wallpaper'
    );
    expect(workflow).toContain('npm run scan:public-backend-secrets:all');
    expect(workflow).toContain('Build Workshop artifact');
    expect(workflow).toContain(
      'VITE_SPOTIFY_BACKEND_ORIGIN: https://ciel-spotify-wallpaper.duckdns.org'
    );
    expect(workflow).toContain('integration:');
    expect(workflow).toContain('runs-on: ubuntu-latest');
    expect(workflow).toContain(
      'docker build -f deploy/public-backend/test/Dockerfile.synthetic-e2e'
    );
    expect(workflow).toContain(
      'sh /repo/deploy/public-backend/test/synthetic-e2e.sh'
    );
    expect(workflow).toContain(
      'sh /repo/deploy/public-backend/test/restore-reconcile-integration.sh'
    );
    const restoreIntegration = read('test/restore-reconcile-integration.sh');
    expect(restoreIntegration).toContain('"$scripts/backup.sh"');
    expect(restoreIntegration).toContain('spotify_wallpaper_deletion_ledger');
    expect(restoreIntegration).toContain('ledger_backup');
    expect(workflow).toContain(
      'sh /repo/deploy/public-backend/test/release-integration.sh'
    );
    expect(workflow).not.toContain('with secret canaries');
    expect(workflow).not.toContain('VITE_SPOTIFY_ACCESS_TOKEN');
    expect(workflow).not.toContain('VITE_SPOTIFY_REFRESH_TOKEN');
    expect(workflow).not.toContain('VITE_SPOTIFY_PKCE_VERIFIER');
    expect(workflow).not.toContain('VITE_SPOTIFY_WORKER_KEY');
    expect(packageJson).toContain('apps/spotify-auth/dist');
    expect(packageJson).toContain('apps/configurator/dist');
    expect(packageJson).toContain('apps/spotify-auth/src');
    expect(packageJson).toContain('apps/wallpaper/src');
    expect(packageJson).toContain('packages/wallpaper-view/src');
    expect(packageJson).toContain('packages/shared-types/src');
    expect(workflow).not.toContain('apps/cloudflare-worker/');
    expect(workflow).not.toContain('@spotify-wallpaper/cloudflare-worker');
  });

  it('keeps Caddy on the fixed origin and exposes only the reviewed route boundaries', () => {
    const config = read('Caddyfile');
    const deployRunbook = readRepository(
      'docs/operations/cloudflare-worker-deploy.md'
    );

    expect(config).toContain('ciel-spotify-wallpaper.duckdns.org');
    expect(config).toContain(
      'path /health /privacy /terms /auth/callback /api/playback'
    );
    expect(config).toContain('path /api/control');
    expect(config).toContain('path /api/account');
    expect(config).toContain('path /setup /auth/confirm');
    expect(config).toContain(
      'path /auth/start /auth/confirm /auth/reauthorize'
    );
    expect(config).toContain(
      'path /oauth2/sign_in /oauth2/start /oauth2/callback /oauth2/sign_out /oauth2/static/*'
    );
    expect(config).toContain('@oauth2_private path /oauth2/*');
    expect(config).toContain('respond @oauth2_private 404');
    expect(config).toContain('unix//run/spotify-wallpaper/public/public.sock');
    expect(config).toContain(
      'unix//run/spotify-wallpaper/oauth/oauth2-proxy.sock'
    );
    expect(config).toContain('header_up -X-SWP-Client-IP');
    expect(config).toContain('header_up X-SWP-Client-IP {remote_host}');
    expect(config).not.toMatch(/header_up\s+[-+]?Authorization/iu);
    expect(config).toContain('auto_https disable_redirects');
    expect(config).toMatch(
      /\{\s*admin off\s*auto_https disable_redirects\s*log \{\s*output discard\s*\}\s*\}/u
    );
    expect(config.match(/^\s*log\s*\{/gmu)).toHaveLength(1);
    expect(deployRunbook).toContain('systemctl daemon-reload');
    expect(deployRunbook).toContain('inbound TCP 80');
    expect(deployRunbook).toContain('never returns a');
  });

  it('restricts the dormant OAuth2 Proxy to one GitHub operator and Unix sockets', () => {
    const config = read('oauth2-proxy.cfg');

    expect(config).toContain('provider = "github"');
    expect(config).toContain('github_users = ["Ciellllllllll"]');
    expect(config).toContain('email_domains = ["*"]');
    expect(config).toContain(
      'http_address = "unix:///run/spotify-wallpaper/oauth/oauth2-proxy.sock,mode=0660"'
    );
    expect(config).toContain(
      'upstreams = ["unix:///run/spotify-wallpaper/admin/admin.sock"]'
    );
    expect(config).toContain(
      'redirect_url = "https://ciel-spotify-wallpaper.duckdns.org/oauth2/callback"'
    );
    expect(config).toContain('cookie_name = "__Host-swp-admin"');
    expect(config).toContain('cookie_expire = "8h"');
    expect(config).toContain('cookie_csrf_expire = "10m"');
    expect(config).toContain('cookie_samesite = "strict"');
    expect(config).toContain('cookie_csrf_samesite = "lax"');
    expect(config).toContain('cookie_csrf_per_request = false');
    expect(config).toContain('cookie_secure = true');
    expect(config).toContain('cookie_httponly = true');
    expect(config).toContain('request_logging = false');
    expect(config).toContain('auth_logging = false');
    expect(config).toContain('standard_logging = false');
    expect(config).toContain('pass_authorization_header = false');
    expect(config).toContain('skip_auth_strip_headers = false');
    expect(config).not.toMatch(/client_(?:id|secret)\s*=/u);
    expect(config).not.toMatch(/cookie_secret\s*=/u);
  });

  it('runs Node locked, non-root, AF_UNIX-only, with distinct inherited socket groups', () => {
    const unit = read('systemd/swp-public-backend.service');
    const caddyUnit = read('systemd/swp-caddy.service');
    const oauthUnit = read('systemd/swp-oauth2-proxy.service');
    const directories = read('tmpfiles.d/spotify-wallpaper.conf');
    const users = read('sysusers.d/spotify-wallpaper.conf');
    const environment = read('environment/public-backend.env.example');

    expect(unit).toContain('User=swp_backend');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain('RestrictAddressFamilies=AF_UNIX');
    expect(unit).toContain('After=postgresql@17-swp.service');
    expect(unit).not.toContain('Requires=postgresql@17-swp.service');
    expect(unit).not.toContain('swp-migrate.service');
    expect(unit).toContain('SupplementaryGroups=swp-pg');
    expect(unit).toContain(
      'EnvironmentFile=/etc/spotify-wallpaper/public-backend.env'
    );
    expect(unit).toContain(
      'ExecStartPre=/usr/bin/rm -f -- /run/spotify-wallpaper/public/public.sock /run/spotify-wallpaper/admin/admin.sock'
    );
    expect(environment).toContain('SPOTIFY_MODE=policy_locked');
    expect(environment).toContain(
      'PUBLIC_SOCKET_PATH=/run/spotify-wallpaper/public/public.sock'
    );
    expect(environment).toContain(
      'ADMIN_SOCKET_PATH=/run/spotify-wallpaper/admin/admin.sock'
    );
    expect(environment).not.toContain('synthetic_test');
    expect(directories).toContain('2770 swp_backend swp-public');
    expect(directories).toContain('2770 swp_backend swp-admin');
    expect(caddyUnit).toContain('SupplementaryGroups=swp-public swp-oauth');
    expect(caddyUnit).toContain(
      'Requires=swp-public-backend.service swp-oauth2-proxy.service'
    );
    expect(caddyUnit).not.toContain('swp-admin');
    expect(oauthUnit).toContain('Group=swp-oauth');
    expect(oauthUnit).toContain('Requires=swp-public-backend.service');
    expect(oauthUnit).toContain('SupplementaryGroups=swp-admin');
    expect(users).toContain('g swp-public');
    expect(users).toContain('g swp-admin');
    expect(users).toContain('g swp-oauth');
    expect(users).toContain('g swp-pg');
    expect(users).toContain('m caddy swp-public');
    expect(users).toContain('m caddy swp-oauth');
    expect(users).toContain('m oauth2-proxy swp-admin');
  });

  it('pins PostgreSQL 17 to port 5433 and peer-only Unix access', () => {
    const postgres = read('postgresql/postgresql.conf');
    const hba = read('postgresql/pg_hba.conf');
    const bootstrap = read('postgresql/bootstrap.sql');

    expect(postgres).toContain("listen_addresses = ''");
    expect(postgres).toContain('port = 5433');
    expect(postgres).toContain("data_directory = '/var/lib/postgresql/17/swp'");
    expect(postgres).toContain(
      "hba_file = '/etc/postgresql/17/swp/pg_hba.conf'"
    );
    expect(postgres).toContain(
      "ident_file = '/etc/postgresql/17/swp/pg_ident.conf'"
    );
    expect(postgres).toContain("unix_socket_directories = '/run/postgresql' ");
    expect(postgres).toContain("unix_socket_group = 'swp-pg'");
    expect(postgres).toContain('log_error_verbosity = terse');
    expect(postgres).toContain('log_parameter_max_length_on_error = 0');
    expect(hba).toMatch(/^local\s+spotify_wallpaper\s+swp_backend\s+peer$/mu);
    expect(hba).toMatch(
      /^local\s+spotify_wallpaper_deletion_ledger\s+swp_backend\s+peer$/mu
    );
    expect(hba).toMatch(/^local\s+all\s+postgres\s+peer$/mu);
    expect(hba).not.toMatch(/^host/mu);
    expect(bootstrap).toContain('CREATE ROLE swp_backend LOGIN');
    expect(bootstrap).toContain('CREATE ROLE swp_migrator LOGIN');
    expect(bootstrap).toContain('ALTER ROLE swp_backend WITH');
    expect(bootstrap).toContain('ALTER ROLE swp_restore WITH');
    expect(bootstrap).toContain('PASSWORD NULL');
    expect(bootstrap).toContain('CREATE DATABASE spotify_wallpaper OWNER swp_migrator');
    expect(bootstrap).toContain(
      'CREATE DATABASE spotify_wallpaper_deletion_ledger OWNER swp_migrator'
    );
    expect(bootstrap).toContain('FROM pg_auth_members');
    expect(bootstrap).toContain(
      "EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role)"
    );
    expect(bootstrap).toContain('\\gexec');
    expect(bootstrap).toContain('REVOKE ALL ON DATABASE spotify_wallpaper FROM PUBLIC');
    expect(bootstrap).not.toMatch(/PASSWORD\s+'[^']+'/iu);
  });

  it('keeps migrations locked and backups unpromoted until isolated restore validation', () => {
    const migration = read('scripts/migrate.sh');
    const backup = read('scripts/backup.sh');
    const validator = read('scripts/validate-database.sh');
    const primaryGrants = read('scripts/grants-primary.sql');
    const ledgerGrants = read('scripts/grants-ledger.sql');

    expect(migration).toContain('ON_ERROR_STOP');
    expect(migration).toContain('pg_advisory_lock');
    expect(migration).toContain('schema_migrations');
    expect(migration).toContain('grants-primary.sql');
    expect(migration).toContain('grants-ledger.sql');
    expect(primaryGrants).toContain('GRANT SELECT, INSERT, UPDATE, DELETE');
    expect(ledgerGrants).toContain(
      'GRANT SELECT, INSERT, UPDATE ON deletion_tombstones TO swp_backend'
    );
    expect(ledgerGrants).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON deletion_tombstones TO swp_backend'
    );
    expect(backup).toContain('umask 077');
    expect(backup).toContain('pg_dump --format=custom');
    expect(backup).toContain('pg_restore --list');
    expect(backup).not.toContain(' - <"$dump"');
    expect(backup).toContain(
      'validate-database.sh "$validation_database" "$label" restored'
    );
    expect(backup).not.toContain('to_regclass');
    expect(validator).toContain('pg_dump --schema-only --no-owner');
    expect(validator).toContain("string_agg(version, ',' ORDER BY version)");
    expect(validator).toContain('cmp --silent');
    expect(validator).toContain('aclexplode');
    expect(validator).toContain('callback_confirmations');
    expect(validator).toContain('deletion_tombstones');
    expect(validator).toContain('grants-$label.sql');
    expect(validator).toContain('trap cleanup EXIT');
    expect(validator).toContain("trap '' HUP INT TERM");
    expect(validator).toContain("trap 'exit 143' HUP INT TERM");
    expect(validator).toContain('actual_user=swp_restore');
    expect(validator).toContain(
      'case "$profile" in restored|live|recovery) ;; *) exit 1 ;; esac'
    );
    expect(validator).toContain('recovery) actual_user=postgres ;;');
    expect(validator).toContain("database.owner = 'swp_migrator'");
    expect(validator).toContain('object.relowner <> database.datdba');
    expect(validator).toContain('database_acl');
    expect(validator).toContain('rolsuper');
    expect(validator).toContain('rolcreatedb');
    expect(validator).toContain('rolbypassrls');
    const roleSecurity = validator.slice(
      validator.indexOf('role_security='),
      validator.indexOf('\n[ "$role_security"')
    );
    expect(roleSecurity).toContain('runuser -u postgres -- psql');
    expect(roleSecurity).toContain('--dbname=postgres');
    expect(roleSecurity).toContain('FROM pg_authid');
    expect(roleSecurity).not.toContain('FROM pg_roles');
    const membershipSecurity = validator.slice(
      validator.indexOf('membership_security='),
      validator.indexOf('\n[ "$membership_security"')
    );
    expect(membershipSecurity).toContain('runuser -u postgres -- psql');
    expect(membershipSecurity).toContain('pg_auth_members');
    expect(membershipSecurity).toContain('member.rolname IN');
    expect(backup.indexOf('snapshot_epoch=$(date +%s)')).toBeLessThan(
      backup.indexOf('pg_dump --format=custom')
    );
    expect(backup).toContain('touch -d "@$snapshot_epoch" "$temporary_dump"');
    expect(backup).toContain(
      '[ "$(stat -c %Y -- "$temporary_dump")" = "$snapshot_epoch" ]'
    );
    expect(backup.indexOf('validate_dump')).toBeLessThan(
      backup.indexOf('sha256sum')
    );
    expect(
      backup.indexOf('sha256sum --check "${temporary_sidecar##*/}"')
    ).toBeLessThan(backup.indexOf('ln -- "$temporary_dump" "$final"'));
    expect(backup).toContain('[ "$verified_digest" = "$digest" ]');
    expect(backup).toContain('temporary_sidecar=');
    expect(backup).toContain('final_dump=');
    expect(backup).toContain('backup_committed=false');
    expect(backup).toContain('final_dump_published=false');
    expect(backup).toContain('final_sidecar_published=false');
    expect(backup).toContain('[ -z "$temporary_dump" ] || rm -f -- "$temporary_dump"');
    expect(backup).toContain('[ -z "$temporary_sidecar" ] || rm -f -- "$temporary_sidecar"');
    expect(backup).toContain(
      '[ "$final_dump_published" != true ] || rm -f -- "$final_dump"'
    );
    expect(backup).toContain(
      '[ "$final_sidecar_published" != true ] || rm -f -- "$final_sidecar"'
    );
    expect(backup).toContain('[ ! -L "$final" ]');
    expect(backup).toContain('[ ! -L "$final.sha256" ]');
    expect(
      backup.indexOf('ln -- "$temporary_dump" "$final"')
    ).toBeGreaterThan(
      backup.indexOf('sha256sum --check "${temporary_sidecar##*/}"')
    );
    expect(backup).not.toContain('mv -- "$temporary_dump" "$final"');
    expect(backup.indexOf('backup_committed=true')).toBeGreaterThan(
      backup.indexOf('validate_sidecar "$final"')
    );
    expect(backup).toContain('validate_sidecar "$resolved"');
    expect(backup).toContain('sidecar_entry=');
    expect(backup).toContain('${sidecar_dump##*/}');
    expect(backup).toContain('35 * 24 * 60 * 60');
    expect(backup).toContain('spotify_wallpaper_deletion_ledger');
    expect(backup).toContain('validation_created=false');
    expect(backup).toContain('if [ "$validation_created" = true ]');
    expect(backup).toContain("trap '' HUP INT TERM");
    expect(backup).toContain("trap 'exit 143' HUP INT TERM");
    expect(backup.indexOf('createdb --template=template0')).toBeLessThan(
      backup.indexOf('validation_created=true')
    );
    expect(backup.lastIndexOf('prune_old primary')).toBeLessThan(
      backup.lastIndexOf('purge_expired_tombstones')
    );
    expect(backup.lastIndexOf('assert_retention ledger')).toBeLessThan(
      backup.lastIndexOf('purge_expired_tombstones')
    );
    expect(backup).toContain('reconciled_at_ms < $retention_cutoff_ms');
    expect(backup).not.toContain('expires_at_ms <= $now_ms');
  });

  it('allows credential recovery only for primary loss with a live ledger', () => {
    const restore = read('scripts/restore.sh');
    const restoreRunbook = readFileSync(
      new URL('docs/operations/cloudflare-worker-restore.md', repositoryRoot),
      'utf8'
    );

    expect(restore).toContain('primary-only-loss)');
    expect(restore).toContain(
      'ledger-only-loss|both-loss|cluster-loss|backup-only)'
    );
    expect(restore).toContain('RECOVERY_REJECTED_REAUTHORIZE_ALL');
    expect(restore).toContain('spotify_wallpaper_deletion_ledger');
    expect(restore).toContain(
      'validate-database.sh spotify_wallpaper_deletion_ledger ledger live'
    );
    expect(restore).toContain('pg_restore --role=swp_migrator');
    expect(restore).not.toContain(' - <"$candidate"');
    expect(restore).toContain('ALTER DATABASE :"recovery" OWNER TO swp_migrator');
    expect(restore).toContain('REVOKE ALL ON DATABASE :"recovery" FROM PUBLIC');
    expect(restore).toContain('SET ROLE swp_migrator');
    expect(restore).toContain('\\i /usr/local/libexec/spotify-wallpaper/grants-primary.sql');
    expect(restore).toContain('ALTER DATABASE :"recovery" RENAME TO spotify_wallpaper');
    expect(restore).toContain(
      'validate-database.sh "$recovery" primary recovery'
    );
    expect(restore).toContain(
      'validate-database.sh spotify_wallpaper primary live'
    );
    expect(restore).toContain('candidate_digest=');
    expect(restore).toContain('${candidate##*/}');
    expect(restore).toContain('sha256sum --check --strict');
    expect(
      restore.indexOf('validate-database.sh "$recovery" primary recovery')
    ).toBeLessThan(
      restore.indexOf('ALTER DATABASE :"recovery" RENAME TO spotify_wallpaper')
    );
    expect(restore).toContain('fixed_database_exists');
    expect(restore).toContain('runuser -u postgres');
    expect(restore).not.toContain('to_regclass');
    expect(restore).toContain(
      'SELECT public_id FROM deletion_tombstones ORDER BY public_id'
    );
    const tombstoneExport = restore.slice(
      restore.indexOf(
        'runuser -u swp_maintenance -- psql --no-psqlrc --quiet'
      ),
      restore.indexOf('\n\nrestore_sql=')
    );
    expect(tombstoneExport).toContain('--set=ON_ERROR_STOP=1');
    expect(restore).not.toContain('WHERE expires_at_ms >');
    expect(restore).toContain(
      'UPDATE deletion_tombstones SET reconciled_at_ms = NULL'
    );
    expect(restore).toContain(
      '/usr/local/libexec/spotify-wallpaper/reconcile.sh'
    );
    expect(restore).toContain('[ "$pending" -gt 0 ]');
    expect(restore).toContain("pending=%s\\n' \"$pending\"");
    expect(restore.indexOf('SET reconciled_at_ms = NULL')).toBeLessThan(
      restore.indexOf('/usr/local/libexec/spotify-wallpaper/reconcile.sh')
    );
    expect(restore).toContain('recovery_created=false');
    expect(restore).toContain('if [ "$recovery_created" = true ]');
    expect(restore).not.toContain('fixed_database_present()');
    expect(restore).toContain(
      "SELECT count(*) FROM pg_database WHERE datname = 'spotify_wallpaper'"
    );
    expect(restore).toContain('if [ "$recovery_promoted" = true ]; then');
    expect(restore).toContain('sidecar=$candidate.sha256');
    expect(restore).toContain('[ ! -L "$sidecar" ]');
    expect(restore).toContain('[ "$(realpath -- "$sidecar")" = "$sidecar" ]');
    expect(restore).toContain('[ "$(stat -c %U -- "$sidecar")" = root ]');
    expect(restore).toContain('[ "$(stat -c %a -- "$sidecar")" = 600 ]');
    expect(restore).toContain("trap cleanup EXIT");
    expect(restore).toContain("trap 'exit 143' HUP INT TERM");
    expect(restore).not.toContain('trap cleanup HUP INT TERM');
    expect(restore.indexOf('createdb --template=template0')).toBeLessThan(
      restore.indexOf('recovery_created=true')
    );
    expect(restore).not.toContain('systemctl start');
    for (const unit of [
      'swp-public-backend.service',
      'swp-oauth2-proxy.service',
      'swp-caddy.service',
      'swp-backup.service',
      'swp-backup.timer',
      'swp-reconcile.service',
      'swp-reconcile.timer',
      'swp-migrate.service'
    ]) {
      expect(restore).toContain(unit);
    }
    expect(restore).toContain('systemctl is-active --quiet "$unit"');
    expect(restoreRunbook).toContain('systemctl stop swp-migrate.service');
  });

  it('keeps the primary-loss restore exercise tracked and reproducible', () => {
    const exercise = read('test/restore-reconcile-integration.sh');

    expect(exercise).toContain('postgres:17');
    expect(exercise).toContain('restore.sh" primary-only-loss');
    expect(exercise).toContain('install -d -m 0755 /run/spotify-wallpaper');
    expect(exercise).toContain('reconciled_at_ms');
    expect(exercise).toContain('attempts = 8');
    expect(exercise).toContain('[ "$pending" = 0 ]');
    expect(exercise).toContain('RESTORE_RECONCILE_INTEGRATION_PASS');
    expect(exercise).toContain('validate-database.real.sh');
    expect(exercise).toContain('= recovery ] && exit 1');
    expect(exercise).toContain("SHOW data_directory");
    expect(exercise).toContain("SHOW hba_file");
    expect(exercise).not.toMatch(/pg_restore --list\s+"\$backup"\s*$/mu);
  });

  it('runs the real release deploy, resume, and rollback from a fresh root', () => {
    const exercise = read('test/release-integration.sh');

    expect(exercise).toContain('release.sh deploy');
    expect(exercise).toContain('release.sh rollback');
    expect(exercise).toContain('groupadd --system swp-public');
    expect(exercise).toContain('groupadd --system swp-admin');
    expect(exercise).toContain('useradd --system');
    expect(exercise).toContain('swp_backend');
    expect(exercise).toContain('/opt/spotify-wallpaper/current');
    expect(exercise).toContain('stat -c %a');
    expect(exercise).toContain('daemon-reload');
    expect(exercise).toContain('daemon-reload.fail');
    expect(exercise).toContain('if deploy "$second"; then');
    expect(exercise).toContain('RELEASE_INTEGRATION_PASS');
  });

  it('keeps the dormant protocol end-to-end exercise tracked and isolated', () => {
    const dockerfile = read('test/Dockerfile.synthetic-e2e');
    const exercise = read('test/synthetic-e2e.sh');
    const upstream = read('test/synthetic-upstream.mjs');
    const client = read('test/synthetic-client.mjs');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS node');
    expect(dockerfile).toContain('FROM postgres:17.10-bookworm');
    expect(dockerfile).toContain('caddy');
    expect(exercise).toContain('SPOTIFY_MODE=synthetic_test');
    expect(exercise).toContain('PG_SOCKET_DIR=/run/postgresql');
    expect(exercise).toContain('apps/public-backend/src');
    expect(exercise).toContain('npm run build:shared-types');
    expect(exercise).toContain(
      'npm run build --workspace @spotify-wallpaper/public-backend'
    );
    expect(exercise).toContain('synthetic-upstream.mjs');
    expect(exercise).toContain('synthetic-client.mjs');
    expect(upstream).toContain('createServer');
    expect(upstream).toContain('https:');
    expect(upstream).toContain('/api/token');
    expect(upstream).toContain('/v1/me/player');
    expect(client).toContain('/auth/start');
    expect(client).toContain('/auth/confirm');
    expect(client).toContain('/auth/reauthorize');
    expect(client).toContain('/api/playback');
    expect(client).toContain('/api/control');
    expect(client).toContain('/api/account');
    expect(client).toContain('SYNTHETIC_E2E_PASS');
    expect(exercise).toContain(
      'caddy validate --config /repo/deploy/public-backend/Caddyfile --adapter caddyfile'
    );
    expect(exercise).not.toMatch(/echo\s+.*(?:PAIRING|TOKEN)/iu);
  });

  it('keeps the exact retention boundary fail-closed against snapshot races', () => {
    const cutoffEpoch = 10_000;
    const snapshotStarts = [cutoffEpoch - 1, cutoffEpoch, cutoffEpoch + 1];
    const retainedSnapshots = snapshotStarts.filter(
      (startedAt) => startedAt > cutoffEpoch
    );
    expect(retainedSnapshots).toEqual([cutoffEpoch + 1]);

    const reconciledAtMs = [
      (cutoffEpoch - 1) * 1000,
      cutoffEpoch * 1000,
      (cutoffEpoch + 1) * 1000
    ];
    const purgeable = reconciledAtMs.filter(
      (reconciledAt) => reconciledAt < cutoffEpoch * 1000
    );
    expect(purgeable).toEqual([(cutoffEpoch - 1) * 1000]);
    expect(Math.min(...retainedSnapshots) * 1000).toBeGreaterThan(
      Math.max(...purgeable)
    );
  });

  it('monitors both backups and reconciliation and sends only a fixed alert', () => {
    const monitor = read('scripts/monitor.sh');
    const reconcile = read('scripts/reconcile.sh');
    const monitorUnit = read('systemd/swp-monitor.service');

    expect(monitor).toContain('spotify_wallpaper');
    expect(monitor).toContain('spotify_wallpaper_deletion_ledger');
    expect(monitor).toContain('cielgameee@gmail.com');
    expect(monitor).toContain('Spotify Wallpaper backend local check failed');
    expect(monitor).not.toContain('$output');
    expect(monitor).toContain('preflight.sh node');
    expect(monitor).toContain('17.11');
    expect(monitor).toContain('systemctl is-active --quiet swp-caddy.service');
    expect(monitor).toContain(
      'systemctl is-active --quiet swp-oauth2-proxy.service'
    );
    expect(monitor).toContain('preflight.sh oauth2-proxy');
    expect(monitor).toContain('COALESCE(last_attempt_at_ms, deleted_at_ms)');
    expect(monitor).toContain('check_tls');
    expect(monitor).toContain('openssl s_client');
    expect(monitor).toContain('openssl x509 -checkend 604800');
    expect(monitor).toContain('tls_certificate=$(mktemp');
    expect(monitor).toContain('rm -f -- "$tls_certificate"');
    expect(monitor).not.toMatch(/openssl s_client[\s\S]*?\|\s*\n?\s*openssl x509/u);
    expect(monitor).toContain('check_systemd');
    expect(monitor).toContain('systemctl --failed --no-legend --plain');
    expect(monitor).toContain('LastTriggerUSec');
    expect(monitor).toContain('swp-backup.timer 129600');
    expect(monitor).toContain('swp-reconcile.timer 1800');
    expect(monitor).toContain('swp-monitor.timer 900');
    expect(monitorUnit).toContain(
      'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'
    );
    const preflight = read('scripts/preflight.sh');
    expect(preflight).toContain('postgres (PostgreSQL) 17.11');
    expect(preflight).toContain('7\\.15\\.3');
    expect(reconcile).toContain('attempted=');
    expect(reconcile).toContain('reconciled=');
    expect(reconcile).toContain('failed=');
    expect(reconcile).toContain('pending=');
    expect(reconcile).toContain('DELETE FROM spotify_backoff');
    expect(reconcile).toContain('other.public_id <>');
    expect(reconcile).toContain('DELETE FROM oauth_sessions');
    expect(reconcile).toContain('DELETE FROM setup_sessions');
    expect(reconcile).toContain('DELETE FROM callback_confirmations');
    expect(reconcile).toContain('clock_timestamp()');
    expect(reconcile).toContain('expired_setup=');
    expect(reconcile).toContain('expired_oauth=');
    expect(reconcile).toContain('expired_confirmation=');
    expect(reconcile.indexOf('BEGIN;')).toBeLessThan(
      reconcile.indexOf('DELETE FROM spotify_backoff')
    );
    expect(reconcile.indexOf('DELETE FROM credentials')).toBeLessThan(
      reconcile.indexOf('COMMIT;')
    );
    expect(reconcile).toContain('reconciled_at_ms="$(date +%s)000"');
    const pendingExport = reconcile.slice(
      reconcile.indexOf(
        'runuser -u swp_maintenance -- psql --no-psqlrc --quiet',
        reconcile.indexOf('pending_file=')
      ),
      reconcile.indexOf('\n\nattempted=')
    );
    expect(pendingExport).toContain('--set=ON_ERROR_STOP=1');
    const statsQuery = reconcile.slice(
      reconcile.indexOf('stats='),
      reconcile.indexOf('\nset -- $stats')
    );
    expect(statsQuery).toContain('--set=ON_ERROR_STOP=1');
    expect(reconcile).not.toContain(
      'DELETE FROM deletion_tombstones WHERE reconciled_at_ms IS NOT NULL AND expires_at_ms'
    );
    expect(read('systemd/swp-backup.timer')).toContain('OnCalendar=daily');
    expect(read('systemd/swp-reconcile.timer')).toContain(
      'OnUnitActiveSec=10m'
    );
    expect(read('systemd/swp-monitor.timer')).toContain('OnUnitActiveSec=5m');
  });

  it('verifies immutable release trees before atomic promotion and rollback', () => {
    const release = read('scripts/release.sh');

    expect(release).toContain('npm ci --omit=dev --ignore-scripts');
    expect(release).toContain('@spotify-wallpaper/public-backend');
    expect(release).toContain('@spotify-wallpaper/shared-types');
    expect(release).toContain('node_modules');
    expect(release).toContain('RUNTIME-MANIFEST.sha256');
    expect(release).toContain('./SHA256SUMS|');
    expect(release).toContain('./RELEASE_ID|');
    expect(release).toContain('[ "$(cat "$tree/RELEASE_ID")" = "$release_id" ]');
    expect(release).toContain('sha256sum --check --strict SHA256SUMS');
    expect(release).toContain('validate-source)');
    expect(release).toContain('materialize_workspace_link');
    expect(release).toContain('node_modules/@spotify-wallpaper/public-backend');
    expect(release).toContain('assert_no_find_matches');
    expect(release).toContain('verify_runtime_manifest');
    const releaseIntegration = read('test/release-integration.sh');
    expect(releaseIntegration).toContain('extra.js');
    expect(releaseIntegration).toContain(
      'if sh /repo/deploy/public-backend/scripts/release.sh deploy'
    );
    const sourceValidation = release.slice(
      release.indexOf('source_path_allowed()'),
      release.indexOf('\nsmoke_locked_tree()')
    );
    expect(sourceValidation).not.toContain('./apps/public-backend/dist/*|');
    expect(sourceValidation).not.toContain('./apps/public-backend/migrations/*|');
    expect(sourceValidation).toContain('source_path_allowed "$path"');
    expect(sourceValidation).toContain(
      '[ "$path" = "./apps/public-backend/dist/src/$name" ]'
    );
    expect(sourceValidation).toContain('-maxdepth 1');
    expect(sourceValidation).toContain(
      './apps/public-backend/dist/src/*.js|./apps/public-backend/dist/src/*.d.ts)'
    );
    expect(sourceValidation).toContain('./apps/public-backend/migrations/*.sql)');
    expect(sourceValidation).toContain('./apps/public-backend/legal/*.md)');
    const smokeSuccess = release.slice(
      release.indexOf('if [ "$ready" != true ]'),
      release.indexOf('materialize_workspace_link')
    );
    expect(smokeSuccess).toMatch(/kill "\$backend_pid" 2>\/dev\/null \|\| true/u);
    expect(smokeSuccess).not.toMatch(/kill "\$backend_pid"\r?\n/u);
    expect(release).toContain('chmod -R a+rX');
    expect(release).toContain('/bin/sh "$preflight" node');
    expect(read('systemd/swp-public-backend.service')).toContain(
      'preflight.sh node'
    );
    expect(release).toContain('sha256sum --check');
    expect(release).toContain('mv -T --');
    expect(release).toContain('rollback)');
    expect(release).toContain('systemctl daemon-reload');
    expect(release).toContain('install-config-links)');
    expect(release).toContain('install_config_links');
    expect(release).toContain('root=/opt/spotify-wallpaper');
    expect(release).toContain('if [ -L "$path" ]; then');
    expect(release).toContain(
      '[ "$(stat -c %u -- "$path")" -eq 0 ] || return 1'
    );
    expect(release).toContain(
      'if [ -e "$root/current" ] && [ ! -L "$root/current" ]; then'
    );
    expect(release).toContain("trap '' HUP INT TERM");
    expect(release).toContain('previous_current=false');
    expect(release).toContain('verify_generation "$previous_target" "$previous_release_id"');
    expect(release).toContain('remove_config_links');
    expect(release).toContain('systemctl daemon-reload || promotion_status=$?');
    const promotion = release.slice(release.indexOf('promote_generation()'));
    expect(promotion.indexOf('if [ -e "$root/current" ]')).toBeLessThan(
      promotion.indexOf('install_config_links')
    );
    expect(release).toContain(
      'config_source=$root/current/config/deploy/public-backend'
    );
    expect(release).toContain('generations=$root/generations');
    expect(release).not.toContain('/opt/spotify-wallpaper/current-config');
    expect(release).toContain('install -d -o root -g root -m 0755');
    expect(release).toContain('/etc/caddy/Caddyfile');
    expect(release).toContain('/etc/spotify-wallpaper/oauth2-proxy.cfg');
    expect(release).toContain('/etc/postgresql/17/swp/postgresql.conf');
    expect(release).toContain('/etc/postgresql/17/swp/pg_hba.conf');
    expect(release).toContain('/etc/systemd/system/$name');
    expect(release).toContain('swp-public-backend.service');
    expect(release).toContain('/etc/tmpfiles.d/spotify-wallpaper.conf');
    expect(release).toContain('/etc/sysusers.d/spotify-wallpaper.conf');
    expect(release).toContain('/usr/local/libexec/spotify-wallpaper/$name');
    expect(release).toContain('restore.sh');
    expect(release).not.toContain('/etc/spotify-wallpaper/public-backend.env.example');
    expect(release).not.toContain('/etc/spotify-wallpaper/oauth2-proxy.env.example');
    expect(release).toContain('verify_config_tree');
    expect(release).toContain('config_files');
    expect(release).toContain('preflight=$self_directory/preflight.sh');
    expect(read('systemd/swp-migrate.service')).not.toContain('RemainAfterExit=yes');
    const configBuilder = read('scripts/build-config-bundle.sh');
    expect(configBuilder).toContain('deploy/public-backend/Caddyfile');
    expect(configBuilder).not.toContain("git archive \"$release_id\" deploy/public-backend");
    expect(configBuilder).not.toContain('deploy/public-backend/test');
    expect(release).toContain('SPOTIFY_MODE=policy_locked');
    expect(release).toContain(
      'public_socket=/run/spotify-wallpaper/public/public.sock'
    );
    expect(release).toContain(
      'admin_socket=/run/spotify-wallpaper/admin/admin.sock'
    );
    expect(release).toContain(
      'systemd-sysusers "$config/sysusers.d/spotify-wallpaper.conf"'
    );
    expect(release).toContain(
      'systemd-tmpfiles --create "$config/tmpfiles.d/spotify-wallpaper.conf"'
    );
    expect(release.indexOf('systemd-sysusers')).toBeLessThan(
      release.indexOf('smoke_locked_tree "$app"')
    );
    expect(release.indexOf('systemd-tmpfiles --create')).toBeLessThan(
      release.indexOf('smoke_locked_tree "$app"')
    );
    expect(release).toContain('runuser -u swp_backend -- env');
    expect(release).toContain(
      'install -d -o swp_backend -g swp-public -m 2770'
    );
    expect(release).toContain(
      'install -d -o swp_backend -g swp-admin -m 2770'
    );
    expect(release).not.toContain('run_dir=$2');
    expect(release).not.toContain('smoke_locked_tree "$app" "$incoming/run"');
    expect(release).toContain("trap 'cleanup_smoke; cleanup_incoming' EXIT");
    expect(release).toContain("trap 'cleanup_smoke; exit 143' HUP INT TERM");
    expect(release).toContain('backend_pid=');
    expect(release).toContain('kill "$backend_pid" 2>/dev/null || true');
    expect(release).toContain('trap cleanup_incoming EXIT HUP INT TERM');
    expect(release).not.toContain(
      'public_socket=$run_dir/public/backend.sock'
    );
    expect(release).toContain("-name '*.map'");
    expect(release).toContain("-name '*.ts' ! -name '*.d.ts'");
    const oauthInstaller = read('scripts/install-oauth2-proxy.sh');
    expect(oauthInstaller).toContain('version=7.15.3');
    expect(oauthInstaller).toContain(
      'checksum_name="$archive_name-sha256sum.txt"'
    );
    expect(oauthInstaller).toContain('sha256sum --check');
    const boundary = read('scripts/verify-authorization-boundary.sh');
    expect(boundary).toContain("--header 'Authorization: A'");
    expect(boundary).toContain('values.length === 1 && values[0] === "A"');
    expect(boundary).toContain('AUTHORIZATION_BOUNDARY_PASS');
  });

  it('keeps shell validation fail-closed when a loop command fails', () => {
    const release = read('scripts/release.sh');
    const backup = read('scripts/backup.sh');
    const monitor = read('scripts/monitor.sh');
    const restore = read('scripts/restore.sh');
    const configBuilder = read('scripts/build-config-bundle.sh');

    expect(release).toContain('done <"$members"');
    expect(release).toContain('done <"$paths"');
    expect(release).not.toMatch(
      /tar --list --file="\$archive"\s*\|\s*while IFS= read -r member/u
    );
    expect(release).not.toMatch(
      /find \. -mindepth 1 -print\)\s*\|\s*while IFS= read -r path/u
    );
    expect(release).not.toMatch(/find[\s\S]*\|\s*(grep|LC_ALL|while)/u);
    expect(configBuilder).not.toMatch(/git archive[\s\S]*\|\s*tar/u);
    expect(configBuilder).not.toMatch(/find[\s\S]*\|\s*(LC_ALL|xargs)/u);

    expect(backup).toContain('done <"$candidates"');
    expect(backup).not.toMatch(
      /find "\$directory"[\s\S]*\|\s*\n?\s*while IFS= read -r candidate/u
    );
    expect(backup).not.toContain('sha256sum -- "$temporary_dump" | cut');
    expect(monitor).not.toMatch(
      /find "\$directory"[\s\S]*\|\s*(LC_ALL|tail)/u
    );
    expect(restore).not.toMatch(/\}\s*\|\s*runuser/u);
    expect(restore).toContain(
      "'COPY swp_restore_tombstones (public_id) FROM STDIN;' || exit 1"
    );
    const createRecovery = restore.slice(
      restore.indexOf("trap '' HUP INT TERM\nrunuser -u swp_restore -- createdb"),
      restore.indexOf(
        'runuser -u postgres -- psql',
        restore.indexOf('runuser -u swp_restore -- createdb')
      )
    );
    expect(createRecovery).toMatch(
      /trap '' HUP INT TERM[\s\S]*createdb --template=template0[\s\S]*recovery_created=true[\s\S]*trap 'exit 143' HUP INT TERM/u
    );
    const promoteRecovery = restore.slice(
      restore.indexOf('trap \'\' HUP INT TERM', restore.indexOf('grants-primary.sql')),
      restore.indexOf(
        '/usr/local/libexec/spotify-wallpaper/validate-database.sh',
        restore.indexOf('trap \'\' HUP INT TERM', restore.indexOf('grants-primary.sql'))
      )
    );
    expect(promoteRecovery).toMatch(
      /trap '' HUP INT TERM[\s\S]*ALTER DATABASE :"recovery" RENAME TO spotify_wallpaper[\s\S]*recovery_promoted=true[\s\S]*trap 'exit 143' HUP INT TERM/u
    );

    expect(monitor).toContain('check_disk_table');
    expect(monitor).toContain('listeners=$(mktemp)');
    expect(monitor).toContain('disk_file=$(mktemp)');
    expect(monitor).not.toMatch(/ss --tcp[^\r\n]*\|\s*grep/u);
    expect(monitor).not.toMatch(/df -P[^\r\n]*\|\s*awk/u);
    expect(monitor).not.toMatch(/df -Pi[^\r\n]*\|\s*awk/u);
  });
});
