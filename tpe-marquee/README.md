# 桃園機場 T1 / T2 客機抵達跑馬燈

```
DEMO=1 node server.js                     # 示範資料
SOURCE_URL='https://…' node server.js     # 真實資料（JSON 或 CSV）
```
開 http://localhost:3000 ，`?t=T1` / `?t=T2` 可只看單一航廈。

- 後端每 `REFRESH_MS`（預設 60 秒）抓一次來源，前端每 30 秒向後端更新。
- 來源欄位名稱不同時，修改 `server.js` 的 `FIELDS` 對照表。
- 來源可用：桃園機場「即時航班」開放資料（data.gov.tw 資料集 7869 / 26194）或 TDX 的 FIDS API。
