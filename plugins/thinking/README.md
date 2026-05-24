# thinking

讓 LLM 在正式寫章節前先做一段「想清楚」的思考推理，章節內容通常更有邏輯與一致性。LLM 思考過程會用 `<thinking>` 或 `<think>` 標籤包起來；外掛在閱讀畫面把這些段落自動折成可展開的小區塊，想看就點開，平常不擋路。

## 如何使用

預設啟用即可，無需額外設定。讀章節時思考區塊預設收摺，標題顯示「思考過程」；模型仍在串流時，未閉合的區塊會展開並顯示「思考中...」，讓讀者掌握進度。

到 **設定 → 外掛 → thinking** 可關閉提示詞注入（只保留前端摺疊渲染），或調整摺疊行為與標題文字。

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關掉後外掛不啟用，思考標籤不會被處理。 |
| `injectInstruction` | `true` | 控制是否將 `think-before-reply.md` 注入 `think_before_reply` 模板變數。 |
| `defaultCollapsed` | `true` | 完整思考區塊是否預設收合；未完成串流區塊仍預設展開。 |
| `completeSummaryLabel` | `思考過程` | 完整思考區塊的 `<summary>` 標題。 |
| `streamingSummaryLabel` | `思考中...` | 未閉合思考區塊的 `<summary>` 標題。 |

`injectInstruction` 由 `handler.ts` 的 `getDynamicVariables()` 動態提供，儲存設定後下一次提示詞組裝就會生效，不必重啟後端。

## 運作原理

外掛分成兩個面向：

### 提示詞指令

後端模組 `handler.ts` 透過 `getDynamicVariables()` 動態提供 `think_before_reply` 模板變數，指示 LLM 在正式回覆前先進行思考推理（chain-of-thought）。當 `injectInstruction` 設為 `false` 時，回傳空字串以省略注入。

### 前端渲染

前端模組 `frontend.js` 透過 `frontend-render` hook 處理 LLM 回應中的 `<thinking>` 和 `<think>` 標籤，將其轉換為 HTML `<details>` 可摺疊元素，讓讀者可選擇展開查看 LLM 的思考過程。

## 檔案結構

```
plugins/thinking/
├── plugin.json            # 外掛 manifest
├── handler.ts             # 後端動態變數模組（getDynamicVariables）
├── think-before-reply.md  # 回覆前思考提示詞片段
├── frontend.js            # 前端渲染模組
└── README.md
```
