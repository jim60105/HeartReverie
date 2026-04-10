//! Pipeline functions for directory scanning and sub-directory processing.

use crate::parser::parse_patch_operations;
use crate::patch_ops::apply_operation;
use regex::Regex;
use serde_yaml::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Returns sorted sub-directories of the given path.
///
/// Only immediate children that are directories are included. Entries are
/// sorted lexicographically by path.
pub(crate) fn sorted_subdirs(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    Ok(dirs)
}

/// Collects Markdown files whose stem is a number, sorted numerically.
///
/// For example, files named `1.md`, `2.md`, `10.md` are returned in numeric
/// order: `(1, …/1.md), (2, …/2.md), (10, …/10.md)`.
pub(crate) fn collect_numbered_md_files(dir: &Path) -> Result<Vec<(u64, PathBuf)>, std::io::Error>
{
    let num_re = Regex::new(r"^\d+$").unwrap();
    let mut files: Vec<(u64, PathBuf)> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().is_some_and(|ext| ext == "md")
                && p.file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| num_re.is_match(s))
        })
        .filter_map(|p| {
            let n = p.file_stem()?.to_str()?.parse::<u64>().ok()?;
            Some((n, p))
        })
        .collect();
    files.sort_by_key(|(n, _)| *n);
    Ok(files)
}

/// Processes a single sub-directory by applying all JSONPatch operations found
/// in numbered Markdown files to a clone of `init_state`, then writes the
/// result to `current-status.yml`.
pub(crate) fn process_subdirectory(sub_dir: &Path, init_state: &Value, patch_re: &Regex) {
    let mut state = init_state.clone();

    let md_files = match collect_numbered_md_files(sub_dir) {
        Ok(files) => files,
        Err(e) => {
            eprintln!("Error reading sub-directory {}: {}", sub_dir.display(), e);
            return;
        }
    };

    for (num, md_path) in &md_files {
        let content = match fs::read_to_string(md_path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Error reading {}: {}", md_path.display(), e);
                continue;
            }
        };

        for cap in patch_re.captures_iter(&content) {
            let json_str = &cap[1];
            let ops = parse_patch_operations(json_str);
            if ops.is_empty() && !json_str.trim().is_empty() {
                eprintln!(
                    "Warning: no operations parsed from JSONPatch in {} (file #{})",
                    md_path.display(),
                    num
                );
            }

            for op in &ops {
                if let Err(e) = apply_operation(&mut state, op) {
                    eprintln!(
                        "Error applying op=\"{}\" path=\"{}\" in {}: {}",
                        op.op,
                        op.path,
                        md_path.display(),
                        e
                    );
                }
            }
        }
    }

    let out_path = sub_dir.join("current-status.yml");
    match serde_yaml::to_string(&state) {
        Ok(yaml_str) => {
            if let Err(e) = fs::write(&out_path, &yaml_str) {
                eprintln!("Error writing {}: {}", out_path.display(), e);
            }
        }
        Err(e) => {
            eprintln!("Error serializing YAML for {}: {}", out_path.display(), e);
        }
    }

    println!("Processed: {}", sub_dir.display());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::yaml_to_f64;
    use tempfile::TempDir;

    fn make_temp_dirs(names: &[&str]) -> TempDir {
        let tmp = TempDir::new().unwrap();
        for name in names {
            fs::create_dir(tmp.path().join(name)).unwrap();
        }
        tmp
    }

    #[test]
    fn test_sorted_subdirs_order() {
        let tmp = make_temp_dirs(&["b", "a", "c"]);
        let dirs = sorted_subdirs(tmp.path()).unwrap();
        let names: Vec<&str> = dirs
            .iter()
            .map(|p| p.file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_sorted_subdirs_empty() {
        let tmp = TempDir::new().unwrap();
        let dirs = sorted_subdirs(tmp.path()).unwrap();
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_sorted_subdirs_ignores_files() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("file.txt"), "hello").unwrap();
        fs::create_dir(tmp.path().join("dir")).unwrap();
        let dirs = sorted_subdirs(tmp.path()).unwrap();
        assert_eq!(dirs.len(), 1);
    }

    #[test]
    fn test_collect_numbered_md_files_order() {
        let tmp = TempDir::new().unwrap();
        for name in &["1.md", "10.md", "2.md", "3.md"] {
            fs::write(tmp.path().join(name), "content").unwrap();
        }
        let files = collect_numbered_md_files(tmp.path()).unwrap();
        let nums: Vec<u64> = files.iter().map(|(n, _)| *n).collect();
        assert_eq!(nums, vec![1, 2, 3, 10]);
    }

    #[test]
    fn test_collect_numbered_md_files_ignores_non_numeric() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("1.md"), "ok").unwrap();
        fs::write(tmp.path().join("readme.md"), "skip").unwrap();
        fs::write(tmp.path().join("2.txt"), "skip").unwrap();
        let files = collect_numbered_md_files(tmp.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, 1);
    }

    #[test]
    fn test_collect_numbered_md_files_empty() {
        let tmp = TempDir::new().unwrap();
        let files = collect_numbered_md_files(tmp.path()).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn test_process_subdirectory_basic() {
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("chapter");
        fs::create_dir(&sub).unwrap();
        let md_content = r#"Story text.

<JSONPatch>
[{"op": "replace", "path": "/name", "value": "Bob"}]
</JSONPatch>
"#;
        fs::write(sub.join("1.md"), md_content).unwrap();

        let init: Value = serde_yaml::from_str("name: Alice").unwrap();
        let re = Regex::new(r"(?s)<JSONPatch>\s*(.*?)\s*</JSONPatch>").unwrap();
        process_subdirectory(&sub, &init, &re);

        let output = fs::read_to_string(sub.join("current-status.yml")).unwrap();
        let result: Value = serde_yaml::from_str(&output).unwrap();
        assert_eq!(
            result.as_mapping().unwrap().get(&Value::String("name".into())),
            Some(&Value::String("Bob".into()))
        );
    }

    #[test]
    fn test_process_subdirectory_no_md_files() {
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("empty-chapter");
        fs::create_dir(&sub).unwrap();

        let init: Value = serde_yaml::from_str("x: 1").unwrap();
        let re = Regex::new(r"(?s)<JSONPatch>\s*(.*?)\s*</JSONPatch>").unwrap();
        process_subdirectory(&sub, &init, &re);

        // Output should be written even with no patches (state = init clone)
        let output = fs::read_to_string(sub.join("current-status.yml")).unwrap();
        let result: Value = serde_yaml::from_str(&output).unwrap();
        assert_eq!(yaml_to_f64(result.as_mapping().unwrap().get(&Value::String("x".into())).unwrap()), Some(1.0));
    }

    #[test]
    fn test_process_subdirectory_error_recovery() {
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("chapter");
        fs::create_dir(&sub).unwrap();
        let md_content = r#"
<JSONPatch>
[
  {"op": "delta", "path": "/hp", "value": 10},
  {"op": "remove", "path": "/nonexistent"},
  {"op": "delta", "path": "/hp", "value": 5}
]
</JSONPatch>
"#;
        fs::write(sub.join("1.md"), md_content).unwrap();

        let init: Value = serde_yaml::from_str("hp: 100").unwrap();
        let re = Regex::new(r"(?s)<JSONPatch>\s*(.*?)\s*</JSONPatch>").unwrap();
        process_subdirectory(&sub, &init, &re);

        let output = fs::read_to_string(sub.join("current-status.yml")).unwrap();
        let result: Value = serde_yaml::from_str(&output).unwrap();
        let hp = result.as_mapping().unwrap().get(&Value::String("hp".into())).unwrap();
        // 100 + 10 + 5 = 115 (error on remove doesn't stop processing)
        assert_eq!(yaml_to_f64(hp), Some(115.0));
    }
}
