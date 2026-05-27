# 前端 Render 生命週期

前端 plugin 的 hook 註冊發生在 `usePlugins.initPlugins()`，需要先完成才能讓 `useMarkdownRenderer.renderChapter()` 對齊外掛的 `frontend-render` 與 `chapter:render:after` handler。為了避免「外掛尚未註冊就先渲染」的競態，閱讀器採用以下契約：

- **Readiness 雙旗標。** `usePlugins()` 暴露兩個 reactive ref：
  - `pluginsReady`：僅在 `initPlugins()` 完整成功後才為 `true`，作為診斷與 sidebar relocation watch 的依賴。
  - `pluginsSettled`：`initPlugins()` 結束後（不論成功或失敗）為 `true`，用於閘控章節渲染。
  - 失敗時透過 `useNotification` 顯示警告 toast 並降級為「無外掛」渲染，而非永久隱藏章節。
- **Idempotent 初始化。** `initPlugins()` 透過模組內的 in-flight `Promise<void>` 共享給並發呼叫，並 `await Promise.resolve(register(...))` 以支援非同步的 `register()`。
- **Readiness gate。** `ContentArea.vue` 以 `v-if="pluginsSettled && currentContent"` 閘控 `<ChapterContent>`；在 settled 之前顯示「載入中…」placeholder。
- **Sidebar relocation 契約。** `ContentArea.vue` 的 `watch([currentContent, isLastChapter, pluginsReady, renderEpoch], …, { flush: "post" })` 會：
  1. 一律先清空 `<Sidebar>`，避免上一章 panel 殘留。
  2. 若尚未 renderable（`!pluginsSettled || !currentContent`），停止後續處理。
  3. 否則把 `.plugin-sidebar` 元素從章節內容搬到 `<Sidebar>` 中。
- **Edit-save 不變式。** `useChapterNav` 暴露 `currentContent: ShallowRef<string>` 與 `renderEpoch: Ref<number>`，所有寫入都經由內部的 `commitContent()` 進行；位元組相同的覆寫也會呼叫 `triggerRef(currentContent)` 並遞增 `renderEpoch`，使下游 computed 與 watch 重新執行。`ChapterContent.vue` 在儲存編輯後呼叫 `refreshAfterEdit(targetChapter)`，停留在使用者剛剛編輯的章節並強制重新渲染。
- **Render 鏈式自我修正。** `ChapterContent.vue` 的 `tokens` computed 讀取 `pluginsReady` 與 `renderEpoch`，作為 readiness gate 的後備，使任何繞過 gate 的渲染都能在後續 invalidation 時自動更新。
