# threshold-lord

RP 框架提示詞，以角色扮演敘事包裝系統指令，引導 LLM 忠實執行故事內容生成。外掛同時清除 LLM 可能輸出的 `<disclaimer>` 免責聲明標籤。

## 運作原理

外掛注入兩段提示詞片段，分別位於系統提示詞的首尾：

| 片段 | Priority | 位置 | 說明 |
|------|----------|------|------|
| `threshold_lord_start` | 10 | 最前段 | 以「門之主」敘事框架開場，定義偏離清單 |
| `threshold_lord_end` | 900 | 最末段 | 以多層免責聲明結構收尾 |

同時透過 `promptStripTags` 和 `displayStripTags` 清除 `<disclaimer>` 標籤，使其不出現在後續提示詞與前端顯示中。

## 檔案結構

```
plugins/threshold-lord/
├── plugin.json                # 外掛 manifest
├── Threshold-Lord_start.md    # 開場提示詞片段
├── Threshold-Lord_end.md      # 結尾提示詞片段
└── README.md
```
