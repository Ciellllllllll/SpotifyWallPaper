#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Readability {
    pub text: Rgb,
    pub overlay_opacity: f32,
    pub shadow_strength: f32,
    pub contrast_ratio: f32,
}

pub fn relative_luminance(color: Rgb) -> f32 {
    fn channel(value: u8) -> f32 {
        let value = value as f32 / 255.0;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }

    0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

pub fn contrast_ratio(a: Rgb, b: Rgb) -> f32 {
    let l1 = relative_luminance(a);
    let l2 = relative_luminance(b);
    let lighter = l1.max(l2);
    let darker = l1.min(l2);
    (lighter + 0.05) / (darker + 0.05)
}

pub fn readability_for_background(background: Rgb) -> Readability {
    let white = Rgb {
        r: 255,
        g: 255,
        b: 255,
    };
    let black = Rgb { r: 0, g: 0, b: 0 };
    let white_ratio = contrast_ratio(background, white);
    let black_ratio = contrast_ratio(background, black);
    let (text, ratio) = if white_ratio >= black_ratio {
        (white, white_ratio)
    } else {
        (black, black_ratio)
    };

    Readability {
        text,
        overlay_opacity: if ratio < 4.5 { 0.42 } else { 0.18 },
        shadow_strength: if text == white { 0.7 } else { 0.25 },
        contrast_ratio: ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_readable_text_for_bright_and_dark_backgrounds() {
        let bright = readability_for_background(Rgb {
            r: 245,
            g: 240,
            b: 230,
        });
        let dark = readability_for_background(Rgb {
            r: 12,
            g: 16,
            b: 20,
        });

        assert_eq!(bright.text, Rgb { r: 0, g: 0, b: 0 });
        assert_eq!(
            dark.text,
            Rgb {
                r: 255,
                g: 255,
                b: 255
            }
        );
        assert!(bright.contrast_ratio >= 4.5);
        assert!(dark.contrast_ratio >= 4.5);
    }
}
