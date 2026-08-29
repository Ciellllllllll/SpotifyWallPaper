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
    const browserWindow = window as Window & {
      wallpaperRegisterAudioListener?: (listener: (samples: number[]) => void) => void;
      __wallpaperAudioListener?: (samples: number[]) => void;
    };
    browserWindow.wallpaperRegisterAudioListener = (listener) => {
      browserWindow.__wallpaperAudioListener = listener;
      listener(samples);
    };
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

  for (const performanceMode of ['standard', 'low-power', 'high-effect'] as const) {
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
            'album-ring': '.ring-base, .ring-active, .album-ring-waveform, .bottom-circular-waveform',
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
            expect(await visualizer.evaluate((element) => {
              const reactiveContent = element.parentElement;
              return reactiveContent?.classList.contains('album-reactive-content')
                && reactiveContent.parentElement?.classList.contains('album-frame');
            })).toBe(true);
            expect(await visualizer.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('50%');
            await page.locator('.album-frame').evaluate(async (element) => {
              await Promise.all(element.getAnimations().map((animation) => animation.finished));
            });
            const visualizerScreenMatrix = await visualizer.locator('.visualizer-canvas').evaluate((element) => {
              const matrix = element.getScreenCTM();
              return matrix ? { b: Math.abs(matrix.b), c: Math.abs(matrix.c) } : null;
            });
            expect(visualizerScreenMatrix).not.toBeNull();
            expect(visualizerScreenMatrix?.b).toBeLessThanOrEqual(0.01);
            expect(visualizerScreenMatrix?.c).toBeLessThanOrEqual(0.01);
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

            if (visualizerMode === 'radial-bars') {
              const radialBarShape = await visualizer.locator('.radial-bar').first().evaluate((element) => ({
                tagName: element.tagName,
                pointCount: element.getAttribute('points')?.trim().split(/\s+/).length ?? 0,
                stroke: getComputedStyle(element).stroke,
                strokeLinecap: getComputedStyle(element).strokeLinecap
              }));
              expect(radialBarShape.tagName).toBe('polygon');
              expect(radialBarShape.pointCount).toBe(4);
              expect(radialBarShape.stroke).toBe('none');
              expect(radialBarShape.strokeLinecap).not.toBe('round');
            }
            if (visualizerMode === 'waveform-line') {
              const waveformShape = await visualizer.locator('.circular-waveform').evaluate((element) => ({
                tagName: element.tagName,
                fill: getComputedStyle(element).fill
              }));
              expect(waveformShape.tagName).toBe('polyline');
              expect(waveformShape.fill).toBe('none');
            }
            if (visualizerMode === 'album-ring') {
              const waveform = visualizer.locator('.album-ring-waveform');
              await expect(waveform).toHaveCount(1);
              const points = (await waveform.getAttribute('points') ?? '').trim().split(/\s+/);
              expect(points.length).toBeGreaterThan(2);
              expect(points[0]).toBe(points.at(-1));
              expect(await visualizer.evaluate((element) => getComputedStyle(element).transitionProperty.split(',').map((value) => value.trim()))).toContain('color');
            }
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
              expect(await visualizer.locator('.bottom-bar').first().getAttribute('rx')).toBeNull();
              for (const bar of bars) {
                expect(bar.top).toBeLessThan(bar.bottom);
                expect(Math.abs(bar.bottom - visualizerBottom)).toBeLessThanOrEqual(2);
              }
            }
            if (visualizerMode === 'album-ring') {
              const waveform = visualizer.locator('.bottom-circular-waveform');
              await expect(waveform).toHaveCount(1);
              const points = (await waveform.getAttribute('points') ?? '').trim().split(/\s+/);
              expect(points[0]).toBe(points.at(-1));
              expect(await visualizer.locator('svg').getAttribute('viewBox')).toBe('0 0 100 100');
              expect(await visualizer.locator('svg').getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
            }
          }
        });
      }
    }
  }
});

test.describe('visualizer effect layers', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const performanceMode of ['standard', 'high-effect', 'low-power'] as const) {
    for (const visualizerPosition of ['around-album', 'bottom-up'] as const) {
      for (const visualizerMode of ['album-ring', 'radial-bars', 'waveform-line'] as const) {
        test(`controls glow layers for ${visualizerPosition} ${visualizerMode} in ${performanceMode}`, async ({ page }) => {
          await page.addInitScript(({ performanceMode, visualizerMode, visualizerPosition }) => {
          localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
            schemaVersion: 2,
            performance: { mode: performanceMode },
            visualizer: { mode: visualizerMode, position: visualizerPosition }
          }));
          }, { performanceMode, visualizerMode, visualizerPosition });
          await freezeBrowserState(page);
          await page.goto('/');

          const visualizer = page.locator('.visualizer');
          const glowLayers = visualizer.locator('.visualizer-glow');
          if (performanceMode === 'low-power') {
            await expect(glowLayers).toHaveCount(0);
            expect(await visualizer.evaluate((element) => getComputedStyle(element).filter)).toBe('none');
          } else {
            expect(await glowLayers.count()).toBeGreaterThan(0);
          }
        });
      }
    }
  }
});

test.describe('glowing object canvas', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('stays independent from the SVG visualizer and follows the shared motion state', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: {
          enabled: false,
          glowingObjectsEnabled: true,
          intensity: 0.5,
          sensitivity: 1,
          smoothing: 0,
          decay: 1,
          bassWeight: 1,
          midWeight: 1,
          trebleWeight: 1,
          noiseGate: 0
        }
      }));
    });
    await freezeBrowserState(page, [0.8, 0.8, 0.8]);
    await page.goto('/');

    const canvas = page.locator('.glowing-object-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveCount(1);
    await expect(page.locator('.visualizer')).toHaveCount(0);
    expect(await canvas.getAttribute('data-enabled')).toBe('true');
    expect(Number(await canvas.getAttribute('data-speed-multiplier'))).toBeCloseTo(1.8, 2);
    expect(Number(await canvas.getAttribute('data-brightness-multiplier'))).toBeCloseTo(1.48, 2);
    expect(await canvas.getAttribute('data-color')).toMatch(/^#[0-9a-f]{6}$/i);
    await page.locator('.album-reactive-content').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    expect(Number(await page.locator('.album-reactive-content').evaluate((element) => getComputedStyle(element).scale))).toBeCloseTo(1.144, 2);
  });

  test('keeps the Canvas active when album art is hidden', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        albumArt: { visible: false },
        visualizer: { enabled: false, glowingObjectsEnabled: true }
      }));
    });
    await freezeBrowserState(page, [0.8, 0.8, 0.8]);
    await page.goto('/');

    await expect(page.locator('.album-frame')).toHaveCount(0);
    const canvas = page.locator('.glowing-object-canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute('data-active-particles'))).toBeGreaterThan(0);
    expect(Number(await canvas.getAttribute('data-speed-multiplier'))).toBeGreaterThan(1);
  });

  test('falls back safely for malformed settings', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', '{malformed settings');
    });
    await freezeBrowserState(page, [0.4, 0.4, 0.4]);
    await page.goto('/');

    await expect(page.locator('.wallpaper')).toBeVisible();
    await expect(page.locator('.album-art')).toBeVisible();
    await expect(page.locator('.glowing-object-canvas')).toHaveAttribute('data-enabled', 'true');
  });

  test('uses the white visualizer fallback when album art cannot load', async ({ page }) => {
    await page.route('**/mock/album-placeholder.svg', (route) => route.fulfill({ status: 404, body: '' }));
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: { enabled: false, colorMode: 'theme', glowingObjectsEnabled: true }
      }));
    });
    await freezeBrowserState(page, [0.4, 0.4, 0.4]);
    await page.goto('/');

    await expect.poll(async () => page.locator('.album-art').evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(0);
    const canvas = page.locator('.glowing-object-canvas');
    await expect(canvas).toHaveAttribute('data-color', '#ffffff');
    await expect(canvas).toBeVisible();
  });

  test('transitions the SVG visualizer color over the runtime color interval', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: { colorMode: 'theme', glowingObjectsEnabled: false }
      }));
    });
    await freezeBrowserState(page, [0, 0, 0]);
    await page.goto('/');

    const visualizer = page.locator('.visualizer-album');
    await expect(visualizer).toBeVisible();
    const transition = await visualizer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        properties: style.transitionProperty.split(',').map((value) => value.trim()),
        durations: style.transitionDuration.split(',').map((value) => value.trim())
      };
    });
    expect(transition.properties).toContain('color');
    expect(transition.durations).toContain('0.45s');

    await visualizer.evaluate((element) => element.style.setProperty('--visualizer-color', '#ff0000'));
    await page.waitForTimeout(80);
    const midColor = await visualizer.evaluate((element) => getComputedStyle(element).color);
    await page.waitForTimeout(500);
    const finalColor = await visualizer.evaluate((element) => getComputedStyle(element).color);
    expect(midColor).not.toBe(transition.color);
    expect(midColor).not.toBe(finalColor);
    expect(finalColor).toBe('rgb(255, 0, 0)');
  });

  for (const viewCase of [
    { name: '1920x1080 album-only', width: 1920, height: 1080, displayMode: 'album-only' },
    { name: '1920x1080 album-details', width: 1920, height: 1080, displayMode: 'album-details' },
    { name: '3440x1440 album-only', width: 3440, height: 1440, displayMode: 'album-only' },
    { name: '3440x1440 album-details', width: 3440, height: 1440, displayMode: 'album-details' }
  ] as const) {
    test(`scales only album content and keeps the progress ring fixed in ${viewCase.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewCase.width, height: viewCase.height });
      await page.addInitScript(({ displayMode }) => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          player: { displayMode },
          seekbar: { visible: true, style: 'album-ring' },
          visualizer: {
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            noiseGate: 0
          }
        }));
      }, viewCase);
      await freezeBrowserState(page, [0, 0, 0]);
      await page.goto('/');

      const albumFrame = page.locator('.album-frame');
      await albumFrame.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const reactiveContent = page.locator('.album-reactive-content');
      const progressRing = page.locator('.album-progress-ring');
      const beforeContent = await reactiveContent.boundingBox();
      const beforeRing = await progressRing.boundingBox();
      await page.evaluate(() => {
        const browserWindow = window as Window & { __wallpaperAudioListener?: (samples: number[]) => void };
        browserWindow.__wallpaperAudioListener?.([0.8, 0.8, 0.8]);
      });

      await expect.poll(() => reactiveContent.evaluate((element) => Number(getComputedStyle(element).scale))).toBeGreaterThan(1.04);
      const afterContent = await reactiveContent.boundingBox();
      const afterRing = await progressRing.boundingBox();
      const motionStyle = await reactiveContent.evaluate((element) => getComputedStyle(element).translate);
      expect(afterContent?.width).toBeGreaterThan((beforeContent?.width ?? 0) + 1);
      expect(motionStyle).not.toBe('none');
      expect(Math.abs((afterRing?.width ?? 0) - (beforeRing?.width ?? 0))).toBeLessThanOrEqual(0.1);
      expect(Math.abs((afterRing?.height ?? 0) - (beforeRing?.height ?? 0))).toBeLessThanOrEqual(0.1);
    });
  }

  for (const [performanceMode, expectedCount, expectedPixelRatio, expectedGlowStrength] of [
    ['low-power', 24, 1, 0],
    ['standard', 48, 1.5, 1],
    ['high-effect', 96, 1.5, 1.35]
  ] as const) {
    test(`uses the automatic particle density for ${performanceMode}`, async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      });
      await page.addInitScript(({ performanceMode }) => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          performance: { mode: performanceMode }
        }));
      }, { performanceMode });
      await freezeBrowserState(page);
      await page.goto('/');

      const canvas = page.locator('.glowing-object-canvas');
      expect(await canvas.getAttribute('data-particle-count')).toBe(String(expectedCount));
      expect(await canvas.getAttribute('data-pixel-ratio')).toBe(String(expectedPixelRatio));
      expect(await canvas.getAttribute('data-glow')).toBe(String(performanceMode !== 'low-power'));
      expect(await canvas.getAttribute('data-glow-strength')).toBe(String(expectedGlowStrength));
      await expect.poll(async () => Number(await canvas.getAttribute('data-active-particles'))).toBeGreaterThan(0);
      expect(await canvas.evaluate((element) => ({
        width: element.width,
        height: element.height,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight
      }))).toEqual({
        width: 1920 * expectedPixelRatio,
        height: 1080 * expectedPixelRatio,
        clientWidth: 1920,
        clientHeight: 1080
      });
    });
  }

  for (const viewport of viewports) {
    for (const displayMode of ['album-only', 'album-details'] as const) {
      for (const performanceMode of ['low-power', 'standard', 'high-effect'] as const) {
        test(`covers ${viewport.name} ${displayMode} Canvas motion in ${performanceMode}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.addInitScript(({ displayMode, performanceMode }) => {
            localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
              schemaVersion: 2,
              player: { displayMode },
              performance: { mode: performanceMode },
              visualizer: {
                enabled: false,
                glowingObjectsEnabled: true,
                colorMode: 'theme'
              }
            }));
          }, { displayMode, performanceMode });
          await freezeBrowserState(page, [0.7, 0.7, 0.7]);
          await page.goto('/');

          const canvas = page.locator('.glowing-object-canvas');
          await expect(canvas).toBeVisible();
          await expect(canvas).toHaveAttribute('data-enabled', 'true');
          await expect(canvas).toHaveAttribute(
            'data-particle-count',
            String(performanceMode === 'low-power' ? 24 : performanceMode === 'high-effect' ? 96 : 48)
          );
          await expect(page.locator('.album-frame')).toBeVisible();
          if (displayMode === 'album-details') {
            await expect(page.getByRole('group', { name: 'Track details' })).toBeVisible();
          } else {
            await expect(page.getByRole('group', { name: 'Track details' })).toHaveCount(0);
          }
        });
      }
    }
  }

  test('stops the canvas loop and clears its field when disabled', async ({ page }) => {
    await page.addInitScript(() => {
      const browserWindow = globalThis as typeof globalThis & { __glowingObjectRafCalls?: number };
      browserWindow.__glowingObjectRafCalls = 0;
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        browserWindow.__glowingObjectRafCalls = (browserWindow.__glowingObjectRafCalls ?? 0) + 1;
        return nativeRequestAnimationFrame(callback);
      };
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: { glowingObjectsEnabled: true }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');

    const canvas = page.locator('.glowing-object-canvas');
    await expect(canvas).toHaveCount(1);
    await expect.poll(async () => Number(await canvas.getAttribute('data-active-particles'))).toBeGreaterThan(0);
    await page.evaluate(() => {
      const browserWindow = window as Window & {
        wallpaperPropertyListener?: { applyUserProperties?: (properties: Record<string, { value: unknown }>) => void };
      };
      browserWindow.wallpaperPropertyListener?.applyUserProperties?.({
        glowing_objects_enabled: { value: false }
      });
    });
    await expect(canvas).toHaveAttribute('data-enabled', 'false');
    await expect.poll(async () => Number(await canvas.getAttribute('data-active-particles'))).toBe(0);
    const stoppedRafCalls = await page.evaluate(() => (globalThis as typeof globalThis & { __glowingObjectRafCalls?: number }).__glowingObjectRafCalls);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { __glowingObjectRafCalls?: number }).__glowingObjectRafCalls)).toBe(stoppedRafCalls);
  });
});

test.describe('display mode animations', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('enables track text enter and album frame layout transitions', async ({ page }) => {
    await page.addInitScript(() => {
      const browserState = globalThis as typeof globalThis & {
        __wallpaperAnimationStarts?: string[];
        __wallpaperTransitionRuns?: string[];
        __wallpaperElementIdentity?: {
          albumFrame: Element | null;
          albumVisualizer: Element | null;
          seekbarPanel: Element | null;
        };
      };
      browserState.__wallpaperAnimationStarts = [];
      browserState.__wallpaperTransitionRuns = [];
      document.addEventListener('animationstart', (event) => {
        browserState.__wallpaperAnimationStarts?.push(event.animationName);
      });
      document.addEventListener('transitionrun', (event) => {
        const target = event.target;
        if (target instanceof Element) {
          const targetName = target.matches('.album-frame')
            ? 'album-frame'
            : target.matches('.visualizer-album')
              ? 'visualizer-album'
              : target.matches('.seekbar-panel')
                ? 'seekbar-panel'
                : null;
          if (targetName) browserState.__wallpaperTransitionRuns?.push(`${targetName}:${event.propertyName}`);
        }
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        transitions: { enabled: false, reduceMotion: false }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');

    const albumFrame = page.locator('.album-frame');
    const albumVisualizer = page.locator('.visualizer-album');
    const seekbarPanel = page.locator('.seekbar-panel');
    await expect(albumFrame).toBeVisible();
    await expect(albumVisualizer).toBeVisible();
    await expect(seekbarPanel).toBeVisible();
    await expect(page.getByRole('group', { name: 'Track details' })).toHaveCount(0);
    await page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & {
        __wallpaperElementIdentity?: {
          albumFrame: Element | null;
          albumVisualizer: Element | null;
          seekbarPanel: Element | null;
        };
      };
      browserState.__wallpaperElementIdentity = {
        albumFrame: document.querySelector('.album-frame'),
        albumVisualizer: document.querySelector('.visualizer-album'),
        seekbarPanel: document.querySelector('.seekbar-panel')
      };
    });
    expect(await albumFrame.evaluate((element) => getComputedStyle(element).animationName)).toMatch(/album-enter$/);
    const albumOnlySeekbarStyle = await seekbarPanel.evaluate((element) => ({
      top: element.style.top,
      width: element.style.width,
      transitionProperty: getComputedStyle(element).transitionProperty.split(',').map((value) => value.trim()),
      transitionDuration: getComputedStyle(element).transitionDuration.split(',').map((value) => value.trim())
    }));
    const albumOnlyVisualizerStyle = await albumVisualizer.evaluate((element) => ({
      top: element.style.top,
      left: element.style.left,
      transitionProperty: getComputedStyle(element).transitionProperty.split(',').map((value) => value.trim()),
      transitionDuration: getComputedStyle(element).transitionDuration.split(',').map((value) => value.trim())
    }));
    await page.getByRole('button', { name: 'Show album details' }).click();
    await expect.poll(async () => page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & {
        __wallpaperAnimationStarts?: string[];
        __wallpaperTransitionRuns?: string[];
      };
      const animationStarts = browserState.__wallpaperAnimationStarts ?? [];
      const transitionRuns = browserState.__wallpaperTransitionRuns ?? [];
      return animationStarts.some((name) => /album-enter$/.test(name))
        && animationStarts.some((name) => /text-enter$/.test(name))
        && transitionRuns.some((name) => name.startsWith('album-frame:'))
        && transitionRuns.some((name) => name.startsWith('seekbar-panel:'));
    })).toBe(true);

    const motionEvents = await page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & {
        __wallpaperAnimationStarts?: string[];
        __wallpaperTransitionRuns?: string[];
        __wallpaperElementIdentity?: {
          albumFrame: Element | null;
          albumVisualizer: Element | null;
          seekbarPanel: Element | null;
        };
      };
      return {
        animationStarts: browserState.__wallpaperAnimationStarts ?? [],
        transitionRuns: browserState.__wallpaperTransitionRuns ?? [],
        sameAlbumFrame: browserState.__wallpaperElementIdentity?.albumFrame === document.querySelector('.album-frame'),
        sameAlbumVisualizer: browserState.__wallpaperElementIdentity?.albumVisualizer === document.querySelector('.visualizer-album'),
        sameSeekbarPanel: browserState.__wallpaperElementIdentity?.seekbarPanel === document.querySelector('.seekbar-panel')
      };
    });
    expect(motionEvents.animationStarts.some((name) => /album-enter$/.test(name))).toBe(true);
    expect(motionEvents.animationStarts.some((name) => /text-enter$/.test(name))).toBe(true);
    expect(motionEvents.transitionRuns.some((name) => name.startsWith('album-frame:'))).toBe(true);
    expect(motionEvents.transitionRuns.some((name) => name.startsWith('seekbar-panel:'))).toBe(true);
    expect(motionEvents.sameAlbumFrame).toBe(true);
    expect(motionEvents.sameAlbumVisualizer).toBe(true);
    expect(motionEvents.sameSeekbarPanel).toBe(true);

    const trackPanel = page.locator('.track-panel');
    await expect(trackPanel).toBeVisible();
    expect(await trackPanel.evaluate((element) => getComputedStyle(element).animationName)).toMatch(/text-enter$/);
    await expect(seekbarPanel).toHaveAttribute('aria-hidden', 'true');
    const detailsSeekbarStyle = await seekbarPanel.evaluate((element) => ({
      top: element.style.top,
      width: element.style.width
    }));
    await expect(seekbarPanel.locator('.seekbar-input')).toBeDisabled();
    expect(detailsSeekbarStyle.top).not.toBe(albumOnlySeekbarStyle.top);
    expect(detailsSeekbarStyle.width).not.toBe(albumOnlySeekbarStyle.width);
    expect(albumOnlySeekbarStyle.transitionProperty).toEqual(expect.arrayContaining(['left', 'top', 'width', 'height', 'transform']));
    expect(albumOnlySeekbarStyle.transitionDuration.some((duration) => duration !== '0s')).toBe(true);
    const detailsVisualizerStyle = await albumVisualizer.evaluate((element) => ({
      top: element.style.top,
      left: element.style.left,
      transitionProperty: getComputedStyle(element).transitionProperty.split(',').map((value) => value.trim()),
      transitionDurations: getComputedStyle(element).transitionDuration.split(',').map((value) => value.trim())
    }));
    expect(albumOnlyVisualizerStyle.top).toBe('');
    expect(albumOnlyVisualizerStyle.left).toBe('');
    expect(detailsVisualizerStyle.top).toBe('');
    expect(detailsVisualizerStyle.left).toBe('');
    expect(albumOnlyVisualizerStyle.transitionProperty).toContain('color');
    expect(albumOnlyVisualizerStyle.transitionDuration.some((duration) => duration !== '0s')).toBe(true);
    expect(detailsVisualizerStyle.transitionProperty).toContain('color');
    expect(detailsVisualizerStyle.transitionDurations.some((duration) => duration !== '0s')).toBe(true);
    const albumFrameMotion = await albumFrame.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        properties: style.transitionProperty.split(',').map((value) => value.trim()),
        durations: style.transitionDuration.split(',').map((value) => value.trim())
      };
    });
    expect(albumFrameMotion.properties).toContain('transform');
    expect(albumFrameMotion.durations.some((duration) => duration !== '0s')).toBe(true);

    await page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & { __wallpaperTransitionRuns?: string[] };
      browserState.__wallpaperTransitionRuns = [];
    });
    await page.getByRole('button', { name: 'Show album only' }).click();
    await expect.poll(async () => page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & { __wallpaperTransitionRuns?: string[] };
      const transitionRuns = browserState.__wallpaperTransitionRuns ?? [];
      return transitionRuns.some((name) => name.startsWith('album-frame:'))
        && transitionRuns.some((name) => name.startsWith('seekbar-panel:'));
    })).toBe(true);
    const reverseTransitionRuns = await page.evaluate(() => {
      const browserState = globalThis as typeof globalThis & { __wallpaperTransitionRuns?: string[] };
      return browserState.__wallpaperTransitionRuns ?? [];
    });
    expect(reverseTransitionRuns.some((name) => name.startsWith('album-frame:'))).toBe(true);
    expect(reverseTransitionRuns.some((name) => name.startsWith('seekbar-panel:'))).toBe(true);
    await expect(seekbarPanel).toBeVisible();
    expect(await seekbarPanel.evaluate((element) => element.style.top)).toBe(albumOnlySeekbarStyle.top);
    expect(await albumVisualizer.evaluate((element) => element.style.top)).toBe('');
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
    const albumVisualizer = page.locator('.visualizer-album');
    const seekbarPanel = page.locator('.seekbar-panel');
    await page.getByRole('button', { name: 'Show album details' }).click();
    const trackPanel = page.locator('.track-panel');
    await expect(trackPanel).toBeVisible();

    for (const element of [albumFrame, trackPanel, seekbarPanel]) {
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
    const visualizerMotion = await albumVisualizer.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        animationName: style.animationName,
        animationDurations: style.animationDuration.split(',').map((value) => value.trim()),
        transitionProperty: style.transitionProperty.split(',').map((value) => value.trim()),
        transitionDurations: style.transitionDuration.split(',').map((value) => value.trim())
      };
    });
    expect(visualizerMotion.animationName).toBe('none');
    expect(visualizerMotion.animationDurations.every((duration) => duration === '0s')).toBe(true);
    expect(visualizerMotion.transitionProperty).toContain('color');
    expect(visualizerMotion.transitionDurations.some((duration) => duration !== '0s')).toBe(true);
  });

  test('stops display mode animations when the user agent requests reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        transitions: { enabled: false, reduceMotion: false }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');
    const albumFrame = page.locator('.album-frame');
    const albumVisualizer = page.locator('.visualizer-album');
    const seekbarPanel = page.locator('.seekbar-panel');
    await page.getByRole('button', { name: 'Show album details' }).click();
    const trackPanel = page.locator('.track-panel');
    await expect(trackPanel).toBeVisible();

    for (const element of [albumFrame, trackPanel, seekbarPanel]) {
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
    const visualizerMotion = await albumVisualizer.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        animationName: style.animationName,
        animationDurations: style.animationDuration.split(',').map((value) => value.trim()),
        transitionProperty: style.transitionProperty.split(',').map((value) => value.trim()),
        transitionDurations: style.transitionDuration.split(',').map((value) => value.trim())
      };
    });
    expect(visualizerMotion.animationName).toBe('none');
    expect(visualizerMotion.animationDurations.every((duration) => duration === '0s')).toBe(true);
    expect(visualizerMotion.transitionProperty).toContain('color');
    expect(visualizerMotion.transitionDurations.some((duration) => duration !== '0s')).toBe(true);
  });
});

test.describe('album visualizer geometry', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const { intensity, sample, visible } of [
    { intensity: 0.5, sample: 0.04, visible: true },
    { intensity: 2, sample: 0.029, visible: false }
  ]) {
    test(`checks the radial threshold before intensity ${intensity}`, async ({ page }) => {
      await page.addInitScript(({ intensity }) => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: {
            position: 'around-album',
            mode: 'radial-bars',
            barCount: 8,
            intensity,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }, { intensity });
      await freezeBrowserState(page, Array.from({ length: 128 }, () => 0));
      await page.goto('/');
      await page.evaluate(({ sample }) => {
        const browserWindow = window as Window & { __wallpaperAudioListener?: (samples: number[]) => void };
        const samples = Array.from({ length: 128 }, () => 0);
        samples[3] = sample;
        samples[67] = sample;
        browserWindow.__wallpaperAudioListener?.(samples);
      }, { sample });

      const bar = page.locator('.visualizer-album .radial-bar').nth(3);
      if (visible) {
        await expect(bar).toBeVisible();
      } else {
        await expect(bar).toBeHidden();
      }
    });
  }

  test('applies the 0.03 threshold to bottom-up radial bars', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: {
          position: 'bottom-up',
          mode: 'radial-bars',
          barCount: 8,
          intensity: 1,
          sensitivity: 1,
          smoothing: 0,
          decay: 1,
          bassWeight: 1,
          midWeight: 1,
          trebleWeight: 1,
          clampMax: 1,
          noiseGate: 0
        }
      }));
    });
    await freezeBrowserState(page, Array.from({ length: 128 }, () => 0));
    await page.goto('/');

    const sendSample = async (sample: number) => {
      await page.evaluate(({ sample }) => {
        const browserWindow = window as Window & { __wallpaperAudioListener?: (samples: number[]) => void };
        const samples = Array.from({ length: 128 }, () => 0);
        samples[3] = sample;
        samples[67] = sample;
        browserWindow.__wallpaperAudioListener?.(samples);
      }, { sample });
    };

    const bar = page.locator('.visualizer-bottom .bottom-bar').nth(3);
    await sendSample(0.029);
    await expect(bar).toBeHidden();
    await sendSample(0.03);
    await expect(bar).toBeVisible();
  });

  test('keeps radial bar DOM slots stable while the threshold changes visibility', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: {
          position: 'around-album',
          mode: 'radial-bars',
          barCount: 8,
          smoothing: 0,
          decay: 1
        }
      }));
    });
    await freezeBrowserState(page, Array.from({ length: 128 }, () => 0));
    await page.goto('/');
    await page.evaluate(() => {
      const browserWindow = window as Window & { __wallpaperAudioListener?: (samples: number[]) => void };
      browserWindow.__wallpaperAudioListener?.(Array.from({ length: 128 }, () => 0));
    });

    const bars = page.locator('.visualizer-album .radial-bar');
    await expect(bars).toHaveCount(8);
    expect(await bars.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display))).toEqual(
      Array.from({ length: 8 }, () => 'none')
    );
    await page.evaluate(() => {
      const browserWindow = window as Window & { __radialBarNodes?: Element[] };
      browserWindow.__radialBarNodes = [...document.querySelectorAll('.visualizer-album .radial-bar')];
    });

    await page.evaluate(() => {
      const browserWindow = window as Window & { __wallpaperAudioListener?: (samples: number[]) => void };
      const samples = Array.from({ length: 128 }, () => 0);
      samples[3] = 1;
      samples[67] = 1;
      browserWindow.__wallpaperAudioListener?.(samples);
    });

    await expect(bars.nth(3)).toBeVisible();
    expect(await page.evaluate(() => {
      const browserWindow = window as Window & { __radialBarNodes?: Element[] };
      const current = [...document.querySelectorAll('.visualizer-album .radial-bar')];
      return current.length === browserWindow.__radialBarNodes?.length
        && current.every((element, index) => element === browserWindow.__radialBarNodes?.[index]);
    })).toBe(true);
  });

  test('uses the album edge for a custom album size', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: { position: 'around-album', mode: 'album-ring' },
        layout: { items: { albumArt: { width: 320, height: 520 } } }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');

    const albumFrame = page.locator('.album-frame');
    const visualizer = page.locator('.visualizer-album');
    await albumFrame.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const albumBox = await albumFrame.boundingBox();
    const visualizerBox = await visualizer.locator('.visualizer-canvas').boundingBox();
    const reactiveScale = await visualizer.evaluate((element) => Number(getComputedStyle(element.parentElement ?? element).scale));
    expect(albumBox).not.toBeNull();
    expect(visualizerBox).not.toBeNull();
    expect(albumBox?.width).toBeCloseTo(320, 1);
    expect(albumBox?.height).toBeCloseTo(320, 1);
    expect(visualizerBox?.width).toBeCloseTo((albumBox?.width ?? 0) * reactiveScale, 1);
    expect(visualizerBox?.height).toBeCloseTo((albumBox?.height ?? 0) * reactiveScale, 1);
    expect(await visualizer.locator('.ring-base').getAttribute('r')).toBe('50');
  });

  test('changes only outward extension when radius changes', async ({ page }) => {
    const readGeometry = async (mode: 'radial-bars' | 'waveform-line', radius: number) => {
      await page.evaluate(({ mode, radius }) => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: { position: 'around-album', mode, radius }
        }));
      }, { mode, radius });
      await page.reload();
      if (mode === 'radial-bars') {
        const bars = page.locator('.visualizer-album .radial-bar');
        await expect(bars).not.toHaveCount(0);
        return bars.first().getAttribute('points');
      }
      await expect(page.locator('.visualizer-album .circular-waveform')).toHaveCount(1);
      return page.locator('.visualizer-album .circular-waveform').getAttribute('points');
    };

    await freezeBrowserState(page);
    await page.goto('/');
    const parsePoints = (points: string | null) => (points ?? '').trim().split(/\s+/).map((point) => point.split(',').map(Number));

    const radialSmall = parsePoints(await readGeometry('radial-bars', 0.6));
    const radialLarge = parsePoints(await readGeometry('radial-bars', 2.2));
    expect(radialSmall[0][0]).toBeCloseTo(49, 4);
    expect(radialSmall[0][1]).toBeCloseTo(0, 4);
    expect(radialSmall[0][0]).toBeCloseTo(radialLarge[0][0], 5);
    expect(radialSmall[0][1]).toBeCloseTo(radialLarge[0][1], 5);
    expect(Math.abs(radialSmall[1][1])).toBeLessThan(Math.abs(radialLarge[1][1]));

    const waveformSmall = parsePoints(await readGeometry('waveform-line', 0.6));
    const waveformLarge = parsePoints(await readGeometry('waveform-line', 2.2));
    expect(waveformSmall[0][0]).toBeCloseTo(waveformLarge[0][0], 5);
    expect(waveformSmall[0][1]).toBeGreaterThan(-1.5);
    expect(waveformSmall[0][1]).toBeLessThan(0);
    expect(waveformSmall[0][1]).toBeGreaterThan(waveformLarge[0][1]);
  });

  test('changes bottom-up radius extension without moving the bottom anchor', async ({ page }) => {
    const samples = Array.from({ length: 128 }, () => 0.5);
    await freezeBrowserState(page, samples);
    await page.addInitScript(() => {
      if (!localStorage.getItem('spotify-wallpaper-settings')) {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: {
            position: 'bottom-up',
            mode: 'radial-bars',
            radius: 0.6,
            barCount: 8,
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }
    });
    await page.goto('/');

    const readFirstBar = async (radius: number) => {
      await page.evaluate((nextRadius) => {
        const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          ...source,
          visualizer: { ...(source.visualizer ?? {}), radius: nextRadius }
        }));
      }, radius);
      await page.reload();
      const bar = page.locator('.visualizer-bottom .bottom-bar').first();
      await expect(bar).toBeVisible();
      return bar.evaluate((element) => {
        const y = Number(element.getAttribute('y'));
        const height = Number(element.getAttribute('height'));
        return { y, height, bottom: y + height };
      });
    };

    const small = await readFirstBar(0.6);
    const large = await readFirstBar(2.2);
    expect(Math.abs(small.bottom - large.bottom)).toBeLessThanOrEqual(0.1);
    expect(large.y).toBeLessThan(small.y);
  });

  test('changes bottom-up waveform extension without moving its zero-sample anchor', async ({ page }) => {
    const samples = Array.from({ length: 128 }, (_, index) => index % 2 === 0 ? 0 : 0.5);
    await freezeBrowserState(page, samples);
    await page.addInitScript(() => {
      if (!localStorage.getItem('spotify-wallpaper-settings')) {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: {
            position: 'bottom-up',
            mode: 'waveform-line',
            radius: 0.6,
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }
    });
    await page.goto('/');

    const readWaveform = async (radius: number) => {
      await page.evaluate((nextRadius) => {
        const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          ...source,
          visualizer: { ...(source.visualizer ?? {}), radius: nextRadius }
        }));
      }, radius);
      await page.reload();
      const waveform = page.locator('.visualizer-bottom .horizontal-waveform');
      await expect(waveform).toHaveCount(1);
      return (await waveform.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((point) => point.split(',').map(Number));
    };

    const small = await readWaveform(0.6);
    const large = await readWaveform(2.2);
    expect(small[0][1]).toBeCloseTo(39, 5);
    expect(large[0][1]).toBeCloseTo(small[0][1], 5);
    expect(large[1][1]).toBeLessThan(small[1][1]);
  });

  test('applies performance response gain to the around-album ring', async ({ page }) => {
    const samples = Array.from({ length: 128 }, () => 0.5);
    await page.addInitScript(() => {
      if (!localStorage.getItem('spotify-wallpaper-settings')) {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          performance: { mode: 'standard' },
          visualizer: {
            position: 'around-album',
            mode: 'album-ring',
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }
    });
    await freezeBrowserState(page, samples);
    await page.goto('/');

    const readRingDash = async () => {
      const dashArray = await page.locator('.visualizer-album .ring-active').getAttribute('stroke-dasharray');
      return Number((dashArray ?? '0').split(/\s+/)[0]);
    };

    const standardDash = await readRingDash();
    await page.evaluate(() => {
      const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { performance?: Record<string, unknown> };
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        ...source,
        performance: { ...(source.performance ?? {}), mode: 'high-effect' }
      }));
    });
    await page.reload();
    const highEffectDash = await readRingDash();

    expect(highEffectDash).toBeGreaterThan(standardDash);
  });

  test('keeps intensity scaling after the response curve for ring thickness', async ({ page }) => {
    const samples = Array.from({ length: 128 }, () => 1);
    await page.addInitScript(() => {
      if (!localStorage.getItem('spotify-wallpaper-settings')) {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: {
            position: 'around-album',
            mode: 'album-ring',
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }
    });
    await freezeBrowserState(page, samples);
    await page.goto('/');

    const readStrokeWidth = async () => Number.parseFloat(
      await page.locator('.visualizer-album .ring-active').evaluate((element) => getComputedStyle(element).strokeWidth)
    );
    const normalIntensityStrokeWidth = await readStrokeWidth();

    await page.evaluate(() => {
      const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        ...source,
        visualizer: { ...(source.visualizer ?? {}), intensity: 2 }
      }));
    });
    await page.reload();
    const highIntensityStrokeWidth = await readStrokeWidth();

    expect(highIntensityStrokeWidth).toBeGreaterThan(normalIntensityStrokeWidth);
  });

  test('keeps intensity scaling after the response curve for bottom-up bar height', async ({ page }) => {
    const samples = Array.from({ length: 128 }, () => 1);
    await page.addInitScript(() => {
      if (!localStorage.getItem('spotify-wallpaper-settings')) {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: {
            position: 'bottom-up',
            mode: 'radial-bars',
            intensity: 1,
            sensitivity: 1,
            smoothing: 0,
            decay: 1,
            bassWeight: 1,
            midWeight: 1,
            trebleWeight: 1,
            clampMax: 1,
            noiseGate: 0
          }
        }));
      }
    });
    await freezeBrowserState(page, samples);
    await page.goto('/');

    const readBarHeight = async () => Number(await page.locator('.visualizer-bottom .bottom-bar').first().getAttribute('height'));
    const normalIntensityHeight = await readBarHeight();

    await page.evaluate(() => {
      const source = JSON.parse(localStorage.getItem('spotify-wallpaper-settings') ?? '{}') as Record<string, unknown> & { visualizer?: Record<string, unknown> };
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        ...source,
        visualizer: { ...(source.visualizer ?? {}), intensity: 2 }
      }));
    });
    await page.reload();
    const highIntensityHeight = await readBarHeight();

    expect(highIntensityHeight - 3).toBeCloseTo((normalIntensityHeight - 3) * 2, 5);
  });

  for (const [name, override] of [
    ['album art hidden', { albumArt: { visible: false } }],
    ['album layout disabled', { layout: { items: { albumArt: { enabled: false } } } }]
  ] as const) {
    test(`hides around-album visualizer when ${name}`, async ({ page }) => {
      await page.addInitScript((settings) => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: { position: 'around-album' },
          ...settings
        }));
      }, override);
      await freezeBrowserState(page);
      await page.goto('/');

      await expect(page.locator('.album-frame')).toHaveCount(0);
      await expect(page.locator('.visualizer-album')).toHaveCount(0);
    });
  }

  test('keeps bottom-up visualizer independent from hidden album art', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        albumArt: { visible: false },
        visualizer: { position: 'bottom-up', mode: 'radial-bars' }
      }));
    });
    await freezeBrowserState(page);
    await page.goto('/');

    await expect(page.locator('.album-frame')).toHaveCount(0);
    await expect(page.locator('.visualizer-bottom')).toBeVisible();
  });

  test('keeps browser mock audio active without a Wallpaper Engine listener', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
        schemaVersion: 2,
        visualizer: {
          position: 'around-album',
          mode: 'waveform-line',
          intensity: 1,
          idleAnimation: false
        }
      }));
    });
    await page.goto('/');

    await expect(page.locator('.visualizer-album')).toBeVisible();
    const waveform = page.locator('.visualizer-album .circular-waveform');
    const initialPoints = await waveform.getAttribute('points');
    expect(initialPoints).not.toBeNull();
    await expect.poll(() => waveform.getAttribute('points'), { timeout: 2_000 }).not.toBe(initialPoints);
  });
});

for (const viewport of viewports) {
  test.describe(`wallpaper ${viewport.name}`, () => {
    test.use({ viewport });

    test('captures deterministic album-only mock baseline', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: { glowingObjectsEnabled: false }
        }));
      });
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
      await page.addInitScript(() => {
        localStorage.setItem('spotify-wallpaper-settings', JSON.stringify({
          schemaVersion: 2,
          visualizer: { glowingObjectsEnabled: false }
        }));
      });
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
