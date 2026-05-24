# user-message

將使用者輸入訊息以 `<user_message>` 標籤包裹寫入章節檔案，並從後續提示詞與前端顯示中清除此標籤。

## 運作原理

外掛在 `pre-write` hook 階段（priority 100）將使用者訊息包裹為：

```
<user_message>
{使用者輸入}
</user_message>

```

此包裹後的區塊寫入章節 `.md` 檔案的開頭，後接 LLM 回覆內容。

透過 `promptStripTags` 與 `displayStripTags` 宣告，`<user_message>` 包裹標籤會在下一輪提示詞組裝時被剝除，模型只讀到內層文字而不會看到 XML 雜訊；前端章節閱讀畫面也不會重複呈現使用者輸入（聊天介面自己已經顯示過一次）。

## 檔案結構

```
plugins/user-message/
├── plugin.json     # 外掛 manifest
├── handler.ts      # pre-write hook，包裹使用者訊息
└── README.md
```

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關閉後本外掛將停用，等同未安裝外掛。 |
