# context-compaction

故事愈寫愈長，舊章節全文塞進提示詞會吃掉大量 token，也容易撞到模型的脈絡上限。這個外掛讓 LLM 在每章結尾順手寫一段摘要，往後回顧時舊章節就以摘要登場，最近的幾章維持原文，整體脈絡保得住，token 卻省下不少。

## 我會看到什麼？

- 模型寫完章節後，章節 `.md` 檔尾端會多一段 `<chapter_summary>` 區塊（提示詞與閱讀畫面都會自動藏起來，只存在於檔案裡）。
- 下次組裝提示詞時，舊章節以摘要傳給模型，近期 N 章保留全文。
- 不需要額外的 API 呼叫，也不會多出任何檔案。

## 運作原理

外掛透過 `promptFragments` 注入提示詞指令，要求 LLM 在每次回覆的故事內容後附上 `<chapter_summary>` 標籤。摘要內嵌在章節 `.md` 檔案中。

在 `prompt-assembly` hook 階段，外掛從各章原始內容提取摘要，將 `previous_context` 陣列重組為三層結構：

| 層級 | 內容 | 說明 |
|------|------|------|
| L0 | `<story_summary>` | 所有非 L2 章節的摘要串接，作為全域故事摘要 |
| L1 | 回退原文 | 沒有 `<chapter_summary>` 標籤的舊章節保留原文 |
| L2 | 近期原文 | 最近 N 章保持全文（`<chapter_summary>` 已由 manifest 的 `promptStripTags` 清除） |

## 設定

外掛支援以下幾種設定來源，優先順序由高至低：

1. **故事層級 YAML**：`playground/{series}/{name}/compaction-config.yaml`
2. **系列層級 YAML**：`playground/{series}/compaction-config.yaml`
3. **全域 plugin 設定（閱讀器 UI）**：由引擎管理，存放於 `playground/_plugins/context-compaction/config.json`
4. **內建預設值**：`recentChapters: 3`、`enabled: true`

YAML 之間採「擇一」語意：若故事層級 YAML 存在，系列層級 YAML 不會被讀取，兩者不會合併。被選中的 YAML 之下，全域 plugin 設定會以 **欄位層級** 的方式補上 YAML 沒有指定的欄位；最後再由內建預設值補齊。

每一層在合併前都會做型別與範圍檢查（`recentChapters` 必須是正整數，`enabled` 必須是布林）；不符合的欄位會被丟掉，由下一層補上。

### 設定欄位

| 欄位 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `recentChapters` | 整數（≥ 1） | `3` | 保留全文的近期章節數（L2 視窗大小） |
| `enabled` | 布林 | `true` | 設為 `false` 時外掛不修改 `previous_context` |

#### 透過 YAML 設定

```yaml
# 近期章節數（L2 視窗大小），保留全文不壓縮
recentChapters: 3

# 是否啟用壓縮，設為 false 可停用外掛
enabled: true
```

#### 透過閱讀器 UI 設定（全域）

外掛 manifest 透過 `settingsSchema` 宣告了上述兩個欄位，引擎會在閱讀器設定頁自動產生對應的表單。打開閱讀器 → 設定 → 外掛 → `context-compaction`，即可調整 `recentChapters` 和 `enabled`。儲存後寫入 `playground/_plugins/context-compaction/config.json`，下一次對話即生效，無需重啟後端。

注意：UI 設定屬於 **全域**（影響整個站台），若要針對個別故事或系列設定，請使用對應的 `compaction-config.yaml`。

#### 範例：YAML 與 UI 並用

- 全域 UI 設定 `recentChapters: 5`、`enabled: true`
- 故事 A 沒有 `compaction-config.yaml` → 使用 `recentChapters: 5`、`enabled: true`
- 故事 B 有 `compaction-config.yaml` 內容為 `recentChapters: 2` → 使用 `recentChapters: 2`、`enabled: true`（`enabled` 由全域 UI 設定補上）
- 故事 C 有 `compaction-config.yaml` 內容為 `enabled: false` → 使用 `recentChapters: 5`（由全域 UI 補上）、`enabled: false`

## 回退行為

- 章節沒有 `<chapter_summary>` 標籤時，保留全文（行為和外掛關掉時一樣）
- 所有章節都沒有摘要標籤時，`previous_context` 內容不變
- 章節總數不超過 `recentChapters` 時，不進行壓縮

## 摘要格式

外掛指示 LLM 在 `<chapter_summary>` 標籤內產出結構化摘要。指令採用與 `UpdateVariable` 相同的 rule/format 結構，要求 LLM 以「第 N 章：」開頭，按時序列出關鍵事件、角色狀態變化、未解伏筆，長度控制在 100-200 字以內。多章摘要直接串接即可作為全域摘要。

範例：

```
<chapter_summary>
第 3 章：小夜在圖書館發現一封藏在舊書中的信件，信件提到地下室的暗門。她嘗試開啟暗門但被管理員撞見，謊稱在找書後離開。回家路上遇到轉學生陸明，他似乎對信件的內容有所了解。伏筆：信件署名「K」的身分未明；陸明的真實目的不明。
</chapter_summary>
```

## 範本變數

`chapter-summary-instruction.md` 是 [Vento](https://vento.js.org/) 範本，引擎會在渲染時注入動態變數：

- `chapter_number`：由目標章節的檔名解析而來（例如 `0042.md` → `42`），讓摘要對應到正確的章節編號。

若範本渲染失敗，引擎會記錄警告並回退至原始內容。

## 檔案結構

```
plugins/context-compaction/
├── plugin.json                       # 外掛 manifest
├── handler.ts                        # prompt-assembly hook 註冊
├── config.ts                         # 設定載入
├── extractor.ts                      # 章節摘要提取
├── compactor.ts                      # 三層脈絡組裝
├── chapter-summary-instruction.md    # 提示詞片段
└── README.md
```
