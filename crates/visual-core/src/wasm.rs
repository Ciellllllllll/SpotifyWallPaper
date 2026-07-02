use wasm_bindgen::prelude::*;

use crate::layout::{calculate_layout_rect, Anchor, LayoutInput};
use crate::lrc::parse_lrc;
use crate::theme::{readability_for_background, Rgb};
use crate::visualizer::normalize_samples;

#[wasm_bindgen]
pub fn parse_lrc_json(input: &str) -> String {
    let parsed = parse_lrc(input);
    serde_json::json!({
        "offsetMs": parsed.offset_ms,
        "lines": parsed.lines.into_iter().map(|line| {
            serde_json::json!({
                "timeMs": line.time_ms,
                "text": line.text
            })
        }).collect::<Vec<_>>()
    })
    .to_string()
}

#[wasm_bindgen]
pub fn normalize_visualizer_json(input_json: &str) -> String {
    let input = match serde_json::from_str::<serde_json::Value>(input_json) {
        Ok(value) => value,
        Err(_) => return error_json("invalid visualizer input"),
    };

    let current = number_array(input.get("current"));
    let previous = number_array(input.get("previous"));
    let smoothing = number(input.get("smoothing"), 0.35);
    let decay = number(input.get("decay"), 0.2);
    let clamp_max = number(input.get("clampMax"), 1.0);
    let noise_gate = number(input.get("noiseGate"), 0.0);
    let output = normalize_samples(&current, &previous, smoothing, decay, clamp_max, noise_gate);

    serde_json::json!({
        "samples": output.samples,
        "peak": output.peak
    })
    .to_string()
}

#[wasm_bindgen]
pub fn readability_json(r: u8, g: u8, b: u8) -> String {
    let readability = readability_for_background(Rgb { r, g, b });
    serde_json::json!({
        "text": {
            "r": readability.text.r,
            "g": readability.text.g,
            "b": readability.text.b
        },
        "overlayOpacity": readability.overlay_opacity,
        "shadowStrength": readability.shadow_strength,
        "contrastRatio": readability.contrast_ratio
    })
    .to_string()
}

#[wasm_bindgen]
pub fn calculate_layout_rect_json(input_json: &str) -> String {
    let input = match serde_json::from_str::<serde_json::Value>(input_json) {
        Ok(value) => value,
        Err(_) => return error_json("invalid layout input"),
    };

    let anchor = match anchor(input.get("anchor").and_then(|value| value.as_str())) {
        Some(value) => value,
        None => return error_json("invalid layout anchor"),
    };

    let rect = calculate_layout_rect(LayoutInput {
        x_percent: number(input.get("xPercent"), 50.0),
        y_percent: number(input.get("yPercent"), 50.0),
        width: number(input.get("width"), 1.0),
        height: number(input.get("height"), 1.0),
        viewport_width: number(input.get("viewportWidth"), 1.0),
        viewport_height: number(input.get("viewportHeight"), 1.0),
        safe_margin: number(input.get("safeMargin"), 0.0),
        anchor,
        clamp_to_safe_area: input
            .get("clampToSafeArea")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    });

    serde_json::json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    })
    .to_string()
}

fn number_array(value: Option<&serde_json::Value>) -> Vec<f32> {
    value
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .map(|value| value.as_f64().unwrap_or(0.0) as f32)
                .collect()
        })
        .unwrap_or_default()
}

fn number(value: Option<&serde_json::Value>, fallback: f32) -> f32 {
    value
        .and_then(|value| value.as_f64())
        .map(|value| value as f32)
        .unwrap_or(fallback)
}

fn anchor(value: Option<&str>) -> Option<Anchor> {
    match value {
        Some("top-left") => Some(Anchor::TopLeft),
        Some("top-center") => Some(Anchor::TopCenter),
        Some("top-right") => Some(Anchor::TopRight),
        Some("center-left") => Some(Anchor::CenterLeft),
        Some("center") => Some(Anchor::Center),
        Some("center-right") => Some(Anchor::CenterRight),
        Some("bottom-left") => Some(Anchor::BottomLeft),
        Some("bottom-center") => Some(Anchor::BottomCenter),
        Some("bottom-right") => Some(Anchor::BottomRight),
        _ => None,
    }
}

fn error_json(message: &str) -> String {
    serde_json::json!({
        "error": message
    })
    .to_string()
}
