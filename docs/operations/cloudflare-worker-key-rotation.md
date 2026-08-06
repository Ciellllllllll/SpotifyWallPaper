# Cloudflare Worker Key Rotation Runbook

## Scope and invariants

Rotate preview first and production only after preview verification. Never
reuse key material between environments or between these purposes:

- Spotify token AES-256-GCM encryption;
- Pairing Token HMAC-SHA-256 digest; and
- OAuth state/browser-nonce HMAC.

Do not print, export, diff, log, or place key material in a command. Use
`wrangler secret put` interactively. Invocation logs remain disabled throughout
rotation.

Required operator variables:

```text
CLOUDFLARE_DEPLOY_ENV
CLOUDFLARE_GENERATED_CONFIG
CLOUDFLARE_PRIMARY_D1_NAME
CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL
CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL
```

Use the environment-prefixed public base URL matching
`CLOUDFLARE_DEPLOY_ENV`. Do not create or rely on an unprefixed
`CLOUDFLARE_PUBLIC_BASE_URL` generator input.

Record only key IDs, deployment version IDs, timestamps, aggregate row counts,
and reviewer approvals. Key values stay in the secret manager.

## Rotation model

`TOKEN_ENCRYPTION_KEYRING` supports lazy re-encryption. Reads decrypt with the
row's stored key ID and rewrite token ciphertext with
`TOKEN_ENCRYPTION_ACTIVE_KEY_ID`.

`PAIRING_HMAC_KEYRING` cannot lazily rotate an existing digest because the
Pairing secret is not stored. New credentials use
`PAIRING_HMAC_ACTIVE_KEY_ID`; an old HMAC key must remain available until no
credential row references it. Removing it earlier invalidates those users.

Changing `OAUTH_STATE_HMAC_KEY` invalidates every in-flight OAuth session.
Users can restart setup; no compatibility window is required.

## Planned encryption-key rotation

Set operator-only IDs. They are identifiers, not key values:

```powershell
if ([string]::IsNullOrWhiteSpace($env:TOKEN_OLD_KEY_ID)) { throw 'Old encryption key ID is required.' }
if ([string]::IsNullOrWhiteSpace($env:TOKEN_NEW_KEY_ID)) { throw 'New encryption key ID is required.' }
if ($env:TOKEN_OLD_KEY_ID -eq $env:TOKEN_NEW_KEY_ID) { throw 'Key IDs must differ.' }
```

1. In the secret manager, create a new 32-byte CSPRNG AES key.
2. Build a keyring JSON value containing both old and new key IDs.
3. Update the keyring first. Enter the JSON only at the prompt:

   ```powershell
   npx wrangler secret put TOKEN_ENCRYPTION_KEYRING `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

4. Smoke-test setup, playback, refresh, and one existing credential while the
   old key remains active.
5. Make the new key active:

   ```powershell
   npx wrangler secret put TOKEN_ENCRYPTION_ACTIVE_KEY_ID `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

6. Verify new OAuth and token-refresh writes use the new key ID. Query only
   key IDs and counts:

   ```powershell
   npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
     --command "SELECT refresh_token_key_id, COUNT(*) AS row_count FROM credentials GROUP BY refresh_token_key_id;" `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG

   npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
     --command "SELECT access_token_key_id, COUNT(*) AS row_count FROM credentials GROUP BY access_token_key_id;" `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG

   npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
     --command "SELECT encryption_key_id, COUNT(*) AS row_count FROM oauth_sessions GROUP BY encryption_key_id;" `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

7. Run at least 72 hours of preview soak, including forced Access Token refresh,
   paused playback, reauthorization, and account deletion. Repeat in production
   as a limited rollout.

Lazy re-encryption is traffic-driven. Do not scan, decrypt, or export
ciphertext merely to accelerate rotation.

## Planned Pairing-HMAC rotation

Set operator-only IDs:

```powershell
if ([string]::IsNullOrWhiteSpace($env:PAIRING_OLD_KEY_ID)) { throw 'Old Pairing key ID is required.' }
if ([string]::IsNullOrWhiteSpace($env:PAIRING_NEW_KEY_ID)) { throw 'New Pairing key ID is required.' }
if ($env:PAIRING_OLD_KEY_ID -eq $env:PAIRING_NEW_KEY_ID) { throw 'Key IDs must differ.' }
```

1. Create a new independent CSPRNG HMAC key.
2. Update `PAIRING_HMAC_KEYRING` to contain old and new keys:

   ```powershell
   npx wrangler secret put PAIRING_HMAC_KEYRING `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

3. Keep the old key active for a smoke test, then switch the active key:

   ```powershell
   npx wrangler secret put PAIRING_HMAC_ACTIVE_KEY_ID `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

4. Confirm a newly created credential uses the new ID and an existing
   credential still authenticates. Query only aggregate counts:

   ```powershell
   npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
     --command "SELECT pairing_key_id, COUNT(*) AS row_count FROM credentials GROUP BY pairing_key_id;" `
     --env $env:CLOUDFLARE_DEPLOY_ENV `
     --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

5. Keep the old key in the live keyring until the old-key count is zero.
   Existing users must delete/reconnect their account to receive a new Pairing
   Token; reauthorization alone preserves the Pairing digest and key ID.

## OAuth-state HMAC rotation

Schedule a short setup interruption. Update the secret interactively:

```powershell
npx wrangler secret put OAUTH_STATE_HMAC_KEY `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Remove in-flight sessions immediately so callbacks signed with the previous
key cannot be confused with server failures:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "DELETE FROM oauth_sessions;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Verify `/setup` can start a new authorization and that an old callback is
rejected with a fixed, secret-free response. Do not retain or replay an old
callback URL.

## Retirement criteria

Remove an old encryption key from the live keyring only when all conditions are
true:

- `refresh_token_key_id`, `access_token_key_id`, and OAuth
  `encryption_key_id` counts for the old ID are zero;
- preview and production each completed a 72-hour soak after activation;
- the rollback window has closed;
- no unresolved refresh/decryption error aggregate exists; and
- the old key remains recoverable from offline secret escrow for any D1 Time
  Travel point that can reintroduce old-key ciphertext.

Remove an old Pairing HMAC key only when:

- the `pairing_key_id` count for the old ID is zero;
- the 72-hour soak and rollback window are complete; and
- every affected user has deleted/reconnected or the credential has expired
  and been deleted.

Then update the corresponding keyring with `wrangler secret put`. Never delete
the active key ID first.

## Rollback

If decryption or authentication failures increase:

1. Stop promotion and keep the Custom Domain on the last known-good Worker.
2. Restore the old-plus-new keyring interactively.
3. Restore the prior active key ID interactively.
4. Roll back Worker code only if the code changed; D1 is not rolled back by a
   Worker rollback.
5. Repeat aggregate key-ID queries and smoke tests.

If an old key was removed and a D1 restore reintroduces rows that reference it,
restore that key from offline escrow before resuming traffic. Never rewrite key
IDs in D1 without decrypting and re-encrypting through reviewed application
logic.

## Emergency compromise

For suspected key disclosure, use the incident-response runbook. A normal
active/previous rotation is insufficient:

- compromised encryption key: rotate immediately, force affected credentials
  to `reauth_required`, and clear token ciphertext;
- compromised Pairing HMAC key: invalidate/delete every credential using that
  key and require a new Pairing Token; and
- compromised OAuth-state key: rotate it and delete all OAuth sessions.

## References

- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
