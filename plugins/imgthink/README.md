# imgthink

從閱讀器顯示中移除 `<imgthink>` 標籤，讓此標籤僅存在於 LLM 提示詞中、不在前端呈現。

## 運作原理

此外掛為純標籤清除用途，不包含提示詞片段或程式碼模組。透過 `displayStripTags` 宣告，系統在前端渲染前自動移除 `<imgthink>...</imgthink>` 區塊。LLM 提示詞中仍保留此標籤，不受影響。

## 檔案結構

```
plugins/imgthink/
├── plugin.json    # 外掛 manifest
└── README.md
```
