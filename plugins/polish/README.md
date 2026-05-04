# Polish Plugin

One-click literary polish rewrite for the last chapter.

## What it does

Clicking the **✨ 潤飾** action button sends the current chapter draft through a literary-style rewrite prompt and atomically replaces the chapter file with the polished version.

## Atomic-replace semantics

- On **success**, the chapter file is atomically replaced with the rewritten content.
- On **cancel or error**, the original file is preserved byte-for-byte — no partial writes occur.

## Cancel-rollback guarantee

If the rewrite is cancelled mid-stream or the model returns an error, the original draft remains untouched on disk. You can safely interrupt the operation at any time.

## Recommendation

Branch the story before running Polish if you want to keep the original draft alongside the polished version.

## Template variable

The `draft` Vento variable is injected server-side with plugin strip-tags applied, ensuring the model sees only the relevant chapter content.
