# Asset Agent

個人資產管理與理財輔助工具 starter project。

此專案目標是建立一個可逐步演進的資產管理 App，讓使用者能定期匯入資產數值，彙整現金、股票、基金、貸款與其他資產，未來可接上 Supabase、匯率、股價 API 與 AI 輔助分析。

## 目前功能

- 使用 React + Vite 建立前端專案
- 使用 `localStorage` 儲存資料，不需後端
- 支援資產類型：
  - 現金
  - 股票
  - ETF
  - 基金
  - 貸款
  - 其他
- 新增股票與 ETF 時只需輸入：
  - 股票代號
  - 股數
  - 購入價格
  - 購入日期
  - 幣別
- ETF 獨立於股票與基金，資產配置、明細篩選與集中度風險會分開呈現
- 同一股票 / ETF 代號會在明細中合併顯示
- 股票與 ETF 分次購入資料保留在資產明細中，可展開查看
- 資產總覽提供配置比例條與分類摘要，可點選股票、現金等大類篩選明細
- 同類型、同幣別、同名稱的非股票資產會合併顯示，明細仍可展開查看
- 資產明細可依關鍵字、類型、幣別、狀態與排序快速篩選
- 貸款會依本金、年限、利率與起始日期估算月付金、已繳比例與剩餘本金
- 可按需更新公開匯率，並以 TWD 估算跨幣別淨資產
- 支援手動編輯匯率，方便在公開資料延遲或需要保守估值時覆寫
- 支援本地資料可靠性提醒、理財目標設定與 JSON 匯入匯出備份
- 支援 Asset Agent 標準 CSV 匯出、CSV 範本下載與匯入 preview
- 支援新增表單與 CSV 匯入共用的資料驗證，error 會阻止寫入，warning 需在頁面內人工確認
- 資產明細會以低飽和 badge 標示幣別待確認、高集中與資料過期
- 新增貸款時需輸入：
  - 貸款名稱
  - 本金
  - 年限
  - 利率
  - 起始日期
  - 幣別
- 頁面採精簡單頁設計，減少捲動需求

## 技術棧

- Vite
- React
- JavaScript
- localStorage
- CSS Modules-free plain CSS

## 安裝與啟動

```bash
npm install
npm run dev
```

打包：

```bash
npm run build
```

測試：

```bash
npm test
```

預覽 production build：

```bash
npm run preview
```

## 專案結構

```text
asset-agent/
  README.md
  TODO.md
  decisions.md
  AGENTS.md
  package.json
  index.html
  src/
    App.jsx
    main.jsx
    styles.css
    utils.js
```

## 資料模型概念

目前所有資產以 versioned store 儲存在 `localStorage`：

```js
{
  schemaVersion: 1,
  updatedAt: "2026-06-11T00:00:00.000Z",
  assets: []
}
```

每筆資產仍維持下列概念：

```js
{
  id: string,
  type: "cash" | "stock" | "etf" | "fund" | "loan" | "other",
  currency: "TWD" | "USD" | "JPY",
  createdAt: string,
  updatedAt: string,
  ...
}
```

匯率資料另存在 `asset-agent.exchange-rates.v1`：

```js
{
  schemaVersion: 1,
  baseCurrency: "TWD",
  provider: "ExchangeRate-API Open Access",
  fetchedAt: "2026-06-14T10:00:00.000Z",
  sourceUpdatedAt: "Sun, 14 Jun 2026 00:02:31 +0000",
  rates: {
    USD: {
      currency: "USD",
      rateToTwd: 31.6,
      source: "api",
      updatedAt: "2026-06-14T10:00:00.000Z"
    }
  }
}
```

股票資產：

```js
{
  type: "stock",
  ticker: "2330",
  shares: 10,
  buyPrice: 600,
  marketPrice: 650, // optional, manual input
  marketPriceUpdatedAt: "2026-06-15",
  buyDate: "2026-06-10",
  note: ""
}
```

ETF 資產與股票共用 ticker、shares、buyPrice、buyDate 等欄位，但 `type` 使用 `"etf"`，讓 ETF 在資產配置與集中度風險中獨立呈現：

```js
{
  type: "etf",
  ticker: "0050",
  shares: 20,
  buyPrice: 160,
  marketPrice: 162, // optional, manual input
  marketPriceUpdatedAt: "2026-06-15",
  buyDate: "2026-06-10",
  note: ""
}
```

貸款：

```js
{
  type: "loan",
  name: "房貸",
  principal: 10000000,
  years: 30,
  annualRate: 2.1,
  startDate: "2026-06-10",
  note: ""
}
```

## 匯入與匯出

JSON 是完整備份格式，包含資產明細、匯率、理財目標與最後檢查時間，適合在更換瀏覽器或重建 localStorage 前保存完整狀態。

CSV 是人工整理與批次匯入格式，只處理 `assets`。使用者可以下載標準 CSV 範本，在 Excel 或 Google Sheets 編輯後匯入。匯入時會先顯示 preview，列出可匯入筆數、正常列、提醒列與錯誤列，按確認後才加入目前資料。

CSV 欄位包含：

```text
id,type,name,ticker,currency,amount,shares,buyPrice,marketPrice,marketPriceUpdatedAt,buyDate,principal,years,annualRate,startDate,note,createdAt,updatedAt
```

目前 CSV 不支援銀行、券商或信用卡原始檔，也不支援 xlsx。銀行或券商資料需先整理成 Asset Agent 標準 CSV。

CSV 匯入 preview 會區分：

- error：例如不合法 type、缺少 ticker、股數或購入價格不是有效數字。error row 不會進入 assets，也不能被匯入。
- warning：例如數字代號使用 USD、英文代號使用 TWD、價格差異過大或集中度偏高。warning row 可匯入，但使用者需先在 preview 內確認 warning。

## 資料驗證規則

新增表單與 CSV 匯入共用同一套驗證 helper。error 代表資料無法可靠計算，會阻止新增、編輯或匯入；warning 代表資料可計算但需要人工確認，不再以 `window.confirm` 打斷流程，而是在表單或 CSV preview 內 inline 顯示。

目前規則：

- 股票 / ETF 的 ticker 不可空白
- 股票 / ETF 的 shares 與 buyPrice 必須大於 0
- 貸款 principal、years 必須大於 0，annualRate 不可小於 0
- 日期欄位建議使用 `YYYY-MM-DD`
- 純數字 ticker 會提示可能應使用 TWD
- 純英文字母 ticker 會提示可能應使用 USD
- buyPrice 與手動市價或同 ticker 既有平均成本差距超過 80% 時會提示確認
- 單一標的與股票 / ETF / 基金總曝險超過理財目標門檻時會提示確認

## 未來方向

後續可以逐步加入：

- Supabase 後端
- 使用者登入
- 匯率 API
- 股票現價 API
- 資產淨值走勢圖
- 定期提醒匯入資產數值
- AI 理財摘要
- 多人共同記帳與資產分帳
- Excel / xlsx 範本輔助

## 安全原則

此工具只作為個人資產紀錄與研究輔助，不應自動下單、轉帳、購買金融商品，亦不應保存密碼、API key、token 或醫療個資。
