import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectPath = resolve(process.argv[2] ?? 'dist/project.json');

try {
  const officialOrigin = requireOfficialHttpsOrigin(
    process.env.VITE_SPOTIFY_BACKEND_ORIGIN
  );
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  const properties = project?.general?.properties;
  const provider = properties?.spotify_playback_provider;
  const backendUrl = properties?.spotify_backend_url;
  const pairingToken = properties?.spotify_pairing_token;
  if (
    provider?.type !== 'combo' ||
    backendUrl?.type !== 'textinput' ||
    pairingToken?.type !== 'textinput'
  ) {
    throw new Error('Wallpaper project is missing required backend properties.');
  }

  provider.value = 'backend';
  backendUrl.value = officialOrigin;
  pairingToken.value = '';
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
} catch {
  console.error('Workshop project preparation failed.');
  process.exitCode = 1;
}

/** @param {string | undefined} value */
function requireOfficialHttpsOrigin(value) {
  if (!value) {
    throw new Error('Official backend origin is required.');
  }
  const url = new URL(value);
  if (
    (value !== url.origin && value !== `${url.origin}/`) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw new Error('Official backend must be an HTTPS origin.');
  }
  return url.origin;
}
