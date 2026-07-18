# Cloudflare Worker Deployment Runbook

## Scope

This runbook deploys the optional public Spotify backend to Cloudflare
Workers. Preview and production are separate security boundaries. Never reuse a
D1 database, key, Rate Limiting namespace, Analytics Engine dataset, Worker
name, or hostname between them.

Production deployment is allowed only when:

- the Cloudflare account uses Workers Paid;
- the production hostname is a fixed HTTPS Custom Domain in a zone controlled
  by the operator;
- Spotify is configured with the exact callback
  `$selectedPublicBaseUrl/auth/callback`;
- invocation logs remain disabled;
- both D1 migration gates pass; and
- the preview release has completed its verification and soak gates.

Do not use a `workers.dev` URL as the production Spotify redirect URI.

## Operator environment

Obtain values from the deployment inventory or secret manager and expose them
only to the current PowerShell process. Do not write them to a tracked file.
The generated configuration consumes these variables:

```text
CLOUDFLARE_DEPLOY_ENV
CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL
CLOUDFLARE_PREVIEW_PRIMARY_D1_ID
CLOUDFLARE_PREVIEW_DELETION_D1_ID
CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL
CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID
CLOUDFLARE_PRODUCTION_DELETION_D1_ID
```

`CLOUDFLARE_DEPLOY_ENV` is mandatory. The generator reads all six
environment-specific values, rejects any missing value, and rejects origins or
D1 IDs shared across preview and production before selecting the requested
environment.

The deployment inventory also supplies:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_PRIMARY_D1_NAME
CLOUDFLARE_DELETION_D1_NAME
CLOUDFLARE_CUSTOM_DOMAIN
CLOUDFLARE_GENERATED_CONFIG
CLOUDFLARE_AUTH_RATE_LIMIT_NAMESPACE_ID
CLOUDFLARE_PRE_AUTH_RATE_LIMIT_NAMESPACE_ID
CLOUDFLARE_PLAYBACK_RATE_LIMIT_NAMESPACE_ID
CLOUDFLARE_CONTROL_RATE_LIMIT_NAMESPACE_ID
CLOUDFLARE_ANALYTICS_DATASET
CLOUDFLARE_MONTHLY_BUDGET_USD
```

Use `preview` or `production` for `CLOUDFLARE_DEPLOY_ENV`. Each public base URL
must be exactly `https://` plus its Custom Domain on standard port 443, with no
explicit port, path, query, fragment, user information, trailing slash, or
redirect.

Check presence without printing values:

```powershell
$deployEnvironment = $env:CLOUDFLARE_DEPLOY_ENV
if ($deployEnvironment -notin @('preview', 'production')) {
  throw 'CLOUDFLARE_DEPLOY_ENV must be preview or production.'
}
$environmentPrefix = "CLOUDFLARE_$($deployEnvironment.ToUpperInvariant())"
$publicBaseUrlVariable = "${environmentPrefix}_PUBLIC_BASE_URL"
$primaryD1IdVariable = "${environmentPrefix}_PRIMARY_D1_ID"
$deletionD1IdVariable = "${environmentPrefix}_DELETION_D1_ID"
$required = @(
  'CLOUDFLARE_DEPLOY_ENV',
  'CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL',
  'CLOUDFLARE_PREVIEW_PRIMARY_D1_ID',
  'CLOUDFLARE_PREVIEW_DELETION_D1_ID',
  'CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL',
  'CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID',
  'CLOUDFLARE_PRODUCTION_DELETION_D1_ID',
  'CLOUDFLARE_PRIMARY_D1_NAME',
  'CLOUDFLARE_DELETION_D1_NAME',
  'CLOUDFLARE_CUSTOM_DOMAIN',
  'CLOUDFLARE_GENERATED_CONFIG',
  'CLOUDFLARE_AUTH_RATE_LIMIT_NAMESPACE_ID',
  'CLOUDFLARE_PRE_AUTH_RATE_LIMIT_NAMESPACE_ID',
  'CLOUDFLARE_PLAYBACK_RATE_LIMIT_NAMESPACE_ID',
  'CLOUDFLARE_CONTROL_RATE_LIMIT_NAMESPACE_ID',
  'CLOUDFLARE_ANALYTICS_DATASET',
  'CLOUDFLARE_MONTHLY_BUDGET_USD'
)
$missing = $required.Where({ [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
if ($missing.Count -ne 0) { throw "Missing deployment variables: $($missing -join ', ')" }
$selectedPublicBaseUrl = [Environment]::GetEnvironmentVariable($publicBaseUrlVariable)
$selectedPrimaryD1Id = [Environment]::GetEnvironmentVariable($primaryD1IdVariable)
$selectedDeletionD1Id = [Environment]::GetEnvironmentVariable($deletionD1IdVariable)
$publicUri = [uri]$selectedPublicBaseUrl
if (
  $publicUri.Scheme -ne 'https' -or
  -not $publicUri.IsDefaultPort -or
  $publicUri.Port -ne 443 -or
  $publicUri.UserInfo -or
  $publicUri.AbsolutePath -ne '/' -or
  $publicUri.Query -or
  $publicUri.Fragment -or
  $selectedPublicBaseUrl -ne "https://$($publicUri.DnsSafeHost)"
) { throw 'Public origin must be a canonical HTTPS origin on standard port 443.' }
$expectedPrimaryName = "spotify-wallpaper-$deployEnvironment"
$expectedDeletionName = "spotify-wallpaper-deletion-$deployEnvironment"
if ($env:CLOUDFLARE_PRIMARY_D1_NAME -ne $expectedPrimaryName) { throw 'Primary D1 name must match the generated binding.' }
if ($env:CLOUDFLARE_DELETION_D1_NAME -ne $expectedDeletionName) { throw 'Deletion D1 name must match the generated binding.' }
if ($env:CLOUDFLARE_CUSTOM_DOMAIN -ne $publicUri.DnsSafeHost) { throw 'Custom Domain must match the public origin.' }
$monthlyBudgetUsd = 0.0
$budgetIsValid = [double]::TryParse(
  $env:CLOUDFLARE_MONTHLY_BUDGET_USD,
  [Globalization.NumberStyles]::Float,
  [Globalization.CultureInfo]::InvariantCulture,
  [ref]$monthlyBudgetUsd
)
if (
  -not $budgetIsValid -or
  [double]::IsNaN($monthlyBudgetUsd) -or
  [double]::IsInfinity($monthlyBudgetUsd) -or
  $monthlyBudgetUsd -le 0
) { throw 'CLOUDFLARE_MONTHLY_BUDGET_USD must be a positive finite number.' }
```

Never print the process environment in CI.

## One-time provisioning

### Account and domain

1. Enable Workers Paid and confirm the Standard usage model in the Cloudflare
   dashboard.
2. Add the preview and production hostnames to separate Worker environments.
3. Configure each hostname as a Custom Domain, not a wildcard route. The
   generated config must contain:

   ```json
   {
     "routes": [
       {
         "pattern": "$env:CLOUDFLARE_CUSTOM_DOMAIN",
         "custom_domain": true
       }
     ]
   }
   ```

   The snippet is illustrative: the generator substitutes the environment
   value. Do not commit a real hostname to generated output.
4. Wait for the Custom Domain certificate to become active before configuring
   Spotify.

### D1 databases

Create two D1 databases for the selected environment. Store the returned IDs
in the deployment inventory, then expose them through the selected environment
variables, for example `CLOUDFLARE_PREVIEW_PRIMARY_D1_ID` and
`CLOUDFLARE_PREVIEW_DELETION_D1_ID`.

```powershell
npx wrangler d1 create $env:CLOUDFLARE_PRIMARY_D1_NAME
npx wrangler d1 create $env:CLOUDFLARE_DELETION_D1_NAME
```

Repeat for the other environment with different names and IDs. Do not rely on
automatic provisioning in preview or production.

### Rate Limiting and Analytics Engine

Reserve four distinct Rate Limiting namespace IDs for each environment:
authentication, pre-authentication API traffic, authenticated playback, and
controls. Preview IDs must not appear in the production generated config.

`PRE_AUTH_RATE_LIMITER` limits unauthenticated work by source IP before D1
lookups. Give it a substantially higher limit than the per-credential playback
limit so several legitimate Wallpaper Engine clients behind one NAT do not
consume the shared IP budget. The generated configuration must keep its limit
at least ten times the playback limit; select the final value from NAT/load-test
evidence rather than lowering it to the per-user polling budget.

Cloudflare Rate Limiting is per location and permissive. It is abuse mitigation,
not a globally strict distributed-DoS control or Spotify upstream budget.
Before public traffic, configure reviewed zone-level WAF/rate-limiting controls
and complete distributed invalid-token, shared-NAT, authenticated-token, Spotify
upstream, and Worker/D1/Analytics cost tests. Record these as external release
gates; a successful Worker deploy does not close them.

Use one Analytics Engine dataset per environment. The dataset is created on
first write after the binding is deployed. Only aggregate dimensions are
allowed:

- route class;
- HTTP status class;
- latency bucket;
- rate-limit event class;
- token-refresh outcome class; and
- numeric latency and billable Worker invocation counts. Use Cloudflare's
  built-in Worker and D1 metrics for CPU and rows-read/written cost inputs.

Do not write URL, query string, callback URL, Client ID, IP address, `publicId`,
OAuth state, authorization code, PKCE verifier, Spotify token, Pairing Token,
key material, track metadata, or exception text.

## Generate and validate deployment configuration

From the repository root:

```powershell
$prepareScript = "prepare:deploy:$($env:CLOUDFLARE_DEPLOY_ENV)"
npm run $prepareScript -w @spotify-wallpaper/cloudflare-worker
$env:CLOUDFLARE_GENERATED_CONFIG = (
  Resolve-Path "apps/cloudflare-worker/.wrangler.$($env:CLOUDFLARE_DEPLOY_ENV).generated.json"
).Path
```

The generated config is environment-specific and must contain only the selected
environment under `env`. It is a disposable artifact and must not be committed.
Set `CLOUDFLARE_GENERATED_CONFIG` to that generated file's absolute path.

Validate the generated file without printing its full contents:

```powershell
$config = Get-Content -Raw $env:CLOUDFLARE_GENERATED_CONFIG | ConvertFrom-Json
$selected = $config.env.PSObject.Properties[$deployEnvironment].Value
if ($config.env.PSObject.Properties.Count -ne 1) { throw 'Generated config contains another environment.' }
if ($selected.vars.ENVIRONMENT -ne $deployEnvironment) { throw 'Environment mismatch.' }
if ($selected.vars.PUBLIC_BASE_URL -ne $selectedPublicBaseUrl) { throw 'Public origin mismatch.' }
if ($selected.d1_databases[0].database_id -ne $selectedPrimaryD1Id) { throw 'Primary D1 mismatch.' }
if ($selected.d1_databases[1].database_id -ne $selectedDeletionD1Id) { throw 'Deletion D1 mismatch.' }
if ($config.observability.logs.invocation_logs -ne $false) { throw 'Invocation logs must be disabled.' }
if ($selected.routes.Count -ne 1 -or $selected.routes[0].custom_domain -ne $true) { throw 'Custom Domain is required.' }
if ($selected.routes[0].pattern -ne $env:CLOUDFLARE_CUSTOM_DOMAIN) { throw 'Custom Domain mismatch.' }
$rateLimitBindings = @{}
foreach ($binding in $selected.ratelimits) { $rateLimitBindings[$binding.name] = $binding }
if ($rateLimitBindings.AUTH_RATE_LIMITER.namespace_id -ne $env:CLOUDFLARE_AUTH_RATE_LIMIT_NAMESPACE_ID) { throw 'Auth Rate Limit namespace mismatch.' }
if ($rateLimitBindings.PRE_AUTH_RATE_LIMITER.namespace_id -ne $env:CLOUDFLARE_PRE_AUTH_RATE_LIMIT_NAMESPACE_ID) { throw 'Pre-auth Rate Limit namespace mismatch.' }
if ($rateLimitBindings.PLAYBACK_RATE_LIMITER.namespace_id -ne $env:CLOUDFLARE_PLAYBACK_RATE_LIMIT_NAMESPACE_ID) { throw 'Playback Rate Limit namespace mismatch.' }
if ($rateLimitBindings.CONTROL_RATE_LIMITER.namespace_id -ne $env:CLOUDFLARE_CONTROL_RATE_LIMIT_NAMESPACE_ID) { throw 'Control Rate Limit namespace mismatch.' }
if (
  $rateLimitBindings.PRE_AUTH_RATE_LIMITER.simple.limit -lt
  (10 * $rateLimitBindings.PLAYBACK_RATE_LIMITER.simple.limit)
) { throw 'Pre-auth Rate Limit must be at least ten times the playback limit.' }
if ($selected.analytics_engine_datasets.Count -ne 1) { throw 'Analytics Engine binding is required.' }
if ($selected.analytics_engine_datasets[0].dataset -ne $env:CLOUDFLARE_ANALYTICS_DATASET) { throw 'Analytics Engine dataset mismatch.' }
```

Compare the selected namespace IDs, D1 IDs, dataset, and hostname with the
other environment's inventory. Stop if any value is shared.

Validate both generated environment configs with Wrangler before migration or
deployment. Preserve the selected target, generate and dry-run preview and
production independently, then regenerate the selected target:

```powershell
$targetEnvironment = $env:CLOUDFLARE_DEPLOY_ENV
foreach ($environment in @('preview', 'production')) {
  $env:CLOUDFLARE_DEPLOY_ENV = $environment
  $prepareScript = "prepare:deploy:$environment"
  npm run $prepareScript -w @spotify-wallpaper/cloudflare-worker
  if ($LASTEXITCODE -ne 0) { throw "Config generation failed for $environment." }
  $generatedConfig = (
    Resolve-Path "apps/cloudflare-worker/.wrangler.$environment.generated.json"
  ).Path
  npx wrangler deploy --dry-run --env $environment --config $generatedConfig
  if ($LASTEXITCODE -ne 0) { throw "Wrangler dry-run failed for $environment." }
}
$env:CLOUDFLARE_DEPLOY_ENV = $targetEnvironment
$prepareScript = "prepare:deploy:$targetEnvironment"
npm run $prepareScript -w @spotify-wallpaper/cloudflare-worker
if ($LASTEXITCODE -ne 0) { throw 'Selected deployment config regeneration failed.' }
$env:CLOUDFLARE_GENERATED_CONFIG = (
  Resolve-Path "apps/cloudflare-worker/.wrangler.$targetEnvironment.generated.json"
).Path
```

Do not print or commit either generated config. The dry-run must show the
expected environment-specific D1, Analytics Engine, and four Rate Limiting
bindings, and invocation logs must remain disabled.

## Migration gate

Use binding names with the generated config so Wrangler selects each binding's
`migrations_dir`. Run `list`, `apply`, then `list` again for both databases:

```powershell
npx wrangler d1 migrations list DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations apply DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations list DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG

npx wrangler d1 migrations list DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations apply DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations list DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
```

The second `list` for each database must report no unapplied migrations.
Record command status and migration names in the release record, but do not
store database exports or row contents as CI artifacts.

## Configure Worker secrets

Configure secrets independently for preview and production:

```powershell
$secretNames = @(
  'TOKEN_ENCRYPTION_KEYRING',
  'TOKEN_ENCRYPTION_ACTIVE_KEY_ID',
  'PAIRING_HMAC_KEYRING',
  'PAIRING_HMAC_ACTIVE_KEY_ID',
  'OAUTH_STATE_HMAC_KEY'
)
foreach ($secretName in $secretNames) {
  npx wrangler secret put $secretName --env $env:CLOUDFLARE_DEPLOY_ENV `
    --config $env:CLOUDFLARE_GENERATED_CONFIG
  if ($LASTEXITCODE -ne 0) { throw "Secret update failed for $secretName" }
}
```

Enter each value only at Wrangler's prompt. Do not pass a secret on the command
line, pipe it from shell history, place it in `.env`, or capture the prompt.
Encryption, Pairing HMAC, and OAuth-state keys must be independent CSPRNG
values. Follow the key-rotation runbook for an existing deployment.

## Pre-deploy gates

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper
h5i capture run -- npm run check -w @spotify-wallpaper/wallpaper
h5i capture run -- cargo test
git diff --check
```

Build the Workshop artifact with the same exact production origin:

```powershell
$env:VITE_SPOTIFY_BACKEND_ORIGIN = $selectedPublicBaseUrl
h5i capture run -- npm run build:workshop -w @spotify-wallpaper/wallpaper
h5i capture run -- npm run scan:public-backend-secrets:all
```

Inspect `apps/wallpaper/dist/project.json` and the generated JavaScript bundle
for the expected origin. Confirm that neither contains a Pairing Token or any
Worker secret.

## Deploy

Deploy preview first:

```powershell
h5i capture run -- npx wrangler deploy --strict --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler deployments list --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Record the deployed version ID outside the repository. Do not promote the same
generated file to production; regenerate it from the production environment
inventory and repeat all gates.

## Smoke tests

Use non-verbose requests. Never use a real Pairing Token in a shell command.

```powershell
$health = Invoke-RestMethod -Method Get -Uri "$selectedPublicBaseUrl/health"
if ($health.value.service -ne 'spotify-wallpaper-backend') { throw 'Health check failed.' }

$setup = Invoke-WebRequest -Method Get -Uri "$selectedPublicBaseUrl/setup"
if ($setup.StatusCode -ne 200) { throw 'Setup page failed.' }

$unauthorized = Invoke-WebRequest -SkipHttpErrorCheck -Method Get `
  -Uri "$selectedPublicBaseUrl/api/playback" `
  -Headers @{ Authorization = 'Bearer invalid' }
if ($unauthorized.StatusCode -ne 401) { throw 'Unauthorized API gate failed.' }
```

In an isolated browser profile, complete one preview OAuth flow using a
dedicated Spotify test app. Do not copy the callback URL, inspect it with
remote logging, or save the one-time Pairing Token outside Wallpaper Engine's
property. Verify playback, every control, reauthorization, and account deletion.

## Monitoring and alerts

Invocation logs must stay disabled in source, generated config, dashboard, and
every deployed version. Do not use `wrangler tail` on this Worker.

Query aggregate Analytics Engine data through an approved dashboard or SQL API
client. Alerts must cover:

- 5xx/status-class increase;
- refresh failure and `invalid_grant` outcome increase;
- rate-limit increase;
- scheduled reconciliation failure or pending deletion growth;
- D1 rows read/written and Worker request/CPU cost; and
- absence of expected aggregate metrics.

Set three account budget alerts at 50%, 80%, and 100% of the approved monthly
budget. Cloudflare budget alerts use dollar thresholds, so calculate the three
amounts from `CLOUDFLARE_MONTHLY_BUDGET_USD` and configure each in the
Cloudflare Billing dashboard:

```powershell
$budget = 0.0
$budgetIsValid = [double]::TryParse(
  $env:CLOUDFLARE_MONTHLY_BUDGET_USD,
  [Globalization.NumberStyles]::Float,
  [Globalization.CultureInfo]::InvariantCulture,
  [ref]$budget
)
if (
  -not $budgetIsValid -or
  [double]::IsNaN($budget) -or
  [double]::IsInfinity($budget) -or
  $budget -le 0
) { throw 'Monthly budget must be a positive finite number.' }
$thresholds = 0.50, 0.80, 1.00 | ForEach-Object { [math]::Round($budget * $_, 2) }
if ($thresholds.Count -ne 3) { throw 'Budget threshold calculation failed.' }
```

Route alerts to at least two maintainers and test delivery before production.

## Rollback

Worker rollback does not roll back D1. Verify schema compatibility before
rolling back:

```powershell
$env:CLOUDFLARE_ROLLBACK_VERSION_ID = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ROLLBACK_VERSION_ID')
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ROLLBACK_VERSION_ID)) { throw 'Rollback version is required.' }
npx wrangler rollback $env:CLOUDFLARE_ROLLBACK_VERSION_ID `
  --message 'Operational rollback' `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Repeat the smoke tests and monitor aggregate metrics. If data integrity is in
question, stop traffic and use the restore runbook instead of a code rollback.

## Soak and promotion

Preview must pass the complete integration suite. Production then starts as a
limited beta and runs for at least 72 continuous hours across:

- playing, paused, stopped, and track changes;
- Access Token refresh and Spotify 429;
- `invalid_grant` and reauthorization;
- account deletion and scheduled reconciliation;
- Worker deploy and rollback;
- network and D1 failures; and
- Wallpaper Engine restart and backend outage recovery.

Before promotion, attach evidence that zone-level WAF controls are active and
that shared-NAT, distributed invalid-token, authenticated-token, Spotify
upstream, and Worker/D1/Analytics cost tests passed. Cloudflare binding limits
and budget-alert configuration alone are not sufficient for public release.

The 72-hour gate restarts after a security, persistence, OAuth, CORS, binding,
or release-origin change. General Workshop publication remains blocked until
the separate Spotify policy gate is closed.

## References

- [Wrangler environments and generated configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)
- [Cloudflare usage-based billing and budget alerts](https://developers.cloudflare.com/billing/understand/usage-based-billing/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
