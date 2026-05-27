// Static-analysis canary: no shell-injection surface anywhere under
// src-tauri/src/.
//
// Mirrors the Phase 10 cli/src/__tests__/no-shell.test.ts regression
// guard, restated for the Rust spawn side. The architect doc §4.3
// commits to argv-only `Command::new("node")` invocation; this test
// fails if a future contributor accidentally introduces a shell-out.
//
// Reviewer verifies by adding `Command::new("sh")` in a scratch
// branch and confirming this test fails.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    fn forbidden() -> Vec<(&'static str, &'static str)> {
        vec![
            ("Command::new(\"sh\"", "Command::new(\"sh\""),
            ("Command::new(\"cmd\"", "Command::new(\"cmd\""),
            ("Command::new(\"cmd.exe\"", "Command::new(\"cmd.exe\""),
            ("Command::new(\"/bin/sh\"", "Command::new(\"/bin/sh\""),
            ("Command::new(\"bash\"", "Command::new(\"bash\""),
            // Powershell would also be a shell-out — guard.
            ("Command::new(\"powershell\"", "Command::new(\"powershell\""),
            ("Command::new(\"pwsh\"", "Command::new(\"pwsh\""),
        ]
    }

    fn collect_rs(dir: &Path, out: &mut Vec<PathBuf>) {
        let read = match fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => return,
        };
        for entry in read.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if path.is_dir() {
                // Skip Cargo target and any hidden dirs.
                if name == "target" || name.starts_with('.') {
                    continue;
                }
                collect_rs(&path, out);
            } else if let Some(ext) = path.extension() {
                if ext == "rs" {
                    // Skip the canary itself.
                    if name == "no_shell_test.rs" {
                        continue;
                    }
                    out.push(path);
                }
            }
        }
    }

    #[test]
    fn rust_sources_have_no_shell_invocations() {
        let root: PathBuf = std::env::var("CARGO_MANIFEST_DIR")
            .map(PathBuf::from)
            .expect("CARGO_MANIFEST_DIR not set")
            .join("src");
        let mut files = Vec::new();
        collect_rs(&root, &mut files);
        assert!(
            !files.is_empty(),
            "expected to scan at least one .rs file under {}",
            root.display()
        );
        let mut offenders: Vec<String> = Vec::new();
        for path in &files {
            let text = match fs::read_to_string(path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            for (line_no, line) in text.lines().enumerate() {
                let trimmed = line.trim_start();
                // Skip comments — JSDoc-equivalent and `//` notes can
                // legitimately reference the names without invoking
                // them.
                if trimmed.starts_with("//") {
                    continue;
                }
                for (name, needle) in forbidden() {
                    if line.contains(needle) {
                        offenders.push(format!(
                            "{}:{}  uses {}",
                            path.display(),
                            line_no + 1,
                            name
                        ));
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "Forbidden shell invocation(s) in Rust source:\n{}",
            offenders.join("\n")
        );
    }
}
