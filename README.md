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
- 同一股票代號會在總覽中合併顯示
- 股票分次購入資料保留在明細中，可展開查看
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

目前所有資產以單一陣列儲存在 `localStorage`：

```js
{
  id: string,
  type: "cash" | "stock" | "fund" | "loan" | "other",
  currency: "TWD" | "USD" | "JPY",
  createdAt: string,
  ...
}
```

股票資產：

```js
{
  type: "stock",
  ticker: "2330",
  shares: 10,
  buyPrice: 600,
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
