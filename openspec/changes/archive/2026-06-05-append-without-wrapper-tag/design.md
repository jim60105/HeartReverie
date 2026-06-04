## Context

The plugin-action append path lives in three layers:

1. **Validation** — `writer/routes/plugin-actions-validation.ts::validateModeCombo()` requires, for `mode === "append-to-existing-chapter"`, that `appendTag` be a string matching `APPEND_TAG_RE` (`^[a-zA-Z][a-zA-Z0-9_-]{0,30}$`). Anything else (including `undefined`) currently fails with `plugin-action:invalid-append-tag`.
2. **Write mode** — `writer/lib/chat-types.ts` models append as `{ kind: "append-to-existing-chapter"; appendTag: string; pluginName: string }`.
3. **Finalisation** — `writer/lib/chat-chapter-finalize.ts::finalizeAppendToExisting()` calls `normaliseAppendContent(aiContent, appendTag)` (strips ≤1 outer `<{appendTag}>` layer) and then unconditionally wraps the result: `const wrapped = \`\n<${appendTag}>\n${normalised}\n</${appendTag}>\n\``. The `post-response` payload carries `appendedTag: appendTag`. This is the ONLY site that sets `appendedTag`; `finalizeWriteNewChapter`, `finalizeReplace`, `finalizeContinueLastChapter`, and discard all OMIT the field.

**Important type fact (verified):** `PostResponsePayload.appendedTag` is declared `readonly appendedTag?: string` in `writer/types/hooks.ts` — optional `string`, **NOT** `string | null`. It is omitted (never `null`) for non-append modes. By contrast, the *result/envelope/frontend* types (`PluginRunPromptResponse.appendedTag` in `writer/types/plugin.ts`, the WS `plugin-action:done` `appendedTag` in `writer/types/ws.ts`, and the frontend `RunPluginPromptOptions`/result types) are ALREADY `string | null`. So setting `appendedTag: null` on the hook payload requires widening the hook payload type — it is not already nullable there.

Both transports converge on `runPluginActionWithDeps` (`writer/routes/plugin-actions.ts`): the HTTP route (`plugin-actions-preflight.ts` → `plugin-actions-execute.ts`) and the WebSocket handler (`ws-plugin-action.ts`, which passes `msg.appendTag` straight through, so `undefined` already survives to validation). The frontend `useChatApi.ts::runPluginPrompt` already spreads `appendTag` only when `opts.appendTag !== undefined`, and `RunPluginPromptOptions.appendTag` is already typed optional.

So the *only* hard blocker for "append without a wrapper tag" is the server-side validation rule plus the unconditional wrap in finalisation. This is the minimal seam to change.

## Goals / Non-Goals

**Goals:**

- Allow `append: true` with no `appendTag` (omitted/`undefined`) to append the model output verbatim — no synthetic wrapper element.
- Preserve every existing behaviour for callers that DO pass `appendTag`, byte-for-byte (same single-outer-strip normalisation, same `<{tag}>…</{tag}>` wrapping, same `appendedTag` echo).
- Keep the contract coherent: present-but-invalid `appendTag` still rejected; `replace` + `appendTag` still rejected.
- Surface the tagless result consistently across HTTP and WebSocket (`chapterUpdated: true`, `appendedTag: null`).

**Non-Goals:**

- No change to `replace` or `discard` modes' runtime behaviour.
- No new HTTP error slug (the new combination becomes *valid*, it does not need its own error).
- No change to how `sd-webui-image-gen` (or any plugin) parses chapters — that is the sibling `HeartReverie_Plugins` change.
- No migration of existing chapter `.md` files (0 users; nothing on disk to migrate).

The `post-response` payload type *does* change (`appendedTag` widens to `string | null`) — this is an in-scope, deliberate type widening, not a non-goal. See D5.

## Decisions

### D1: Make `appendTag` nullable end-to-end rather than introducing a separate "raw-append" mode

**Choice:** Keep a single `append-to-existing-chapter` write mode and widen its `appendTag` field to `string | null`. `null` means "append without wrapper".

**Why:** The two behaviours differ only in the final wrap step; everything else (lock, render, stream, re-read chapter, `post-response`, usage) is identical. A `null` sentinel on the existing mode is far less surface area than a parallel `append-raw` write mode and avoids duplicating the finalisation branch's lock/usage/dispatch ordering, which the codebase deliberately centralises.

**Alternatives considered:**
- *New `WriteMode` variant `{ kind: "append-raw-to-existing-chapter" }`* — rejected: duplicates the whole finalizer and the route's mode-selection switch for one differing line.
- *Sentinel empty-string `appendTag: ""`* — rejected: `""` is falsy and ambiguous with "caller forgot the tag"; `null` is explicit and matches how `validateModeCombo` already returns `appendTag: null` for non-append modes.

### D2: Validation distinguishes "absent" from "present-but-invalid"

**Choice:** In `validateModeCombo`, for append mode:
- `appendTag === undefined` (field omitted) → valid, resolve to `appendTag: null` (tagless append).
- `appendTag` is a string matching `APPEND_TAG_RE` → valid, resolve to that string.
- anything else — including a non-string value, a string failing the regex, the empty string `""`, AND an explicit JSON `null` → `plugin-action:invalid-append-tag`.

**Why:** "Omit the field entirely to opt into raw append" is an unambiguous, discoverable contract. Passing a *malformed* tag is still almost certainly a bug and should keep failing loudly. **Explicit `null` is rejected, not treated as tagless.** An explicit JSON `null` arrives at validation as `null` (a non-string non-`undefined` value), so it lands in the "anything else" bucket. This keeps the contract symmetric across modes: `replace` mode already rejects any non-`undefined` `appendTag` (including `null`) under `invalid-replace-combo`, so in BOTH modes the only way to opt out of a tag is to omit the field. The frontend always omits the key (it never emits `null`), so real clients pay nothing; and a hand-written client that sends `appendTag: null` uniformly gets a consistent 400 instead of tagless-append in one mode and a rejection in the other. The validator therefore special-cases ONLY `appendTag === undefined`.

### D3: Tagless normalisation is trim-only

**Choice:** When `appendTag` is `null`, finalisation appends `\n${aiContent.trim()}\n`. It does NOT run `normaliseAppendContent` (there is no tag to strip), so any `<image>` blocks the model emitted are preserved exactly.

**Why:** The whole point is that the prompt owns its tag structure. Stripping or rewriting anything would re-introduce the class of bug this change fixes. `normaliseAppendContent` stays in place and is invoked only on the tagged branch.

### D4: Finalisation branch

`finalizeAppendToExisting` becomes:

```ts
const normalised = appendTag === null
  ? aiContent.trim()
  : normaliseAppendContent(aiContent, appendTag);
const wrapped = appendTag === null
  ? `\n${normalised}\n`
  : `\n<${appendTag}>\n${normalised}\n</${appendTag}>\n`;
// …atomic append, re-read…
// post-response base: appendedTag: appendTag   // appendTag is string | null after D5
```

The `post-response` payload field `appendedTag` is set to the (possibly `null`) `appendTag`, and the route result / `plugin-action:done` envelope mirror it. `chapterUpdated` stays `true` whenever an append actually happened.

### D5: Widen the `post-response` hook payload `appendedTag` to `string | null`

**Choice:** Change `PostResponsePayload.appendedTag` in `writer/types/hooks.ts` from `readonly appendedTag?: string` to `readonly appendedTag?: string | null`, and update its JSDoc + the `plugin-hooks` spec to state it is `null` for a tagless plugin-action append (and omitted for chat / write-new / replace / discard).

**Why:** D4 assigns `appendTag` (now `string | null`) into the payload's `appendedTag`. The current `?: string` type rejects `null` under `strictNullChecks`, so the finalizer would not compile without this widening. Keeping it OPTIONAL (`?:`) AND nullable means the four other dispatch sites that omit the field keep compiling unchanged. The sibling result/envelope/frontend types are already `string | null`, so this aligns the hook payload with them rather than introducing a new shape.

**Alternatives considered:**
- *Make `finalizeAppendToExisting` omit `appendedTag` when tagless instead of setting `null`* — rejected: the result/envelope/frontend layers already commit to `appendedTag: null` for non-tag cases (e.g. the existing replace scenario asserts `appendedTag: null`), so emitting `null` on the hook payload too keeps all four surfaces consistent and lets a `post-response` consumer distinguish "tagged append" (string) from "tagless append" (`null`) without re-reading the chapter. (As a cleanup, also reconcile the existing `plugin-hooks` spec/scenarios that say replace/write-new *omit* `appendedTag` while `plugin-action-buttons` replace scenarios assert `appendedTag: null` — pick "omit for replace/write-new/chat, `null` only for tagless append" as the single convention and make the spec say exactly that.)

## Risks / Trade-offs

- **[Ambiguity: did the caller mean to omit the tag, or forget it?]** → Mitigated by D2: a *malformed* tag still errors; only total omission opts in. Documented in the skill + action-buttons doc so the opt-in is intentional, not accidental.
- **[Two append shapes on disk now exist (wrapped vs. raw)]** → Acceptable and intended. `post-response` consumers already see full re-read chapter content; the only observable difference is the absence of the synthetic wrapper, which is the desired outcome. Plugins that need a tag keep passing one.
- **[`post-response` consumers that read `appendedTag`]** → Per D5 the hook payload field widens from `?: string` to `?: string | null`. Well-typed in-repo consumers already treat it as optional; the new `null` value only appears on the tagless append path. The change is type-checked across all five dispatch sites as part of the implementation. Call this out in the `plugin-hooks` spec scenario so reviewers verify there is no consumer doing unconditional string ops on `appendedTag`.
- **[Empty model output → empty append]** → `aiContent.trim()` could be `""`, yielding an appended `"\n\n"`. This already exists for the tagged path (an empty wrapper). No regression; not worth special-casing for a 0-user pre-release engine.

## Migration Plan

No data migration. Deploy is a pure code change with new tests. Rollback = revert the commit; existing tagged-append callers are unaffected at every step, and no on-disk format changed for them. The sibling `HeartReverie_Plugins` change (sd-webui button → tagless append) MUST be deployed only after this core change is live, per workspace cross-repo sequencing.

## Open Questions

- _None._ The contract, validation table, and finalisation branch are fully specified above.
