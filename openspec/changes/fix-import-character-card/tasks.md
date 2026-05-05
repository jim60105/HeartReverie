# Tasks

## Task 1: Fix entry name resolution in parser

**File:** `reader-src/src/lib/character-card-parser.ts`

In the `normalise()` function (~line 148), change the name derivation to use trim-aware fallback:

```ts
// Helper for trim-aware non-empty string extraction
function nonEmptyTrimmed(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s || "";
}

// In the entry mapping:
const firstNonEmptyKey = (entry?.keys ?? [])
  .map((k: unknown) => (typeof k === "string" ? k.trim() : ""))
  .find(Boolean) ?? "";
const name = nonEmptyTrimmed(entry?.comment)
  || nonEmptyTrimmed(entry?.name)
  || firstNonEmptyKey
  || "";
```

This implements the `comment → name → first non-empty key → ""` fallback chain with proper trim handling.

## Task 2: Extract character_book.name and update types

**File:** `reader-src/src/types/character-card.ts`

Add `bookName: string` to `ParsedCharacterCard` interface. Add `comment?: string` to the raw entry type if one exists.

**File:** `reader-src/src/lib/character-card-parser.ts`

Add extraction of `character_book.name`:

```ts
bookName: nonEmptyTrimmed(data?.character_book?.name)
```

## Task 3: Skip Keys line for empty keys in world_info markdown

**File:** `reader-src/src/components/ImportCharacterCardPage.vue`

In `buildWorldInfoMarkdown()` (~line 361-371), conditionally include the `**Keys:**` line only when `entry.keys.filter(k => k.trim()).length > 0`:

```ts
// Before (always includes keys):
sections.push(`## ${entry.name}\n**Keys:** ${entry.keys.join(', ')}\n\n${entry.content}`)

// After (skip keys when empty):
const keysLine = entry.keys.filter(k => k.trim()).length > 0
  ? `**Keys:** ${entry.keys.join(', ')}\n\n`
  : ''
sections.push(`## ${entry.name}\n${keysLine}${entry.content}`)
```

## Task 4: Change lore scope from story to series

**File:** `reader-src/src/components/ImportCharacterCardPage.vue`

In `putLore()` (~lines 388-406) and the preflight logic:

- Change character PUT URL to:
  ```ts
  `/api/lore/series/${encodeURIComponent(series)}/character/${encodeURIComponent(characterFilename)}`
  ```
- Change world_info PUT URL to:
  ```ts
  `/api/lore/series/${encodeURIComponent(series)}/${encodeURIComponent(worldInfoFilename)}`
  ```
- Update corresponding preflight GETs to use the same series-scope paths

**Important:** Encode each path segment individually. The `character/` prefix is a literal path segment, NOT part of the filename. Do NOT pass `character/hero.md` as a single `encodeURIComponent()` call.

The filename validation (`validateLoreFilename`) validates only the basename (e.g. `hero.md`). The `character/` prefix is added during URL construction only.

Keep `storyName` for the `POST /init` call (story still needs to exist for final navigation).

## Task 5: Change world_info defaults and auto-derivation

**File:** `reader-src/src/components/ImportCharacterCardPage.vue`

- Pre-fill 世界典籍名稱 (`worldInfoName`) from `parsed.bookName` (empty if absent)
- Derive 世界典籍檔案名稱 (`worldInfoFilename`) from worldInfoName using the same slug logic as character filename, with fallback to `world_info.md` if derivation is empty
- Remove the hardcoded `"世界典籍"` default
- Add auto-derivation: if user has NOT manually edited `worldInfoFilename`, it re-derives from `worldInfoName` on change. Track manual edit with a boolean flag (`worldInfoFilenameManuallyEdited`), reset on new card parse.

## Task 6: Restructure UI with fieldset.group sections

**File:** `reader-src/src/components/ImportCharacterCardPage.vue`

Wrap UI elements in `<fieldset class="group">` with `<legend>`:

1. 檔案選擇 — existing dropzone + file input
2. 角色資料 — all character fields + 角色檔案名稱 (moved here from story section)
3. 故事位置 — series name, story name (only these two)
4. 世界典籍 — world_info name, world_info filename, book entries collapsibles

Show only 檔案選擇 when no card is loaded; show all sections after parse.

## Task 7: Add .themed-btn base styles

**File:** `reader-src/src/styles/base.css`

Add before the existing `.themed-btn:hover` rule (~line 202):

```css
.themed-btn {
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 8px 16px;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
}
```

## Task 8: Style the file input as a button trigger

**File:** `reader-src/src/components/ImportCharacterCardPage.vue` (scoped style)

- Visually hide `<input type="file">` (opacity: 0, position: absolute, pointer-events: none)
- Add a `<label class="file-trigger">` styled as a button (border, padding, hover state)
- Add instructional text in the dropzone area ("拖放 PNG 角色卡到此處，或")

## Task 9: Verify with existing tests

Run `deno task test` to ensure no existing tests break. If `character-card-parser` has unit tests, verify the name fallback chain works with the test fixtures.

## Task 10: Build and smoke-test

Run `scripts/podman-build-run.sh`, navigate to the import tool at `http://localhost:8080/tools/import-character-card`, and test with `tmp/高橋 玲奈.png`:

- Entry names should show "悠奈", "[initvar]", etc. (not "(unnamed)")
- World_info name should pre-fill with "悠奈"
- No empty **Keys:** lines for entries with no keys
- File saves to series scope (verify in filesystem)
- Buttons are visible without hovering
- File input looks like a styled widget
