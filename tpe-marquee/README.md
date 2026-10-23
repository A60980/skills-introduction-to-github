# 桃園機場 T1 / T2 客機抵達跑馬燈

```
DEMO=1 node server.js                                         # 示範資料
TDX_CLIENT_ID=… TDX_CLIENT_SECRET=… node server.js            # TDX 即時航班（建議）
SOURCE_URL='https://…' node server.js                         # 其他來源（JSON 或 CSV）
```
開 http://localhost:3000 ，`?t=T1` / `?t=T2` 可只看單一航廈。

## TDX 模式
1. 到 https://tdx.transportdata.tw 註冊，在「會員中心 → 資料服務 → API 金鑰」取得 Client Id / Client Secret。
2. 設環境變數後啟動。程式會：
   - 用 client_credentials 取 token（快過期前自動更新）
   - 抓 `/v2/Air/FIDS/Airport/TPE`（指定機場即時航班），只保留 `ArrivalAirportID === TPE`
   - 用 `/v2/Air/Airline`、`/v2/Air/Airport` 把代碼換成中文名（一天更新一次）
3. 可用環境變數：`AIRPORT`（預設 TPE）、`TDX_PATH`（改用別的端點）、`REFRESH_MS`（預設 60000）。

## 穩定性
- 抓取失敗時保留上次資料，頁面上方顯示警告；每次請求 15 秒逾時。
- 遇到 429（限流）自動把更新間隔拉長 5 倍。
- 前端只讀本機 `/api/arrivals`，不會直接打 TDX，金鑰不會外洩到瀏覽器。

來源欄位名稱不同時，修改 `server.js` 的 `FIELDS` 對照表或 `tdxFlights()`。
