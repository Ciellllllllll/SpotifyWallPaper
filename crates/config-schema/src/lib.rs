pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct SettingsInput {
    pub schema_version: u32,
    pub opacity: f32,
    pub scale: f32,
    pub rotation: f32,
    pub z_index: i32,
    pub visualizer_intensity: f32,
    pub smoothing: f32,
    pub decay: f32,
    pub particle_count: u32,
    pub transition_duration_ms: u32,
    pub polling_playing_ms: u32,
    pub polling_paused_ms: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SettingsValidation {
    pub settings: SettingsInput,
    pub repaired: bool,
    pub migrated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsStatus {
    pub schema_version: u32,
    pub repaired: bool,
}

pub fn default_status() -> SettingsStatus {
    SettingsStatus {
        schema_version: CURRENT_SCHEMA_VERSION,
        repaired: false,
    }
}

impl Default for SettingsInput {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            opacity: 1.0,
            scale: 1.0,
            rotation: 0.0,
            z_index: 0,
            visualizer_intensity: 0.7,
            smoothing: 0.35,
            decay: 0.2,
            particle_count: 120,
            transition_duration_ms: 650,
            polling_playing_ms: 1000,
            polling_paused_ms: 3000,
        }
    }
}

pub fn migrate_schema_version(version: u32) -> (u32, bool) {
    if version == CURRENT_SCHEMA_VERSION {
        (version, false)
    } else {
        (CURRENT_SCHEMA_VERSION, true)
    }
}

pub fn validate_settings(mut settings: SettingsInput) -> SettingsValidation {
    let mut repaired = false;
    let (schema_version, migrated) = migrate_schema_version(settings.schema_version);
    settings.schema_version = schema_version;

    repair_f32(&mut settings.opacity, 0.0, 1.0, 1.0, &mut repaired);
    repair_f32(&mut settings.scale, 0.1, 4.0, 1.0, &mut repaired);
    repair_f32(&mut settings.rotation, -360.0, 360.0, 0.0, &mut repaired);
    repair_i32(&mut settings.z_index, -1000, 1000, 0, &mut repaired);
    repair_f32(&mut settings.visualizer_intensity, 0.0, 2.0, 0.7, &mut repaired);
    repair_f32(&mut settings.smoothing, 0.0, 1.0, 0.35, &mut repaired);
    repair_f32(&mut settings.decay, 0.0, 1.0, 0.2, &mut repaired);
    repair_u32(&mut settings.particle_count, 0, 2000, 120, &mut repaired);
    repair_u32(
        &mut settings.transition_duration_ms,
        0,
        10_000,
        650,
        &mut repaired,
    );
    repair_u32(
        &mut settings.polling_playing_ms,
        500,
        60_000,
        1000,
        &mut repaired,
    );
    repair_u32(
        &mut settings.polling_paused_ms,
        500,
        60_000,
        3000,
        &mut repaired,
    );

    SettingsValidation {
        settings,
        repaired,
        migrated,
    }
}

fn repair_f32(value: &mut f32, min: f32, max: f32, fallback: f32, repaired: &mut bool) {
    let next = if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    };

    if *value != next {
        *value = next;
        *repaired = true;
    }
}

fn repair_i32(value: &mut i32, min: i32, max: i32, fallback: i32, repaired: &mut bool) {
    let next = if *value < min || *value > max {
        fallback
    } else {
        *value
    };

    if *value != next {
        *value = next;
        *repaired = true;
    }
}

fn repair_u32(value: &mut u32, min: u32, max: u32, fallback: u32, repaired: &mut bool) {
    let next = if *value < min || *value > max {
        fallback
    } else {
        *value
    };

    if *value != next {
        *value = next;
        *repaired = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_uses_current_schema() {
        assert_eq!(default_status().schema_version, CURRENT_SCHEMA_VERSION);
        assert!(!default_status().repaired);
    }

    #[test]
    fn valid_settings_remain_valid() {
        let input = SettingsInput::default();
        let output = validate_settings(input.clone());

        assert_eq!(output.settings, input);
        assert!(!output.repaired);
        assert!(!output.migrated);
    }

    #[test]
    fn invalid_settings_are_repaired_safely() {
        let output = validate_settings(SettingsInput {
            schema_version: CURRENT_SCHEMA_VERSION,
            opacity: 2.0,
            scale: 0.0,
            rotation: f32::NAN,
            z_index: 10_000,
            visualizer_intensity: 4.0,
            smoothing: -1.0,
            decay: 8.0,
            particle_count: 10_000,
            transition_duration_ms: 100_000,
            polling_playing_ms: 1,
            polling_paused_ms: 100_000,
        });

        assert!(output.repaired);
        assert_eq!(output.settings.opacity, 1.0);
        assert_eq!(output.settings.scale, 0.1);
        assert_eq!(output.settings.rotation, 0.0);
        assert_eq!(output.settings.z_index, 0);
        assert_eq!(output.settings.visualizer_intensity, 2.0);
        assert_eq!(output.settings.smoothing, 0.0);
        assert_eq!(output.settings.decay, 1.0);
        assert_eq!(output.settings.particle_count, 120);
        assert_eq!(output.settings.transition_duration_ms, 650);
        assert_eq!(output.settings.polling_playing_ms, 1000);
        assert_eq!(output.settings.polling_paused_ms, 3000);
    }

    #[test]
    fn old_schema_migrates() {
        let output = validate_settings(SettingsInput {
            schema_version: 0,
            ..SettingsInput::default()
        });

        assert!(output.migrated);
        assert_eq!(output.settings.schema_version, CURRENT_SCHEMA_VERSION);
    }
}
