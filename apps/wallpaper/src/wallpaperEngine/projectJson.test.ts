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
  text?: unknown;
  type?: unknown;
  value?: unknown;
  min?: unknown;
  max?: unknown;
  fraction?: unknown;
  precision?: unknown;
  step?: unknown;
  condition?: unknown;
};

type WallpaperProject = {
  workshopid?: unknown;
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

  it('exposes only the approved Wallpaper Engine controls', () => {
    const properties = loadProjectJson().general?.properties ?? {};

    expect(Object.keys(properties)).toEqual([
      'spotify_refresh_token',
      'visualizer_enabled',
      'glowing_objects_enabled',
      'visualizer_mode',
      'visualizer_position',
      'visualizer_intensity',
      'visualizer_sensitivity',
      'visualizer_smoothing',
      'visualizer_decay',
      'clock_enabled',
      'clock_hour12',
      'clock_show_date',
      'performance_mode',
      'debug_enabled'
    ]);
    expect(properties.spotify_refresh_token).toMatchObject({
      text: 'Spotify Token',
      type: 'textinput',
      value: ''
    });
    expect(properties.glowing_objects_enabled).toMatchObject({
      text: 'Glowing Objects Enabled',
      type: 'bool',
      value: true
    });
  });

  it('keeps the source project safe for direct and mock development', () => {
    const project = loadProjectJson();
    const properties = project.general?.properties ?? {};

    expect(project.workshopid).toBeUndefined();
    expect(properties.spotify_refresh_token?.value).toBe('');
  });

  it('prepares a release project only with an exact official backend origin', () => {
    withTemporaryProject((projectPath) => {
      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example'
      );
      const properties =
        JSON.parse(readFileSync(projectPath, 'utf8')).general?.properties ?? {};

      expect(result.status).toBe(0);
      expect(properties.spotify_refresh_token?.value).toBe('');
      expect(properties.spotify_playback_provider).toBeUndefined();
      expect(properties.spotify_backend_url).toBeUndefined();
      expect(properties.spotify_pairing_token).toBeUndefined();
    });
  });

  it('removes credential-bearing property values from the release project', () => {
    withTemporaryProject((projectPath) => {
      const project = JSON.parse(readFileSync(projectPath, 'utf8')) as WallpaperProject;
      const properties = project.general?.properties ?? {};
      const tokenCanary = 'spotify-token-canary-4f6a2c';
      properties.spotify_refresh_token.value = tokenCanary;
      writeFileSync(projectPath, JSON.stringify(project), 'utf8');

      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example'
      );
      const preparedText = readFileSync(projectPath, 'utf8');
      const prepared = JSON.parse(preparedText) as WallpaperProject;
      const preparedProperties = prepared.general?.properties ?? {};

      expect(result.status).toBe(0);
      expect(preparedProperties.spotify_refresh_token?.value).toBe('');
      expect(preparedText).not.toContain(tokenCanary);
    });
  });

  it('injects the tracked Workshop ID only into the release project', () => {
    withTemporaryProject((projectPath, metadataPath) => {
      writeFileSync(metadataPath, JSON.stringify({ workshopid: '12345678901234567890' }), 'utf8');

      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example',
        metadataPath
      );
      const prepared = JSON.parse(readFileSync(projectPath, 'utf8')) as WallpaperProject;

      expect(result.status).toBe(0);
      expect(prepared.workshopid).toBe('12345678901234567890');
    });
  });

  it('removes a stale Workshop ID when tracked metadata is null', () => {
    withTemporaryProject((projectPath, metadataPath) => {
      const project = JSON.parse(readFileSync(projectPath, 'utf8')) as WallpaperProject;
      project.workshopid = '987654321';
      writeFileSync(projectPath, JSON.stringify(project), 'utf8');

      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example',
        metadataPath
      );
      const prepared = JSON.parse(readFileSync(projectPath, 'utf8')) as WallpaperProject;

      expect(result.status).toBe(0);
      expect(prepared.workshopid).toBeUndefined();
    });
  });

  it.each([
    '',
    '0',
    '0123',
    '-1',
    '1.5',
    123,
    true,
    {}
  ])('rejects an invalid tracked Workshop ID: %j', (workshopid) => {
    withTemporaryProject((projectPath, metadataPath) => {
      writeFileSync(metadataPath, JSON.stringify({ workshopid }), 'utf8');

      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example',
        metadataPath
      );

      expect(result.status).not.toBe(0);
      expect(JSON.parse(readFileSync(projectPath, 'utf8')).general.properties.spotify_refresh_token.value).toBe('');
    });
  });

  it('does not copy unknown metadata fields into the release project', () => {
    withTemporaryProject((projectPath, metadataPath) => {
      const metadataCanary = 'metadata-refresh-canary-2cc347';
      writeFileSync(
        metadataPath,
        JSON.stringify({
          workshopid: '123456789',
          spotify_refresh_token: metadataCanary
        }),
        'utf8'
      );

      const result = runWorkshopPreparation(
        projectPath,
        'https://api.wallpaper.example',
        metadataPath
      );
      const preparedText = readFileSync(projectPath, 'utf8');

      expect(result.status).toBe(0);
      expect(preparedText).not.toContain(metadataCanary);
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
      expect(JSON.parse(readFileSync(projectPath, 'utf8')).general.properties.spotify_refresh_token.value).toBe('');
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

  it('exposes live visualizer tuning as conditional fractional sliders', () => {
    const properties = loadProjectJson().general?.properties ?? {};
    const expected = {
      visualizer_intensity: ['Visualizer Intensity', 0.72, 0, 2],
      visualizer_sensitivity: ['Visualizer Sensitivity', 1, 0, 3],
      visualizer_smoothing: ['Visualizer Smoothing', 0.35, 0, 0.95],
      visualizer_decay: ['Visualizer Decay Speed', 0.22, 0, 1]
    } as const;

    for (const [key, [text, value, min, max]] of Object.entries(expected)) {
      expect(properties[key]).toMatchObject({
        text,
        type: 'slider',
        value,
        min,
        max,
        fraction: true,
        precision: 2,
        step: 0.01,
        condition: 'visualizer_enabled.value == true'
      });
    }
  });

  it('exposes the two supported visualizer positions', () => {
    expect(loadProjectJson().general?.properties?.visualizer_position).toMatchObject({
      text: 'Visualizer Position',
      type: 'combo',
      value: 'around-album',
      options: [
        { label: 'Around Album', value: 'around-album' },
        { label: 'Bottom Up', value: 'bottom-up' }
      ]
    });
  });
});

const withTemporaryProject = (
  run: (projectPath: string, metadataPath: string) => void
): void => {
  const directory = mkdtempSync(resolve(tmpdir(), 'spotify-wallpaper-project-'));
  const projectPath = resolve(directory, 'project.json');
  const metadataPath = resolve(directory, 'workshop-metadata.json');
  try {
    writeFileSync(
      projectPath,
      JSON.stringify(loadProjectJson()),
      'utf8'
    );
    writeFileSync(metadataPath, JSON.stringify({ workshopid: null }), 'utf8');
    run(projectPath, metadataPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runWorkshopPreparation = (
  projectPath: string,
  origin: string | undefined,
  metadataPath?: string
) => {
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const scriptPath = resolve(testDir, '../../prepare-workshop.mjs');
  const environment = { ...process.env };
  if (origin === undefined) {
    delete environment.VITE_SPOTIFY_BACKEND_ORIGIN;
  } else {
    environment.VITE_SPOTIFY_BACKEND_ORIGIN = origin;
  }
  return spawnSync(
    process.execPath,
    [scriptPath, projectPath, ...(metadataPath ? [metadataPath] : [])],
    {
    encoding: 'utf8',
    env: environment
    }
  );
};
