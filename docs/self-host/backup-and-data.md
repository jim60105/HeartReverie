# 備份與資料

[HeartReverie 浮心夜夢][project] 的全部使用者資料集中於 `playground/` 目錄。本頁說明 playground 結構、備份/還原作法、與升級時的注意事項。

## playground 結構

```
playground/
├── _lore/                   # 全域典籍篇章
├── _logs/                   # 稽核日誌與 LLM 互動日誌
├── _plugins/                # 各外掛設定 config.json
├── _prompts/                # 自訂 system.md 覆寫
├── <系列>/
│   ├── _lore/               # 系列範圍典籍
│   └── <故事>/
│       ├── 01.md            # 章節檔
│       ├── _lore/           # 故事範圍典籍
│       └── _images/         # 由外掛生成的插圖（含 _metadata.json）
```

底線（`_`）前綴目錄為系統保留，不會被故事列表 API 列出。

## 備份

最簡單的備份方式是把整個 `playground/` 目錄打包：

```bash
tar -czf heartreverie-backup-$(date +%F).tar.gz playground/
```

進階做法：把 playground 放進 Git 儲存庫，每次撰寫完直接 commit，享有版本控制與差異比較。

## 還原

把 tar 包解壓回原位、或 git clone 至原位後直接重啟容器即可。引擎在啟動時掃描 playground 重新建立索引，無需額外步驟。

## 升級時的注意事項

- 升級到新 image 前，先 commit 或備份 playground。
- 內建外掛的 `playground/_plugins/<name>/config.json` 在升級時保留，新增的欄位以 `settingsSchema` 預設值補齊。
- 主規格欄位若被破壞性變更，會在 release notes 與 CHANGELOG 標示為 BREAKING，請依該文件指示處理。

[project]: https://github.com/jim60105/HeartReverie
