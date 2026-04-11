# state-patches

完整的變數／狀態修補系統。LLM 輸出 `<UpdateVariable>` 區塊，內含 JSON Patch 操作指令；後端 Rust 二進位檔將修補套用至 YAML 狀態檔；前端將更新區塊渲染為可摺疊的詳情面板。

## 運作原理

### 後端流程

外掛在 `post-response` hook 階段執行 Rust 二進位檔 `state-patches`，處理故事目錄下的狀態修補。二進位檔執行以下步驟：

1. 掃描含有 `init-status.yml` 的場景目錄
2. 按編號順序讀取子目錄中的 `.md` 章節檔案
3. 提取 `<JSONPatch>` 區塊（不區分大小寫）
4. 將修補操作套用至狀態，產出 `current-status.yml`

### 支援的修補操作

| 操作 | 說明 |
|------|------|
| `replace` | 替換值（若路徑不存在則建立） |
| `delta` | 數值加減（對既有數值欄位進行增減） |
| `insert` | 插入值（若路徑不存在則建立） |
| `remove` | 移除指定路徑的值 |

路徑採用 JSON Pointer 格式（RFC 6901），支援跳脫字元。解析器具備格式容錯能力，可處理不完整的 JSON。

### 前端渲染

前端模組提取 `<UpdateVariable>...</UpdateVariable>` 區塊（及短標籤 `<update>`），渲染為可摺疊的詳情面板：

- 完整區塊顯示標題「變數更新詳情」
- 未關閉的區塊顯示「變數更新中...」
- 預設為摺疊狀態，內容以 `<pre>` 呈現

## 建置 Rust 二進位檔

使用 Containerfile 建置（不需安裝 Rust 工具鏈）：

```bash
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
```

產出路徑：`plugins/state-patches/state-patches`（外掛根目錄）

> [!TIP]
> 若已安裝 [Rust](https://www.rust-lang.org/) 工具鏈，也可直接以 cargo 建置：
>
> ```bash
> cd plugins/state-patches/rust
> cargo build --release
> cp target/release/state-patches ../state-patches
> ```

## 檔案結構

```
plugins/state-patches/
├── plugin.json        # 外掛 manifest
├── handler.js         # post-response hook，執行 Rust 二進位檔
├── frontend.js        # 前端更新區塊渲染模組
├── state-patches      # 預建置 Rust 二進位檔（已提交至 git）
├── rust/              # Rust CLI 專案
│   ├── Containerfile  # 多階段建置（cargo-chef 模式）
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── .gitignore
│   ├── AGENTS.md      # Rust 開發指引
│   └── src/
│       ├── main.rs        # CLI 進入點
│       ├── convert.rs     # JSON↔YAML 轉換
│       ├── parser.rs      # JSONPatch 解析
│       ├── yaml_nav.rs    # YAML 路徑導航
│       ├── patch_ops.rs   # 修補操作實作
│       └── pipeline.rs    # 目錄處理管線
└── README.md
```
