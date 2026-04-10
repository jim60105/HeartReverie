//! Value conversion utilities between JSON and YAML types.

use serde_yaml::Value;

/// Converts a [`serde_json::Value`] to a [`serde_yaml::Value`].
///
/// Recursively maps all JSON types to their YAML equivalents. JSON numbers
/// that can be represented as `i64` are stored as integers; otherwise they
/// are stored as `f64`.
pub(crate) fn json_to_yaml(json: &serde_json::Value) -> Value {
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
pub(crate) fn parse_path(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

/// Extracts an `f64` from a YAML number value.
///
/// Returns [`None`] for non-numeric values. Handles both integer and
/// floating-point YAML numbers.
pub(crate) fn yaml_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().or_else(|| n.as_i64().map(|i| i as f64)),
        _ => None,
    }
}

/// Converts an `f64` to a YAML number [`Value`].
///
/// Whole numbers are stored as `i64` to preserve clean integer formatting
/// in the YAML output (e.g., `42` instead of `42.0`).
pub(crate) fn f64_to_yaml_number(result: f64) -> Value {
    if result == result.trunc() && result.is_finite() {
        Value::Number(serde_yaml::Number::from(result as i64))
    } else {
        Value::Number(serde_yaml::Number::from(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_path_segments() {
        assert_eq!(parse_path("/a/b/c"), vec!["a", "b", "c"]);
    }

    #[test]
    fn test_parse_path_empty() {
        assert!(parse_path("").is_empty());
    }

    #[test]
    fn test_parse_path_root_slash() {
        assert!(parse_path("/").is_empty());
    }

    #[test]
    fn test_yaml_to_f64_integer() {
        let v = Value::Number(serde_yaml::Number::from(42));
        assert_eq!(yaml_to_f64(&v), Some(42.0));
    }

    #[test]
    fn test_yaml_to_f64_float() {
        let v = Value::Number(serde_yaml::Number::from(3.14));
        assert!((yaml_to_f64(&v).unwrap() - 3.14).abs() < 1e-10);
    }

    #[test]
    fn test_yaml_to_f64_non_numeric() {
        assert_eq!(yaml_to_f64(&Value::String("hello".into())), None);
        assert_eq!(yaml_to_f64(&Value::Null), None);
    }

    #[test]
    fn test_f64_to_yaml_number_whole() {
        let v = f64_to_yaml_number(10.0);
        assert_eq!(yaml_to_f64(&v), Some(10.0));
        if let Value::Number(n) = &v {
            assert!(n.as_i64().is_some());
        } else {
            panic!("expected Number");
        }
    }

    #[test]
    fn test_f64_to_yaml_number_fractional() {
        let v = f64_to_yaml_number(3.14);
        assert!((yaml_to_f64(&v).unwrap() - 3.14).abs() < 1e-10);
    }

    #[test]
    fn test_json_to_yaml_null() {
        let j: serde_json::Value = serde_json::json!(null);
        assert_eq!(json_to_yaml(&j), Value::Null);
    }

    #[test]
    fn test_json_to_yaml_bool() {
        assert_eq!(json_to_yaml(&serde_json::json!(true)), Value::Bool(true));
        assert_eq!(json_to_yaml(&serde_json::json!(false)), Value::Bool(false));
    }

    #[test]
    fn test_json_to_yaml_int() {
        let v = json_to_yaml(&serde_json::json!(42));
        assert_eq!(yaml_to_f64(&v), Some(42.0));
    }

    #[test]
    fn test_json_to_yaml_float() {
        let v = json_to_yaml(&serde_json::json!(2.5));
        assert!((yaml_to_f64(&v).unwrap() - 2.5).abs() < 1e-10);
    }

    #[test]
    fn test_json_to_yaml_string() {
        let v = json_to_yaml(&serde_json::json!("hello"));
        assert_eq!(v, Value::String("hello".into()));
    }

    #[test]
    fn test_json_to_yaml_array() {
        let v = json_to_yaml(&serde_json::json!([1, "two", null]));
        if let Value::Sequence(seq) = v {
            assert_eq!(seq.len(), 3);
            assert_eq!(seq[1], Value::String("two".into()));
            assert_eq!(seq[2], Value::Null);
        } else {
            panic!("expected Sequence");
        }
    }

    #[test]
    fn test_json_to_yaml_nested_object() {
        let v = json_to_yaml(&serde_json::json!({"a": {"b": 1}}));
        if let Value::Mapping(map) = &v {
            let inner = map.get(&Value::String("a".into())).unwrap();
            if let Value::Mapping(inner_map) = inner {
                let val = inner_map.get(&Value::String("b".into())).unwrap();
                assert_eq!(yaml_to_f64(val), Some(1.0));
            } else {
                panic!("expected inner Mapping");
            }
        } else {
            panic!("expected Mapping");
        }
    }
}
