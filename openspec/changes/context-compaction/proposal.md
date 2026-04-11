## Why

故事章節數隨推進線性增長，全量載入所有章節至 context window 的 token 成本隨之爆炸。系統目前的唯一保護是 `MAX_CHAPTERS = 200` 的硬上限，沒有任何壓縮或摘要機制。當故事超過數十章，200K context window 裝不下全部歷史時，早期章節被截斷會導致角色設定、伏筆、因果鏈等關鍵資訊遺失，故事一致性崩壞。

## What Changes

- 新增 `context-compaction` 外掛，實作分層脈絡壓實架構，將 `previous_context` 的 token 成本從 O(n) 降為 O(1)+O(k)（串接摘要 + 固定視窗近期章節）
- 透過 `promptFragments` 注入提示詞指令，要求主要 LLM 在產出故事內容後附上 `<chapter_summary>` XML 標籤，包含該章的結構化摘要。摘要格式經過設計，可直接串接為全局摘要
- 在前端和後端分別過濾 `<chapter_summary>` 標籤：後端 `stripPromptTags()` 在建構近期章節的 `previous_context` 時移除；前端不顯示
- 在 `prompt-assembly` 階段替換 `previous_context` 的建構邏輯：近期 N 章保留原文（已移除摘要標籤），較舊章節提取 `<chapter_summary>` 內容取代全文，全局摘要由所有舊章節的摘要串接而成
- 不需要額外的 LLM 呼叫，不需要額外的摘要檔案——摘要內嵌在章節檔案的 XML 標籤中
- 修改 `buildPromptFromStory()` 以在建構 `previousContext` 後分派 `prompt-assembly` hook，允許外掛介入脈絡建構流程
- **BREAKING**: `previous_context` 模板變數的內容結構改變——較舊章節將不再是原文，而是提取的摘要文字

## Capabilities

### New Capabilities

- `context-compaction`: 分層脈絡壓實外掛，涵蓋內嵌摘要提取、串接式全局摘要、分層脈絡組裝、壓實設定管理

### Modified Capabilities

- `plugin-hooks`: 新增 `prompt-assembly` hook 的實際分派點（目前 stage 定義存在但未被任何程式碼分派）
- `vento-prompt-template`: `previous_context` 變數語意擴展——從「所有章節原文」變為「分層壓實後的脈絡」，可能包含摘要文字而非原文

## Impact

- **核心程式碼**: `writer/lib/story.ts` 的 `buildPromptFromStory()` 需增加 `prompt-assembly` hook 分派
- **外掛系統**: `writer/lib/hooks.ts` 已支援 `prompt-assembly` stage，無需修改 dispatcher 本身
- **新增檔案**: `plugins/context-compaction/` 目錄（plugin.json、handler.ts、compactor.ts、prompt 模板檔案）
- **無額外儲存**: 摘要內嵌在章節 `.md` 檔案的 `<chapter_summary>` 標籤中，不需要額外檔案
- **無額外 API 呼叫**: 摘要由主要 LLM 呼叫一併產出，不增加 API 成本
- **向下相容**: 沒有 `<chapter_summary>` 標籤的舊章節將回退到原文載入
