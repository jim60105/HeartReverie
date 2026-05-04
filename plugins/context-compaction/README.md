# context-compaction

透過 LLM 產生的章節摘要，將 `previous_context` 從全量章節原文壓縮為三層結構，降低 token 消耗。

## 運作原理

外掛透過 `promptFragments` 注入提示詞指令，要求 LLM 在每次回覆的故事內容後附上 `<chapter_summary>` 標籤。摘要內嵌在章節 `.md` 檔案中，不產生額外檔案，也不需要額外的 API 呼叫。

在 `prompt-assembly` hook 階段，外掛從各章原始內容提取摘要，將 `previous_context` 陣列重組為三層結構：

| 層級 | 內容 | 說明 |
|------|------|------|
| L0 | `<story_summary>` | 所有非 L2 章節的摘要串接，作為全局故事摘要 |
| L1 | 回退原文 | 沒有 `<chapter_summary>` 標籤的舊章節保留原文 |
| L2 | 近期原文 | 最近 N 章保持全文（`<chapter_summary>` 已由 `stripPromptTags` 移除） |

## 設定

外掛透過 `compaction-config.yaml` 進行設定，支援兩個層級（高優先覆寫低優先）：

1. **故事層級**：`playground/{series}/{name}/compaction-config.yaml`
2. **系列層級**：`playground/{series}/compaction-config.yaml`

若兩個層級都不存在設定檔，外掛使用預設值。

### 設定欄位

```yaml
# 近期章節數（L2 視窗大小），保留全文不壓縮
recentChapters: 3

# 是否啟用壓縮，設為 false 可停用外掛
enabled: true
```

| 欄位 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `recentChapters` | 整數 | `3` | 保留全文的近期章節數（L2 視窗大小） |
| `enabled` | 布林 | `true` | 設為 `false` 時外掛不修改 `previous_context` |

## 回退行為

- 章節沒有 `<chapter_summary>` 標籤時，保留全文（與未安裝外掛時相同）
- 所有章節都沒有摘要標籤時，`previous_context` 內容不變
- 章節總數不超過 `recentChapters` 時，不進行壓縮

## 摘要格式

外掛指示 LLM 在 `<chapter_summary>` 標籤內產出結構化摘要。指令採用與 `UpdateVariable` 相同的 rule/format 結構，要求 LLM 以「第 N 章：」開頭，按時序列出關鍵事件、角色狀態變化、未解伏筆，長度控制在 100-200 字以內。多章摘要直接串接即可作為全局摘要。

範例：

```
<chapter_summary>
第 3 章：小夜在圖書館發現一封藏在舊書中的信件，信件提到地下室的暗門。她嘗試開啟暗門但被管理員撞見，謊稱在找書後離開。回家路上遇到轉學生陸明，他似乎對信件的內容有所了解。伏筆：信件署名「K」的身分未明；陸明的真實目的不明。
</chapter_summary>
```

## 範本變數

`chapter-summary-instruction.md` 是 [Vento](https://vento.js.org/) 範本，引擎會在渲染時注入動態變數：

- `chapter_number`：由目標章節的檔名解析而來（例如 `0042.md` → `42`），確保摘要使用正確的章節編號。

若範本渲染失敗，引擎會記錄警告並回退至原始內容。

## 檔案結構

```
plugins/context-compaction/
├── plugin.json                       # 外掛 manifest
├── handler.ts                        # prompt-assembly hook 註冊
├── config.ts                         # 設定載入
├── extractor.ts                      # 章節摘要提取
├── compactor.ts                      # 三層脈絡組裝
├── frontend.js                       # 前端摘要標籤過濾
├── chapter-summary-instruction.md    # 提示詞片段
└── README.md
```
