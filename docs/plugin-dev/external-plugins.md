# 使用外部外掛

本專案將部分選用外掛獨立維護於外部儲存庫 [HeartReverie_Plugins](https://codeberg.org/jim60105/HeartReverie_Plugins.git)，提供更豐富的提示詞片段與功能擴充。以下說明如何啟用這些外掛。

## 取得外部外掛

```bash
git clone https://codeberg.org/jim60105/HeartReverie_Plugins.git
```

## 設定環境變數

將 `PLUGIN_DIR` 指向已複製的目錄絕對路徑，並將外掛的 `system.md` 複製至專案根目錄覆寫預設提示詞模板（其中引用了外部外掛提供的模板變數）：

```bash
 # .env
PLUGIN_DIR=/path/to/HeartReverie_Plugins
```

```bash
 # 複製外掛提示詞模板至專案根目錄
cp /path/to/HeartReverie_Plugins/system.md ./system.md
```

或以命令列方式啟動：

```bash
PLUGIN_DIR=/path/to/HeartReverie_Plugins \
./scripts/serve.sh
```

> [!WARNING]
> 請勿以 `PROMPT_FILE` 環境變數指向外部外掛的 `system.md`。`PROMPT_FILE` 用於儲存使用者自訂的提示詞，按下「重置」按鈕時該檔案會被刪除。應以複製方式覆寫專案根目錄的 `system.md`，讓重置後仍可正確回復至外掛版提示詞。

> [!NOTE]
> 當外部 plugin 的名稱與內建 plugin 相同時，外部版本會覆蓋內建版本。系統會在 console 記錄覆蓋資訊。
