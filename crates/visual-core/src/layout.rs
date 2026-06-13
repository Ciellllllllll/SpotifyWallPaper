#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutInput {
    pub x_percent: f32,
    pub y_percent: f32,
    pub width: f32,
    pub height: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub safe_margin: f32,
    pub anchor: Anchor,
    pub clamp_to_safe_area: bool,
}

pub fn calculate_layout_rect(input: LayoutInput) -> Rect {
    let base_x = input.viewport_width * input.x_percent.clamp(0.0, 100.0) / 100.0;
    let base_y = input.viewport_height * input.y_percent.clamp(0.0, 100.0) / 100.0;
    let (offset_x, offset_y) = anchor_offset(input.anchor, input.width, input.height);
    let mut x = base_x + offset_x;
    let mut y = base_y + offset_y;

    if input.clamp_to_safe_area {
        let min_x = input.safe_margin;
        let min_y = input.safe_margin;
        let max_x = input.viewport_width - input.safe_margin - input.width;
        let max_y = input.viewport_height - input.safe_margin - input.height;
        x = x.clamp(min_x, max_x.max(min_x));
        y = y.clamp(min_y, max_y.max(min_y));
    }

    Rect {
        x,
        y,
        width: input.width,
        height: input.height,
    }
}

fn anchor_offset(anchor: Anchor, width: f32, height: f32) -> (f32, f32) {
    match anchor {
        Anchor::TopLeft => (0.0, 0.0),
        Anchor::TopCenter => (-width / 2.0, 0.0),
        Anchor::TopRight => (-width, 0.0),
        Anchor::CenterLeft => (0.0, -height / 2.0),
        Anchor::Center => (-width / 2.0, -height / 2.0),
        Anchor::CenterRight => (-width, -height / 2.0),
        Anchor::BottomLeft => (0.0, -height),
        Anchor::BottomCenter => (-width / 2.0, -height),
        Anchor::BottomRight => (-width, -height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_all_anchor_offsets() {
        let anchors = [
            (Anchor::TopLeft, 500.0, 500.0),
            (Anchor::TopCenter, 450.0, 500.0),
            (Anchor::TopRight, 400.0, 500.0),
            (Anchor::CenterLeft, 500.0, 475.0),
            (Anchor::Center, 450.0, 475.0),
            (Anchor::CenterRight, 400.0, 475.0),
            (Anchor::BottomLeft, 500.0, 450.0),
            (Anchor::BottomCenter, 450.0, 450.0),
            (Anchor::BottomRight, 400.0, 450.0),
        ];

        for (anchor, expected_x, expected_y) in anchors {
            let rect = calculate_layout_rect(LayoutInput {
                x_percent: 50.0,
                y_percent: 50.0,
                width: 100.0,
                height: 50.0,
                viewport_width: 1000.0,
                viewport_height: 1000.0,
                safe_margin: 0.0,
                anchor,
                clamp_to_safe_area: false,
            });

            assert_eq!(rect.x, expected_x);
            assert_eq!(rect.y, expected_y);
        }
    }

    #[test]
    fn clamps_into_safe_area() {
        let rect = calculate_layout_rect(LayoutInput {
            x_percent: 0.0,
            y_percent: 0.0,
            width: 100.0,
            height: 100.0,
            viewport_width: 500.0,
            viewport_height: 500.0,
            safe_margin: 24.0,
            anchor: Anchor::Center,
            clamp_to_safe_area: true,
        });

        assert_eq!(rect.x, 24.0);
        assert_eq!(rect.y, 24.0);
    }
}
