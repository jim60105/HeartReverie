//! Patch parsing from JSON text and malformed JSON entries.

use crate::convert::json_to_yaml;
use crate::patch_ops::PatchOperation;
use serde_yaml::Value;

/// Parses a JSON text block into a list of [`PatchOperation`]s.
///
/// Attempts standard JSON array parsing first (fast path). If that fails
/// (e.g., due to unescaped quotes in string values from SillyTavern data),
/// falls back to line-by-line extraction.
pub(crate) fn parse_patch_operations(json_text: &str) -> Vec<PatchOperation> {
    // Fast path: standard JSON array parsing
    if let Ok(ops) = serde_json::from_str::<Vec<serde_json::Value>>(json_text) {
        return ops.iter().filter_map(json_value_to_patch_op).collect();
    }

    // Fallback: brace-aware block accumulation for malformed JSON
    let mut results = Vec::new();
    let mut brace_depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;
    let mut buffer = String::new();

    for ch in json_text.chars() {
        if escape_next {
            buffer.push(ch);
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            buffer.push(ch);
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            buffer.push(ch);
            continue;
        }
        if !in_string {
            if ch == '{' {
                brace_depth += 1;
                buffer.push(ch);
                continue;
            }
            if ch == '}' {
                brace_depth -= 1;
                buffer.push(ch);
                if brace_depth == 0 {
                    let entry = buffer.trim();
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(entry) {
                        if let Some(op) = json_value_to_patch_op(&json_val) {
                            results.push(op);
                        }
                    } else if let Some(op) = parse_malformed_entry(entry) {
                        results.push(op);
                    }
                    buffer.clear();
                }
                continue;
            }
        }
        if brace_depth > 0 {
            buffer.push(ch);
        }
    }
    results
}

/// Converts a [`serde_json::Value`] object into a [`PatchOperation`].
///
/// Returns [`None`] if the required `"op"` or `"path"` fields are missing.
pub(crate) fn json_value_to_patch_op(json: &serde_json::Value) -> Option<PatchOperation> {
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
pub(crate) fn parse_malformed_entry(entry: &str) -> Option<PatchOperation> {
    let op = extract_simple_string_field(entry, "op")?;
    let path = extract_simple_string_field(entry, "path")?;
    let value = extract_value_field(entry);
    Some(PatchOperation { op, path, value })
}

/// Extracts a simple string field from a JSON-like object string.
///
/// Looks for `"field": "value"` patterns where the value contains no embedded
/// quotes. For fields with complex values, use [`extract_value_field`] instead.
pub(crate) fn extract_simple_string_field(entry: &str, field: &str) -> Option<String> {
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
pub(crate) fn extract_value_field(entry: &str) -> Option<Value> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::yaml_to_f64;

    // -- parse_patch_operations ----------------------------------------------

    #[test]
    fn test_parse_patch_operations_single_block() {
        let json = r#"[{"op":"replace","path":"/name","value":"Alice"}]"#;
        let ops = parse_patch_operations(json);
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, "replace");
        assert_eq!(ops[0].path, "/name");
        assert_eq!(ops[0].value, Some(Value::String("Alice".into())));
    }

    #[test]
    fn test_parse_patch_operations_multiple() {
        let json = r#"[
            {"op":"replace","path":"/a","value":1},
            {"op":"remove","path":"/b"}
        ]"#;
        let ops = parse_patch_operations(json);
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op, "replace");
        assert_eq!(ops[1].op, "remove");
        assert!(ops[1].value.is_none());
    }

    #[test]
    fn test_parse_patch_operations_empty() {
        let ops = parse_patch_operations("[]");
        assert!(ops.is_empty());
    }

    #[test]
    fn test_parse_patch_operations_no_blocks() {
        let ops = parse_patch_operations("");
        assert!(ops.is_empty());
    }

    #[test]
    fn test_parse_patch_operations_nested_json_value() {
        let json = r#"[{"op":"replace","path":"/stats","value":{"hp":100,"mp":50}}]"#;
        let ops = parse_patch_operations(json);
        assert_eq!(ops.len(), 1);
        if let Some(Value::Mapping(map)) = &ops[0].value {
            assert!(map.get(&Value::String("hp".into())).is_some());
        } else {
            panic!("expected nested mapping value");
        }
    }

    // -- parse_malformed_entry -----------------------------------------------

    #[test]
    fn test_parse_patch_operations_fallback_line_by_line() {
        // This is NOT valid JSON as a whole (unescaped quotes), so the fast path fails
        // and the fallback kicks in. Each line is tried individually.
        let input = r#"[
  {"op": "replace", "path": "/x", "value": "He said "hi" to her"},
  {"op": "delta", "path": "/y", "value": 5}
]"#;
        let ops = parse_patch_operations(input);
        // Both entries should be parsed (second via single-line JSON, first via malformed)
        assert_eq!(ops.len(), 2);
    }

    #[test]
    fn test_parse_patch_operations_fallback_skip_non_object_lines() {
        // Fallback path: lines that are not `{...}` are skipped
        let input = "not json at all\n{\"op\":\"remove\",\"path\":\"/a\"},\n---";
        let ops = parse_patch_operations(input);
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, "remove");
    }

    #[test]
    fn test_parse_malformed_entry_unescaped_quotes() {
        let entry = r#"{"op": "replace", "path": "/desc", "value": "He said "hello" to her"}"#;
        let op = parse_malformed_entry(entry).unwrap();
        assert_eq!(op.op, "replace");
        assert_eq!(op.path, "/desc");
        assert!(op.value.is_some());
        if let Some(Value::String(s)) = &op.value {
            assert!(s.contains("hello"));
        }
    }

    #[test]
    fn test_parse_malformed_entry_op_path_value() {
        let entry = r#"{"op": "delta", "path": "/score", "value": 5}"#;
        let op = parse_malformed_entry(entry).unwrap();
        assert_eq!(op.op, "delta");
        assert_eq!(op.path, "/score");
        assert_eq!(op.value.as_ref().and_then(yaml_to_f64), Some(5.0));
    }

    #[test]
    fn test_parse_malformed_entry_missing_op() {
        let entry = r#"{"path": "/x", "value": 1}"#;
        assert!(parse_malformed_entry(entry).is_none());
    }

    #[test]
    fn test_parse_malformed_entry_remove_no_value() {
        let entry = r#"{"op": "remove", "path": "/x"}"#;
        let op = parse_malformed_entry(entry).unwrap();
        assert_eq!(op.op, "remove");
        assert!(op.value.is_none());
    }

    #[test]
    fn test_extract_simple_string_field_basic() {
        let entry = r#"{"op": "replace", "path": "/a"}"#;
        assert_eq!(
            extract_simple_string_field(entry, "op"),
            Some("replace".to_string())
        );
        assert_eq!(
            extract_simple_string_field(entry, "path"),
            Some("/a".to_string())
        );
    }

    #[test]
    fn test_extract_value_field_string() {
        let entry = r#"{"op": "replace", "path": "/x", "value": "hello"}"#;
        let v = extract_value_field(entry);
        assert_eq!(v, Some(Value::String("hello".into())));
    }

    #[test]
    fn test_extract_value_field_number() {
        let entry = r#"{"op": "delta", "path": "/x", "value": 42}"#;
        let v = extract_value_field(entry);
        assert!(v.is_some());
        assert_eq!(yaml_to_f64(&v.unwrap()), Some(42.0));
    }

    #[test]
    fn test_extract_value_field_none() {
        let entry = r#"{"op": "remove", "path": "/x"}"#;
        assert!(extract_value_field(entry).is_none());
    }

    #[test]
    fn test_parse_patch_operations_multiline_malformed() {
        let input = r#"[
  {
    "op": "replace",
    "path": "/desc",
    "value": "He said "hello" to her"
  },
  {"op": "delta", "path": "/hp", "value": 5}
]"#;
        let ops = parse_patch_operations(input);
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op, "replace");
        assert_eq!(ops[0].path, "/desc");
        assert_eq!(ops[1].op, "delta");
    }

    #[test]
    fn test_parse_patch_operations_mixed_single_and_multiline() {
        let input = r#"[
  {"op": "delta", "path": "/hp", "value": 10},
  {
    "op": "replace",
    "path": "/name",
    "value": "She whispered "run" softly"
  },
  {"op": "remove", "path": "/old"}
]"#;
        let ops = parse_patch_operations(input);
        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].op, "delta");
        assert_eq!(ops[1].op, "replace");
        assert_eq!(ops[1].path, "/name");
        assert_eq!(ops[2].op, "remove");
    }
}
