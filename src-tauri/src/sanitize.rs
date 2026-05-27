// Hand-rolled stderr sanitizer for the Tauri→TS boundary.
//
// Architecture invariant (architect §6): stderr crossing the IPC must
// have ANSI CSI/OSC escapes stripped, other control chars stripped
// (keeping \n / \t), and be capped at 1 KB for display.
//
// No `regex` dep — a small state-machine scanner does the job and
// keeps the bundle lean. Defense in depth: the TS render layer uses
// `textContent`, never `innerHTML`, so even a sanitizer bug can't
// inject HTML.

const DISPLAY_CAP_BYTES: usize = 1024;
const TRUNCATED_MARKER: &str = "\n… (truncated)";

/// Sanitize a stderr byte buffer for safe display in the UI.
///
/// 1. UTF-8 decode (lossy: replacement char on bad bytes).
/// 2. Strip ANSI CSI (`ESC [ ... letter`) sequences.
/// 3. Strip ANSI OSC (`ESC ] ... BEL`) sequences.
/// 4. Drop other control chars; keep `\n` and `\t`.
/// 5. Truncate to ~1 KB with a marker.
pub fn sanitize_stderr(raw: &[u8]) -> String {
    let decoded: String = String::from_utf8_lossy(raw).into_owned();
    let cleaned = strip_escapes_and_controls(&decoded);
    cap_length(&cleaned)
}

fn strip_escapes_and_controls(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // ANSI escape — consume the rest of the sequence.
            match chars.peek().copied() {
                Some('[') => {
                    // CSI: ESC [ <params> <letter>
                    chars.next();
                    loop {
                        match chars.next() {
                            // CSI terminator: any ASCII letter (uppercase or lowercase).
                            Some(c) if c.is_ascii_alphabetic() => break,
                            // Defensive bail: stop if we hit another ESC or run off the end.
                            Some('\x1b') | None => break,
                            Some(_) => continue,
                        }
                    }
                }
                Some(']') => {
                    // OSC: ESC ] <params> BEL (or ESC \)
                    chars.next();
                    loop {
                        match chars.next() {
                            Some('\x07') | None => break,
                            Some('\x1b') => {
                                // ESC \  terminator.
                                if matches!(chars.peek().copied(), Some('\\')) {
                                    chars.next();
                                }
                                break;
                            }
                            Some(_) => continue,
                        }
                    }
                }
                _ => {
                    // Unknown ESC sequence: drop the single ESC.
                }
            }
            continue;
        }
        if c.is_control() && c != '\n' && c != '\t' {
            // Drop other control chars silently.
            continue;
        }
        out.push(c);
    }
    out
}

fn cap_length(s: &str) -> String {
    if s.len() <= DISPLAY_CAP_BYTES {
        return s.to_string();
    }
    // Walk back to the nearest char boundary so we don't slice a
    // multi-byte codepoint in half.
    let mut cut = DISPLAY_CAP_BYTES;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut out = String::with_capacity(cut + TRUNCATED_MARKER.len());
    out.push_str(&s[..cut]);
    out.push_str(TRUNCATED_MARKER);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_csi() {
        let input = b"\x1b[31mred\x1b[0m and \x1b[1;33myellow\x1b[m";
        let out = sanitize_stderr(input);
        assert_eq!(out, "red and yellow");
    }

    #[test]
    fn strips_ansi_osc_bel_terminated() {
        let input = b"\x1b]0;title\x07hello";
        let out = sanitize_stderr(input);
        assert_eq!(out, "hello");
    }

    #[test]
    fn strips_ansi_osc_st_terminated() {
        let input = b"\x1b]0;title\x1b\\hello";
        let out = sanitize_stderr(input);
        assert_eq!(out, "hello");
    }

    #[test]
    fn strips_control_chars_but_keeps_newlines_and_tabs() {
        let input = b"line1\nline2\x07bell\x00null\tindent";
        let out = sanitize_stderr(input);
        assert_eq!(out, "line1\nline2bellnull\tindent");
    }

    #[test]
    fn preserves_printable_text_unchanged() {
        let input = b"plain printable ASCII 123 !@#$";
        let out = sanitize_stderr(input);
        assert_eq!(out, "plain printable ASCII 123 !@#$");
    }

    #[test]
    fn caps_long_input_with_marker() {
        let input = vec![b'a'; 4096];
        let out = sanitize_stderr(&input);
        assert!(out.len() <= 1024 + TRUNCATED_MARKER.len());
        assert!(out.ends_with(TRUNCATED_MARKER));
    }

    #[test]
    fn lossy_utf8_does_not_panic() {
        let input = b"valid \xff\xfe invalid bytes";
        let out = sanitize_stderr(input);
        // Output is non-empty and the printable prefix survives.
        assert!(out.starts_with("valid "));
        assert!(out.ends_with("invalid bytes"));
    }

    #[test]
    fn handles_lone_esc_safely() {
        let input = b"before\x1bafter";
        let out = sanitize_stderr(input);
        assert_eq!(out, "beforeafter");
    }
}
