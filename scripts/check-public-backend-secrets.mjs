import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = process.argv.slice(2).map((target) => resolve(target));
const forbiddenPatterns = [
  {
    label: 'pairing-token',
    pattern: /swpb1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/
  },
  {
    label: 'legacy-pairing-token',
    pattern: /swpt1\.[A-Za-z0-9._~-]{20,}/
  },
  {
    label: 'oauth-callback-query',
    pattern: /\/auth\/callback\?[^\s"'<>]*(?:code|state)=/i
  },
  {
    label: 'access-token-canary',
    pattern: /SWPB_CI_ACCESS_TOKEN_CANARY/
  },
  {
    label: 'refresh-token-canary',
    pattern: /SWPB_CI_REFRESH_TOKEN_CANARY/
  },
  {
    label: 'pkce-verifier-canary',
    pattern: /SWPB_CI_PKCE_VERIFIER_CANARY/
  },
  {
    label: 'worker-key-canary',
    pattern: /SWPB_CI_WORKER_KEY_CANARY/
  }
];

if (targets.length === 0) {
  console.error('Secret scan requires at least one artifact path.');
  process.exitCode = 1;
} else {
  const findings = [];
  for (const target of targets) {
    for (const file of await filesUnder(target)) {
      const bytes = await readFile(file);
      const text = bytes.toString('utf8');
      const scanVariants = normalizedScanVariants(text);
      for (const { label, pattern } of forbiddenPatterns) {
        if (scanVariants.some((variant) => pattern.test(variant))) {
          findings.push({ file, label });
        }
      }
    }
  }

  for (const finding of findings) {
    console.error(`Forbidden ${finding.label} pattern in ${finding.file}`);
  }
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

/** @param {string} value */
function normalizedScanVariants(value) {
  const slashDecoded = value
    .replaceAll('\\/', '/')
    .replace(/\\u003[dD]/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\x3[dD]/g, '=')
    .replace(/\\x26/g, '&');
  const variants = [value, slashDecoded];
  try {
    variants.push(decodeURIComponent(slashDecoded));
  } catch {
    // Malformed percent escapes do not make the raw artifact safe to skip.
  }
  return variants;
}

/** @param {string} target */
async function filesUnder(target) {
  const entries = await readdir(target, {
    recursive: true,
    withFileTypes: true
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}
