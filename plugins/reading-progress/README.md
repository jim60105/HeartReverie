# reading-progress

在手機讀到一半，回到桌機接著看，捲動位置自動跟過來。這個外掛把目前讀到的章節、捲動位置與一小段文字錨點記在伺服器上，多裝置之間隨時同步。

## 如何使用

預設開啟後，閱讀章節時捲動位置會自動上傳（節流間隔可調）。切到別的裝置打開同一個故事，外掛會抓回最新進度並跳到對應位置；若伺服器版本比本地更新，會跳出對話框讓讀者決定要套用遠端版本還是保留本地版本。

到 **設定 → 外掛 → reading-progress** 可以調整同步頻率、是否在頁面切回時重新抓取、是否記錄文字錨點等選項。

## 設定欄位

| 欄位名稱 | 型別 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 啟用閱讀進度同步 |
| `syncIntervalSeconds` | number | `5` | 捲動同步節流秒數（1–60） |
| `storageBackend` | string | `"file"` | 儲存後端，可選 `"file"` 或 `"local"` |
| `pollOnFocus` | boolean | `true` | 切回頁面時重新抓取伺服器進度 |
| `pollIntervalMs` | number | `0` | 輪詢間隔（毫秒），`0` 表示停用（0–600000） |
| `confirmRemoteJump` | boolean | `true` | 跨裝置跳轉前顯示確認對話框（僅於頁面載入時觸發一次；在站內導航至新章節時不會跳出，避免打斷生成下一章的流程） |
| `retainDays` | number | `90` | 進度保留天數（1–3650） |
| `trackSelectionAnchor` | boolean | `true` | 記錄 W3C Text Fragment 文字錨點 |

## 功能特色

- 節流式捲動同步，依 `syncIntervalSeconds` 設定控制上傳頻率
- 原子檔案寫入，避免寫入中途損毀
- 嚴格遞增修訂號（strict-monotonic revision），讓多裝置衝突可被偵測
- 捲動還原搭配 `ResizeObserver` 穩定化，等待版面完成再套用位置
- 章節頂端自動對齊：當儲存的進度位於章節最上方時，重新載入會維持 `scrollTop = 0`，工具列直接落在置頂頁首下方，不會被任何文字錨點覆寫
- W3C Text Fragment 文字錨點定位，回到上次閱讀段落
- 多裝置衝突偵測與行內對話框，讓讀者選擇保留版本
- localStorage 進度匯入，可將舊的本地端進度遷移至伺服器
- 設定面板管理所有外掛選項

## 隱私聲明

所有閱讀進度資料僅儲存於伺服器的 `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/` 目錄中。本外掛 **不會** 傳送任何遙測資料至第三方服務。若需完全移除所有進度紀錄，刪除該目錄即可。

## ⚠️ 多人共用警告

> **注意：** HeartReverie 引擎採用單一通行密語（passphrase）驗證機制，不區分使用者身分。若多人共用同一組密語，各自的閱讀進度 **將互相覆蓋**，無法區分不同使用者的資料。此外掛僅適用於單人使用情境。

## API 端點

所有端點皆掛載於外掛路由前綴下。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `PUT` | `progress/:series/:story` | 建立或更新指定故事的閱讀進度 |
| `GET` | `progress/:series/:story` | 取得指定故事的閱讀進度 |
| `DELETE` | `progress/:series/:story` | 刪除指定故事的閱讀進度 |
| `GET` | `progress` | 列出所有已儲存的閱讀進度 |
| `POST` | `import-local` | 從 localStorage 匯入閱讀進度至伺服器 |

## Revision 合約

本外掛採用 **嚴格遞增（strict-monotonic）** 的 revision 機制保證多裝置一致性：

1. 每次成功寫入，伺服器端 `revision` 加 1。
2. 客戶端上傳時附帶 `cachedRevision`；若與伺服器端 `revision` 不符，回應將包含 `conflict: true` 與當前的 `serverRevision`。
3. **客戶端收到 `conflict: true` 時，必須將本地的 `cachedRevision` 更新為 `serverRevision`**，再由讀者決定是否覆蓋。

此合約讓任何裝置都無法在未察覺衝突的情況下靜默覆蓋其他裝置的進度。

## selectionAnchor 結構

`selectionAnchor` 欄位採用 `TextFragmentAnchor` 物件格式，遵循 [W3C Text Fragment URL 規範](https://wicg.github.io/scroll-to-text-fragment/)：

```typescript
interface TextFragmentAnchor {
  prefix?: string;   // 錨點前方的脈絡文字
  textStart: string;  // 錨定文字的起始片段
  textEnd?: string;   // 錨定文字的結束片段（範圍選取時使用）
  suffix?: string;    // 錨點後方的脈絡文字
}
```

其中 `textStart` 為必填欄位，其餘為選填。此結構可直接對應至 URL 的 `#:~:text=[prefix-,]textStart[,textEnd][,-suffix]` 語法。

## 檔案說明

| 檔案 | 說明 |
| --- | --- |
| `plugin.json` | 外掛 manifest，定義名稱、版本、模組路徑與設定結構 |
| `frontend.js` | 前端模組：捲動監聽、進度同步、衝突對話框、Text Fragment 錨點處理 |
| `backend.ts` | 後端模組：REST API 路由、原子檔案讀寫、revision 管理、過期清理 |
| `README.md` | 本文件 |
