# Writer UI

Writer UI 是 HeartReverie 的編輯模式，提供直接操作章節 `.md` 檔的能力。當你需要修正 AI 寫偏的章節、補一段轉折、或重新組織既有內容時，就切到 Writer UI。

## 進入 Writer UI

在 Reader UI 的左下角會看到鉛筆圖示，點下去即進入 Writer UI；同一個故事的網址結尾改成 `/edit` 也能直接打開。

## 介面組成

Writer UI 把章節列在側邊欄，點選任一章節就能在主編輯區看到原始 Markdown 內容。主要操作有：

- **直接編輯章節**：CodeMirror 為主要編輯器；儲存時採 atomic write，避免半寫入造成檔案毀損。
- **新增、刪除、重排章節**：透過側邊欄的按鈕進行；底層直接操作檔案。
- **預覽**：將 Markdown 渲染成與 Reader UI 一致的樣式。

## 與 Reader UI 的搭配

最常見的工作流是「Reader 引導 → AI 寫入 → Writer 微調」。AI 寫的章節若偏離你想要的方向，切到 Writer UI 直接刪改章節原文是最快的方式；改完之後回到 Reader UI，下一回合的 `previous_context` 就會看到修正後的版本，AI 自然會延續新的方向。
