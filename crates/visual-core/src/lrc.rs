#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LyricLine {
    pub time_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LrcParseResult {
    pub offset_ms: i64,
    pub lines: Vec<LyricLine>,
}

pub fn parse_lrc(input: &str) -> LrcParseResult {
    let mut offset_ms = 0;
    let mut lines = Vec::new();

    for raw_line in input.lines() {
        let mut rest = raw_line.trim();
        let mut timestamps = Vec::new();

        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(end) = stripped.find(']') else {
                break;
            };
            let tag = &stripped[..end];
            rest = &stripped[end + 1..];

            if let Some(value) = tag.strip_prefix("offset:") {
                offset_ms = value.trim().parse::<i64>().unwrap_or(0);
                continue;
            }

            if let Some(timestamp) = parse_timestamp(tag) {
                timestamps.push(timestamp);
            }
        }

        for timestamp in timestamps {
            lines.push(LyricLine {
                time_ms: timestamp + offset_ms,
                text: rest.to_string(),
            });
        }
    }

    lines.sort_by_key(|line| line.time_ms);
    LrcParseResult { offset_ms, lines }
}

pub fn current_line(lines: &[LyricLine], progress_ms: i64) -> Option<&LyricLine> {
    lines.iter().rev().find(|line| line.time_ms <= progress_ms)
}

fn parse_timestamp(tag: &str) -> Option<i64> {
    let (minutes, rest) = tag.split_once(':')?;
    let minutes = minutes.parse::<i64>().ok()?;
    let seconds = rest.parse::<f64>().ok()?;
    Some(minutes * 60_000 + (seconds * 1000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_offset_duplicate_and_empty_lines() {
        let parsed = parse_lrc("[offset:100]\n[00:01.00]First\n[00:01.00]Duplicate\n[00:02.50]\n[ar:metadata]");

        assert_eq!(parsed.offset_ms, 100);
        assert_eq!(
            parsed.lines,
            vec![
                LyricLine {
                    time_ms: 1100,
                    text: "First".to_string()
                },
                LyricLine {
                    time_ms: 1100,
                    text: "Duplicate".to_string()
                },
                LyricLine {
                    time_ms: 2600,
                    text: "".to_string()
                }
            ]
        );
    }

    #[test]
    fn finds_current_line_by_progress() {
        let parsed = parse_lrc("[00:01.00]One\n[00:02.00]Two");

        assert_eq!(current_line(&parsed.lines, 500), None);
        assert_eq!(current_line(&parsed.lines, 1500).unwrap().text, "One");
        assert_eq!(current_line(&parsed.lines, 2500).unwrap().text, "Two");
    }
}
