import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
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
};

type WallpaperProject = {
  general?: {
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
    expect(properties.settings_json?.type).toBe('textinput');
  });
});
