# 模板架構概覽

主模板位於專案根目錄的 `system.md`，由使用者自行撰寫。模板系統負責將核心變數與外掛提供的變數一併傳入 Vento 引擎進行渲染。外掛如何提供變數，參見[外掛系統文件][plugin-system]。

模板渲染前，引擎會分派 `prompt-assembly` hook，外掛可在該 hook 中讀取或修改 `previousContext` / `rawChapters`，並透過 `context.correlationId` 與後續的 `pre-llm-fetch` / `response-stream` / `post-response` 階段交叉關聯。詳細的 hook context 形狀與 per-handler 觀察事件請見[外掛系統 — Hook 系統](/plugin-system/hooks.md)。
