<!-- ===== RELEASE NOTE — BREAKING CHANGES (hook-parallel-dispatch v1) =====

## Breaking Changes

1. **Track B: `readOnly:true` entries are now parallel by default**
   - Any `hooks[]` entry with `readOnly: true` and no explicit `parallel` field
     is treated as `parallel: true`.
   - Opt out: add `"parallel": false` to the entry.
   - Plugins that do NOT declare `hooks[]` are completely unaffected.

2. **Priority semantics change: parallel handlers run AFTER all serial handlers**
   - `parallel:true` handlers always execute after every serial handler finishes,
     regardless of their `priority` value.
   - Priority is only the sort key within the serial bucket and within the
     parallel bucket, but never crosses between buckets.
   - Manifest validator warns on `parallel:true && priority < 100`.

3. **`hooks[]` stage enum restricted to PARALLEL_ALLOWED only**
   - Only `prompt-assembly`, `post-response`, and `response-stream` are accepted.
   - `pre-write` and `strip-tags` are always serial (not declarable in `hooks[]`).
   - All frontend stage names are rejected by the schema.
   - `response-stream` with `parallel:true` REQUIRES `readOnly:true`; missing
     `readOnly` causes the entry to be rejected (log.error), not coerced.

===== END RELEASE NOTE ===== -->

# Implementation Tasks

## 1. 型別與 manifest schema

- [x] 1.1 在 `writer/types.ts` 擴充 `HookDeclaration`（即 `PluginHookDeclaration`）新增 `parallel?: boolean`、`readOnly?: boolean`、`concurrency?: number`、`dependsOn?: readonly string[]` 欄位；export `BackendHookStage`、`PARALLEL_ALLOWED` 常數。
- [x] 1.2 同檔擴充 `HandlerEntry` 介面新增 `parallel?: boolean`、`readOnly?: boolean`、`concurrency?: number`、`dependsOn?: readonly string[]`；新增 `RegisterOptions` 型別並更新 `HookRegister` 的第三參型別為 `number | RegisterOptions`。
- [x] 1.3 在 `writer/lib/hooks.ts` 匯出 `PARALLEL_ALLOWED = new Set(["prompt-assembly","post-response","response-stream"])` 並讓 `HookDispatcher` 引用之；同步加入 `HOOK_DEBUG = Deno.env.get("HOOK_DEBUG") === "1"` 常數。

## 2. Manifest validator（`writer/lib/plugin-manager.ts`）

- [x] 2.1 擴充 `hooks[]` JSON schema 片段：加入 `parallel` / `readOnly` / `concurrency` / `dependsOn` 屬性，以及 `allOf` 中的 `if parallel===true then stage ∈ PARALLEL_ALLOWED` 條件。
- [x] 2.2 實作 stage allowlist coercion：當 `parallel:true` 但 `stage ∉ PARALLEL_ALLOWED` → 設 `parallel:false`，`log.warn` 含 `parallel:true is only allowed for stages in PARALLEL_ALLOWED`。
- [x] 2.3 實作 readOnly coercion（prompt-assembly + post-response）：當 `parallel:true` 但 `readOnly !== true` → 設 `parallel:false`，`log.warn` 含 `parallel:true requires readOnly:true`。
- [x] 2.4 實作 response-stream **reject**：當 `stage === "response-stream" && parallel === true && readOnly !== true` → `log.error` 含 `response-stream + parallel:true requires readOnly:true`，drop `parallel`（仍載入 plugin）。
- [x] 2.5 實作 Track B coercion：當 `readOnly === true && parallel === undefined` → 設 `parallel: true`，`log.debug`（不 warn）。
- [x] 2.6 實作 priority warn：當 `parallel:true && typeof priority === "number" && priority < 100` → `log.warn` 含 `parallel handlers run after all serial handlers regardless of priority`。
- [x] 2.7 實作 concurrency coercion：非整數或 `<1` → 設 `undefined`，`log.warn` 帶 plugin/stage/rejected value。
- [x] 2.8 實作全域 `dependsOn` DAG 校驗：在所有 plugin 載入完成後（既有 `finalizeBoot` 或等價的 collection point）對每個 stage 各自建 `(plugin) → dependsOn[]` 圖；偵測 cycle 或 unknown name → `log.error` 並 drop 該 declaration 的 `dependsOn`（保留 `parallel` / `readOnly`）。fallback：dispatcher 對該 stage parallel bucket 走 priority-only 排序。
- [x] 2.9 把 manifest entry 的 `parallel` / `readOnly` / `concurrency` / `dependsOn` 經 wrapper 傳給 `HookDispatcher.register()`（透過新增的 options object overload）。
- [x] 2.10 確保 v1 不影響既有 `reads/writes/note/priority/duplicate stage/strip-tags reject/unknown-stage warn` 行為（既有 scenarios 仍綠）。

## 3. `HookDispatcher` 改寫（`writer/lib/hooks.ts`）

- [x] 3.1 `register()` 新增 options-object overload：第三參接受 `number | RegisterOptions`；number 走 thin shim（純等於 `{priority}`），object 走 per-handler 覆蓋並執行 §2 同款 allowlist + readOnly 校驗（違反者 coerce / reject 並 log）。`HandlerEntry` 落地 `parallel/readOnly/concurrency/dependsOn`。
- [x] 3.2 重寫 `dispatch(stage, ctx)` 主迴圈為 two-bucket：split serial/parallel；serial pass 依 priority-asc 共用 base context；parallel pass 在 serial 完成後啟動。
- [x] 3.3 抽出 `#runSerial(entry, ctx, correlationId)`：`ctx.logger = deriveLogger(entry, correlationId)` 就地 mutate（無 race），`try/catch` log.error 帶 `dispatchPhase: "serial"` 並 `entry.errorCount++`。
- [x] 3.4 抽出 `#runParallel(entry, ctx, correlationId)`：建 `new Proxy(ctx, { get, set })`，`get("logger")` → per-handler logger，其他 `get` 透傳；`set("logger", _)` no-op true，其餘 `set` 在 `HOOK_DEBUG` 下 `log.warn` 帶 `{ plugin, stage, mutatedKey, dispatchPhase: "parallel" }`，production 下 pass-through。`Reflect.set` 仍呼叫以保留失敗模式為「race」而非 crash。
- [x] 3.5 parallel bucket 啟動前：依 §2.8 校驗成功的 `dependsOn` 對該 bucket 做拓樸排序；同一層內保持 priority-asc 為次序鍵。對 cycle/unknown 已 drop 的 stage 直接用 priority-asc。
- [x] 3.6 parallel bucket 用 `Promise.allSettled` 收結；若有效 `concurrency` 為 `Math.min(...declared)` 之整數，把 bucket 切成 size `N` 的 chunks 依序 `await Promise.allSettled(chunk)`；任一 entry 未設 → 視為 unbounded（單一 `Promise.allSettled` 全展開）。
- [x] 3.7 parallel settle 後逐筆檢查 `rejected`：`log.error` 帶 `{ stage, plugin, dispatchPhase: "parallel", error: { message, stack } }`、`entry.errorCount++`，不 rethrow。
- [x] 3.8 `response-stream` 特例：dispatch 內部判斷 stage，parallel bucket 走 per-chunk `Promise.allSettled`（每次 dispatch 為單一 chunk fan-out），**不**對下一 chunk 形成 back-pressure（呼叫端持續 forward stream 不受阻）。
- [x] 3.9 per-handler 維護 `response-stream` 滑動視窗（最近 N=50 chunks 的 wall-time）；avg 超過 5ms 發 `log.warn { plugin, stage, avgMs, samples }`，並 debounce 直到下一次「crossing」事件再次觸發。
- [x] 3.10 加入 dispatch metrics ring buffer（容量 N=200）：每次 `dispatch()` 結束 push `{ stage, dispatchPhase: "serial"|"parallel"|"mixed", durationMs, serialCount, parallelCount, plugins[] }`；`dispatchPhase` 為「mixed」當 serial 與 parallel bucket 都非空，否則為對應的單一 phase。同步 emit 到 SSE subscriber 集合。
- [x] 3.11 確保未宣告 `hooks[]`、`parallel` 全 false 的 stage 走「empty parallel bucket」分支 → 不建 Proxy、不呼叫 `Promise.allSettled`、與舊實作 byte-identical。

## 4. Debug endpoints（`writer/routes/_debug-hooks.ts`，新檔）

- [x] 4.1 新建 `writer/routes/_debug-hooks.ts`；export `registerDebugHookRoutes(app: Hono, dispatcher: HookDispatcher)`，掛入既有 `X-Passphrase` middleware 之後。
- [x] 4.2 實作 `GET /api/_debug/hooks`：讀取 dispatcher ring buffer，計算 per-stage `{count, avgMs, p50Ms, p95Ms, serialCount, parallelCount}` 與 per-plugin `{cumulativeMs, dispatchCount, errorCount}`，回傳 `{ perStage, perPlugin, windowSize }`。
- [x] 4.3 實作 `GET /api/_debug/hooks/stream` SSE：訂閱 dispatcher emit 事件、寫出 `data: <json>\n\n`；每 30 秒寫一行 `: heartbeat\n\n`；client 斷線時清理 subscriber。
- [x] 4.4 在 server bootstrap（`writer/server.ts` 或 unified-server 入口）呼叫 `registerDebugHookRoutes`。
- [x] 4.5 Payload shape 完全比照 `hook-parallel-dispatch/spec.md` 的 Debug endpoints requirement（避免未來重做）。

## 5. Unit tests（`tests/writer/lib/hooks_test.ts`，擴充既有檔案）

- [x] 5.1 **Mixed bucket ordering**：3 serial（priority 50/100/150）+ 2 parallel handler；assert serial 完成順序 50→100→150，parallel 起始時間皆 ≥ serial-150 完成時間。
- [x] 5.2 **Priority semantics change**：serial p150 + parallel p10 → parallel 不會搶先；用 wall-clock timestamp 對齊驗證。
- [x] 5.3 **Parallel error isolation**：5 parallel handler 中 2 個 throw → 5 個 settle、`log.error` 呼叫 2 次（帶 `dispatchPhase: "parallel"`）、`errorCount` 對應 +1、`dispatch` 不 throw。
- [x] 5.4 **Serial mutator regression**：fixture 模擬 `user-message` 寫 `context.preContent = "<user_message>x</user_message>"`；assert `dispatch` 回傳的 context 與呼叫端持有的 reference 相同且 `preContent` 為該值。
- [x] 5.5 **Logger isolation（parallel）**：兩個 parallel handler 同時讀 `context.logger`；spy 兩者拿到的 logger 攜帶各自 plugin name；對 `context.logger = ...` 的寫嘗試 assert base context 未被改。
- [x] 5.6 **Allowlist enforcement（manifest）**：(a) `pre-write parallel:true readOnly:true` → coerce + warn；(b) `post-response parallel:true readOnly:false` → coerce + warn；(c) `post-response parallel:true readOnly:true` → 保留 parallel。
- [x] 5.7 **`response-stream` allow_with_readOnly**：(a) `parallel:true readOnly:true` → 接受並 per-chunk fan-out；(b) `parallel:true` 缺 `readOnly` → validator log.error + drop parallel；(c) 兩個 parallel readOnly 觀察者在同一 chunk 內 timestamp 重疊；(d) 下一個 chunk dispatch 啟動時間 < 前一 chunk 的 parallel handler 完成時間（無 back-pressure）。
- [x] 5.8 **HOOK_DEBUG write detector**：set `HOOK_DEBUG=1`；parallel handler 寫 `context.foo = 1` → `log.warn` 一次帶 `{ plugin, stage, mutatedKey: "foo", dispatchPhase: "parallel" }`；dispatch 仍成功。
- [x] 5.9 **No-manifest backward-compat snapshot**：未宣告 `hooks[]` 的 fixture plugin → 全 serial；用 snapshot 比對 dispatch 順序與 context 內容與 baseline 完全一致。
- [x] 5.10 **`concurrency` cap**：(a) `concurrency:1` 把 4 parallel 切成 4 sequential chunks（wall-time ≈ 4×handler）；(b) `concurrency:2` 把 4 parallel 切成 2 chunks（wall-time ≈ 2×handler）；(c) 多 entry 不同 `concurrency` → 取 min；(d) 任一 entry 未設 → unbounded。
- [x] 5.11 **`concurrency` coercion**：`concurrency: 0 / -1 / 1.5 / "two"` → 各自 coerce 為 undefined + `log.warn` 帶被拒絕值。
- [x] 5.12 **`dependsOn` topo order**：plugin `a` dependsOn `["b"]` + plugin `b` → b 先完成才 a 啟動。
- [x] 5.13 **`dependsOn` cycle reject**：a→b、b→a → `log.error`、雙方 dependsOn drop、parallel bucket 退回 priority-asc。
- [x] 5.14 **`dependsOn` unknown reject**：a dependsOn `["ghost"]` → `log.error` 帶兩個名字、a 的 dependsOn drop、parallel/readOnly 保留。
- [x] 5.15 **Track B default-on**：(a) `readOnly:true` 無 `parallel` → 視為 parallel；(b) `readOnly:true parallel:false` → serial（顯式 opt out）；(c) `readOnly:false` → serial（未宣告 readOnly）。
- [x] 5.16 **Priority<100 warn**：`parallel:true priority:50` → manifest validator `log.warn` 帶 priority 訊息，entry 仍 parallel。
- [x] 5.17 **`register()` overload**：(a) `register(stage, h, 50)` 與 `register(stage, h, { priority: 50 })` 行為等價（同 priority、同 bucket）；(b) `register(stage, h, { parallel: false })` 覆蓋 manifest Track B 預設 → serial；(c) `register(stage, h, { dependsOn: ["c"] })` 與 manifest `dependsOn: ["b"]` union 為 `{"b","c"}`；(d) `register("pre-write", h, { parallel: true, readOnly: true })` → coerce + warn；(e) `register("response-stream", h, { parallel: true })` → reject + log.error + 落為 serial。
- [x] 5.18 **Microbenchmark sanity**：`tests/writer/lib/hooks_bench.ts` 用 `Deno.bench` 跑「20 × 50ms serial」vs「20 × 50ms parallel」，斷言 parallel < serial / 2（寬鬆門檻避免 Podman flake）。
- [x] 5.19 **`response-stream` 5ms soft warn**：fixture handler `setTimeout 10ms` 跑 51 個 chunk → 一次 `log.warn` 帶 `{ avgMs >= 5, samples: 50 }`；連續再跑不再 warn（debounce 至下一 crossing）。

## 6. Integration / fixture tests

- [x] 6.1 新增 `tests/fixtures/plugins/parallel-bench/`（一個 readOnly post-response handler，含 manifest `hooks[]`），用於端到端整合測試。
- [x] 6.2 新增 `tests/fixtures/plugins/serial-mutator-fixture/`（mimic `user-message`，寫 `context.preContent`），用於守護 §5.4 等價性。
- [x] 6.3 跑既有 `tests/writer/lib/plugin-manager_test.ts`、`tests/writer/lib/chat-shared*.ts`、`tests/writer/lib/story_test.ts` 確認 0 regression。
- [x] 6.4 新增 `tests/writer/routes/_debug-hooks_test.ts`：(a) `GET /api/_debug/hooks` 缺 X-Passphrase → 401/403；(b) 含 passphrase → 200 + payload shape 比對；(c) SSE 連線後 dispatch 一次 → 收到 1 個 `data:` event 且欄位齊全；(d) idle 30+ 秒 → 收到 heartbeat 註解行。
- [x] 6.5 Pre-write 等價性整合 fixture：跑完整 `executeChat()` 路徑（HTTP `/api/chat`），assert 寫入檔案的開頭含 `<user_message>...</user_message>`。

## 7. 文件

- [x] 7.1 `HeartReverie/docs/plugin-system.md`：新增「Parallel dispatch model」章節，涵蓋 manifest `hooks[]` 範例（含 `parallel/readOnly/concurrency/dependsOn`）、parallel-safe 判準、Track B release-note 級遷移注意事項、priority 語意變化、`register()` options-object overload 教學、frontend exclusion 註記。
- [x] 7.2 `HeartReverie/AGENTS.md`：在 plugin 段落補一句摘要：「並行分派受 `PARALLEL_ALLOWED` allowlist + `readOnly:true` 契約限制；`response-stream` 須伴 readOnly 否則 reject；未宣告 `hooks[]` 完全不受影響」。
- [x] 7.3 `HeartReverie/.agents/skills/heartreverie-create-plugin/references/manifest-schema.md`：把 `hooks[]` 的 `parallel/readOnly/concurrency/dependsOn` 加入 keyword list 與 example。
- [x] 7.4 Release note 草稿：在 `tasks.md` 或 commit message 中提示「BREAKING: Track B 預設並行 for `readOnly:true` entries」、「priority 語意：parallel handler 一律後於所有 serial handler」。

## 8. Podman 整合驗證（依 root `AGENTS.md`）

- [x] 8.1 `cd HeartReverie/ && scripts/podman-build-run.sh` 啟動 container。
- [x] 8.2 `podman logs heartreverie 2>&1 | grep -iE "error|warn" | grep -vE "parallel:true is only allowed for stages in PARALLEL_ALLOWED|parallel:true requires readOnly:true|response-stream \+ parallel:true requires readOnly:true|parallel handlers run after all serial handlers regardless of priority"` — 預期空輸出（其餘 warn / error 視為失敗）。
- [x] 8.3 `curl -H "X-Passphrase: $PASSPHRASE" -X POST localhost:8080/api/chat ...` 觸發完整鏈路；觀察 log `Hook dispatch completed` 的 `serialCount` / `parallelCount` 與 `dispatchPhase` 欄位是否出現。
- [x] 8.4 `curl -H "X-Passphrase: $PASSPHRASE" localhost:8080/api/_debug/hooks` → 回傳 JSON 含 `perStage`、`perPlugin`、`windowSize`。
- [x] 8.5 `curl -N -H "X-Passphrase: $PASSPHRASE" localhost:8080/api/_debug/hooks/stream` 建立 SSE 連線，再以另一個 terminal 觸發 `/api/chat`；確認收到 `data:` event 內含 `stage`、`dispatchPhase`、`durationMs`、`serialCount`、`parallelCount`、`plugins[]`。

## 9. Final validation

- [x] 9.1 `cd HeartReverie && deno task test` — backend test suite 全綠。
- [x] 9.2 `openspec validate add-hook-parallel-dispatch --strict` 通過。
- [x] 9.3 Rubber-duck pass（orchestrator 執行）後依需修正並重跑 9.1 / 9.2。
- [x] 9.4 Commit inner repo（conventional message + Co-authored-by trailer），bump outer repo submodule。
