<script lang="ts">
  import {
    buildSettings,
    defaultDraft,
    exportSettingsJson,
    importSettingsJson,
    layoutPresetOptions,
    type ConfiguratorDraft
  } from './settingsModel';
  import { buildRainmeterOutput, exportRainmeterJson } from './rainmeter/rainmeterExport';
  import {
    exchangeSpotifyCallback,
    startRainmeterScheduler,
    startSpotifyPkceAuth,
    stopRainmeterScheduler,
    updateRainmeterScheduler,
    writeRainmeterJson
  } from './tauriCommands';

  let draft: ConfiguratorDraft = { ...defaultDraft };
  let importSource = '';
  let importWarning: string | null = null;
  let copyStatus = '';
  let rainmeterStatus = '';
  let spotifyRedirectUri = 'http://127.0.0.1:8899/callback';
  let spotifyCallbackUrl = '';
  let oauthStatus = '';
  let rainmeterSchedulerRunning = false;

  $: settings = buildSettings(draft);
  $: settingsJson = exportSettingsJson(draft);
  $: rainmeterJson = exportRainmeterJson(
    buildRainmeterOutput(
      {
        source: 'mock',
        itemType: 'track',
        id: 'mock-track',
        uri: 'spotify:track:mock-track',
        title: 'Afterglow Atlas',
        artists: ['Nami Kuroda', 'The Static Lights'],
        albumName: 'Mock Signals',
        imageUrls: [],
        albumImageUrl: '',
        durationMs: 200000,
        progressMs: 84000,
        isPlaying: settings.player.controlsEnabled,
        device: null,
        deviceName: 'Browser Mock',
        shuffleState: false,
        repeatState: 'off',
        volumePercent: 72,
        externalUrl: null,
        fetchedAt: '2026-06-14T00:00:00.000Z'
      },
      {
        primaryColor: '#93cab3',
        secondaryColor: '#496a8f',
        accentColor: '#f2c66a',
        readableTextColor: '#f6f7fb'
      },
      {
        albumArtLocalPath: 'D:\\SpotifyWallPaper\\cache\\album.jpg',
        timestamp: '2026-06-14T00:00:00.000Z'
      }
    )
  );
  $: previewClasses = ['mock-wallpaper', `preset-${draft.preset.toLowerCase().replaceAll(' ', '-')}`].join(' ');
  $: exportSummary = draft.includeRefreshToken && draft.spotifyRefreshToken.trim() ? 'includes refresh token' : 'token excluded';
  $: rainmeterSummary = settings.rainmeter.enabled ? 'Rainmeter JSON enabled' : 'Rainmeter off';

  const update = <K extends keyof ConfiguratorDraft>(key: K, value: ConfiguratorDraft[K]) => {
    draft = { ...draft, [key]: value };
    copyStatus = '';
    rainmeterStatus = '';
  };

  const importSettings = () => {
    const imported = importSettingsJson(importSource);
    draft = imported.draft;
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
    oauthStatus = '';
    const result = await startSpotifyPkceAuth(draft.spotifyClientId, spotifyRedirectUri);
    if (!result.ok) {
      oauthStatus = result.message;
      return;
    }

    oauthStatus = 'Spotify authorization opened';
    window.open(result.authUrl, '_blank', 'noopener,noreferrer');
  };

  const exchangeCallback = async () => {
    oauthStatus = '';
    const result = await exchangeSpotifyCallback(draft.spotifyClientId, spotifyCallbackUrl);
    if (!result.ok) {
      oauthStatus = result.message;
      return;
    }

    update('spotifyRefreshToken', result.refreshToken);
    update('includeRefreshToken', false);
    oauthStatus = 'Refresh token saved locally; export still excludes token by default';
    spotifyCallbackUrl = '';
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
          <span>Client ID</span>
          <input value={draft.spotifyClientId} on:input={(event) => update('spotifyClientId', event.currentTarget.value)} />
        </label>
        <label>
          <span>Redirect URI</span>
          <input value={spotifyRedirectUri} on:input={(event) => (spotifyRedirectUri = event.currentTarget.value)} />
        </label>
        <div class="export-actions">
          <button type="button" on:click={startSpotifyAuth}>Start Auth</button>
          <span>{oauthStatus}</span>
        </div>
        <label>
          <span>Callback URL</span>
          <input
            type="password"
            value={spotifyCallbackUrl}
            autocomplete="off"
            on:input={(event) => (spotifyCallbackUrl = event.currentTarget.value)}
          />
        </label>
        <div class="export-actions">
          <button type="button" on:click={exchangeCallback}>Save Token</button>
        </div>
        <label>
          <span>Refresh token</span>
          <input
            type="password"
            value={draft.spotifyRefreshToken}
            autocomplete="off"
            on:input={(event) => update('spotifyRefreshToken', event.currentTarget.value)}
          />
        </label>
        <label class="check-row">
          <input
            type="checkbox"
            checked={draft.includeRefreshToken}
            on:change={(event) => update('includeRefreshToken', event.currentTarget.checked)}
          />
          <span>Include token in export</span>
        </label>
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
          <input type="checkbox" checked={draft.lyricsEnabled} on:change={(event) => update('lyricsEnabled', event.currentTarget.checked)} />
          <span>Lyrics</span>
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
      <div class={previewClasses}>
        <div class="preview-album"></div>
        <div class="preview-copy">
          <span>{settings.player.controlsEnabled ? 'Controls ready' : 'Controls off'}</span>
          <strong>Afterglow Atlas</strong>
          <small>Nami Kuroda, The Static Lights</small>
          <div class="preview-progress"><span></span></div>
        </div>
        {#if settings.clock.enabled}
          <div class="preview-clock">22:10{settings.clock.showSeconds ? ':36' : ''}</div>
        {/if}
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

  .mock-wallpaper {
    position: relative;
    min-height: 360px;
    overflow: hidden;
    border: 1px solid #c9d3dc;
    border-radius: 8px;
    background:
      radial-gradient(circle at 20% 18%, rgb(124 177 199 / 42%), transparent 34%),
      linear-gradient(135deg, #15191f, #28313a 54%, #101318);
  }

  .preview-album {
    position: absolute;
    left: 34px;
    top: 50%;
    width: 180px;
    aspect-ratio: 1;
    border-radius: 8px;
    background:
      linear-gradient(135deg, rgb(255 255 255 / 26%), transparent),
      linear-gradient(145deg, #93cab3, #496a8f 55%, #f2c66a);
    box-shadow: 0 22px 52px rgb(0 0 0 / 36%);
    transform: translateY(-50%);
  }

  .preview-copy {
    position: absolute;
    left: 248px;
    top: 50%;
    display: grid;
    gap: 8px;
    width: min(48%, 520px);
    color: #f6f7fb;
    transform: translateY(-50%);
  }

  .preview-copy span,
  .preview-copy small {
    color: rgb(246 247 251 / 72%);
  }

  .preview-copy strong {
    overflow-wrap: anywhere;
    font-size: 2.2rem;
    line-height: 1;
  }

  .preview-progress {
    width: min(100%, 360px);
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 20%);
  }

  .preview-progress span {
    display: block;
    width: 42%;
    height: 100%;
    background: linear-gradient(90deg, #93cab3, #f2c66a);
  }

  .preview-clock {
    position: absolute;
    right: 24px;
    bottom: 22px;
    color: #f6f7fb;
    font-size: 1.6rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .preset-bottom-player .preview-album {
    top: auto;
    bottom: 20px;
    width: 110px;
    transform: none;
  }

  .preset-bottom-player .preview-copy {
    left: 164px;
    top: auto;
    bottom: 30px;
    transform: none;
  }

  .preset-ambient-background .preview-album {
    display: none;
  }

  .preset-ambient-background .preview-copy {
    left: 50%;
    top: 50%;
    text-align: center;
    transform: translate(-50%, -50%);
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
