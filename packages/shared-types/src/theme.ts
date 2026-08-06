export interface WallpaperTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  mutedColor: string;
  darkColor: string;
  lightColor: string;
  readableTextColor: string;
  overlayOpacity: number;
  shadowStrength: number;
  source: 'extracted' | 'fallback';
}
