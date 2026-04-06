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

use regex::Regex;
use serde_yaml::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// A parsed patch operation extracted from a `<JSONPatch>` block.
///
/// Each operation specifies a type ([`op`](Self::op)), a target
/// [`path`](Self::path) using JSON Pointer syntax, and an optional
/// [`value`](Self::value) (absent for `remove` operations).
/// The value is pre-converted from JSON to [`serde_yaml::Value`] during
/// parsing to avoid repeated conversion at application time.
#[derive(Debug)]
struct PatchOperation {
    /// The operation type: `"replace"`, `"delta"`, `"insert"`, or `"remove"`.
    op: String,
    /// A JSON Pointer path targeting the YAML node (e.g., `"/character/stats/health"`).
    path: String,
    /// The operation value, pre-converted to YAML. [`None`] for `remove` operations.
    value: Option<Value>,
}

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

    for child_dir in &child_dirs {
        let init_path = child_dir.join("init-status.yml");
        let init_state = match fs::read_to_string(&init_path) {
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

/// Processes a single sub-directory by applying all JSONPatch operations found
/// in numbered Markdown files to a clone of `init_state`, then writes the
/// result to `current-status.yml`.
fn process_subdirectory(sub_dir: &Path, init_state: &Value, patch_re: &Regex) {
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

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

/// Returns sorted sub-directories of the given path.
///
/// Only immediate children that are directories are included. Entries are
/// sorted lexicographically by path.
fn sorted_subdirs(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
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
fn collect_numbered_md_files(dir: &Path) -> Result<Vec<(u64, PathBuf)>, std::io::Error> {
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

// ---------------------------------------------------------------------------
// Patch parsing
// ---------------------------------------------------------------------------

/// Parses a JSON text block into a list of [`PatchOperation`]s.
///
/// Attempts standard JSON array parsing first (fast path). If that fails
/// (e.g., due to unescaped quotes in string values from SillyTavern data),
/// falls back to line-by-line extraction.
fn parse_patch_operations(json_text: &str) -> Vec<PatchOperation> {
    // Fast path: standard JSON array parsing
    if let Ok(ops) = serde_json::from_str::<Vec<serde_json::Value>>(json_text) {
        return ops.iter().filter_map(json_value_to_patch_op).collect();
    }

    // Fallback: line-by-line parsing for malformed JSON
    let mut results = Vec::new();
    for line in json_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed == "[" || trimmed == "]" {
            continue;
        }

        let entry = trimmed.trim_end_matches(',').trim();
        if !entry.starts_with('{') || !entry.ends_with('}') {
            continue;
        }

        // Try standard parsing for this single entry
        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(entry)
            && let Some(op) = json_value_to_patch_op(&json_val)
        {
            results.push(op);
            continue;
        }

        // Manual extraction for entries with unescaped quotes in value strings
        if let Some(op) = parse_malformed_entry(entry) {
            results.push(op);
        }
    }
    results
}

/// Converts a [`serde_json::Value`] object into a [`PatchOperation`].
///
/// Returns [`None`] if the required `"op"` or `"path"` fields are missing.
fn json_value_to_patch_op(json: &serde_json::Value) -> Option<PatchOperation> {
    let op = json.get("op")?.as_str()?.to_string();
    let path = json.get("path")?.as_str()?.to_string();
    let value = json.get("value").map(json_to_yaml);
    Some(PatchOperation { op, path, value })
}

/// Parses a single malformed JSON object by manually extracting fields.
///
/// Handles entries with unescaped ASCII double quotes inside string values,
/// which are common in SillyTavern story data (Chinese text uses `"\u2026"` for
/// emphasis).
fn parse_malformed_entry(entry: &str) -> Option<PatchOperation> {
    let op = extract_simple_string_field(entry, "op")?;
    let path = extract_simple_string_field(entry, "path")?;
    let value = extract_value_field(entry);
    Some(PatchOperation { op, path, value })
}

/// Extracts a simple string field from a JSON-like object string.
///
/// Looks for `"field": "value"` patterns where the value contains no embedded
/// quotes. For fields with complex values, use [`extract_value_field`] instead.
fn extract_simple_string_field(entry: &str, field: &str) -> Option<String> {
    let marker = format!("\"{}\":", field);
    let pos = entry.find(&marker)?;
    let after = entry[pos + marker.len()..].trim_start();
    let after = after.strip_prefix('"')?;
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

/// Extracts the `"value"` field from a malformed JSON object string.
///
/// Handles both string values (with potential unescaped internal quotes) and
/// non-string values (numbers, booleans, null, arrays, objects).
/// Returns [`None`] if no `"value"` field is found (valid for `remove` ops).
fn extract_value_field(entry: &str) -> Option<Value> {
    let value_marker = "\"value\":";
    let val_pos = entry.find(value_marker)?;
    let after_marker = entry[val_pos + value_marker.len()..].trim_start();

    if let Some(inner) = after_marker.strip_prefix('"') {
        // String value: find the last `"` before the final `}`
        let last_brace = inner.rfind('}')?;
        let value_region = &inner[..last_brace];
        let last_quote = value_region.rfind('"')?;
        Some(Value::String(value_region[..last_quote].to_string()))
    } else {
        // Non-string value (number, bool, null, array, object)
        let end = after_marker.rfind('}')?;
        let raw = after_marker[..end].trim().trim_end_matches(',').trim();
        let json_val: serde_json::Value = serde_json::from_str(raw).ok()?;
        Some(json_to_yaml(&json_val))
    }
}

// ---------------------------------------------------------------------------
// YAML tree navigation
// ---------------------------------------------------------------------------

/// Navigates to the parent node of the leaf segment in a JSON Pointer path.
///
/// Returns a mutable reference to the parent [`Value`] and the final path
/// segment as a [`String`].
///
/// When `auto_create` is `true`, missing intermediate mappings are created
/// and scalar values at intermediate positions are converted to empty
/// mappings to allow descent.
fn navigate_to_parent<'a>(
    root: &'a mut Value,
    segments: &[&str],
    auto_create: bool,
) -> Result<(&'a mut Value, String), String> {
    if segments.is_empty() {
        return Err("empty path".to_string());
    }
    let (parent_segs, last) = segments.split_at(segments.len() - 1);
    let mut current = root;
    for &seg in parent_segs {
        current = descend_or_create(current, seg, auto_create)?;
    }
    Ok((current, last[0].to_string()))
}

/// Descends one level into a [`Value`] by key (mapping) or index (sequence).
///
/// When `auto_create` is `true`:
/// - Missing keys in mappings are created as empty mappings.
/// - Existing scalar values at the target key are replaced with empty mappings.
/// - Scalar root values are converted to empty mappings to allow descent.
fn descend_or_create<'a>(
    value: &'a mut Value,
    segment: &str,
    auto_create: bool,
) -> Result<&'a mut Value, String> {
    match value {
        Value::Mapping(map) => {
            let key = Value::String(segment.to_string());
            if auto_create {
                let needs_create = match map.get(&key) {
                    None => true,
                    Some(v) => !matches!(v, Value::Mapping(_) | Value::Sequence(_)),
                };
                if needs_create {
                    map.insert(key.clone(), Value::Mapping(serde_yaml::Mapping::new()));
                }
            }
            map.get_mut(&key)
                .ok_or_else(|| format!("key '{}' not found in mapping", segment))
        }
        Value::Sequence(seq) => {
            let idx: usize = segment
                .parse()
                .map_err(|_| format!("invalid sequence index '{}'", segment))?;
            let len = seq.len();
            seq.get_mut(idx)
                .ok_or_else(|| format!("index {} out of bounds (len {})", idx, len))
        }
        _ if auto_create => {
            *value = Value::Mapping(serde_yaml::Mapping::new());
            if let Value::Mapping(map) = value {
                let key = Value::String(segment.to_string());
                map.insert(key.clone(), Value::Mapping(serde_yaml::Mapping::new()));
                map.get_mut(&key)
                    .ok_or_else(|| "unreachable".to_string())
            } else {
                Err("unreachable".to_string())
            }
        }
        _ => Err(format!(
            "cannot descend into non-container with segment '{}'",
            segment
        )),
    }
}

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

/// Converts a [`serde_json::Value`] to a [`serde_yaml::Value`].
///
/// Recursively maps all JSON types to their YAML equivalents. JSON numbers
/// that can be represented as `i64` are stored as integers; otherwise they
/// are stored as `f64`.
fn json_to_yaml(json: &serde_json::Value) -> Value {
    match json {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                Value::Number(serde_yaml::Number::from(f))
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::String(s.clone()),
        serde_json::Value::Array(arr) => {
            Value::Sequence(arr.iter().map(json_to_yaml).collect())
        }
        serde_json::Value::Object(obj) => {
            let mut map = serde_yaml::Mapping::new();
            for (k, v) in obj {
                map.insert(Value::String(k.clone()), json_to_yaml(v));
            }
            Value::Mapping(map)
        }
    }
}

/// Splits a JSON Pointer path string into segments.
///
/// Strips the leading `/` and splits on subsequent `/` separators.
/// For example, `"/a/b/c"` yields `["a", "b", "c"]`.
fn parse_path(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

/// Extracts an `f64` from a YAML number value.
///
/// Returns [`None`] for non-numeric values. Handles both integer and
/// floating-point YAML numbers.
fn yaml_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().or_else(|| n.as_i64().map(|i| i as f64)),
        _ => None,
    }
}

/// Converts an `f64` to a YAML number [`Value`].
///
/// Whole numbers are stored as `i64` to preserve clean integer formatting
/// in the YAML output (e.g., `42` instead of `42.0`).
fn f64_to_yaml_number(result: f64) -> Value {
    if result == result.trunc() && result.is_finite() {
        Value::Number(serde_yaml::Number::from(result as i64))
    } else {
        Value::Number(serde_yaml::Number::from(result))
    }
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

/// Applies a single [`PatchOperation`] to the YAML state tree.
///
/// # Operations
///
/// - **`replace`**: Sets the value at the target path. Creates intermediate
///   mappings if they don't exist (upsert semantics).
/// - **`delta`**: Adds a numeric delta to the value at the target path.
///   Missing or non-numeric targets are treated as `0`.
/// - **`insert`**: Inserts a value at the target path. Replaces existing
///   values (upsert semantics). For sequences, use `/-` to append.
/// - **`remove`**: Removes the value at the target path. Does not create
///   intermediate paths.
///
/// # Errors
///
/// Returns an error message if the operation cannot be applied (e.g., invalid
/// path, missing required value, type mismatch for sequence operations).
fn apply_operation(state: &mut Value, op: &PatchOperation) -> Result<(), String> {
    let segments = parse_path(&op.path);

    match op.op.as_str() {
        "replace" => apply_replace(state, &segments, op),
        "delta" => apply_delta(state, &segments, op),
        "insert" => apply_insert(state, &segments, op),
        "remove" => apply_remove(state, &segments),
        _ => Err(format!("unknown operation '{}'", op.op)),
    }
}

/// Applies a `replace` operation (upsert: inserts if key is absent).
fn apply_replace(
    state: &mut Value,
    segments: &[&str],
    op: &PatchOperation,
) -> Result<(), String> {
    let yaml_val = op.value.clone().ok_or("replace: missing 'value'")?;

    if segments.is_empty() {
        *state = yaml_val;
        return Ok(());
    }

    let (parent, key) = navigate_to_parent(state, segments, true)?;
    match parent {
        Value::Mapping(map) => {
            map.insert(Value::String(key), yaml_val);
        }
        Value::Sequence(seq) => {
            let idx: usize = key
                .parse()
                .map_err(|_| format!("replace: invalid index '{}'", key))?;
            if idx < seq.len() {
                seq[idx] = yaml_val;
            } else {
                return Err(format!(
                    "replace: index {} out of bounds (len {})",
                    idx,
                    seq.len()
                ));
            }
        }
        _ => return Err("replace: parent is not a container".to_string()),
    }
    Ok(())
}

/// Applies a `delta` operation, adding a numeric value to the target.
///
/// Missing or non-numeric targets are treated as `0`. String delta values
/// are parsed as `f64`.
fn apply_delta(
    state: &mut Value,
    segments: &[&str],
    op: &PatchOperation,
) -> Result<(), String> {
    let delta_val = op.value.as_ref().ok_or("delta: missing 'value'")?;
    let delta_f64 = yaml_to_f64(delta_val)
        .or_else(|| match delta_val {
            Value::String(s) => s.parse::<f64>().ok(),
            _ => None,
        })
        .ok_or("delta: 'value' is not a number")?;

    if segments.is_empty() {
        let existing = yaml_to_f64(state).unwrap_or(0.0);
        *state = f64_to_yaml_number(existing + delta_f64);
        return Ok(());
    }

    let (parent, key) = navigate_to_parent(state, segments, true)?;
    match parent {
        Value::Mapping(map) => {
            let k = Value::String(key.clone());
            let existing = map.get(&k).and_then(yaml_to_f64).unwrap_or(0.0);
            map.insert(k, f64_to_yaml_number(existing + delta_f64));
        }
        Value::Sequence(seq) => {
            let idx: usize = key
                .parse()
                .map_err(|_| format!("delta: invalid index '{}'", key))?;
            if let Some(target) = seq.get_mut(idx) {
                let existing = yaml_to_f64(target).unwrap_or(0.0);
                *target = f64_to_yaml_number(existing + delta_f64);
            } else {
                return Err(format!("delta: index {} out of bounds", idx));
            }
        }
        _ => return Err("delta: parent is not a container".to_string()),
    }
    Ok(())
}

/// Applies an `insert` operation (upsert: replaces if key already exists).
///
/// For sequences, use `/-` as the final path segment to append.
/// Scalar parents are converted to sequences when the key is `"-"`.
fn apply_insert(
    state: &mut Value,
    segments: &[&str],
    op: &PatchOperation,
) -> Result<(), String> {
    let yaml_val = op.value.clone().ok_or("insert: missing 'value'")?;

    if segments.is_empty() {
        return Err("insert: empty path".to_string());
    }

    let (parent, key) = navigate_to_parent(state, segments, true)?;
    match parent {
        Value::Mapping(map) => {
            map.insert(Value::String(key), yaml_val);
        }
        Value::Sequence(seq) => {
            if key == "-" {
                seq.push(yaml_val);
            } else {
                return Err(format!(
                    "insert: for sequences, path must end with '-', got '{}'",
                    key
                ));
            }
        }
        _ if key == "-" => {
            *parent = Value::Sequence(vec![yaml_val]);
        }
        _ => return Err("insert: parent is not a container".to_string()),
    }
    Ok(())
}

/// Applies a `remove` operation.
///
/// Does not auto-create intermediate paths; returns an error if the target
/// path does not exist.
fn apply_remove(state: &mut Value, segments: &[&str]) -> Result<(), String> {
    if segments.is_empty() {
        return Err("remove: empty path".to_string());
    }

    let (parent, key) = navigate_to_parent(state, segments, false)?;
    match parent {
        Value::Mapping(map) => {
            let k = Value::String(key.clone());
            if map.remove(&k).is_none() {
                return Err(format!("remove: key '{}' not found", key));
            }
        }
        Value::Sequence(seq) => {
            let idx: usize = key
                .parse()
                .map_err(|_| format!("remove: invalid index '{}'", key))?;
            if idx < seq.len() {
                seq.remove(idx);
            } else {
                return Err(format!(
                    "remove: index {} out of bounds (len {})",
                    idx,
                    seq.len()
                ));
            }
        }
        _ => return Err("remove: parent is not a container".to_string()),
    }
    Ok(())
}
