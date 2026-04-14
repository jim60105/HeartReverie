# thinking

注入「回覆前先思考」提示詞指令，並將 LLM 輸出中的 `<thinking>` 和 `<think>` 標籤折疊為可展開的 details 元素。

## 運作原理

外掛包含兩個面向：

### 提示詞指令

透過 `promptFragments` 注入 `think_before_reply` 模板變數，指示 LLM 在正式回覆前先進行思考推理（chain-of-thought）。

### 前端渲染

前端模組 `frontend.js` 透過 `frontend-render` hook 處理 LLM 回應中的 `<thinking>` 和 `<think>` 標籤，將其轉換為 HTML `<details>` 可摺疊元素，讓讀者可選擇展開查看 LLM 的思考過程。

## 檔案結構

```
plugins/thinking/
├── plugin.json            # 外掛 manifest
├── think-before-reply.md  # 回覆前思考提示詞片段
├── frontend.js            # 前端渲染模組
└── README.md
```
