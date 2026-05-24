# user-message

寫故事時，讀者每次輸入的訊息會跟著 LLM 的回覆一起存進章節 `.md` 檔。這個外掛在使用者訊息外面包上 `<user_message>` 標籤，讓後續提示詞與閱讀畫面都認得出來「這段是讀者說的話」，並自動把標籤藏起來，閱讀體驗不受影響。

## 我會看到什麼？

- 章節 `.md` 檔開頭多了一段 `<user_message>...</user_message>` 區塊，內含本回合輸入。
- 下一輪提示詞組裝時，標籤被剝掉，模型只讀到內層文字。
- 閱讀畫面也不會重複呈現使用者輸入（聊天介面已經顯示過一次）。

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關掉後外掛不啟用，使用者訊息不會被包裹。 |

## 運作原理

外掛在 `pre-write` hook 階段（priority 100）將使用者訊息包裹為：

```
<user_message>
{使用者輸入}
</user_message>

```

此包裹後的區塊寫入章節 `.md` 檔案的開頭，後接 LLM 回覆內容。

透過 manifest 的 `promptStripTags` 與 `displayStripTags` 宣告，`<user_message>` 包裹標籤會在下一輪提示詞組裝時被剝除，前端章節閱讀畫面也不會重複呈現使用者輸入。

## 檔案結構

```
plugins/user-message/
├── plugin.json     # 外掛 manifest
├── handler.ts      # pre-write hook，包裹使用者訊息
└── README.md
```
