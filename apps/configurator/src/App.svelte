<script lang="ts">
  import {
    buildSettings,
    defaultDraft,
    exportSettingsJson,
    importSettingsJson,
    layoutPresetOptions,
    type ConfiguratorDraft
  } from './settingsModel';
  import WallpaperView from '@spotify-wallpaper/wallpaper-view/WallpaperView.svelte';
  import type { WallpaperPreferences, WallpaperViewIntent, WallpaperViewModel } from '@spotify-wallpaper/shared-types';
  import { buildRainmeterOutput, exportRainmeterJson } from './rainmeter/rainmeterExport';
  import { applyPreviewIntent } from './previewIntent';
  import {
    authorizeSpotifyAndCopySwpt1,
    startRainmeterScheduler,
    stopRainmeterScheduler,
    updateRainmeterScheduler,
    writeRainmeterJson
  } from './tauriCommands';

  let draft: ConfiguratorDraft = { ...defaultDraft };
  let importSource = '';
  let importWarning: string | null = null;
  let copyStatus = '';
  let rainmeterStatus = '';
  let oauthStatus = '';
  let rainmeterSchedulerRunning = false;
  let previewDisplayMode: WallpaperPreferences['player']['displayMode'] = 'album-details';

  const previewPlayback = {
    source: 'mock' as const,
    itemType: 'track' as const,
    id: 'mock-track',
    uri: 'spotify:track:mock-track',
    title: 'Afterglow Atlas',
    artists: ['Nami Kuroda', 'The Static Lights'],
    albumName: 'Mock Signals',
    imageUrls: [],
    albumImageUrl: '',
    durationMs: 200_000,
    progressMs: 84_000,
    isPlaying: true,
    device: null,
    deviceName: 'Browser Mock',
    shuffleState: false,
    repeatState: 'off' as const,
    volumePercent: 72,
    externalUrl: null,
    fetchedAt: '2026-06-14T00:00:00.000Z'
  };

  const previewTheme = {
    primaryColor: '#93cab3',
    secondaryColor: '#496a8f',
    accentColor: '#f2c66a',
    mutedColor: '#b9c7d3',
    darkColor: '#101318',
    lightColor: '#f6f7fb',
    readableTextColor: '#f6f7fb',
    overlayOpacity: 0.72,
    shadowStrength: 0.5,
    source: 'fallback' as const
  };

  $: settings = buildSettings(draft);
  $: settingsJson = exportSettingsJson(draft);
  $: previewSettings = {
    ...settings,
    player: { ...settings.player, displayMode: previewDisplayMode }
  } satisfies WallpaperPreferences;
  let previewViewModel: WallpaperViewModel;
  $: previewViewModel = {
    settings: previewSettings,
    playback: { ...previewPlayback, isPlaying: settings.player.controlsEnabled },
    previousPlayback: null,
    visualizerFrame: null,
    theme: previewTheme,
    transitionState: null,
    nowMs: Date.parse('2026-06-14T22:10:36.000Z'),
    progressNowMs: Date.parse('2026-06-14T22:10:36.000Z'),
    playbackMode: 'configurator mock',
    providerSelection: 'mock',
    providerConfigurationError: null,
    spotifyStatusText: 'mock preview',
    controlStatusText: '',
    controlBusy: false,
    canControlPlayback: false,
    lastPollingDelayMs: null,
    consecutiveErrors: 0,
    visualCoreStatus: 'typescript-fallback',
    credentialConfigured: false,
    settingsWarning: null,
    settingsSource: 'configurator draft'
  } satisfies WallpaperViewModel;
  $: rainmeterJson = exportRainmeterJson(
    buildRainmeterOutput(
      previewPlayback,
      previewTheme,
      {
        albumArtLocalPath: 'D:\\SpotifyWallPaper\\cache\\album.jpg',
        timestamp: '2026-06-14T00:00:00.000Z'
      }
    )
  );
  $: exportSummary = 'settings v2 export is secret-free';
  $: rainmeterSummary = settings.rainmeter.enabled ? 'Rainmeter JSON enabled' : 'Rainmeter off';

  const update = <K extends keyof ConfiguratorDraft>(key: K, value: ConfiguratorDraft[K]) => {
    draft = {
      ...draft,
      [key]: value,
      ...(key === 'preset' ? { presetChanged: true } : {})
    };
    copyStatus = '';
    rainmeterStatus = '';
  };

  const importSettings = () => {
    const imported = importSettingsJson(importSource);
    draft = imported.draft;
    previewDisplayMode = 'album-details';
    importWarning = imported.warning;
    copyStatus = imported.warning ? '' : 'Imported settings JSON';
  };

  const copySettings = async () => {
    try {
      await navigator.clipboard.writeText(settingsJson);
      copyStatus = 'Copied settings JSON';
    } catch {
      copyStatus = 'Clipboard unavailable';
    }
  };

  const writeRainmeter = async () => {
    if (!settings.rainmeter.enabled) {
      rainmeterStatus = 'Rainmeter export is disabled';
      return;
    }

    const result = await writeRainmeterJson(settings.rainmeter.outputPath, rainmeterJson);
    rainmeterStatus = result.ok ? 'Rainmeter JSON written' : result.message;
  };

  const startSpotifyAuth = async () => {
    oauthStatus = 'Opening Spotify authorization; waiting for native confirmation...';
    const result = await authorizeSpotifyAndCopySwpt1(draft.spotifyClientId);
    if (!result.ok) {
      oauthStatus = result.message;
      return;
    }
    oauthStatus = 'Native confirmation accepted; swpt1 copied once to the clipboard.';
  };

  const handlePreviewIntent = (intent: WallpaperViewIntent) => {
    previewDisplayMode = applyPreviewIntent(previewDisplayMode, intent);
  };

  const startScheduler = async () => {
    const result = await startRainmeterScheduler(
      settings.rainmeter.outputPath,
      rainmeterJson,
      settings.player.controlsEnabled,
      settings.rainmeter.stoppedUpdateIntervalMs
    );
    rainmeterSchedulerRunning = result.ok;
    rainmeterStatus = result.ok ? 'Rainmeter scheduler running' : result.message;
  };

  const updateScheduler = async () => {
    const result = await updateRainmeterScheduler(
      settings.rainmeter.outputPath,
      rainmeterJson,
      settings.player.controlsEnabled,
      settings.rainmeter.stoppedUpdateIntervalMs
    );
    rainmeterStatus = result.ok ? 'Rainmeter scheduler updated' : result.message;
  };

  const stopScheduler = async () => {
    const result = await stopRainmeterScheduler();
    rainmeterSchedulerRunning = false;
    rainmeterStatus = result.ok ? 'Rainmeter scheduler stopped' : result.message;
  };
</script>

<main>
  <header class="topbar">
    <div>
      <p class="eyebrow">Optional configurator</p>
      <h1>Spotify Wallpaper Settings</h1>
    </div>
    <div class="status-stack">
      <span>{exportSummary}</span>
      <span>{settings.layout.preset}</span>
    </div>
  </header>

  <section class="workspace">
    <form class="editor" aria-label="Settings editor">
      <fieldset>
        <legend>Spotify</legend>
        <label>
          <span>Playback provider</span>
          <select value={draft.provider} on:change={(event) => update('provider', event.currentTarget.value as ConfiguratorDraft['provider'])}>
            <option value="mock">Browser mock</option>
            <option value="direct">Spotify direct</option>
            <option value="backend">Public backend</option>
          </select>
        </label>
        {#if draft.provider === 'backend'}
          <label>
            <span>Backend origin</span>
            <input value={draft.backendOrigin} placeholder="https://example.workers.dev" on:input={(event) => update('backendOrigin', event.currentTarget.value)} />
          </label>
        {/if}
        <label>
          <span>Client ID</span>
          <input value={draft.spotifyClientId} on:input={(event) => update('spotifyClientId', event.currentTarget.value)} />
        </label>
        <div class="export-actions">
          <button type="button" on:click={startSpotifyAuth}>Authorize and copy swpt1</button>
          <span>{oauthStatus}</span>
        </div>
        <p class="auth-note">The native flow keeps OAuth material in Rust and copies a one-time swpt1 token only after confirmation.</p>
      </fieldset>

      <fieldset>
        <legend>Layout</legend>
        <label>
          <span>Preset</span>
          <select value={draft.preset} on:change={(event) => update('preset', event.currentTarget.value as ConfiguratorDraft['preset'])}>
            {#each layoutPresetOptions as preset}
              <option value={preset}>{preset}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Performance</span>
          <select
            value={draft.performanceMode}
            on:change={(event) => update('performanceMode', event.currentTarget.value as ConfiguratorDraft['performanceMode'])}
          >
            <option value="low-power">Low power</option>
            <option value="standard">Standard</option>
            <option value="high-effect">High effect</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Visual</legend>
        <label>
          <span>Background</span>
          <select
            value={draft.backgroundMode}
            on:change={(event) => update('backgroundMode', event.currentTarget.value as ConfiguratorDraft['backgroundMode'])}
          >
            <option value="album-blur">Album blur</option>
            <option value="album-gradient">Album gradient</option>
            <option value="solid-color">Solid color</option>
          </select>
        </label>
        <label>
          <span>Theme</span>
          <select value={draft.themeMode} on:change={(event) => update('themeMode', event.currentTarget.value as ConfiguratorDraft['themeMode'])}>
            <option value="album">Album</option>
            <option value="fallback">Fallback</option>
            <option value="custom">Custom</option>
          </select>
        </label>
      </fieldset>

      <fieldset class="toggle-grid">
        <legend>Modules</legend>
        <label class="check-row">
          <input type="checkbox" checked={draft.playerControlsEnabled} on:change={(event) => update('playerControlsEnabled', event.currentTarget.checked)} />
          <span>Player controls</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={draft.visualizerEnabled} on:change={(event) => update('visualizerEnabled', event.currentTarget.checked)} />
          <span>Visualizer</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={draft.transitionEnabled} on:change={(event) => update('transitionEnabled', event.currentTarget.checked)} />
          <span>Transitions</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={draft.clockEnabled} on:change={(event) => update('clockEnabled', event.currentTarget.checked)} />
          <span>Clock</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={draft.clockShowSeconds} on:change={(event) => update('clockShowSeconds', event.currentTarget.checked)} />
          <span>Clock seconds</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={draft.debugEnabled} on:change={(event) => update('debugEnabled', event.currentTarget.checked)} />
          <span>Debug overlay</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Rainmeter</legend>
        <label class="check-row">
          <input
            type="checkbox"
            checked={draft.rainmeterEnabled}
            on:change={(event) => update('rainmeterEnabled', event.currentTarget.checked)}
          />
          <span>Export JSON</span>
        </label>
        <label>
          <span>Output path</span>
          <input
            value={draft.rainmeterOutputPath}
            placeholder="D:\Rainmeter\Skins\SpotifyWallPaper\NowPlaying.json"
            on:input={(event) => update('rainmeterOutputPath', event.currentTarget.value)}
          />
        </label>
      </fieldset>
    </form>

    <section class="preview-pane" aria-label="Mock wallpaper preview">
      <div class="preview-shell">
        <WallpaperView model={previewViewModel} showDebug={false} onIntent={handlePreviewIntent} />
      </div>

      <div class="export-actions">
        <button type="button" on:click={copySettings}>Copy JSON</button>
        <span>{copyStatus}</span>
      </div>
      <textarea readonly value={settingsJson} aria-label="Generated settings JSON"></textarea>

      <div class="export-actions">
        <span>{rainmeterSummary}</span>
      </div>
      <div class="export-actions">
        <button type="button" disabled={!settings.rainmeter.enabled} on:click={writeRainmeter}>Write Rainmeter</button>
        <span>{rainmeterStatus}</span>
      </div>
      <div class="export-actions">
        <button type="button" disabled={!settings.rainmeter.enabled} on:click={startScheduler}>Start Scheduler</button>
        <button type="button" disabled={!rainmeterSchedulerRunning} on:click={updateScheduler}>Update Scheduler</button>
        <button type="button" disabled={!rainmeterSchedulerRunning} on:click={stopScheduler}>Stop Scheduler</button>
      </div>
      <textarea class="rainmeter-preview" readonly value={rainmeterJson} aria-label="Rainmeter JSON preview"></textarea>
    </section>

    <section class="import-pane" aria-label="Import settings">
      <h2>Import</h2>
      <textarea bind:value={importSource} aria-label="Import settings JSON"></textarea>
      <div class="export-actions">
        <button type="button" on:click={importSettings}>Import JSON</button>
        <span>{importWarning}</span>
      </div>
    </section>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #1c232b;
    background: #f3f6f8;
  }

  main {
    min-height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 24px 32px;
    border-bottom: 1px solid #d8e0e6;
    background: #ffffff;
  }

  .eyebrow,
  h1 {
    margin: 0;
  }

  .eyebrow {
    color: #66727f;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 4px;
    font-size: 1.8rem;
  }

  .status-stack {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    color: #40505f;
    font-size: 0.88rem;
  }

  .status-stack span {
    padding: 6px 10px;
    border: 1px solid #d3dce4;
    border-radius: 8px;
    background: #f7fafc;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(320px, 420px) minmax(420px, 1fr);
    gap: 24px;
    padding: 24px 32px 32px;
  }

  .editor,
  .preview-pane,
  .import-pane {
    min-width: 0;
  }

  .editor {
    display: grid;
    gap: 18px;
  }

  fieldset {
    display: grid;
    gap: 12px;
    margin: 0;
    border: 0;
    border-top: 1px solid #d8e0e6;
    padding: 16px 0 0;
  }

  legend,
  h2 {
    color: #27323c;
    font-size: 0.95rem;
    font-weight: 800;
  }

  label {
    display: grid;
    gap: 6px;
    color: #40505f;
    font-size: 0.86rem;
    font-weight: 650;
  }

  input,
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #c9d3dc;
    border-radius: 8px;
    padding: 9px 10px;
    color: #1c232b;
    background: #ffffff;
    font: inherit;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .check-row input {
    width: 18px;
    height: 18px;
  }

  .toggle-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .toggle-grid legend {
    grid-column: 1 / -1;
  }

  .preview-pane {
    display: grid;
    gap: 14px;
    align-content: start;
  }

  .preview-shell {
    height: 560px;
    min-height: 360px;
    overflow: hidden;
    border: 1px solid #c9d3dc;
    border-radius: 8px;
    background: #111318;
  }

  .export-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 36px;
    color: #52606d;
    font-size: 0.88rem;
  }

  button {
    min-width: 112px;
    height: 36px;
    border: 1px solid #1f6feb;
    border-radius: 8px;
    color: #ffffff;
    background: #1f6feb;
    font-weight: 750;
    cursor: pointer;
  }

  textarea {
    min-height: 280px;
    resize: vertical;
    font: 0.86rem/1.45 "Cascadia Mono", Consolas, monospace;
  }

  .rainmeter-preview {
    min-height: 220px;
  }

  .import-pane {
    grid-column: 2;
  }

  .import-pane h2 {
    margin: 0 0 10px;
  }

  .import-pane textarea {
    min-height: 120px;
  }

  @media (max-width: 980px) {
    .topbar,
    .workspace {
      padding-inline: 18px;
    }

    .workspace {
      grid-template-columns: 1fr;
    }

    .import-pane {
      grid-column: auto;
    }
  }
</style>
