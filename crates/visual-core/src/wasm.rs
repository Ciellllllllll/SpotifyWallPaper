use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

use crate::theme::{readability_for_background, Rgb};
use crate::visualizer::normalize_samples;

/// Returns a Float32Array whose first value is peak and remaining values are samples.
/// Typed arrays keep the audio hot path free of JSON serialization.
#[wasm_bindgen]
pub fn normalize_visualizer(
    current: &[f32],
    previous: &[f32],
    smoothing: f32,
    decay: f32,
    clamp_max: f32,
    noise_gate: f32,
) -> Float32Array {
    let output = normalize_samples(current, previous, smoothing, decay, clamp_max, noise_gate);
    let mut values = Vec::with_capacity(output.samples.len() + 1);
    values.push(output.peak);
    if output.samples.is_empty() {
        values.push(0.0);
    } else {
        values.extend(output.samples);
    }
    Float32Array::from(values.as_slice())
}

/// Returns [text.r, text.g, text.b, overlayOpacity, shadowStrength, contrastRatio].
#[wasm_bindgen]
pub fn readability(r: u8, g: u8, b: u8) -> Float32Array {
    let output = readability_for_background(Rgb { r, g, b });
    Float32Array::from(
        [
            output.text.r as f32,
            output.text.g as f32,
            output.text.b as f32,
            output.overlay_opacity,
            output.shadow_strength,
            output.contrast_ratio,
        ]
        .as_slice(),
    )
}
