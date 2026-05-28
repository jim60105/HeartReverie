# Writer UI

HeartReverie 沒有獨立的「Writer UI」頁面或網址。撰寫、修訂、AI 生成都在同一個故事頁面（路由 `/<series>/<story>/...`）內完成，由章節工具列與頁面底部的故事指令輸入框組合提供。

## 進入故事頁面

在 Reader 首頁的故事選單中選擇任一故事，即可進入該故事的章節閱讀／撰寫畫面。畫面上半為章節主體，下半為「故事指令」輸入框與外掛動作按鈕列。

## 章節工具列：直接修訂章節原文

每個章節主體上方都有工具列，包含三顆主要按鈕：

- **編輯**：把章節主體切換為純文字編輯區，直接修改 Markdown 原始碼。儲存時引擎以 atomic write 寫回 `<series>/<story>/<n>.md`，並保留 `.bak` 備份。
- **倒回至此**：把故事狀態倒回到該章節，後續章節自動歸檔，AI 下一回合的 `previous_context` 只看到該章為止的內容。
- **從此分支**：以該章節為起點建立故事分支。

編輯模式下工具列改顯示「儲存／取消」。內建編輯器為純 `<textarea>`，存檔時走 `PUT /api/stories/:series/:story/chapters/:n`。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
  - 章節 1 已建立
steps:
  - wait_for: 'main'
  - click: 'button:has-text("編輯")'
  - wait_for: 'textarea.chapter-editor'
capture: viewport
output: docs/assets/screenshots/writer-editor.png
captured_at: 2026-05-28
app_commit: 4534325
-->
![章節編輯模式顯示原始 Markdown 與儲存／取消按鈕](../assets/screenshots/writer-editor.png)

## 故事指令輸入框：引導 AI 接續

頁面底部的輸入框（placeholder：「輸入故事指令…」）負責把故事發展意圖傳給 AI。可用按鈕：

- **✨ 發送**：以輸入框內容作為 `user_input`，呼叫 LLM 並把回應串流寫入下一個章節檔。
- **⏭ 續寫**：在最近一個章節的尾端追加生成，不開新章。
- **🔄 重送**：用上一次的 `user_input` 重新生成；常用於不滿意 AI 上一回合的產出。
- **⏹ 停止**：中止串流中的請求。

輸入框上方為 `PluginActionBar`，由外掛透過 `actionButtons` manifest 欄位貢獻互動按鈕，詳見[動作按鈕](action-buttons.md)。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
steps:
  - wait_for: 'main'
  - scroll_to: 'textarea[placeholder*="故事指令"]'
capture: viewport
output: docs/assets/screenshots/writer-action-buttons.png
captured_at: 2026-05-28
app_commit: 4534325
notes: 外掛動作按鈕列、故事指令輸入框與發送／續寫／重送按鈕並列
-->
![動作按鈕列、故事指令輸入框與發送按鈕並列](../assets/screenshots/writer-action-buttons.png)

## 兩種寫作模式的搭配

最常見的工作流是「下指令 → AI 串流寫入 → 點『編輯』修訂」：

1. 在底部輸入框描述想要的劇情走向（不是寫章節開頭），按發送。
2. AI 把回應串流寫進新章節檔。寫完後該章自動出現在主畫面上方。
3. 若 AI 寫偏，點該章工具列的「編輯」直接改 Markdown 原文；下一回合的 `previous_context` 會自動讀到修訂後版本，AI 順著新方向接續。

如需重整故事走向，配合「倒回至此」或「從此分支」處理整段歷史。

完整生成流程涵蓋章節主體、選項面板與底部互動區，整頁長度遠超過單一視窗：

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
steps:
  - wait_for: 'main'
  - scroll_to: 'top'
  - wait: 500
capture: full_page
output: docs/assets/screenshots/writer-generate-flow.png
captured_at: 2026-05-28
app_commit: 4534325
notes: 擷取前先把捲動位置帶回文件最頂端，避免 full_page 從捲動後的位置開始。
-->
![章節內文、選項面板、側欄與底部生成區的全頁序列](../assets/screenshots/writer-generate-flow.png)
