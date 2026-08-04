/**
 * Compatibility entry point for existing Wallpaper imports.
 * Preset data and cloning live in shared-types so the Configurator can reuse
 * the same authority in its migration phase.
 */
export {
  clonePresetItems,
  defaultLayoutPreset,
  isLayoutPresetName,
  layoutPresetNames,
  layoutPresets,
  withPresetItems
} from '@spotify-wallpaper/shared-types';
