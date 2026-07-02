#[derive(Debug, Clone, PartialEq)]
pub struct VisualizerNormalization {
    pub samples: Vec<f32>,
    pub peak: f32,
}

pub fn normalize_samples(
    current: &[f32],
    previous: &[f32],
    smoothing: f32,
    decay: f32,
    clamp_max: f32,
    noise_gate: f32,
) -> VisualizerNormalization {
    let smoothing = smoothing.clamp(0.0, 1.0);
    let decay = decay.clamp(0.0, 1.0);
    let clamp_max = clamp_max.max(0.0001);
    let noise_gate = noise_gate.clamp(0.0, clamp_max);
    let len = current.len().max(previous.len());
    let mut samples = Vec::with_capacity(len);
    let mut peak: f32 = 0.0;

    for index in 0..len {
        let raw = current.get(index).copied().unwrap_or(0.0);
        let previous = previous.get(index).copied().unwrap_or(0.0);
        let clamped = if raw.is_finite() {
            raw.clamp(0.0, clamp_max) / clamp_max
        } else {
            0.0
        };
        let gated = if clamped < noise_gate / clamp_max {
            0.0
        } else {
            clamped
        };
        let smoothed = previous * smoothing + gated * (1.0 - smoothing);
        let decayed = smoothed.max(previous * (1.0 - decay));
        peak = peak.max(decayed);
        samples.push(decayed);
    }

    VisualizerNormalization { samples, peak }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smooths_decays_clamps_and_gates_samples() {
        let output = normalize_samples(&[-1.0, 0.05, 0.5, 2.0], &[0.8, 0.2, 0.1, 0.0], 0.5, 0.25, 1.0, 0.1);

        assert_eq!(output.samples[0], 0.6);
        assert_eq!(output.samples[1], 0.15);
        assert_eq!(output.samples[2], 0.3);
        assert_eq!(output.samples[3], 0.5);
        assert_eq!(output.peak, 0.6);
    }
}
