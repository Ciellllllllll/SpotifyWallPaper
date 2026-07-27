# Rainmeter Integration

## Role

Rainmeter integration is optional and belongs to the configurator/companion side, not the Web Wallpaper core requirement.

## Output model

Export at least JSON containing:

- track title
- artists
- album name
- album art local cache path if available
- progress ms
- duration ms
- progress ratio
- is playing
- primary color
- secondary color
- accent color
- readable text color
- timestamp
- playback source

INI-compatible output may be added later.

## Behavior

Output path is user-configured.
If output fails, wallpaper and Spotify display must continue.
When playback is stopped, output frequency should be reduced.

## Security

Do not output Spotify tokens into Rainmeter files.
