<script lang="ts">
  import type { LyricLine, WallpaperSettings } from '@spotify-wallpaper/shared-types';
  import { layoutStyle } from '../layout/style';
  import type { LyricDisplayState } from './lrc';

  export let settings: WallpaperSettings;
  export let state: LyricDisplayState;
  export let lines: LyricLine[];

  $: lyricsItem = settings.layout.items.lyrics;
  $: showLayer = settings.lyrics.enabled && lyricsItem.enabled && state.status !== 'disabled';
  $: missingText =
    state.status === 'missing'
      ? 'Lyrics unavailable'
      : state.status === 'before-first-line'
        ? 'Lyrics ready'
        : '';
</script>

{#if showLayer}
  <section class="layout-item lyrics-layer" style={layoutStyle(lyricsItem)} aria-label="Lyrics">
    {#if state.status === 'active' && state.current}
      {#if settings.lyrics.mode === 'context'}
        <p class="lyric surrounding">{state.previous?.text ?? ''}</p>
      {/if}
      <p class="lyric current">{state.current.text || '\u00a0'}</p>
      {#if settings.lyrics.mode === 'context'}
        <p class="lyric surrounding">{state.next?.text ?? ''}</p>
      {/if}
    {:else if missingText && settings.lyrics.showMissingState}
      <p class="lyric missing">{missingText}</p>
      {#if state.next}
        <p class="lyric surrounding">{state.next.text}</p>
      {/if}
    {:else if lines.length > 0}
      <p class="lyric surrounding">{lines[0].text}</p>
    {/if}
  </section>
{/if}

<style>
  .lyrics-layer {
    position: absolute;
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    color: var(--theme-text, #f6f7fb);
    text-align: center;
    text-shadow: 0 2px 18px rgb(0 0 0 / calc(var(--theme-shadow-strength, 0.7) * 0.78));
    pointer-events: none;
  }

  .lyric {
    margin: 0;
    overflow-wrap: anywhere;
    line-height: 1.18;
  }

  .current {
    font-size: clamp(1.5rem, 3.4vw, 3.3rem);
    font-weight: 760;
  }

  .surrounding {
    color: rgb(246 247 251 / 58%);
    font-size: clamp(1rem, 1.9vw, 1.55rem);
    font-weight: 600;
  }

  .missing {
    color: rgb(246 247 251 / 68%);
    font-size: clamp(1.1rem, 2.2vw, 1.7rem);
    font-weight: 650;
  }

  @media (max-width: 720px) {
    .lyrics-layer {
      gap: 8px;
    }
  }
</style>
