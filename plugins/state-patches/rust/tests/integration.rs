use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

/// Returns the path to the compiled binary.
fn binary_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_BIN_EXE_state-patches"));
    // Fallback: try to find the binary in the target directory
    if !path.exists() {
        path = PathBuf::from("target/debug/state-patches");
    }
    path
}

/// Creates a scenario directory structure inside a temp dir and returns the TempDir.
///
/// Layout:
/// ```text
/// root/
/// └── scenario/
///     ├── init-status.yml
///     └── chapter-01/
///         ├── 1.md
///         └── 2.md  (optional)
/// ```
fn create_fixture(
    init_yaml: &str,
    chapters: &[(&str, &[(&str, &str)])], // [(chapter_name, [(filename, content)])]
) -> TempDir {
    let tmp = TempDir::new().expect("failed to create temp dir");
    let scenario = tmp.path().join("scenario");
    fs::create_dir(&scenario).unwrap();
    fs::write(scenario.join("init-status.yml"), init_yaml).unwrap();

    for (chapter_name, files) in chapters {
        let chapter_dir = scenario.join(chapter_name);
        fs::create_dir(&chapter_dir).unwrap();
        for (filename, content) in *files {
            fs::write(chapter_dir.join(filename), content).unwrap();
        }
    }

    tmp
}

fn run_binary(root: &Path) -> std::process::Output {
    Command::new(binary_path())
        .arg(root)
        .output()
        .expect("failed to execute binary")
}

fn read_output_yaml(tmp: &TempDir, chapter: &str) -> String {
    let path = tmp
        .path()
        .join("scenario")
        .join(chapter)
        .join("current-status.yml");
    fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing output at {}", path.display()))
}

// -----------------------------------------------------------------------
// 3.2 Full pipeline test
// -----------------------------------------------------------------------

#[test]
fn test_full_pipeline() {
    let init = "name: Alice\nhp: 100\n";
    let md1 = r#"Some story text.

<JSONPatch>
[
  {"op": "replace", "path": "/name", "value": "Bob"},
  {"op": "delta", "path": "/hp", "value": -10}
]
</JSONPatch>

More story.
"#;
    let md2 = r#"Another chapter.

<JSONPatch>
[
  {"op": "delta", "path": "/hp", "value": 5},
  {"op": "insert", "path": "/level", "value": 2}
]
</JSONPatch>
"#;
    let tmp = create_fixture(init, &[("chapter-01", &[("1.md", md1), ("2.md", md2)])]);
    let output = run_binary(tmp.path());
    assert!(output.status.success(), "binary failed: {:?}", output);

    let yaml_str = read_output_yaml(&tmp, "chapter-01");
    let result: serde_yaml::Value = serde_yaml::from_str(&yaml_str).unwrap();
    let map = result.as_mapping().unwrap();

    assert_eq!(
        map.get(&serde_yaml::Value::String("name".into())),
        Some(&serde_yaml::Value::String("Bob".into()))
    );

    let hp = map
        .get(&serde_yaml::Value::String("hp".into()))
        .unwrap();
    let hp_val = hp.as_i64().or_else(|| hp.as_f64().map(|f| f as i64));
    assert_eq!(hp_val, Some(95)); // 100 - 10 + 5

    let level = map
        .get(&serde_yaml::Value::String("level".into()))
        .unwrap();
    assert_eq!(level.as_i64(), Some(2));
}

// -----------------------------------------------------------------------
// 3.3 Multiple sub-directories processed independently
// -----------------------------------------------------------------------

#[test]
fn test_multiple_subdirs_independent() {
    let init = "hp: 100\n";
    let md_ch1 = r#"
<JSONPatch>
[{"op": "delta", "path": "/hp", "value": -20}]
</JSONPatch>
"#;
    let md_ch2 = r#"
<JSONPatch>
[{"op": "delta", "path": "/hp", "value": 10}]
</JSONPatch>
"#;
    let tmp = create_fixture(
        init,
        &[
            ("chapter-01", &[("1.md", md_ch1)]),
            ("chapter-02", &[("1.md", md_ch2)]),
        ],
    );
    let output = run_binary(tmp.path());
    assert!(output.status.success());

    // Each chapter starts from init-status.yml independently
    let yaml1: serde_yaml::Value =
        serde_yaml::from_str(&read_output_yaml(&tmp, "chapter-01")).unwrap();
    let yaml2: serde_yaml::Value =
        serde_yaml::from_str(&read_output_yaml(&tmp, "chapter-02")).unwrap();

    let hp1 = yaml1
        .as_mapping()
        .unwrap()
        .get(&serde_yaml::Value::String("hp".into()))
        .unwrap()
        .as_i64()
        .unwrap();
    let hp2 = yaml2
        .as_mapping()
        .unwrap()
        .get(&serde_yaml::Value::String("hp".into()))
        .unwrap()
        .as_i64()
        .unwrap();

    assert_eq!(hp1, 80); // 100 - 20
    assert_eq!(hp2, 110); // 100 + 10
}

// -----------------------------------------------------------------------
// 3.4 Error recovery: invalid patch in one file, valid patches still applied
// -----------------------------------------------------------------------

#[test]
fn test_error_recovery() {
    let init = "hp: 100\nmp: 50\n";
    let md1 = r#"
<JSONPatch>
[
  {"op": "delta", "path": "/hp", "value": 10},
  {"op": "remove", "path": "/nonexistent"},
  {"op": "delta", "path": "/mp", "value": 5}
]
</JSONPatch>
"#;
    let tmp = create_fixture(init, &[("chapter-01", &[("1.md", md1)])]);
    let output = run_binary(tmp.path());
    // The binary should still succeed (errors are logged to stderr, not fatal)
    assert!(output.status.success());

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Error"), "Expected error in stderr: {}", stderr);

    let yaml_str = read_output_yaml(&tmp, "chapter-01");
    let result: serde_yaml::Value = serde_yaml::from_str(&yaml_str).unwrap();
    let map = result.as_mapping().unwrap();

    // hp should have been updated before the error
    let hp = map
        .get(&serde_yaml::Value::String("hp".into()))
        .unwrap()
        .as_i64()
        .unwrap();
    assert_eq!(hp, 110);

    // mp should have been updated after the error
    let mp = map
        .get(&serde_yaml::Value::String("mp".into()))
        .unwrap()
        .as_i64()
        .unwrap();
    assert_eq!(mp, 55);
}

// -----------------------------------------------------------------------
// 3.5 File ordering: numeric sort (not lexicographic)
// -----------------------------------------------------------------------

#[test]
fn test_file_ordering_numeric() {
    let init = "order: ''\n";
    // If sorted lexicographically: 1, 10, 2, 3 → "A-D-B-C"
    // If sorted numerically: 1, 2, 3, 10 → "A-B-C-D"
    let md1 = r#"
<JSONPatch>
[{"op": "replace", "path": "/order", "value": "A"}]
</JSONPatch>
"#;
    let md2 = r#"
<JSONPatch>
[{"op": "replace", "path": "/order", "value": "B"}]
</JSONPatch>
"#;
    let md3 = r#"
<JSONPatch>
[{"op": "replace", "path": "/order", "value": "C"}]
</JSONPatch>
"#;
    let md10 = r#"
<JSONPatch>
[{"op": "replace", "path": "/order", "value": "D"}]
</JSONPatch>
"#;
    let tmp = create_fixture(
        init,
        &[(
            "chapter-01",
            &[
                ("1.md", md1),
                ("2.md", md2),
                ("3.md", md3),
                ("10.md", md10),
            ],
        )],
    );
    let output = run_binary(tmp.path());
    assert!(output.status.success());

    let yaml_str = read_output_yaml(&tmp, "chapter-01");
    let result: serde_yaml::Value = serde_yaml::from_str(&yaml_str).unwrap();
    let order = result
        .as_mapping()
        .unwrap()
        .get(&serde_yaml::Value::String("order".into()))
        .unwrap()
        .as_str()
        .unwrap();

    // Last applied wins — if numeric order, "D" from 10.md is last
    assert_eq!(order, "D", "Expected numeric ordering, got '{}'", order);
}

// -----------------------------------------------------------------------
// Symlink traversal prevention
// -----------------------------------------------------------------------

#[test]
#[cfg(unix)]
fn test_symlink_chapter_skipped() {
    let tmp = TempDir::new().expect("failed to create temp dir");
    let scenario = tmp.path().join("scenario");
    fs::create_dir(&scenario).unwrap();
    fs::write(scenario.join("init-status.yml"), "hp: 100\n").unwrap();

    // Create a real chapter
    let real_chapter = scenario.join("chapter-01");
    fs::create_dir(&real_chapter).unwrap();
    let md = r#"
<JSONPatch>
[{"op": "delta", "path": "/hp", "value": 10}]
</JSONPatch>
"#;
    fs::write(real_chapter.join("1.md"), md).unwrap();

    // Create a separate target directory outside scenario for the symlink
    let external_target = tmp.path().join("external-target");
    fs::create_dir(&external_target).unwrap();
    fs::write(external_target.join("1.md"), md).unwrap();

    // Create a symlinked chapter pointing to the external target
    let link_chapter = scenario.join("chapter-02");
    std::os::unix::fs::symlink(&external_target, &link_chapter).unwrap();

    let output = run_binary(tmp.path());
    assert!(output.status.success());

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Warning: skipping symlink"),
        "Expected symlink warning in stderr: {}",
        stderr
    );

    // Real chapter should be processed
    let real_out = scenario.join("chapter-01").join("current-status.yml");
    assert!(real_out.exists(), "Real chapter output should exist");

    // External target should NOT have current-status.yml written
    let external_out = external_target.join("current-status.yml");
    assert!(!external_out.exists(), "Symlinked chapter should not produce output");
}
