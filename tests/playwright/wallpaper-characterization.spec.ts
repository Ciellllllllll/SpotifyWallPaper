import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '3440x1440', width: 3440, height: 1440 }
] as const;

const audioFixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/characterization/audio-reduced-motion.json'), 'utf8')
) as { samples: number[] };
const baselineDivergenceFixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/characterization/known-baseline-divergences.json'), 'utf8')
) as { albumDetails: { progressVisible: boolean; controlsVisible: boolean } };

async function freezeBrowserState(page: Page, samples = audioFixture.samples) {
  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixedNow = NativeDate.parse('2026-08-04T03:04:05.000Z');

    function FixedDate(this: Date, ...args: unknown[]) {
      if (new.target) {
        return args.length === 0 ? new NativeDate(fixedNow) : new NativeDate(...(args as []));
      }
      return new NativeDate(fixedNow).toString();
    }

    FixedDate.prototype = NativeDate.prototype;
    Object.setPrototypeOf(FixedDate, NativeDate);
    Object.defineProperties(FixedDate, {
      now: { value: () => fixedNow },
      parse: { value: NativeDate.parse },
      UTC: { value: NativeDate.UTC }
    });
    Object.defineProperty(globalThis, 'Date', { configurable: false, value: FixedDate });
    Math.random = () => 0.42;
  });
  await page.addInitScript((samples: number[]) => {
    (window as Window & {
      wallpaperRegisterAudioListener?: (listener: (samples: number[]) => void) => void;
    }).wallpaperRegisterAudioListener = (listener) => listener(samples);
  }, samples);
}

async function disableMotionAndCaret(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `
  });
}

for (const viewport of viewports) {
  test.describe(`wallpaper ${viewport.name}`, () => {
    test.use({ viewport });

    test('captures deterministic album-only mock baseline', async ({ page }) => {
      await freezeBrowserState(page);
      await page.goto('/');
      await disableMotionAndCaret(page);
      await expect(page.locator('.album-art')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show album details' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Playback progress' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Track details' })).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'Mock Horizon' })).toHaveAttribute('src', /album-placeholder/);
      await expect(page).toHaveScreenshot(`${viewport.name}-album-only.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.002
      });
    });

    test('captures deterministic album-details baseline with known hover-only divergence', async ({ page }) => {
      await freezeBrowserState(page);
      await page.goto('/');
      await disableMotionAndCaret(page);
      await page.getByRole('button', { name: 'Show album details' }).click();
      await expect(page.getByRole('group', { name: 'Track details' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Afterglow Atlas' })).toBeVisible();
      await expect(page.getByText('Nami Kuroda, The Static Lights')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Playback progress' })).toHaveCount(
        baselineDivergenceFixture.albumDetails.progressVisible ? 1 : 0
      );
      await expect(page.getByRole('group', { name: 'Track details' })).toBeVisible();
      const controlDock = page.locator('.control-dock');
      await expect(controlDock).toHaveCount(1);
      expect(await controlDock.evaluate((element) => getComputedStyle(element).opacity)).toBe(
        baselineDivergenceFixture.albumDetails.controlsVisible ? '1' : '0'
      );
      await expect(page.getByLabel('Clock')).toBeVisible();
      await expect(page).toHaveScreenshot(`${viewport.name}-album-details.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.002
      });
    });

    test('applies low-power sample and bar limits to waveform and radial rendering', async ({ page }) => {
      const samples = Array.from({ length: 128 }, (_, index) => index / 128);
      await freezeBrowserState(page, samples);
      await page.addInitScript(() => {
        if (!localStorage.getItem('spotify-wallpaper-settings')) {
          localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
            schemaVersion: 2,
            performance: { mode: 'low-power' },
            visualizer: { mode: 'waveform-line', barCount: 120 }
          }));
        }
      });
      await page.goto('/');
      await expect(page.locator('.waveform polyline')).toHaveCount(1);
      await expect.poll(async () => page.locator('.waveform polyline').getAttribute('points').then((points) => points?.trim().split(' ').length ?? 0)).toBe(24);

      await page.evaluate(() => {
        const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          ...source,
          visualizer: { ...(source.visualizer ?? {}), mode: 'radial-bars', barCount: 120 }
        }));
      });
      await page.reload();
      await expect(page.locator('.visualizer span')).toHaveCount(24);
    });
  });
}
