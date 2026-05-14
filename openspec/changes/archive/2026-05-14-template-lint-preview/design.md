## Context

引擎使用 Vento 渲染四類模板（主 `system.md`、lore 篇章 body、plugin promptFragments、`{{> include }}` 子模板），但作者修改任何一份模板時，得「儲存 → 觸發 chat → 等回應失敗 → 看 error toast」才知道哪行壞了。`writer/lib/template.ts:41-91` 的 `validateTemplate()` SSTI 白名單只在主模板 PUT 路徑與 chat 啟動時跑；plugin fragment 載入 / render 兩端**都沒驗**（`writer/lib/template.ts:180-200` 直接 `runString` 跳過驗證）。`writer/lib/vento-message-tag.ts` 的 `messageTagPlugin()` 已在 parse 階段拋 `SourceError`，但前端無法 standalone 觸發這條路徑——必須跑 prompt assembly 才會冒出。

CodeMirror 6（120 KB gz）相對 Monaco（900 KB gz）對本專案 Vite + 輕量 bundle 風格更合適；`docs/prompt-template.md` 中既有的 `{{- set my_var |> trim -}}{{- include "./x.md" -}}{{- /set -}}` 範例與 `validateTemplate()` 的 strict 白名單衝突，是長期未解的 docs vs runtime 不一致——本 change 一併修。專案目前 0 使用者（pre-release），可採 breaking changes 把 plugin fragment 也納入同一道 SSTI 驗證，不留 migration shim。

## Goals / Non-Goals

**Goals:**

- 在儲存前即時偵測 Vento 編譯／渲染錯誤（含 `multi-message:*` Vento parse-time 錯誤），標出 line/col。
- 提供「核心變數 + plugin `promptFragments` + plugin `getDynamicVariables` + lore 標籤 + Vento helper / pipe filter」彙整成的 autocomplete catalog。
- 用「故事 fixture」做沙盒預覽，避免直接讀寫使用者 playground 資料；`default` / `inline` mode 從型別層阻止 IO 注入。
- 涵蓋引擎主模板與 lore 篇章寫入；plugin fragment 僅供讀取 / lint / preview，**不可寫回**。
- 收緊 plugin fragment 的 SSTI 驗證：在 `PluginManager.init()` 註冊 hook 前先驗每個 fragment source；每次 render 前再驗一次。
- 收緊 `validateTemplate()` 規格：`set` / `/set` / `include` / `{{> jsExpression }}` 一律 `vento.unsafe-expression`。
- Lint pipeline 採 `compile()` 集中解析路徑，產出可重用 AST，移除既有 `runString` dry-run 對 fixture context 的依賴。

**Non-Goals:**

- ❌ 不取代使用者的外部編輯器（VSCode 仍是主要寫作環境）。
- ❌ 不放寬 SSTI 策略；不為 `include` 補路徑安全規則（若未來確有需求需另開 spec change）。
- ❌ 不做 LLM 呼叫；preview 不觸發任何上游 API。
- ❌ 不在 lint 階段做靜態 type-check（Vento untyped）。
- ❌ 不提供 plugin migration shim；既有受影響 plugin 須在自己 repo 中改寫 fragment。
- ❌ 不提供獨立 lint CLI（`deno task lint:templates` 不存在）；以 backend 單元測試 + `POST /api/templates/lint` endpoint 覆蓋。

## Decisions

### D1. Editor library — CodeMirror 6

選 CodeMirror 6 而非 Monaco／Ace：
- CM6 ~120 KB gz（vs Monaco ~900 KB）；可 tree-shake；無 Web Worker 多 chunk 風險。
- `@codemirror/view` 可直接掛 `<div ref>`，與既有 Vue 3 + Vite 整合一致。
- 自訂 tokenizer 用 `StreamLanguage.define`，不需另開 worker。
- Ace 對 ESM 支援差且維護鬆散，pass。

新增依賴：`@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/lint`、`@vueuse/core`、`diff`，全部以 `npm:` 規格加入 `deno.json` `imports` map。

### D2. Lint pipeline — `compile()` AST 路徑（取代 `runString` dry-run）

過往可選做法是 `runString(EMPTY_PROBE)` dry-run，但會：
- 觸發 runtime-only 錯誤（`multi-message:no-user-message`），與 parse-time 錯誤混淆 diagnostic。
- 跑 IO 副作用（plugin loader）。
- 對 fixture context 過敏（缺欄位 → `Variable not defined`）。

改採 `ventoEnv.compile(source)` 集中解析：純 parse 階段，攔 `SourceError`（含 `messageTagPlugin` 的 `multi-message:nested` / `multi-message:invalid-role`），收集 AST 供未來模組（AST-based 變數收集、其他 lint 規則）重用。Runtime-only 錯誤僅在 `mode=preview` 真實渲染時自然冒出。

代價：`writer/vendor/ventojs.d.ts` 目前只宣告 `run` / `runString` / `load`，需擴充 ambient typings 加 `compile(source: string, filename?: string): Promise<Template>` signature。本 change 一併補 `writer/vendor/__tests__/ventojs-compile.test.ts` ambient pin 測試，ventojs 升版改 signature 時 CI 立即攔下。

### D3. Preview 三模式（`default` / `inline` / `current`）

`renderSystemPromptForPreview(source, fixture, mode)` 純函式：

| Mode | Story 章節 IO | Lore 解析 | Plugin `getDynamicVariables()` | Plugin fragment 檔案讀取 | `validateTemplate` |
|---|---|---|---|---|---|
| `default` | ❌ | ❌ | ❌ | ❌（`plugin_fragments: []`、命名片段 `""`） | ✅ |
| `inline` | ❌ | ❌ | ❌ | ❌（同上，使用者 paste 的 JSON 蓋上） | ✅ |
| `current` | ✅（沿用 `buildPromptFromStory`） | ✅ | ✅ | ✅ | ✅ |

`default` / `inline` 走純 Vento `runString(source, fixtureToContext(fixture))`，**完全不接** `pluginManager`、`storyDir`、`PLAYGROUND_DIR`。`current` 才退回沿用 `buildPromptFromStory()`。signature 在型別層拒收 `series` / `story` / `storyDir` 等內部物件（除 `mode === "current"`），阻止 IO 注入。

`current` 模式必須前端按鈕兩段式確認（modal：「將從磁碟載入 N 個章節，僅在記憶體渲染、不寫回任何檔案」）。

### D4. Plugin fragment SSTI — load-time + render-time 強制（**BREAKING**）

`PluginManager.init()` 在註冊 hook 與載入 backend module 前，對每個 plugin 的 `promptFragments[].file` source 跑 `validateTemplate()`：
- 非空 → plugin load fail（log `error` + 從 `#plugins` 移除，hook／settings／fragment 皆**未**註冊）。
- 與 `enabled === false` 不同：是 schema-level reject，runtime 不會再去碰該 plugin 的 fragment，也不會留下任何 orphan hook 或 introspection 條目。
- 縱深防禦：`renderSystemPrompt()` 在每次組合 fragment 前再 validate 一次，攔住「載入後檔案被改動」或「runtime 動態組裝出 SSTI 字串」的情況。

代替方案考慮並 reject：
- **僅在載入時驗一次**：rejected — 載入後 fragment 檔案可能被外部編輯／hot-swap，無防禦深度。
- **僅在 render 前驗**：rejected — 每次 chat 都跑 validate 是浪費，且 load 階段可早期攔下並避免 orphan hook。
- **保留現狀（不驗）**：rejected — 既有 SSTI 縫隙會延續。

### D5. Plugin fragment 寫入 — 嚴格 read-only（**BREAKING**）

`PUT /api/templates` 收到 `templatePath: "plugin:<name>:…"` 一律回 **403**：
- Plugin 檔案屬於 plugin image，由 plugin 作者在自己 repo 中維護。
- 編輯器只提供 read / lint / preview。
- 不提供「另存到 `PLUGIN_DIR`」或 fork-then-overlay（會混淆來源、增加維護成本）。

`TemplateRef.editable` 對 `kind: "plugin-fragment"` 永遠為 `false`，UI 不渲染 save 按鈕。

### D6. `validateTemplate()` 規格 — Option A (strict)

`set` / `/set` / `include` / `{{> jsExpression }}` 一律落入 `vento.unsafe-expression`（error，硬阻擋 save／runtime）。CodeMirror tokenizer 同步把這些 token 標 `error` 顏色 + remediation hint：「使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 `getDynamicVariables()` 注入內容」。

`docs/prompt-template.md` 中既有 `{{- set my_var |> trim -}}{{- include "./x.md" -}}` 範例由 §12 Task 4.1 一併刪除，改寫為以具名變數注入的等價寫法。

代替方案考慮並 reject：
- **Option B（為 `include` 補路徑安全規則）**：rejected — 增加路徑解析、symlink 防護、跨 plugin scope 隔離邏輯的維護成本；本期需求未要求。

### D7. Lore 篇章 lint catalog — 第一輪 snapshot

Lore 篇章在引擎中早於 plugin fragment 渲染（`writer/lib/template.ts:155-170` 的 `ventoEnv.runString(passage.content, …)`，使用 `lore_*` + `series_name` + `story_name`）。

Template Editor 對 lore 條目採同一 catalog：**不含** plugin-fragment 變數。避免「lint 通過但 runtime 渲染失敗」的反向不一致。

### D8. Helper drift CI 檢查

`reader-src/src/lib/template.ts` 的 `VENTO_HELPERS` const 與 `ventojs` 實際 filter 集合可能因升版而漂移。CI `scripts/check-vento-helpers.ts` 比對兩者，差集非空即失敗。新增 filter 時必須同步更新 const。

### D9. 寫入安全 — atomic + backup + symlink 拒收

依 `writer/lib/story.ts:124-135` 的 `atomicWriteChapter` 風格：
1. `Deno.copyFile(target, target + ".bak")`；若 `.bak` 存在改用 `.bak.<ts>`。
2. 寫 temp `<parent>/.<basename>.tmp.<crypto.randomUUID()>`。
3. `Deno.rename` 至最終路徑（同 dev 內 atomic）。
4. `try/finally` 確保 tmp 清掉。

Symlink 防護：
- `base = await Deno.realPath(allowedBase)`。
- `parent = await Deno.realPath(dirname(target))`；assert `isPathContained(base, parent)`。
- 若 `target` 存在，`Deno.lstat(target)` → 拒收 `isSymlink === true`。
- `isPathContained` 從 `plugin-manager.ts:61-64` 抽出到 `writer/lib/path-safety.ts`，plugin-manager 改 import 此 helper。

### D10. Git 警告（選配）

寫入前嘗試 `Deno.Command("git", ["status", "--porcelain", "--", target])`；若有未提交變更，回 `{ ok: true, warning: "uncommitted-changes" }` 讓前端 toast 黃色提醒。git 不存在時 silently skip（不視為錯誤）。

### D11. Save 流程 — 無 autosave，warning 不阻擋

- 無 autosave：必須點「儲存」才寫盤。
- 點「儲存」前呼叫 `lint`，若有 **error** 則阻擋 + toast「請先修復 N 個錯誤」。
- **Warning 一律不阻擋 save**，僅以 toast 提示；不提供「視為 error」的使用者旗標（避免設定矩陣爆炸）。
- 寫盤前對「目前盤上版本 vs editor buffer」算 unified diff（`diff` npm pkg）並彈 modal 確認。
- 寫盤成功後 emit `template:saved` event，關閉 modal，重新 lint+preview。

## Risks / Trade-offs

- **[BREAKING：plugin fragment SSTI runtime 強制]** → 受影響的 plugin 會 load fail。緩解：release notes 列出受影響 fragment 路徑與遷移範例；專案 0 使用者，可承受陣痛。
- **[BREAKING：plugin fragment 寫入 read-only]** → 編輯器無法直接改 plugin 模板。緩解：文件明示 plugin 模板須於 plugin repo 編輯；left panel 顯示「唯讀」標籤；UI 不渲染 save 按鈕。
- **[BREAKING：`set` / `include` 全面禁用]** → 既有 docs 範例失效；任何依賴 `include` 的 plugin / lore 失效。緩解：docs §12 Task 4.1 同步刪除；release notes 給遷移指引（具名變數、`promptFragments`、`getDynamicVariables`）。
- **[`compile()` ambient signature 未來變動]** → ventojs 升版可能改 signature。緩解：`writer/vendor/__tests__/ventojs-compile.test.ts` 做 ambient pin，CI 立即攔。
- **[大型模板 100–500 KB lint 延遲]** → Deno V8 實測 < 300 ms，搭配 300 ms debounce 可接受。> 500 KB 由既有 limit 攔截。
- **[`current` mode 誤觸真實 IO]** → 前端兩段式確認 + handler 端 assert `mode === "current"` 才接受 `series` / `story` 欄位。
- **[Symlink swap 競態]** → 寫入流程先 realpath parent + lstat target 再 atomic rename；不對待寫檔案 realpath。
- **[並發 PUT]** → §10.4 並發 smoke 驗任一勝出 + `.bak` 為先前版本 + 檔案內容無交錯。
- **[CodeMirror tree-shaking 失效]** → 各 `@codemirror/*` 套件粒度足夠；用 dynamic import 拆 chunk，並在 build 後驗 bundle size budget。

## Migration Plan

1. **Phase 0（本 change 同 commit 內）**：
   - 文件 `docs/prompt-template.md` 刪除 `set` + `include` 範例，加警語。
   - Release notes 草稿列出 BREAKING CHANGES 段。
2. **Phase 1（合併前）**：
   - 在 staging container 啟動引擎，跑 podman smoke + agent-browser smoke。
   - 對所有現有 plugin 跑 `PluginManager.init()` 載入測試，若有 plugin load fail，於 release notes 中具體列出 fragment 路徑。
3. **Phase 2（rollback）**：
   - 若上線後發現 fragment 大規模 fail，可暫時還原 `PluginManager.init()` 的 SSTI 強制（保留 PUT-time + render 前驗證）。rollback 邊界乾淨：所有 strict 邏輯集中於 `init()` + `renderSystemPrompt()` 兩處。

無 schema migration、無資料 migration。

## Open Questions

無。所有設計決策（Q1-Q8）已在 `tmp/feat/B5-template-editor.md` §14 全部 RESOLVED：
- Q1 → Option A strict（set/include 全禁、docs 同步刪除）
- Q2 → breaking change（plugin fragment runtime SSTI 強制）
- Q3 → read_only（plugin fragment 永不可寫回）
- Q4 → v1 完整 helper autocomplete + CI drift check
- Q5 → drop CLI（不提供獨立 lint CLI）
- Q6 → warning_toast_only（warning 不阻擋 save）
- Q7 → v1 完整 lore 篇章 lint 支援
- Q8 → 本 change 一併補 `compile()` ambient typing 與 pin 測試
