# Player UI and Clock

The structure-first runtime owns progress interpolation, clock scheduling,
playback history, and control intent. The shared view only renders the
secret-free ViewModel. `album-only` is an explicit preference and does not
silently mutate saved layout; long titles, paused playback, missing items, and
transitions remain characterization fixtures.

## Player display

Show:

- title
- artists
- album or show name
- album art
- progress
- duration
- play state
- device information when enabled

Long titles and many artists must not break layout.

## Seekbar

Support multiple styles over time:

- straight line
- bottom line
- circular ring
- album outer ring
- waveform line

MVP requires straight line and album ring if feasible.

## Controls

Supported controls when Spotify permits:

- play/pause
- next
- previous
- seek
- volume
- shuffle
- repeat

Control errors must not crash the wallpaper. Restricted device state should disable controls.

## Premium caveat

Passive display must work without Premium. Playback control operations may require Premium and must fail gracefully.

Spotify Development Mode separately requires the owner of a BYO Client ID to have Premium. This platform restriction does not change the wallpaper's passive-display contract for approved or extended-quota apps.

## Clock

Support:

- 24h/12h
- seconds ON/OFF
- date ON/OFF
- weekday ON/OFF
- font size
- font weight
- letter spacing
- opacity
- coordinate layout
- auto/fixed color

If seconds are disabled, do not update the clock every second.
