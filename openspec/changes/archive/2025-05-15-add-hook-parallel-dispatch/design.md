## Context

`HookDispatcher`（`writer/lib/hooks.ts`）今日對同 stage 的所有 handler 一律走 `for + await` 序列。`register()` 完成後依 `(a,b)=>a.priority-b.priority` 全域排序，priority 越低越先執行，每個 handler 個別包覆 `try/catch` 並由 `log.error` 吞掉例外（保留 plugin failure isolation）。Context 物件以 reference 在 handler 間傳遞並回傳給呼叫端，少數欄位（`previousContext`、`preContent`、`chunk`）會被就地寫入；引擎於 dispatch 之後讀取這些欄位。

掃描全部既有 plugin 後（`HeartReverie/plugins/*`、`HeartReverie_Plugins/*`），可並行化的高 ROI handler 是 `state.post-response`（磁碟寫）與 `sd-webui-image-gen.post-response`（HTTP 呼叫）。`context-compaction.prompt-assembly`（就地寫 `previousContext`）與 `user-message.pre-write`（寫 `context.preContent`）為 mutator，必須保持序列；前者於 dispatch 後其 mutation 必須能被 `renderSystemPrompt` 看到，後者於 dispatch 後其 `preContent` 必須能被 `chat-shared.ts` L377 讀到。**任何把 serial handler 包進 `Object.create(context)` 或 Proxy 的方案都會靜默 break 這兩個關鍵流程。**

前端 `FrontendHookDispatcher`（`reader-src/src/lib/plugin-hooks.ts`）多數 stage 為同步 `for` 迴圈、不 await；唯一 async stage（`action-button:click`）通常只 match 單一 plugin，沒有實質並行機會。v1 範圍限定後端，frontend 完全不動。

A8 prompt-debugger 一直在等一個正規的「hook timing 上游」；本提案順帶把 `/api/_debug/hooks` 與 SSE stream 端點落地，contract 鎖定在 spec，避免日後重做。

Stakeholders: 引擎核心（`writer/lib/hooks.ts`、`plugin-manager.ts`）、外掛作者（特別是 `state` / `sd-webui-image-gen` 兩個目標）、A8 prompt-debugger 後續實作、Podman 部署管線（log grep 白名單）。

設計來源：`tmp/feat/B9-hook-parallelism.md`（673 lines），所有 6 個 open questions 已 RESOLVED；下文 Decisions 為其精煉。

## Goals / Non-Goals

**Goals:**

- 將同 stage 的網路 / 磁碟 I/O handler 並行化，使 `prompt-assembly` / `post-response` wall-clock 隨外掛數量呈次線性成長（目標：`state` + `sd-webui-image-gen` 同啟用時，post-response 從 t1+t2 降為 max(t1,t2)）。
- 提供 **opt-in、可審查、向後相容** 的 manifest 機制（`hooks[].parallel` + `readOnly`）；支援 **per-handler options-object overload**；引入 `concurrency` cap 與 `dependsOn` DAG 排序。
- 同步啟用 **Track B 預設並行**：靜態宣告 `readOnly:true` 的條目視為 `parallel:true`（可顯式 `parallel:false` opt out）。**未宣告 `hooks[]` 的 plugin 完全不受影響**。
- 在 `response-stream` stage 提供「allow_with_readOnly」：`parallel:true` 必須伴 `readOnly:true`（否則 reject）；per-chunk 獨立 `Promise.allSettled` fan-out、無 back-pressure；滑動平均 wall-time > 5ms / chunk 發 soft warn。
- 暴露 `GET /api/_debug/hooks` aggregate 與 `GET /api/_debug/hooks/stream` SSE；指定為 A8 canonical consumer，payload shape 於 spec 鎖定。
- 保留 spec L253「single handler failure SHALL NOT prevent other handlers from running」契約，log payload 加入 `dispatchPhase: "serial" | "parallel"`。

**Non-Goals:**

- **不改變未宣告 `hooks[]` 的 plugin 行為**：100% 序列、與今日 byte-identical。
- **不對 serial handler 套用 `Object.create` / Proxy**：保留 `context.preContent = ...` 等頂層 mutate 與 `previousContext` 就地修改的可見性。
- **不依賴 `Promise.allSettled` 作為並行寫入安全機制**；它只隔離失敗。並行 handler 一律以 read-only by contract 對待，由 manifest schema 強制。
- **不在 v1 修改 `FrontendHookDispatcher`**；frontend stage 名稱被 schema 主動拒絕。
- **不引入跨 stage dependency / retry / timeout**；同 stage `dependsOn` 已落地，跨 stage 留給後續提案。
- **不在 v1 為任何既有 plugin 啟用 `parallel:true`**；本提案只提供能力。
- **不在 run-time 強制 parallel handler 不可寫**；schema 為主要 guard，run-time 僅 `HOOK_DEBUG=1` 下 Proxy `set` trap 紀錄違規（避免改變失敗模式為 crash）。

## Decisions

### D1 — Two-bucket（serial-first）演算法，取代「依 priority 連續分批」

`dispatch()` 把 handler list 分成 `serial[]` 與 `parallel[]` 兩個 bucket（依 per-entry `parallel` 旗標）。先依 priority-asc 把 serial 全部 await，再對 parallel 一次 `Promise.allSettled`（必要時依 `concurrency` 切 chunk、依 `dependsOn` 拓樸排序）。

替代方案：「依 priority 連續同優先級分批」可保留 priority barrier，但 scheduling 複雜（需在 priority 跨界時暫停、判斷下一段是否仍 parallel-safe）。實測 plugin 數量小（<20）、收益不明顯。Serial-first 簡單、可推理，副作用是 priority 語意改變（D2）— 此為刻意取捨。

### D2 — priority 語意變化：parallel handler 一律後於所有 serial handler

副作用：宣告 `parallel:true && priority<100` 的 handler 不會搶先 priority>=100 的 serial handler。Mitigation：manifest validator 在 `parallel:true && priority<100` 時 `log.warn` 提醒；spec 以 scenario 明列「Given serial p150 + parallel p10, dispatch order is serial-first」。

未來若需回復全 priority barrier，可演進為 D1 替代方案；v1 不採用。

### D3 — Serial 走共用 base context，Parallel 走 Proxy view（雙路徑）

**為什麼不能統一走 `Object.create(context)`**：`user-message` handler 直接寫 `context.preContent = "..."`（`plugins/user-message/handler.ts:29,35`），引擎隨後讀 `preWriteCtx.preContent`（`chat-shared.ts:377-386`）。若 serial handler 拿到 prototype-chain 子物件，賦值會建立 own property 在子物件上，base context 完全沒被改 — 靜默 break `pre-write`。同理 `context-compaction` 就地寫 `previousContext` 也需 base context 可見。

**修正方案**：
- `#runSerial(entry, context)`：傳入 **同一個 base context**，`context.logger = deriveLogger(entry)` 就地 mutate（無 race，因 pass 為序列）。完全等於今日行為。
- `#runParallel(entry, context)`：傳入 `new Proxy(context, { get, set })`。`get` 把 `"logger"` 換成 per-handler logger，其他欄位讀穿透至 base（能看到 serial pass 完成後的最新狀態）。`set` 對 `"logger"` 槽返回 true（吞掉），其餘欄位 production 下 pass-through（避免改變失敗模式為 crash），`HOOK_DEBUG=1` 下記錄違反 readOnly 契約的寫入（`log.warn { mutatedKey, plugin, stage }`）。

Documented gap：對既存陣列 / 物件的就地 mutate（如 `arr.push(...)`）無法被 Proxy `set` trap 偵測（同 reference）。Mitigation：plugin authoring docs 教育 + 把 mutator-prone stage 建議保持 serial。

### D4 — Stage allowlist as **allowlist not denylist**，`response-stream` 條件式

```ts
const PARALLEL_ALLOWED = new Set(["prompt-assembly", "post-response", "response-stream"]);
```

`pre-write`（fan-in pipeline，單一寫者）與 `strip-tags`（未被 dispatch）一律強制 serial — schema 在 manifest 載入時 coerce `parallel:false` + log warn。所有 frontend stage 名稱在 schema enum 外，連條目都不能進入。

**`response-stream` 特殊條件**：列入 PARALLEL_ALLOWED，但 `parallel:true` 必須伴 `readOnly:true`，否則 validator **reject（log.error，非 coerce）**，整條 declaration 丟棄。理由：`response-stream` 每 chunk 觸發一次，misuse cost 極高；強制 reject 讓作者立刻發現，而非靜默降級為 serial。其他兩個 allowed stage 的「missing readOnly」走 coerce + warn 即可（成本低）。

### D5 — `readOnly:true` 是 manifest 強制契約，run-time 只偵測不強制

並行寫入安全靠三道防線：(1) stage allowlist；(2) manifest 顯式 `readOnly:true`（plugin 作者自我承諾）；(3) `HOOK_DEBUG=1` 下的 Proxy `set` trap 偵測。

替代方案「snapshot diff（`structuredClone` 比對 base）」被否決：對既存陣列就地 mutate（同 reference）無法可靠偵測；對 Proxy pass-through 寫入雖能看到 base 變化，但**無法歸責於哪個 handler**。Proxy `set` trap 反而能 per-handler 記錄違規。

### D6 — Track B 預設並行（**v1 即上線，BREAKING 行為變化**）

manifest 條目 `{ readOnly: true, parallel: undefined }` → validator 設為 `parallel: true`。`{ readOnly: true, parallel: false }` 顯式 opt out 完全尊重。`{ readOnly: undefined }` → 序列。**未宣告 `hooks[]` → 完全不變**（向後相容守護線）。

理由：plugin 作者宣告 `readOnly:true` 已等同承諾「不寫 context」；要求他們再寫一次 `parallel:true` 是冗餘樣板。但 release note 必須以最高層級紅字標示「post-response 預設 ordering 已從 priority-strict 改為 parallel-by-default for read-only handlers」。

### D7 — `Promise.allSettled` 用於失敗隔離（保留 spec L253 契約）

並行 bucket 收結後逐筆檢查 `result.status === "rejected"`，以 `log.error { stage, plugin, dispatchPhase: "parallel", error.message, error.stack }` 紀錄；不 rethrow。序列 bucket 維持今日 try/catch 行為，log payload 同樣加入 `dispatchPhase: "serial"`。

### D8 — `concurrency` cap：取同 stage 內 entries 的最小值，預設 unbounded

dispatcher 對 parallel bucket 啟動前若任一 entry 帶 `concurrency: N`，以 `Math.min(...)` 為 chunk size，內建輕量 async semaphore（`Promise.allSettled` over chunks of N）。任何 entry 未設 → 視為 unbounded（與今日「全展開 `Promise.allSettled`」一致）。Validator 對非正整數 / 非整數 coerce 為 undefined + warn。

### D9 — `dependsOn` 全域 DAG，cycle / unknown reject 後退化為 priority-only

值為 plugin name（可跨 plugin）；validator 在所有 plugin 載入完成後對 `(stage, plugin)` 節點建圖。cycle 或 unknown name → reject 該條 declaration（`log.error`），dispatcher 對該 stage 回退到 priority-only 排序。Dispatcher 在 parallel bucket 啟動前對成功 declaration 做拓樸排序，違反依賴的 entry 推遲到下一個 sub-batch（與 `concurrency` chunk 正交）。

### D10 — `response-stream` per-chunk fan-out + 無 back-pressure + 5ms 滑動平均 soft warn

每個 chunk 觸發獨立 `Promise.allSettled`（per-chunk fan-out）；**下一個 chunk 進入 dispatch 時不等待前一個 chunk 的 parallel handler 完成** — engine 持續 forward stream（寫檔 / 發 client）的序列 pipeline 不被阻塞。

per-handler 維護最近 N=50 chunks 的 wall-time 滑動平均；超過 5 ms / chunk 發 `log.warn { plugin, stage: "response-stream", avgMs, samples }`。此 soft warn 不影響 dispatch 行為，僅引導作者降級為 serial 或拆分工作。v1 不設 hard timeout。

### D11 — `register()` API v1 落地 options-object overload，舊位置參數為 thin shim

```ts
register(
  stage: HookStage,
  handler: HookHandler,
  priorityOrOptions?: number | { priority?: number; parallel?: boolean; readOnly?: boolean; dependsOn?: readonly string[] },
): void;
```

- 第三參為 `number`：等於 `{ priority: number }`（0 行為差異，舊呼叫不變）。
- 第三參為 object：per-handler 覆蓋 manifest `hooks[]` 預設；解鎖「同 plugin、同 stage 混合 read-only + mutator」場景。
- options 仍受 §7.3 allowlist + readOnly 契約校驗，違反者 coerce 並 log warn（與 manifest validator 同款訊息）。
- `dependsOn` 與 manifest 取 union（不取代）。

### D12 — `/api/_debug/hooks` aggregate + `/api/_debug/hooks/stream` SSE，A8 canonical consumer

- Ring buffer 最近 N=200 次 dispatch 駐 `HookDispatcher`；aggregate endpoint 計算 per-stage 平均 / p50 / p95、per-plugin 累計時間；payload shape locked。
- SSE endpoint 每次 dispatch 完成 emit `{ stage, dispatchPhase, durationMs, serialCount, parallelCount, plugins[] }`；payload shape locked。
- 兩者都掛在既有 `X-Passphrase` middleware 之後（無新 auth surface）。Reader-only mode 仍曝露（觀測性需要）— 不視為 settings page 範疇。
- Spec 鎖 shape 讓 A8 prompt-debugger 直接消費，避免日後重做。

## Risks / Trade-offs

- **[Track B 默默把 read-only handler 由 serial 變 parallel，破壞 priority-strict ordering 期待]** → mitigated by D2 的 validator warn（`priority<100 + parallel:true`）、release note 紅字、spec scenario 明列；plugin 作者可顯式 `parallel:false` opt out。Recovery cost = 一行 manifest 編輯。
- **[並行 handler 違反 `readOnly` 契約導致 race]** → mitigated by D5 三道防線（schema allowlist、`readOnly` 自我宣告、`HOOK_DEBUG=1` Proxy set trap）。Documented gap：既存陣列就地 mutate 偵測不到 — 由 plugin authoring docs 教育 + 建議 mutator stage 保持 serial。
- **[`response-stream` per-chunk 並行的 overhead 累積]** → mitigated by D10 的 5ms 滑動平均 soft warn + reject-on-missing-readOnly（強硬 gate misuse）。`Promise.allSettled` 為每 chunk 獨立、無 back-pressure → 即使 handler 卡住也不阻塞 forward stream。
- **[`dependsOn` cycle / unknown 在多 plugin repo 載入順序下可能變動]** → mitigated by 「所有 plugin 載入完成後才建圖」、cycle / unknown name reject + 退回 priority-only（fail open，dispatch 不爆）。
- **[Microtask starvation：N 過大時 `Promise.allSettled` 同 tick 排程]** → mitigated by D8 `concurrency` cap escape hatch；plugin 作者可宣告 `concurrency: 4`（或更小）切 chunk 串行批次執行。
- **[debug endpoint 對 high-frequency `response-stream` 造成 SSE 流量爆量]** → mitigated by 「dispatch ring buffer 與 SSE 共用同一筆記錄物件、aggregate 端點只在 GET 時計算」+ payload shape 精簡（不含完整 context）；客戶端可選擇只訂 `response-stream` 以外的 stage（v2 可加 query filter，v1 一律全推）。
- **[Serial / Parallel 雙路徑 context 視圖差異是 footgun]** → mitigated by 「serial 拿 base、parallel 拿 Proxy」的明確規則 + spec scenario 「serial mutator regression（mimic user-message preContent）」+ 整合測試守護；雙路徑於 `dispatch()` 內以兩個 private method 隔離，易讀。
- **[Podman 整合驗證 log grep 可能誤報]** → mitigated by 預期 warn 白名單明列（`parallel:true is only allowed for stages in PARALLEL_ALLOWED`、`parallel:true requires readOnly:true`、`response-stream + parallel:true requires readOnly:true`、`parallel handlers run after all serial handlers`），實作端執行 `grep -vE` 過濾。

## Migration Plan

1. **Spec & types**：合併本 change 的 specs（`hook-parallel-dispatch`、`plugin-hooks` 增 requirement、`plugin-core` 增欄位）。在 `writer/types.ts` 擴充 `HookDeclaration`（純型別，0 行為）。
2. **Manifest validator**：擴充 `writer/lib/plugin-manager.ts` 的 hooks[] validator — allowlist coerce、`readOnly` 缺失 coerce、`response-stream + parallel:true + readOnly!==true` reject、`concurrency` 整數性 coerce、Track B 預設並行 coerce、全局 `dependsOn` DAG（cycle / unknown reject）。此階段尚未啟用任何並行行為，dispatcher 仍走舊路徑；驗證 log 警告白名單與既有 plugin 載入無 regression。
3. **Dispatcher 重寫**：`HookDispatcher.dispatch()` 改為 two-bucket、`#runSerial` / `#runParallel` 雙路徑、Proxy view、`Promise.allSettled` + `dispatchPhase` log。`register()` 新增 options-object overload。`HandlerEntry` 增 `parallel? / readOnly? / concurrency? / dependsOn?`。先放行「parallel bucket 始終為空」的 case 跑 baseline 測試。
4. **`concurrency` chunk + `dependsOn` topo**：在 `#runParallel` 加入 chunk 主迴圈與拓樸排序；同步擴充 unit tests。
5. **`response-stream` per-chunk 特例 + 5ms 滑動平均 soft warn**：在 `chat-shared.ts:468` 的 dispatch 點維持單呼叫（dispatcher 內部判斷 stage 走 per-chunk 路徑）；ring buffer 紀錄 per-handler 最近 N=50 chunks。
6. **Debug endpoints**：新增 `writer/routes/_debug-hooks.ts`（aggregate + SSE），掛入 `X-Passphrase` middleware；payload 直接消費 ring buffer。spec lock 後不得改動 shape。
7. **Tests**：擴充 `tests/writer/lib/hooks_test.ts` 完整 case（mixed ordering、parallel error isolation、serial mutator regression、logger isolation、allowlist、`response-stream` allow_with_readOnly 三 case、HOOK_DEBUG detector、no-manifest 等價、`concurrency` cap、`dependsOn` topo / cycle / unknown、Track B default-on、`register()` overload）；`tests/writer/lib/hooks_bench.ts` sanity bench；`tests/writer/routes/_debug-hooks_test.ts`；fixture plugins。
8. **Docs**：`docs/plugin-system.md` 新章節、`HeartReverie/AGENTS.md` 摘要、`.agents/skills/heartreverie-create-plugin/references/manifest-schema.md` keyword list。
9. **Podman smoke**：build + run + `curl /api/chat`（觀察 `Hook dispatch completed` 的 `serialCount` / `parallelCount`）+ `curl /api/_debug/hooks` 比對 + SSE 連線測試；log grep 套用白名單。
10. **Archive**：`openspec validate --strict` 二次檢驗 → archive。

Rollback：步驟 1-2 為 0 行為變化，可單獨 revert。步驟 3-5 為核心；若需回退，將 `dispatch()` 改回單一序列 `for + await`、移除 `parallel/readOnly/concurrency/dependsOn` 欄位 wiring（manifest 仍可包含，會被視為未知欄位 — 因 schema additionalProperties:false 須同步 revert schema 片段）。步驟 6（debug endpoints）為純加法，可獨立留下或移除。

## Open Questions

來源 design doc（`tmp/feat/B9-hook-parallelism.md` §14）的 6 個 open questions 已全部 RESOLVED：

1. `concurrency: number` cap — **RESOLVED**：v1 即實作（D8）。
2. Track B 預設並行 — **RESOLVED**：v1 與 Track A 一同上線（D6）；未宣告 `hooks[]` 的 plugin 不受影響。
3. `dependsOn: string[]` — **RESOLVED**：v1 即實作（D9），cross-plugin 全域 DAG。
4. Dispatch metrics 暴露 — **RESOLVED**：v1 落地 `/api/_debug/hooks` aggregate + SSE（D12），A8 canonical consumer。
5. `response-stream` 可否並行 — **RESOLVED**：v1 採 allow_with_readOnly（D4 + D10），per-chunk 無 back-pressure + 5ms soft warn。
6. `register()` options-object overload — **RESOLVED**：v1 即實作（D11），舊位置參數為 thin shim。

設計批准時無遺留 open question。
