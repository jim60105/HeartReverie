//! Patch operation types and application logic.

use crate::convert::{f64_to_yaml_number, parse_path, yaml_to_f64};
use crate::yaml_nav::navigate_to_parent;
use serde_yaml::Value;

/// A parsed patch operation extracted from a `<JSONPatch>` block.
///
/// Each operation specifies a type ([`op`](Self::op)), a target
/// [`path`](Self::path) using JSON Pointer syntax, and an optional
/// [`value`](Self::value) (absent for `remove` operations).
/// The value is pre-converted from JSON to [`serde_yaml::Value`] during
/// parsing to avoid repeated conversion at application time.
#[derive(Debug)]
pub(crate) struct PatchOperation {
    /// The operation type: `"replace"`, `"delta"`, `"insert"`, or `"remove"`.
    pub(crate) op: String,
    /// A JSON Pointer path targeting the YAML node (e.g., `"/character/stats/health"`).
    pub(crate) path: String,
    /// The operation value, pre-converted to YAML. [`None`] for `remove` operations.
    pub(crate) value: Option<Value>,
}

/// Parses a string key as a sequence index, returning a contextual error.
fn parse_seq_index(op_name: &str, key: &str) -> Result<usize, String> {
    key.parse()
        .map_err(|_| format!("{op_name}: invalid index '{key}'"))
}

/// Returns an index-out-of-bounds error for the given operation.
fn seq_oob_err(op_name: &str, idx: usize, len: usize) -> String {
    format!("{op_name}: index {idx} out of bounds (len {len})")
}

/// Returns a "parent is not a container" error for the given operation.
fn not_container_err(op_name: &str) -> String {
    format!("{op_name}: parent is not a container")
}

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
pub(crate) fn apply_operation(state: &mut Value, op: &PatchOperation) -> Result<(), String> {
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
            let idx = parse_seq_index("replace", &key)?;
            if idx < seq.len() {
                seq[idx] = yaml_val;
            } else {
                return Err(seq_oob_err("replace", idx, seq.len()));
            }
        }
        _ => return Err(not_container_err("replace")),
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
            let idx = parse_seq_index("delta", &key)?;
            if let Some(target) = seq.get_mut(idx) {
                let existing = yaml_to_f64(target).unwrap_or(0.0);
                *target = f64_to_yaml_number(existing + delta_f64);
            } else {
                return Err(seq_oob_err("delta", idx, seq.len()));
            }
        }
        _ => return Err(not_container_err("delta")),
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
                    "insert: for sequences, path must end with '-', got '{key}'"
                ));
            }
        }
        _ if key == "-" => {
            *parent = Value::Sequence(vec![yaml_val]);
        }
        _ => return Err(not_container_err("insert")),
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
                return Err(format!("remove: key '{key}' not found"));
            }
        }
        Value::Sequence(seq) => {
            let idx = parse_seq_index("remove", &key)?;
            if idx < seq.len() {
                seq.remove(idx);
            } else {
                return Err(seq_oob_err("remove", idx, seq.len()));
            }
        }
        _ => return Err(not_container_err("remove")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::yaml_to_f64;

    fn make_op(op: &str, path: &str, value: Option<Value>) -> PatchOperation {
        PatchOperation {
            op: op.to_string(),
            path: path.to_string(),
            value,
        }
    }

    // -- apply_replace -------------------------------------------------------

    #[test]
    fn test_apply_replace_existing() {
        let mut state: Value = serde_yaml::from_str("name: Bob").unwrap();
        let op = make_op("replace", "/name", Some(Value::String("Alice".into())));
        let segs = parse_path(&op.path);
        assert!(apply_replace(&mut state, &segs, &op).is_ok());
        let map = state.as_mapping().unwrap();
        assert_eq!(
            map.get(&Value::String("name".into())),
            Some(&Value::String("Alice".into()))
        );
    }

    #[test]
    fn test_apply_replace_upsert() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("replace", "/b", Some(Value::Number(serde_yaml::Number::from(2))));
        let segs = parse_path(&op.path);
        assert!(apply_replace(&mut state, &segs, &op).is_ok());
        assert!(state.as_mapping().unwrap().get(&Value::String("b".into())).is_some());
    }

    #[test]
    fn test_apply_replace_root() {
        let mut state = Value::String("old".into());
        let op = make_op("replace", "", Some(Value::String("new".into())));
        let segs = parse_path(&op.path);
        assert!(apply_replace(&mut state, &segs, &op).is_ok());
        assert_eq!(state, Value::String("new".into()));
    }

    #[test]
    fn test_apply_replace_sequence_element() {
        let mut state: Value = serde_yaml::from_str("items:\n  - a\n  - b").unwrap();
        let op = make_op("replace", "/items/1", Some(Value::String("c".into())));
        let segs = parse_path(&op.path);
        assert!(apply_replace(&mut state, &segs, &op).is_ok());
        let items = state.as_mapping().unwrap()
            .get(&Value::String("items".into())).unwrap()
            .as_sequence().unwrap();
        assert_eq!(items[1], Value::String("c".into()));
    }

    #[test]
    fn test_apply_replace_out_of_bounds() {
        let mut state: Value = serde_yaml::from_str("items:\n  - a").unwrap();
        let op = make_op("replace", "/items/5", Some(Value::String("x".into())));
        let segs = parse_path(&op.path);
        let result = apply_replace(&mut state, &segs, &op);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of bounds"));
    }

    #[test]
    fn test_apply_replace_non_container() {
        let mut state: Value = serde_yaml::from_str("x: hello").unwrap();
        let op = make_op("replace", "/x/0", Some(Value::String("y".into())));
        let segs = parse_path(&op.path);
        let result = apply_replace(&mut state, &segs, &op);
        assert!(result.is_ok());
    }

    // -- apply_delta ---------------------------------------------------------

    #[test]
    fn test_apply_delta_positive() {
        let mut state: Value = serde_yaml::from_str("hp: 100").unwrap();
        let op = make_op("delta", "/hp", Some(Value::Number(serde_yaml::Number::from(10))));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        let hp = state.as_mapping().unwrap().get(&Value::String("hp".into())).unwrap();
        assert_eq!(yaml_to_f64(hp), Some(110.0));
    }

    #[test]
    fn test_apply_delta_negative() {
        let mut state: Value = serde_yaml::from_str("hp: 100").unwrap();
        let op = make_op("delta", "/hp", Some(Value::Number(serde_yaml::Number::from(-20))));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        let hp = state.as_mapping().unwrap().get(&Value::String("hp".into())).unwrap();
        assert_eq!(yaml_to_f64(hp), Some(80.0));
    }

    #[test]
    fn test_apply_delta_missing_path_treat_as_zero() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("delta", "/new_field", Some(Value::Number(serde_yaml::Number::from(5))));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        let val = state.as_mapping().unwrap().get(&Value::String("new_field".into())).unwrap();
        assert_eq!(yaml_to_f64(val), Some(5.0));
    }

    #[test]
    fn test_apply_delta_string_numeric() {
        let mut state: Value = serde_yaml::from_str("x: 10").unwrap();
        let op = make_op("delta", "/x", Some(Value::String("3".into())));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        let val = state.as_mapping().unwrap().get(&Value::String("x".into())).unwrap();
        assert_eq!(yaml_to_f64(val), Some(13.0));
    }

    #[test]
    fn test_apply_delta_non_numeric_error() {
        let mut state: Value = serde_yaml::from_str("x: 10").unwrap();
        let op = make_op("delta", "/x", Some(Value::String("abc".into())));
        let segs = parse_path(&op.path);
        let result = apply_delta(&mut state, &segs, &op);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a number"));
    }

    #[test]
    fn test_apply_delta_sequence_element() {
        let mut state: Value = serde_yaml::from_str("scores:\n  - 10\n  - 20").unwrap();
        let op = make_op("delta", "/scores/0", Some(Value::Number(serde_yaml::Number::from(5))));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        let seq = state.as_mapping().unwrap()
            .get(&Value::String("scores".into())).unwrap()
            .as_sequence().unwrap();
        assert_eq!(yaml_to_f64(&seq[0]), Some(15.0));
    }

    #[test]
    fn test_apply_delta_root_value() {
        let mut state = Value::Number(serde_yaml::Number::from(10));
        let op = make_op("delta", "", Some(Value::Number(serde_yaml::Number::from(7))));
        let segs = parse_path(&op.path);
        assert!(apply_delta(&mut state, &segs, &op).is_ok());
        assert_eq!(yaml_to_f64(&state), Some(17.0));
    }

    // -- apply_insert --------------------------------------------------------

    #[test]
    fn test_apply_insert_into_mapping() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("insert", "/b", Some(Value::Number(serde_yaml::Number::from(2))));
        let segs = parse_path(&op.path);
        assert!(apply_insert(&mut state, &segs, &op).is_ok());
        assert!(state.as_mapping().unwrap().get(&Value::String("b".into())).is_some());
    }

    #[test]
    fn test_apply_insert_upsert() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("insert", "/a", Some(Value::Number(serde_yaml::Number::from(99))));
        let segs = parse_path(&op.path);
        assert!(apply_insert(&mut state, &segs, &op).is_ok());
        let val = state.as_mapping().unwrap().get(&Value::String("a".into())).unwrap();
        assert_eq!(yaml_to_f64(val), Some(99.0));
    }

    #[test]
    fn test_apply_insert_append_to_sequence() {
        let mut state: Value = serde_yaml::from_str("items:\n  - a\n  - b").unwrap();
        let op = make_op("insert", "/items/-", Some(Value::String("c".into())));
        let segs = parse_path(&op.path);
        assert!(apply_insert(&mut state, &segs, &op).is_ok());
        let items = state.as_mapping().unwrap()
            .get(&Value::String("items".into())).unwrap()
            .as_sequence().unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[2], Value::String("c".into()));
    }

    #[test]
    fn test_apply_insert_empty_path_error() {
        let mut state = Value::Null;
        let op = make_op("insert", "", Some(Value::String("x".into())));
        let segs = parse_path(&op.path);
        let result = apply_insert(&mut state, &segs, &op);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty path"));
    }

    #[test]
    fn test_apply_insert_scalar_to_sequence_with_dash() {
        let mut state: Value = serde_yaml::from_str("x: hello").unwrap();
        let op = make_op("insert", "/x/-", Some(Value::String("item".into())));
        let segs = parse_path(&op.path);
        assert!(apply_insert(&mut state, &segs, &op).is_ok());
        let x = state.as_mapping().unwrap().get(&Value::String("x".into())).unwrap();
        assert!(x.as_mapping().is_some());
    }

    // -- apply_remove --------------------------------------------------------

    #[test]
    fn test_apply_remove_mapping_key() {
        let mut state: Value = serde_yaml::from_str("a: 1\nb: 2").unwrap();
        let segs = parse_path("/a");
        assert!(apply_remove(&mut state, &segs).is_ok());
        assert!(state.as_mapping().unwrap().get(&Value::String("a".into())).is_none());
        assert!(state.as_mapping().unwrap().get(&Value::String("b".into())).is_some());
    }

    #[test]
    fn test_apply_remove_sequence_element() {
        let mut state: Value = serde_yaml::from_str("items:\n  - a\n  - b\n  - c").unwrap();
        let segs = parse_path("/items/1");
        assert!(apply_remove(&mut state, &segs).is_ok());
        let items = state.as_mapping().unwrap()
            .get(&Value::String("items".into())).unwrap()
            .as_sequence().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1], Value::String("c".into()));
    }

    #[test]
    fn test_apply_remove_non_existent_key() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let segs = parse_path("/missing");
        let result = apply_remove(&mut state, &segs);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_apply_remove_out_of_bounds() {
        let mut state: Value = serde_yaml::from_str("items:\n  - a").unwrap();
        let segs = parse_path("/items/5");
        let result = apply_remove(&mut state, &segs);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of bounds"));
    }

    #[test]
    fn test_apply_remove_empty_path() {
        let mut state = Value::Null;
        let segs = parse_path("");
        let result = apply_remove(&mut state, &segs);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty path"));
    }

    #[test]
    fn test_apply_remove_non_container() {
        let mut state: Value = serde_yaml::from_str("a: hello").unwrap();
        let segs = parse_path("/a/x");
        let result = apply_remove(&mut state, &segs);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not found") || err.contains("not a container"));
    }

    // -- apply_operation -----------------------------------------------------

    #[test]
    fn test_apply_operation_unknown() {
        let mut state = Value::Null;
        let op = make_op("foobar", "/x", None);
        let result = apply_operation(&mut state, &op);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown operation"));
    }

    #[test]
    fn test_apply_operation_dispatch_replace() {
        let mut state: Value = serde_yaml::from_str("x: 1").unwrap();
        let op = make_op("replace", "/x", Some(Value::Number(serde_yaml::Number::from(99))));
        assert!(apply_operation(&mut state, &op).is_ok());
        let val = state.as_mapping().unwrap().get(&Value::String("x".into())).unwrap();
        assert_eq!(yaml_to_f64(val), Some(99.0));
    }

    #[test]
    fn test_apply_operation_dispatch_delta() {
        let mut state: Value = serde_yaml::from_str("x: 10").unwrap();
        let op = make_op("delta", "/x", Some(Value::Number(serde_yaml::Number::from(5))));
        assert!(apply_operation(&mut state, &op).is_ok());
    }

    #[test]
    fn test_apply_operation_dispatch_insert() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("insert", "/b", Some(Value::Number(serde_yaml::Number::from(2))));
        assert!(apply_operation(&mut state, &op).is_ok());
    }

    #[test]
    fn test_apply_operation_dispatch_remove() {
        let mut state: Value = serde_yaml::from_str("a: 1").unwrap();
        let op = make_op("remove", "/a", None);
        assert!(apply_operation(&mut state, &op).is_ok());
    }
}
