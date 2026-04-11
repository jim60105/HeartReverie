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

透過 `promptStripTags` 與 `displayStripTags` 宣告，`<user_message>` 標籤在下一輪提示詞組裝時被移除（避免重複傳送），在前端顯示時也不會呈現。

## 檔案結構

```
plugins/user-message/
├── plugin.json     # 外掛 manifest
├── handler.ts      # pre-write hook，包裹使用者訊息
└── README.md
```
