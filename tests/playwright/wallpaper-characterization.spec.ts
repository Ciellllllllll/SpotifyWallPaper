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

test.describe('debug overlay', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('grows its frame to contain rendered text', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        debug: { enabled: true },
        layout: { items: { debug: { height: 24 } } }
      }));
    });
    await page.goto('/');

    const panel = page.getByRole('complementary', { name: 'Debug overlay' });
    await expect(panel).toBeVisible();
    const { clientHeight, scrollHeight } = await panel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));

    expect(clientHeight).toBeGreaterThanOrEqual(scrollHeight);
  });
});

test.describe('visualizer positioning', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  for (const performanceMode of ['standard', 'low-power'] as const) {
    for (const visualizerPosition of ['around-album', 'bottom-up'] as const) {
      for (const visualizerMode of ['album-ring', 'radial-bars', 'waveform-line'] as const) {
        test(`renders ${visualizerPosition} ${visualizerMode} in ${performanceMode}`, async ({ page }) => {
          await page.addInitScript(({ performanceMode, visualizerMode, visualizerPosition }) => {
            localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
              schemaVersion: 2,
              performance: { mode: performanceMode },
              visualizer: { mode: visualizerMode, position: visualizerPosition, rotationSpeed: 0.8 },
              layout: { items: { albumArt: { rotation: 45 } } }
            }));
          }, { performanceMode, visualizerMode, visualizerPosition });
          await freezeBrowserState(page);
          await page.goto('/');

          const visualizer = page.locator('.visualizer');
          await expect(visualizer).toBeVisible();
          const geometrySelector = {
            'album-ring': '.ring-base, .ring-active, .peak-band-base, .peak-band-active',
            'radial-bars': '.radial-bar, .bottom-bar',
            'waveform-line': '.circular-waveform, .horizontal-waveform'
          }[visualizerMode];
          const geometry = visualizer.locator(geometrySelector);
          expect(await geometry.count()).toBeGreaterThan(0);
          expect(await visualizer.evaluate((element) => getComputedStyle(element).rotate)).toBe('none');
          expect(await visualizer.evaluate((element) => {
            const matrix = new DOMMatrix(getComputedStyle(element).transform);
            return Math.abs(matrix.b) <= 0.000001 && Math.abs(matrix.c) <= 0.000001;
          })).toBe(true);

          if (visualizerPosition === 'around-album') {
            expect(await visualizer.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('50%');
            await page.locator('.album-frame').evaluate(async (element) => {
              await Promise.all(element.getAnimations().map((animation) => animation.finished));
            });
            const albumBox = await page.locator('.album-art').boundingBox();
            const visualizerBox = await visualizer.boundingBox();
            expect(albumBox).not.toBeNull();
            expect(visualizerBox).not.toBeNull();
            const centerDeltaX = Math.abs(
              ((visualizerBox?.x ?? 0) + (visualizerBox?.width ?? 0) / 2) -
              ((albumBox?.x ?? 0) + (albumBox?.width ?? 0) / 2)
            );
            const centerDeltaY = Math.abs(
              ((visualizerBox?.y ?? 0) + (visualizerBox?.height ?? 0) / 2) -
              ((albumBox?.y ?? 0) + (albumBox?.height ?? 0) / 2)
            );
            expect(centerDeltaX).toBeLessThanOrEqual(0.01);
            expect(centerDeltaY).toBeLessThanOrEqual(0.01);
          } else {
            const visualizerBox = await visualizer.boundingBox();
            expect(visualizerBox).not.toBeNull();
            const viewportHeight = await page.evaluate(() => window.innerHeight);
            const bottomGap = viewportHeight - ((visualizerBox?.y ?? 0) + (visualizerBox?.height ?? 0));
            expect(await visualizer.evaluate((element) => element.style.top)).toBe('auto');
            expect(await visualizer.evaluate((element) => element.style.bottom)).not.toBe('auto');
            expect(bottomGap).toBeGreaterThanOrEqual(15);
            expect(bottomGap).toBeLessThanOrEqual(52);

            if (visualizerMode === 'radial-bars') {
              const visualizerBottom = (visualizerBox?.y ?? 0) + (visualizerBox?.height ?? 0);
              const bars = await visualizer.locator('.bottom-bar').evaluateAll((elements) => elements.map((element) => {
                const box = element.getBoundingClientRect();
                return { top: box.top, bottom: box.bottom };
              }));
              expect(bars.length).toBeGreaterThan(0);
              for (const bar of bars) {
                expect(bar.top).toBeLessThan(bar.bottom);
                expect(Math.abs(bar.bottom - visualizerBottom)).toBeLessThanOrEqual(2);
              }
            }
          }
        });
      }
    }
  }
});

test.describe('display mode animations', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('enables track text enter and album frame layout transitions', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        transitions: { reduceMotion: false }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');

    const albumFrame = page.locator('.album-frame');
    await expect(albumFrame).toBeVisible();
    await expect(page.getByRole('group', { name: 'Track details' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show album details' }).click();

    const trackPanel = page.locator('.track-panel');
    await expect(trackPanel).toBeVisible();
    expect(await trackPanel.evaluate((element) => getComputedStyle(element).animationName)).toMatch(/text-enter$/);
    const albumFrameMotion = await albumFrame.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        properties: style.transitionProperty.split(',').map((value) => value.trim()),
        durations: style.transitionDuration.split(',').map((value) => value.trim())
      };
    });
    expect(albumFrameMotion.properties).toContain('transform');
    expect(albumFrameMotion.durations.some((duration) => duration !== '0s')).toBe(true);
  });

  test('stops track text enter and album frame transitions when reduced motion is enabled', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        transitions: { reduceMotion: true }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');
    const albumFrame = page.locator('.album-frame');
    await page.getByRole('button', { name: 'Show album details' }).click();
    const trackPanel = page.locator('.track-panel');
    await expect(trackPanel).toBeVisible();

    for (const element of [albumFrame, trackPanel]) {
      const motion = await element.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          animationName: style.animationName,
          animationDurations: style.animationDuration.split(',').map((value) => value.trim()),
          transitionDurations: style.transitionDuration.split(',').map((value) => value.trim())
        };
      });
      expect(motion.animationName).toBe('none');
      expect(motion.animationDurations.every((duration) => duration === '0s')).toBe(true);
      expect(motion.transitionDurations.every((duration) => duration === '0s')).toBe(true);
    }
  });
});

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
      await expect(page.locator('.visualizer .circular-waveform')).toHaveCount(1);
      await expect.poll(async () => page.locator('.visualizer .circular-waveform').getAttribute('points').then((points) => points?.trim().split(' ').length ?? 0)).toBe(24);

      await page.evaluate(() => {
        const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          ...source,
          visualizer: { ...(source.visualizer ?? {}), mode: 'radial-bars', barCount: 120 }
        }));
      });
      await page.reload();
      await expect(page.locator('.visualizer .radial-bar')).toHaveCount(24);
    });
  });
}
