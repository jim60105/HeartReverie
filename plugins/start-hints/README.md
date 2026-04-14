# start-hints

提供首輪章節開場引導提示，在故事的第一回合注入創作指引，幫助 LLM 產出引人入勝的起始章節。

## 運作原理

外掛透過 `promptFragments` 注入 `start_hints` 模板變數，內容為包裹在 `<start_hints>` XML 標籤中的七項創作指引。系統模板 `system.md` 以 `{{ if isFirstRound }}` 條件判斷，僅在首輪對話時將此變數嵌入提示詞。

### 七項創作指引

1. 開場懸念 — 第一句話就拋出引人入勝的懸念
2. 世界觀建構 — 自然地介紹背景和世界觀
3. 人物登場 — 及早讓主角或重要人物登場
4. 主線確立 — 明確表達主角的目標或挑戰
5. 伏筆鋪設 — 暗示未來的重大事件
6. 石破天驚 — 用獨特的情節或視角立即抓住讀者
7. 基調定性 — 透過文字風格展現故事的類型和基調

同時透過 `promptStripTags` 和 `displayStripTags` 清除 `<start_hints>` 標籤，使其不出現在後續提示詞與前端顯示中。

## 檔案結構

```
plugins/start-hints/
├── plugin.json        # 外掛 manifest
├── start-hints.md     # 首輪開場引導提示詞片段
└── README.md
```
