# Writer UI

Writer UI 是 HeartReverie 的編輯模式，提供直接操作章節 `.md` 檔的能力。當你需要修正 AI 寫偏的章節、補一段轉折、或重新組織既有內容時，就切到 Writer UI。

## 進入 Writer UI

在 Reader UI 的左下角會看到鉛筆圖示，點下去即進入 Writer UI；同一個故事的網址結尾改成 `/edit` 也能直接打開。

點開「編輯」按鈕後，章節主體會切換成 CodeMirror 編輯器，可直接修改 Markdown 原始碼。

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
  - wait_for: '.cm-editor'
capture: viewport
output: docs/assets/screenshots/writer-editor.png
captured_at: 2026-05-28
app_commit: 4534325
-->
![CodeMirror 編輯模式顯示章節原始碼](../assets/screenshots/writer-editor.png)

## 介面組成

Writer UI 把章節列在側邊欄，點選任一章節就能在主編輯區看到原始 Markdown 內容。主要操作有：

- **直接編輯章節**：CodeMirror 為主要編輯器；儲存時採 atomic write，避免半寫入造成檔案毀損。
- **新增、刪除、重排章節**：透過側邊欄的按鈕進行；底層直接操作檔案。
- **預覽**：將 Markdown 渲染成與 Reader UI 一致的樣式。

章節底部則是「生成新章節」的互動區，包含 plugin 貢獻的動作按鈕、文字輸入框與發送按鈕。

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
notes: 由 plugin 貢獻的動作按鈕列、使用者輸入框與發送按鈕
-->
![動作按鈕列、故事指令輸入框與發送按鈕並列](../assets/screenshots/writer-action-buttons.png)

完整的生成流程涵蓋角色設定資訊側欄、選項面板、變數更新詳情與底部互動區，整頁長度遠超過單一視窗。下圖以 full page 模式捕捉整段流程，方便對照各區塊的相對位置。

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
notes: 擷取前先把捲動位置帶回文件最頂端，避免 full_page 從捲動後的位置開始，導致頁首落在圖片中段。
-->
![章節內文、選項面板、角色側欄與底部生成區的全頁序列](../assets/screenshots/writer-generate-flow.png)

## 與 Reader UI 的搭配

最常見的工作流是「Reader 引導 → AI 寫入 → Writer 微調」。AI 寫的章節若偏離你想要的方向，切到 Writer UI 直接刪改章節原文是最快的方式；改完之後回到 Reader UI，下一回合的 `previous_context` 就會看到修正後的版本，AI 自然會延續新的方向。
