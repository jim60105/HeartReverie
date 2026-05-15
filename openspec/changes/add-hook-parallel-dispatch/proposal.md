## Why

目前 `HookDispatcher.dispatch`（`writer/lib/hooks.ts`）對同一個 stage 內所有 handler 一律以 `for + await` 序列執行；對網路 / 磁碟 I/O 為主的 handler（`sd-webui-image-gen` 的 `post-response` HTTP 呼叫、`state` 的 YAML 重播寫檔）這代表「總 wall time = sum(個別)」，外掛數量越多越線性放大。在 `executeChat()` 的關鍵路徑（`writer/lib/chat-shared.ts` L700+）已被量測出單請求 post-response 動輒 1 秒以上。

同時，引擎欠缺一個**可審查、契約化**的「並行安全」表達方式：plugin 作者今日無法在 manifest 中宣告「我的 handler 不寫 context」，dispatcher 也沒有結構化的 dispatch 指標可供觀察。`/api/_debug` 系列只覆蓋既有狀態，沒有 hook timing；A8 prompt-debugger 的上游因此一直懸而未決。

本提案以「**選擇性並行分派 + Track B read-only 預設並行 + 內建可觀測性**」一次性解決上述瓶頸，同時嚴格保留現有 `pre-write` mutator 與錯誤隔離語意。

## What Changes

- **新能力 `hook-parallel-dispatch`**：定義 backend `HookDispatcher` 的 two-bucket（serial-first → parallel）分派演算法、`Promise.allSettled` 失敗隔離、`PARALLEL_ALLOWED = {prompt-assembly, post-response, response-stream}` 的 stage allowlist、`readOnly:true` 契約、`response-stream` 的 allow_with_readOnly + per-chunk fan-out + 無 back-pressure、滑動平均 wall-time soft warn、`concurrency` cap、`dependsOn` 跨 plugin DAG、Track B「`readOnly:true` 預設視為 parallel（可顯式 `parallel:false` opt out）」、`/api/_debug/hooks` aggregate + `/api/_debug/hooks/stream` SSE payload 契約。
- **修改 `plugin-hooks`**：新增「Parallel hook dispatch」requirement，涵蓋上列分派/錯誤/可觀測性所有 scenarios；保留現有「single handler failure SHALL NOT prevent others」契約並擴充 log payload 加入 `dispatchPhase: "serial" | "parallel"`；明示 priority 語意變化（parallel handler 一律後於所有 serial handler 啟動，與 priority 數值無關）；明示 v1 僅後端（`FrontendHookDispatcher` 不動）。
- **修改 `plugin-core`**：擴充 manifest `hooks[]` 條目欄位 — `parallel?: boolean`、`readOnly?: boolean`、`concurrency?: integer >=1`、`dependsOn?: string[]`，並在 JSON schema 片段中嚴格限定 `stage` enum 為 `{prompt-assembly, post-response, response-stream}`（任何 frontend stage 名稱或 `pre-write` / `strip-tags` 都會被 schema 拒絕）；新增 `hooks.register()` 的 options-object overload（`register(stage, handler, priorityOrOptions: number | { priority?; parallel?; readOnly?; dependsOn? })`）與 per-handler 覆蓋語意；保留既有 `reads/writes/note` 欄位與「declared ↔ registered consistency」檢查不變。
- **BREAKING（行為）— Track B 預設並行**：任何 `hooks[]` 條目顯式宣告 `readOnly: true` 且未顯式宣告 `parallel`，dispatcher 將之視為 `parallel: true`。**未宣告 `hooks[]` 的 plugin 完全不受影響**（零 breakage）。Release note 需以最高層級標示，並列出既有 plugin 的逐一影響（§8.2 of source design：v1 不修改任何 plugin manifest，僅提供能力）。
- **BREAKING（行為）— priority 語意**：`parallel:true` 的 handler 一律於所有 serial handler 之後啟動，priority 僅作為「同 bucket 內」的排序鍵。manifest validator 在 `parallel:true && priority<100` 時 `log.warn` 提醒作者勿期望搶先執行。
- **新端點**：`GET /api/_debug/hooks`（最近 N=200 次 dispatch 的 per-stage 平均/p50/p95、per-plugin 累計時間 aggregate）與 `GET /api/_debug/hooks/stream`（SSE，每次 dispatch 完成即時推送 `{ stage, dispatchPhase, durationMs, serialCount, parallelCount, plugins[] }`），皆掛於既有 `X-Passphrase` middleware；指定為 A8 prompt-debugger 的 canonical 上游消費者，payload shape 於 spec 鎖定。

## Capabilities

### New Capabilities

- `hook-parallel-dispatch`：定義 backend `HookDispatcher` 的 two-bucket 並行分派演算法、context view 雙路徑（serial 共用 base / parallel 走 Proxy）、`PARALLEL_ALLOWED` allowlist、`readOnly:true` 契約、`response-stream` allow_with_readOnly + per-chunk 無 back-pressure + 5ms 滑動平均 soft warn、`concurrency` cap、`dependsOn` 跨 plugin DAG（cycle / unknown name reject）、Track B default-on、`Promise.allSettled` 失敗隔離與 `dispatchPhase` 標記、`/api/_debug/hooks` aggregate + `/api/_debug/hooks/stream` SSE 的 payload 與授權契約。

### Modified Capabilities

- `plugin-hooks`：新增 Requirement「Parallel hook dispatch (opt-in + readOnly default-on, backend-only)」，涵蓋 serial-first ordering、priority 語意變化、`Promise.allSettled` 錯誤隔離與 `dispatchPhase` 標記、stage allowlist、`response-stream` per-chunk 並行 + 5ms soft warn、Track B 預設並行 + 顯式 `parallel:false` opt out、`context.logger` 的 Proxy view 隔離、`concurrency` cap 行為、`dependsOn` DAG、debug endpoint payload 契約，並明示 v1 僅後端。
- `plugin-core`：擴充「Plugin manifest format」與 `hooks[]` JSON schema 片段加入 `parallel` / `readOnly` / `concurrency` / `dependsOn` 欄位、Frontend stage 排除註記、`response-stream + parallel:true` 必須伴 `readOnly:true`（否則 reject）的條件式校驗、`register()` options-object overload 簽章與 per-handler 覆蓋語意。

## Impact

- **Backend（`writer/lib/hooks.ts`）**：重寫 `dispatch()` 主迴圈為 two-bucket（serial-first），新增 `#runSerial` / `#runParallel` 雙路徑、Proxy-based per-handler logger view、`Promise.allSettled` 收結與 `dispatchPhase` 標記、stage 層級 `concurrency` chunk、`dependsOn` 同 stage 拓樸排序、`response-stream` per-chunk fan-out 與滑動平均監控、ring buffer 紀錄最近 N=200 次 dispatch。`HookDispatcher.register` 新增 `number | RegisterOptions` overload；舊 `register(stage, handler, priority)` 維持為 thin shim（0 行為差異）。估 ~280 LOC。
- **Backend（`writer/lib/plugin-manager.ts` + `writer/types.ts`）**：擴充 `HookDeclaration` 介面、JSON schema 片段、manifest validator（stage allowlist coerce、`readOnly` 缺失 coerce、`response-stream + parallel:true + readOnly!==true` reject（非 coerce）、`concurrency` 非正整數 coerce + warn、`priority<100` 警告、Track B `readOnly:true && parallel===undefined → parallel=true`、全局 `dependsOn` DAG 載入後 cycle / unknown name reject）。約 ~120 LOC。
- **Backend routes（新）**：`writer/routes/_debug-hooks.ts` 兩個 handler（aggregate + SSE），均通過 `X-Passphrase` middleware；payload shape 與 ring buffer 由 `hooks.ts` 直接餵入。
- **Frontend**：**完全不動**。`FrontendHookDispatcher`、`reader-src/` 與所有 frontend stage 行為與今日 100% 一致。Spec 文字明示「parallel dispatch is backend-only in v1」。
- **Plugins**：v1 **不修改任何 plugin manifest**。能力僅作為提供；plugin 作者後續可依 `docs/plugin-system.md` 的 parallel-safe 判準逐一升級。`HeartReverie_Plugins/state` 與 `HeartReverie_Plugins/sd-webui-image-gen` 為高 ROI 候選但須由各自 repo 在獨立 PR 標註。
- **Tests**：擴充 `tests/writer/lib/hooks_test.ts`、新增 `tests/writer/lib/hooks_bench.ts`（Deno.bench sanity check）、新增 `tests/writer/routes/_debug-hooks_test.ts`（aggregate + SSE 連線）、新增 `tests/fixtures/plugins/parallel-bench/`、`tests/fixtures/plugins/serial-mutator-fixture/`（mimic `user-message` 的 `preContent` 回歸守護）。預估 ~350 LOC tests。
- **Docs**：`docs/plugin-system.md` 新增「Parallel dispatch model」章節、`hooks[]` 範例含 `concurrency` / `dependsOn`、Track B release-note 級遷移注意事項、priority 語意變化、`register()` options-object overload 教學；`HeartReverie/AGENTS.md` 補 parallel 規範摘要；`.agents/skills/heartreverie-create-plugin/references/manifest-schema.md` 將 `hooks[]` 加入 keyword list。
- **Podman 整合驗證**：`scripts/podman-build-run.sh` build + run，`podman logs` 以**白名單**過濾預期的 validator warn（allowlist coerce、readOnly coerce、response-stream reject、priority<100 提示）；`curl` 觸發 `/api/chat` 與 `/api/_debug/hooks*` 驗證 dispatch 分桶與 SSE 推送。
- **依賴**：零新增 npm / Deno 第三方相依；`Promise.allSettled`、`Proxy`、`performance.now` 皆為平台內建。
