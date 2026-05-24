# polish

一鍵以文學筆觸重寫當前章節，並以原子寫入直接覆蓋章節檔案。

## 運作原理

點擊章節工具列上的 **✨ 潤飾** 按鈕後，外掛會透過 `action-button:click` hook 觸發 `polish-instruction.md` 提示詞，把章節草稿送進 LLM 進行重寫，再以 `replace: true` 模式原子覆寫該章節 `.md` 檔案。

按鈕透過 manifest 的 `visibleWhen: "last-chapter-backend"` 條件顯示，只有在閱讀最後一章時才會出現。

## 原子寫入與取消保護

- **成功時**：章節檔案以原子方式被重寫版本取代。
- **取消或錯誤時**：原檔逐位元組保留，不會留下半寫狀態。

串流途中按下取消，或模型回傳錯誤，磁碟上的章節都不會被動到，可放心隨時中斷。

## 建議用法

想保留原始草稿與潤飾版本同時存在，請在執行潤飾前先用「從此分支」功能複製一份故事。潤飾完成後外掛會自動重新載入章節，重寫結果即時顯示。

## 提示詞變數

`polish-instruction.md` 使用 Vento 範本，引擎在渲染時注入下列變數：

- `draft`：當前章節的原始內容，已套用全域 `promptStripTags`，模型只看得到實際章節正文。

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關閉後 **✨ 潤飾** 按鈕會隱藏，殘留的點擊事件也不會觸發重寫。 |

## 檔案結構

```
plugins/polish/
├── plugin.json              # 外掛 manifest，定義 action button 與設定
├── frontend.js              # action-button:click hook 處理器
├── polish-instruction.md    # 文學潤飾的 Vento 提示詞範本
└── README.md
```
