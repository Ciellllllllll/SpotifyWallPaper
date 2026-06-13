<script lang="ts">
  import type { WallpaperSettings, WallpaperTheme } from '@spotify-wallpaper/shared-types';
  import { layoutStyle } from '../layout/style';
  import { buildBackgroundStyle } from '../theme/background';
  import { transitionCssClass, type TrackTransitionState } from './model';

  export let state: TrackTransitionState | null;
  export let settings: WallpaperSettings;
  export let theme: WallpaperTheme;

  $: overlayClass = state ? transitionCssClass(state) : '';
  $: transitionStyle = state
    ? `--transition-duration: ${state.durationMs}ms; --transition-easing: ${state.easing};`
    : '';
  $: previousArtists = state?.previous.artists.join(', ') ?? '';
</script>

{#if state}
  <div class={`transition-overlay ${overlayClass}`} style={transitionStyle} aria-hidden="true">
    {#if settings.transitions.background}
      <div class="transition-backdrop" style={buildBackgroundStyle(settings, theme, state.previous.albumImageUrl)}></div>
    {/if}

    {#if settings.transitions.albumArt && settings.albumArt.visible && settings.layout.items.albumArt.enabled}
      <div class="transition-item transition-album" style={layoutStyle(settings.layout.items.albumArt)}>
        <img src={state.previous.albumImageUrl} alt="" />
      </div>
    {/if}

    {#if settings.transitions.text && settings.text.visible && settings.layout.items.trackText.enabled}
      <section class="transition-item transition-text" style={layoutStyle(settings.layout.items.trackText)}>
        <p>{state.previous.isPlaying ? 'Playing' : 'Paused'}</p>
        <h2>{state.previous.title}</h2>
        <span>{previousArtists}</span>
      </section>
    {/if}
  </div>
{/if}

<style>
  .transition-overlay {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    animation: transition-fade-out var(--transition-duration, 700ms) var(--transition-easing, ease-out) both;
  }

  .transition-backdrop {
    position: absolute;
    inset: -8vh -8vw;
  }

  .transition-item {
    position: absolute;
  }

  .transition-album {
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 42%);
  }

  .transition-album img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .transition-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    color: var(--theme-text, #f6f7fb);
    text-shadow: 0 2px 18px rgb(0 0 0 / 48%);
  }

  .transition-text p {
    margin: 0 0 14px;
    color: var(--theme-accent, #96d0b4);
    font-size: clamp(0.78rem, 1.2vw, 0.9rem);
    font-weight: 700;
    text-transform: uppercase;
  }

  .transition-text h2 {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: clamp(2.2rem, 7vw, 6rem);
    line-height: 0.96;
  }

  .transition-text span {
    margin-top: 18px;
    overflow-wrap: anywhere;
    font-size: clamp(1.1rem, 2.2vw, 1.6rem);
    font-weight: 650;
  }

  .transition-slide-left {
    animation-name: transition-slide-left;
  }

  .transition-zoom-in {
    animation-name: transition-zoom-in;
  }

  .transition-blur-fade {
    animation-name: transition-blur-fade;
  }

  .transition-crossfade {
    animation-name: transition-fade-out;
  }

  @keyframes transition-fade-out {
    from {
      opacity: 1;
    }

    to {
      opacity: 0;
    }
  }

  @keyframes transition-slide-left {
    from {
      opacity: 1;
      transform: translateX(0);
    }

    to {
      opacity: 0;
      transform: translateX(-54px);
    }
  }

  @keyframes transition-zoom-in {
    from {
      opacity: 1;
      transform: scale(1);
    }

    to {
      opacity: 0;
      transform: scale(1.08);
    }
  }

  @keyframes transition-blur-fade {
    from {
      filter: blur(0);
      opacity: 1;
    }

    to {
      filter: blur(12px);
      opacity: 0;
    }
  }
</style>
