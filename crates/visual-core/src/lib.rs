pub mod animation;
pub mod layout;
pub mod lrc;
pub mod theme;
pub mod visualizer;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub fn clamp_progress(progress_ms: u32, duration_ms: u32) -> f32 {
    if duration_ms == 0 {
        return 0.0;
    }

    (progress_ms as f32 / duration_ms as f32).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_clamped() {
        assert_eq!(clamp_progress(50, 100), 0.5);
        assert_eq!(clamp_progress(150, 100), 1.0);
        assert_eq!(clamp_progress(50, 0), 0.0);
    }
}
