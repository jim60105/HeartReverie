# Hook Inspector 遷移指南

本文件說明 `hook-inspector` 變更引入的 plugin manifest 規範，並列出每個內建 plugin 已套用的 `hooks` 宣告片段，供外部 plugin 作者比對參考。

## 影響範圍

- **新增 manifest 欄位**：`hooks`（選填，但**新撰寫的 plugin 必須**宣告）。
- **嚴格驗證**：當 `hooks` 存在時，系統比對宣告 vs 實際 `hooks.register()` 呼叫，不一致則回滾該 plugin 載入並輸出 `Plugin <name> hook declarations do not match registration: declaredOnly=[…], registeredOnly=[…]`。
- **省略 `hooks`** 進入 legacy 模式（向後相容），但無法享有 Hook Inspector 的衝突偵測。
- **`action-button:click` 不變**：仍維持「每個 `(plugin, stage)` 僅一個 handler」（過去並非如此，現為嚴格契約）。

## 內建 plugin 的 `hooks` 宣告

| Plugin | `hooks` 片段 |
|--------|-------------|
| `context-compaction` | `[{ "stage": "prompt-assembly", "writes": ["previousContext"] }]` |
| `dialogue-colorize` | `[{ "stage": "chapter:dom:ready" }, { "stage": "chapter:dom:dispose" }]` |
| `polish` | `[{ "stage": "action-button:click" }]` |
| `response-notify` | `[{ "stage": "notification" }]` |
| `start-hints` | `[]`（純 prompt-only） |
| `thinking` | `[{ "stage": "frontend-render", "reads": ["text"], "writes": ["text", "placeholderMap"] }]` |
| `user-message` | `[{ "stage": "pre-write", "writes": ["preContent"] }]` |

## 外部 plugin 遷移步驟

1. 為每個 `hooks.register("<stage>", ...)` 呼叫補上 manifest 中的 `{ "stage": "<stage>" }`。
2. 若 handler 會改寫 context 欄位（例如 `context.chunk = ...`），補上 `writes: ["chunk"]`。
3. 若僅讀取，補上 `reads: ["chunk"]`；可同時宣告以參與衝突偵測。
4. 重新載入容器後到 `/settings/hook-inspector` 確認 plugin 出現在預期 stage 下；或執行 `deno task introspect:hooks` 取得 JSON。
5. 若仍在過渡期，可暫時省略 `hooks` 欄位進入 legacy 模式，但會收到 Hook Inspector 上的「未宣告」灰色標記。

## 驗證

確認啟動 log 中沒有 `hook declarations do not match registration`，並執行：

```bash
podman exec heartreverie deno task introspect:hooks | jq '.manifestDeclarations'
```

預期輸出涵蓋所有已啟用的 plugin。
