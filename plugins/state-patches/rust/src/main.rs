//! A CLI tool that processes custom JSONPatch operations from numbered Markdown
//! files against YAML state files.
//!
//! # Overview
//!
//! `apply-patches` scans a root directory for scenario directories containing
//! `init-status.yml`. For each scenario, it iterates sub-directories, reads
//! numbered `.md` files in order, extracts `<JSONPatch>` blocks, and applies
//! the patch operations to produce a `current-status.yml` output.
//!
//! # Directory Layout
//!
//! ```text
//! root/
//! ├── scenario-a/
//! │   ├── init-status.yml
//! │   ├── chapter-01/
//! │   │   ├── 1.md
//! │   │   └── 2.md
//! │   └── chapter-02/
//! │       └── 1.md
//! └── scenario-b/
//!     ├── init-status.yml
//!     └── ...
//! ```
//!
//! # Supported Operations
//!
//! | Operation | Description                                       |
//! |-----------|---------------------------------------------------|
//! | `replace` | Set a value at a path (upsert: inserts if absent) |
//! | `delta`   | Add a numeric delta to a value                    |
//! | `insert`  | Insert a value at a path (upsert semantics)       |
//! | `remove`  | Remove a value at a path                          |
//!
//! # Usage
//!
//! ```bash
//! apply-patches [root_directory]
//! ```

mod convert;
mod yaml_nav;
mod patch_ops;
mod parser;
mod pipeline;

use pipeline::{process_subdirectory, sorted_subdirs};
use regex::Regex;
use serde_yaml::Value;
use std::path::PathBuf;

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("failed to get current directory"));

    let patch_re = Regex::new(r"(?s)<JSONPatch>\s*(.*?)\s*</JSONPatch>").unwrap();

    let mut child_dirs = match sorted_subdirs(&root) {
        Ok(dirs) => dirs,
        Err(e) => {
            eprintln!("Error reading root directory {}: {}", root.display(), e);
            return;
        }
    };
    child_dirs.retain(|d| d.join("init-status.yml").is_file());
    child_dirs.retain(|d| {
        match std::fs::symlink_metadata(d) {
            Ok(meta) if meta.is_symlink() => {
                eprintln!("Warning: skipping symlink {}", d.display());
                false
            }
            _ => true,
        }
    });

    for child_dir in &child_dirs {
        let init_path = child_dir.join("init-status.yml");

        // Reject symlinked init-status.yml
        if std::fs::symlink_metadata(&init_path).is_ok_and(|m| m.is_symlink()) {
            eprintln!(
                "Warning: skipping symlinked init file {}",
                init_path.display()
            );
            continue;
        }

        let init_state = match std::fs::read_to_string(&init_path) {
            Ok(content) => match serde_yaml::from_str::<Value>(&content) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("Error parsing {}: {}", init_path.display(), e);
                    continue;
                }
            },
            Err(e) => {
                eprintln!("Error reading {}: {}", init_path.display(), e);
                continue;
            }
        };

        let sub_dirs = match sorted_subdirs(child_dir) {
            Ok(dirs) => dirs,
            Err(e) => {
                eprintln!(
                    "Error reading child directory {}: {}",
                    child_dir.display(),
                    e
                );
                continue;
            }
        };

        for sub_dir in &sub_dirs {
            process_subdirectory(sub_dir, &init_state, &patch_re);
        }
    }
}
