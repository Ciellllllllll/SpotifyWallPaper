import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const supportedPropertyTypes = new Set([
  'color',
  'slider',
  'bool',
  'combo',
  'textinput',
  'file',
  'directory'
]);

type WallpaperProperty = {
  type?: unknown;
  value?: unknown;
};

type WallpaperProject = {
  general?: {
    supportsaudioprocessing?: unknown;
    properties?: Record<string, WallpaperProperty>;
  };
};

const loadProjectJson = (): WallpaperProject => {
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const projectPath = resolve(testDir, '../../public/project.json');
  return JSON.parse(readFileSync(projectPath, 'utf8')) as WallpaperProject;
};

describe('Wallpaper Engine project.json', () => {
  it('uses only Wallpaper Engine supported user property types', () => {
    const project = loadProjectJson();
    const properties = project.general?.properties ?? {};

    expect(Object.keys(properties).length).toBeGreaterThan(0);
    for (const [key, property] of Object.entries(properties)) {
      expect(property.type, `${key} has unsupported type`).toSatisfy((type: unknown) => {
        return typeof type === 'string' && supportedPropertyTypes.has(type);
      });
    }
  });

  it('defines credential and settings fields as textinput properties', () => {
    const properties = loadProjectJson().general?.properties ?? {};

    expect(properties.spotify_client_id?.type).toBe('textinput');
    expect(properties.spotify_refresh_token?.type).toBe('textinput');
    expect(properties.spotify_playback_provider?.type).toBe('combo');
    expect(properties.spotify_backend_url?.type).toBe('textinput');
    expect(properties.spotify_pairing_token?.type).toBe('textinput');
    expect(properties.settings_json?.type).toBe('textinput');
  });

  it('keeps the source project safe for direct and mock development', () => {
    const properties = loadProjectJson().general?.properties ?? {};

    expect(properties.spotify_playback_provider?.value).toBe('direct');
    expect(properties.spotify_backend_url?.value).toBe('');
    expect(properties.spotify_pairing_token?.value).toBe('');
  });

  it('prepares a release project with the exact official backend origin', () => {
    withTemporaryProject((projectPath) => {
      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example'
      );
      const properties =
        JSON.parse(readFileSync(projectPath, 'utf8')).general?.properties ?? {};

      expect(result.status).toBe(0);
      expect(properties.spotify_playback_provider?.value).toBe('backend');
      expect(properties.spotify_backend_url?.value).toBe(
        'https://api.wallpaper.example'
      );
      expect(properties.spotify_pairing_token?.value).toBe('');
    });
  });

  it.each([
    undefined,
    '',
    'http://api.wallpaper.example',
    'https://user@api.wallpaper.example',
    'https://@api.wallpaper.example',
    'https://api.wallpaper.example/setup',
    'https://api.wallpaper.example/./',
    'https://api.wallpaper.example/%2e',
    'https://api.wallpaper.example/?query=value',
    'https://api.wallpaper.example/?',
    'https://api.wallpaper.example/#fragment',
    'https://api.wallpaper.example/#'
  ])('rejects a missing or non-origin release backend: %s', (origin) => {
    withTemporaryProject((projectPath) => {
      const result = runWorkshopPreparation(projectPath, origin);

      expect(result.status).not.toBe(0);
      expect(
        JSON.parse(readFileSync(projectPath, 'utf8')).general.properties
          .spotify_playback_provider.value
      ).toBe('direct');
    });
  });

  it('does not expose lyrics settings in Wallpaper Engine properties', () => {
    const properties = loadProjectJson().general?.properties ?? {};

    expect(properties.lyrics_enabled).toBeUndefined();
    expect(properties.lyrics_mode).toBeUndefined();
  });

  it('enables Wallpaper Engine audio processing for the visualizer', () => {
    expect(loadProjectJson().general?.supportsaudioprocessing).toBe(true);
  });
});

const withTemporaryProject = (run: (projectPath: string) => void): void => {
  const directory = mkdtempSync(resolve(tmpdir(), 'spotify-wallpaper-project-'));
  const projectPath = resolve(directory, 'project.json');
  try {
    writeFileSync(
      projectPath,
      JSON.stringify(loadProjectJson()),
      'utf8'
    );
    run(projectPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runWorkshopPreparation = (
  projectPath: string,
  origin: string | undefined
) => {
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const scriptPath = resolve(testDir, '../../prepare-workshop.mjs');
  const environment = { ...process.env };
  if (origin === undefined) {
    delete environment.VITE_SPOTIFY_BACKEND_ORIGIN;
  } else {
    environment.VITE_SPOTIFY_BACKEND_ORIGIN = origin;
  }
  return spawnSync(process.execPath, [scriptPath, projectPath], {
    encoding: 'utf8',
    env: environment
  });
};
