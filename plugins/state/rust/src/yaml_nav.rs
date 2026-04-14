//! YAML tree navigation utilities.

use serde_yaml::Value;

/// Navigates to the parent node of the leaf segment in a JSON Pointer path.
///
/// Returns a mutable reference to the parent [`Value`] and the final path
/// segment as a [`String`].
///
/// When `auto_create` is `true`, missing intermediate mappings are created
/// and scalar values at intermediate positions are converted to empty
/// mappings to allow descent.
pub(crate) fn navigate_to_parent<'a>(
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
pub(crate) fn descend_or_create<'a>(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_descend_or_create_existing_key() {
        let mut v: Value = serde_yaml::from_str("a:\n  b: 1").unwrap();
        let result = descend_or_create(&mut v, "a", false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_descend_or_create_auto_create_missing() {
        let mut v = Value::Mapping(serde_yaml::Mapping::new());
        let result = descend_or_create(&mut v, "new_key", true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_descend_or_create_no_auto_missing() {
        let mut v = Value::Mapping(serde_yaml::Mapping::new());
        let result = descend_or_create(&mut v, "missing", false);
        assert!(result.is_err());
    }

    #[test]
    fn test_descend_or_create_sequence() {
        let mut v: Value = serde_yaml::from_str("- a\n- b").unwrap();
        let result = descend_or_create(&mut v, "0", false);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), &Value::String("a".into()));
    }

    #[test]
    fn test_descend_or_create_sequence_out_of_bounds() {
        let mut v: Value = serde_yaml::from_str("- a").unwrap();
        let result = descend_or_create(&mut v, "5", false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of bounds"));
    }

    #[test]
    fn test_descend_or_create_scalar_auto_create() {
        let mut v = Value::String("hello".into());
        let result = descend_or_create(&mut v, "key", true);
        assert!(result.is_ok());
        assert!(matches!(v, Value::Mapping(_)));
    }

    #[test]
    fn test_descend_or_create_scalar_no_auto() {
        let mut v = Value::String("hello".into());
        let result = descend_or_create(&mut v, "key", false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-container"));
    }

    #[test]
    fn test_navigate_to_parent_single_segment() {
        let mut v: Value = serde_yaml::from_str("x: 10").unwrap();
        let (parent, key) = navigate_to_parent(&mut v, &["x"], false).unwrap();
        assert_eq!(key, "x");
        assert!(matches!(parent, Value::Mapping(_)));
    }

    #[test]
    fn test_navigate_to_parent_multi_segment() {
        let mut v: Value = serde_yaml::from_str("a:\n  b:\n    c: 1").unwrap();
        let (parent, key) = navigate_to_parent(&mut v, &["a", "b", "c"], false).unwrap();
        assert_eq!(key, "c");
        assert!(matches!(parent, Value::Mapping(_)));
    }

    #[test]
    fn test_navigate_to_parent_empty() {
        let mut v = Value::Null;
        let result = navigate_to_parent(&mut v, &[], false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty path"));
    }

    #[test]
    fn test_navigate_to_parent_auto_create_deep() {
        let mut v = Value::Mapping(serde_yaml::Mapping::new());
        let result = navigate_to_parent(&mut v, &["a", "b", "c"], true);
        assert!(result.is_ok());
        let (_, key) = result.unwrap();
        assert_eq!(key, "c");
    }
}
