# Asset Agent

個人資產管理與理財輔助工具 starter project。

此專案目標是建立一個可逐步演進的資產管理 App，讓使用者能定期匯入資產數值，彙整現金、股票、基金、貸款與其他資產，未來可接上 Supabase、匯率、股價 API 與 AI 輔助分析。

## 目前功能

- 使用 React + Vite 建立前端專案
- 使用 `localStorage` 儲存資料，不需後端
- 支援資產類型：
  - 現金
  - 股票
  - 基金
  - 貸款
  - 其他
- 新增股票時只需輸入：
  - 股票代號
  - 股數
  - 購入價格
  - 購入日期
  - 幣別
- 同一股票代號會在明細中合併顯示
- 股票分次購入資料保留在資產明細中，可展開查看
- 資產總覽提供配置比例條與分類摘要，可點選股票、現金等大類篩選明細
- 同類型、同幣別、同名稱的非股票資產會合併顯示，明細仍可展開查看
- 資產明細可依關鍵字、類型、幣別、狀態與排序快速篩選
- 貸款會依本金、年限、利率與起始日期估算月付金、已繳比例與剩餘本金
- 可按需更新公開匯率，並以 TWD 估算跨幣別淨資產
- 支援手動編輯匯率，方便在公開資料延遲或需要保守估值時覆寫
- 支援本地資料可靠性提醒、理財目標設定與 JSON 匯入匯出備份
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
  type: "cash" | "stock" | "fund" | "loan" | "other",
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
- CSV / Excel 匯入匯出

## 安全原則

此工具只作為個人資產紀錄與研究輔助，不應自動下單、轉帳、購買金融商品，亦不應保存密碼、API key、token 或醫療個資。
