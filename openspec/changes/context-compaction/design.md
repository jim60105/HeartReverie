## Context

HeartReverie 是一個角色扮演故事寫作系統，透過 OpenRouter API 呼叫 LLM 來續寫互動小說。系統目前將所有已完成章節（最多 200 章）的全文載入 context window 作為 `previous_context`，沒有任何壓縮或摘要機制。

當前的 token 成本隨章節數線性增長。以正體中文故事為例，每章約 800-2000 token，20 章已達 16K-40K token，50 章以上便會逼近主流模型的 context window 上限。且中文 token 密度本身就高於英文，進一步壓縮的空間有限。

系統的外掛架構已定義 `prompt-assembly` hook stage，但目前無任何程式碼分派此 hook。`post-response` hook 已由 `apply-patches` 外掛使用。LLM 的回應已經包含多種 XML 標籤（`<options>`、`<status>`、`<UpdateVariable>` 等），由外掛在前端和後端分別處理。

## Goals / Non-Goals

**Goals:**

- 將 `previous_context` 的 token 消耗從 O(n) 降至 O(1)+O(k)：串接的章節摘要 + 固定視窗的近期章節原文
- 利用主要 LLM 呼叫一併產出章節摘要，不增加額外 API 呼叫或成本
- 摘要內嵌在章節檔案的 XML 標籤中，不產生額外檔案
- 全局摘要以串接各章節摘要的方式組成，不需要 LLM 呼叫
- 向下相容：沒有摘要標籤的舊章節自動回退到全量載入
- 可設定：近期章節數可在系列或故事層級覆寫

**Non-Goals:**

- 不實作向量檢索（L3 層）——這是未來的擴充方向，本次不涉及
- 不實作時序知識圖譜或矛盾偵測——複雜度過高
- 不產生額外的摘要檔案（`.summary.yml`、`global-summary.yml`）
- 不進行額外的 LLM API 呼叫來產生或更新摘要
- 不修改前端渲染邏輯（僅需在 stripTags 中加入 `chapter_summary`）

## Decisions

### Decision 1: 摘要由主要 LLM 呼叫一併產出

**選擇**: 透過 `promptFragments` 注入提示詞指令，要求 LLM 在產出故事內容後附上 `<chapter_summary>` XML 標籤。摘要內嵌在章節 `.md` 檔案中。

**替代方案 A**: 在 `post-response` hook 中額外呼叫 LLM API 產生摘要，儲存為獨立檔案。

**替代方案 B**: 使用 LLMLingua-2 做 token 級壓縮。

**理由**: 主要 LLM 在撰寫章節時已完整理解故事脈絡，最適合同時產出高品質摘要。不需要額外 API 呼叫（零額外成本、零額外延遲）。不需要額外檔案管理。摘要與章節內容天然綁定，版本一致性有保障。

### Decision 2: 以外掛形式實作，透過 hook 和 tag 系統整合

**選擇**: 實作為 `context-compaction` 外掛，使用 `promptFragments`（注入摘要指令）、`stripTags`（過濾摘要標籤）、`backendModule`（`prompt-assembly` hook 處理脈絡分層）、`frontendModule`（前端過濾）。

**替代方案**: 直接修改 `story.ts` 的核心邏輯。

**理由**: 外掛形式符合系統的架構原則——功能模組化、可啟用/停用。利用現有的 `promptFragments` 和 `stripTags` 機制注入指令和過濾標籤。核心程式碼僅需新增 `prompt-assembly` hook 分派點。

### Decision 3: 三層脈絡結構（L0 + L1 + L2）

**選擇**: 採用三層結構：
- **L0 — 全局摘要**：所有非 L2 章節的 `<chapter_summary>` 內容串接，包裹在 `<story_summary>` 標籤中。不需要 LLM 呼叫。
- **L1 — 章節摘要帶**：近期章節之前的章節，若有 `<chapter_summary>` 標籤則提取其內容取代全文。
- **L2 — 近期章節原文**：最近 N 章（預設 3）保持全文（移除 `<chapter_summary>` 標籤後），保留風格、語氣、節奏的局部連貫性。

**替代方案**: 只做 L0 + L2，跳過個別章節摘要。

**理由**: L1 個別章節摘要提供 L0 全局摘要和 L2 近期原文之間的資訊梯度。L0 由 L1 摘要串接而成，實作簡單。三層結構在壓縮比和資訊保留之間取得平衡。

### Decision 4: 摘要格式設計——可串接的結構化文字

**選擇**: `<chapter_summary>` 標籤內的摘要以簡潔的結構化純文字呈現，每章摘要包含章節編號標記，涵蓋關鍵事件、角色狀態變化、未解伏筆。格式設計使得多章摘要直接串接後即可作為全局摘要使用。

**替代方案**: YAML 格式的結構化摘要。

**理由**: 純文字格式對 LLM 最友好（無需 YAML 解析，直接可讀）。串接時不需要額外處理。LLM 在 prompt 中看到的是自然語言摘要，理解效果優於結構化格式。

### Decision 5: prompt-assembly hook 設計

**選擇**: 在 `buildPromptFromStory()` 中、建構 `previousContext` 陣列之後、呼叫 `renderSystemPrompt()` 之前，分派 `prompt-assembly` hook。Hook context 包含可修改的 `previousContext` 陣列和章節原始內容（含 `<chapter_summary>` 標籤），外掛可從原始內容提取摘要後替換 `previousContext`。

**理由**: 此設計讓壓實外掛能存取兩個版本的章節內容：已過濾的（`previousContext`，標籤已移除）和原始的（含 `<chapter_summary>`）。外掛從原始內容提取摘要，替換 `previousContext` 中對應的元素。

### Decision 6: 向下相容的回退策略

**選擇**: 若某章節沒有 `<chapter_summary>` 標籤，壓實外掛將該章保留原文。若完全沒有章節包含摘要標籤，外掛不做任何處理，行為等同於停用外掛。

**理由**: 避免對舊故事產生影響。使用者啟用外掛後，只有新產出的章節（LLM 遵循摘要指令時）才會被壓實。

## Risks / Trade-offs

**[風險] LLM 不遵循摘要指令** → LLM 可能忽略 `<chapter_summary>` 輸出指令，或產出格式不符的摘要。此時回退到全文載入，不影響功能。可在提示詞中強調摘要指令的優先度。

**[風險] 摘要品質影響故事一致性** → LLM 自行摘要可能遺漏對後續章節重要的細節。透過提示詞引導 LLM 聚焦角色狀態、重要事件、未解伏筆。使用者可手動編輯章節檔案中的 `<chapter_summary>` 內容修正遺漏。

**[風險] 全局摘要（串接）可能冗長** → 隨章節增加，串接的摘要文字持續增長（但增長率遠低於原文）。每章摘要約 100-200 token，50 章約 5K-10K token。在極端情況（100+ 章）可能需要進一步壓縮策略，但這遠優於全文載入的 100K+ token。

**[風險] `previous_context` 語意變更為 breaking change** → 依賴 `previous_context` 為原文的模板可能受影響。以明確的 XML 標籤區隔摘要內容和原文（`<story_summary>`、`<chapter_summary>` vs `<previous_context>`），讓模板作者能區分處理。

**[取捨] 摘要品質取決於主要模型** → 不同模型的摘要品質不一致。但這也是優勢——使用者選擇的主要模型品質越高，摘要品質也越高，不存在「便宜摘要模型」與「高品質主模型」之間的品質落差。
