## 1. Pre-flight

- [ ] 1.1 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- writer/lib/chat-shared.ts writer/routes/prompt.ts`; compare the live `readTemplate` against the documented excerpt. On any mismatch, STOP and report.
- [ ] 1.2 Sweep all importers: `grep -rn "readTemplate" writer/ tests/ scripts/ --include="*.ts"`. Confirm the set is within `writer/` and `tests/` (expect `chat-shared.ts`, `routes/prompt.ts`, possibly tests). If an importer lives outside `writer/`/`tests/` and relies on the routes path in a way a re-export cannot cover, STOP and report.
- [ ] 1.3 Confirm the sole layering violation exists: `grep -rn 'from "../routes/' writer/lib/` returns the `chat-shared.ts` → `routes/prompt.ts` import.

## 2. Move the function to lib

- [ ] 2.1 Create `writer/lib/prompt-file.ts` with the AGPL-3.0-or-later header (copy the standard 15-line header from any lib file), the `join` import from `@std/path`, and the `readTemplate` function moved **verbatim** (signature, body, JSDoc, explicit return type unchanged).
- [ ] 2.2 Verify the new module type-checks: `deno check writer/lib/prompt-file.ts` → exit 0.

## 3. Re-export and update importers

- [ ] 3.1 In `writer/routes/prompt.ts`: delete the `readTemplate` function body and add `export { readTemplate } from "../lib/prompt-file.ts";` near the top. Leave the prompt GET/PUT route handlers calling `readTemplate` via the re-export (no other edits).
- [ ] 3.2 In `writer/lib/chat-shared.ts`: change the import to `import { readTemplate } from "./prompt-file.ts";`.
- [ ] 3.3 Update any test imports found in task 1.2 to point at `writer/lib/prompt-file.ts` (optional for correctness — covered by the re-export — but preferred for clarity).
- [ ] 3.4 Verify the layering violation is gone: `grep -rn 'from "../routes/' writer/lib/` → no matches.

## 4. Verification gates

- [ ] 4.1 `deno check writer/server.ts` → exit 0.
- [ ] 4.2 `deno task test:backend` → all pass (existing prompt-route + chat tests are the regression net; no new tests).
- [ ] 4.3 `deno task fmt` → exit 0.
- [ ] 4.4 `deno task lint` → exit 0.
- [ ] 4.5 Confirm no files outside the in-scope list were modified: `git status` shows only `writer/lib/prompt-file.ts` (new), `writer/routes/prompt.ts`, `writer/lib/chat-shared.ts`, and any updated test files.

## 5. Done criteria

- [ ] 5.1 `grep -rn 'from "../routes/' writer/lib/` returns no matches.
- [ ] 5.2 `writer/lib/prompt-file.ts` exists with the function + AGPL header + explicit return type.
- [ ] 5.3 `deno task test:backend` exits 0.
- [ ] 5.4 `deno task fmt` and `deno task lint` exit 0.
- [ ] 5.5 No files outside the in-scope list modified.
