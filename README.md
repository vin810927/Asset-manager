# Asset Agent

個人資產管理與理財輔助工具 starter project。

此專案目標是建立一個可逐步演進的資產管理 App，讓使用者能定期匯入資產數值，彙整現金、股票、基金、貸款與其他資產，未來可接上 Cloudflare D1 雲端同步、匯率、股價 API 與 AI 輔助分析。

## 目前功能

- 使用 React + Vite 建立前端專案
- 目前仍以 `localStorage` 作為主資料源，不需後端
- v0.9 已可把本機 JSON 備份匯入 Cloudflare D1 雲端副本，但尚未啟用跨裝置同步
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

## 資料來源狀態

目前正式使用的 canonical data 仍是目前瀏覽器內的 `localStorage`，因此手機、電腦與不同瀏覽器之間仍會各自保存資料。

Cloudflare Access 目前只保護 Cloudflare Pages 入口，不等於資料已同步到雲端。v0.9 可以把本機 JSON 備份建立成 D1 雲端副本，但前端 dashboard、資產新增 / 編輯 / 刪除與匯率操作仍全部使用 localStorage。

目前 UI 會明確顯示：

- 目前資料來源：本機瀏覽器 `localStorage`
- Cloudflare D1 雲端同步：準備中
- Cloudflare D1 雲端副本：可建立 / 已建立 / 無法檢查

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

## 部署與 Vite base path

GitHub Pages 使用專案子路徑部署，正式網址是：

```text
https://vin810927.github.io/Asset-manager/
```

因此 GitHub Pages build 需使用：

```bash
VITE_BASE=/Asset-manager/ npm run build
```

目前 `.github/workflows/deploy.yml` 已明確設定 `VITE_BASE=/Asset-manager/`，避免 GitHub Pages 的 JS / CSS 路徑被改成根路徑。

Cloudflare Pages 使用根網域部署，正式網址是：

```text
https://asset-manager-30u.pages.dev/
```

因此 Cloudflare Pages build 需使用 `/` 作為 base path。建議設定：

```text
Build command: npm run build
Build output directory: dist
Environment variable: VITE_BASE=/
```

若未設定 `VITE_BASE`，`vite.config.js` 也會在偵測到 Cloudflare Pages 的 `CF_PAGES` 環境變數時自動使用 `/`。

## 專案結構

```text
asset-agent/
  .env.example
  README.md
  TODO.md
  decisions.md
  AGENTS.md
  package.json
  wrangler.jsonc
  index.html
  migrations/
    0001_cloud_sync_foundation.sql
  functions/
    api/
    _shared/
  src/
    App.jsx
    data/
      cloudStore.js
      dataSource.js
      localStore.js
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

目前 localStorage keys：

```text
asset-agent.assets.v1
asset-agent.exchange-rates.v1
asset-agent.financial-goals.v1
asset-agent.style-mode.v1
```

JSON backup `schemaVersion` 目前為 `1`，內容包含 `schemaVersion`、`exportedAt`、`lastCheckedAt`、`assets`、`exchangeRates` 與 `financialGoals`。

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

## Cloudflare D1 foundation

v0.7 新增 `migrations/0001_cloud_sync_foundation.sql`，作為未來雲端同步的 D1 schema 草案。v0.7.1 補上正式 `wrangler.jsonc`，讓後續查詢與套用 D1 migration 不需要再使用一次性 Wrangler config。

目前 D1 resource setup 已完成：

- D1 database：`asset-agent-prod`
- Pages binding：`ASSET_AGENT_DB`
- 已套用 migration：`0001_cloud_sync_foundation.sql`
- 已驗證 tables：`profiles`、`assets`、`exchange_rates`、`financial_goals`、`asset_snapshots`

即使 D1 已建立，目前 App 仍是 localStorage mode。`localStorage` 仍是正式資料來源，D1 尚未承接跨裝置同步。

localStorage 與 D1 的對應關係：

| localStorage 資料 | D1 table | 說明 |
| --- | --- | --- |
| `assets[]` | `assets` | 逐筆資產資料，保留現有 cash / stock / ETF / fund / loan / other 欄位，並加入 `deleted_at` 供未來 soft delete / sync 使用 |
| `exchangeRates` | `exchange_rates` | 目前匯率 store 以 `rates_json` 保存，保留 provider、fetched/source updated time |
| `financialGoals` | `financial_goals` | 理財目標以 `goals_json` 保存，先避免頻繁 schema migration |
| dashboard 衍生數字 | `asset_snapshots` | 未來 agent report / reminder 可使用每日 snapshot，不影響目前前端即時計算 |
| Cloudflare Access identity | `profiles` | 以已驗證的 Access JWT subject / email 建立使用者 profile |

Pages Functions API skeleton：

```text
GET    /api/health
GET    /api/assets
POST   /api/assets
PUT    /api/assets/:id
DELETE /api/assets/:id
GET    /api/financial-goals
PUT    /api/financial-goals
GET    /api/exchange-rates
PUT    /api/exchange-rates
POST   /api/import-local-backup
```

v0.9 已實作：

```text
GET    /api/assets               read-only cloud copy，目前只供驗證 D1 副本
GET    /api/cloud-status         回傳目前登入使用者是否已有雲端副本
POST   /api/import-local-backup  將本機 JSON backup 建立為 D1 雲端副本
```

仍未實作：

- POST / PUT / DELETE `/api/assets`
- cloud mode 作為前端主資料源
- localStorage 與 D1 的雙向同步、自動同步、衝突處理

Cloudflare Access identity 設計：

- Worker / Pages Functions 必須從 Cloudflare Access JWT 取得身份，不可相信前端傳來的 email
- v0.8 已讓 `getCurrentUserFromRequest(request, env)` 與 `requireAuthenticatedUser(request, env)` 使用 Cloudflare Access JWKS 驗證 `Cf-Access-Jwt-Assertion` header 或 `CF_Authorization` cookie
- v0.8 驗證 issuer、audience、signature、`exp` 與 `nbf`，並從已驗證 token 取得 `sub`、`email` 與 `name`
- 若缺少 token、token 無效、audience 不符或 token 過期，資料 API 會回 401
- 若 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 未設定，資料 API 會明確回報 Access 設定缺失，不會假裝成功
- v0.8 仍不實作真正 cloud sync；assets、financial goals、exchange rates 與 local backup import API 在通過 auth 後仍回 501

本機建議使用 `asset-agent-node` conda environment：

```bash
conda activate asset-agent-node
```

Wrangler 登入與帳號確認：

```bash
npx wrangler@latest whoami
```

確認 D1 database：

```bash
npx wrangler@latest d1 list
```

檢查 migration 狀態：

```bash
npx wrangler@latest d1 migrations list ASSET_AGENT_DB --remote
```

套用 future migration：

```bash
npx wrangler@latest d1 migrations apply ASSET_AGENT_DB --remote
```

查詢 remote D1 tables：

```bash
npx wrangler@latest d1 execute asset-agent-prod --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Cloudflare Pages environment variables：

```text
ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
ACCESS_AUD=<application-audience-aud-tag>
```

`ACCESS_TEAM_DOMAIN` 是 Cloudflare Access team domain，例如 `https://<team-name>.cloudflareaccess.com`。

`ACCESS_AUD` 可在 Cloudflare Zero Trust 找到：

```text
Zero Trust -> Access controls -> Applications -> asset-agent -> Additional settings -> Application Audience (AUD) Tag
```

`.env.example` 只提供 placeholder，實際值需設定在 Cloudflare Pages dashboard，不要寫死在 repo。

`wrangler.jsonc` 只保存非 secret 設定，例如 app name、compatibility date、D1 binding name、database name、database id 與 migrations directory。本專案不會在前端保存任何 D1 secret。

`GET /api/health` 是 v0.8 的 health check endpoint，回傳格式包含：

```json
{
  "ok": true,
  "mode": "localStorage-primary-cloud-foundation",
  "hasD1Binding": true,
  "hasAccessConfig": true,
  "d1Reachable": true,
  "authenticated": true,
  "userEmail": "user@example.com",
  "timestamp": "2026-06-24T00:00:00.000Z"
}
```

`/api/health` 可以公開回報 binding / config / D1 ping 狀態；若 request 具有有效 Cloudflare Access JWT，才會額外回傳已驗證的 `userEmail`。這個 endpoint 不會啟用同步，也不會讓前端主流程依賴雲端。

### D1 雲端副本匯入策略

v0.9 的「上傳 JSON 建立雲端副本」只接受 Asset Agent JSON export，並要求 Cloudflare Access JWT 驗證通過。

匯入流程：

1. 前端選擇 JSON 檔後先 preview，顯示 `schemaVersion`、assets 筆數、是否包含 `financialGoals` 與 `exchangeRates`。
2. 使用者確認後才呼叫 `POST /api/import-local-backup`。
3. 後端只使用已驗證 Access JWT 的 `sub` / `email` 作為 user identity，不信任 body 裡的 `email`、`user_id` 或其他身份欄位。
4. 後端會 upsert `profiles`，並將 assets、financial goals、exchange rates 寫入目前使用者的 cloud copy。
5. 匯入採 replace cloud copy 策略：同一 user 既有 active assets 先 soft delete，再把這次 JSON backup 的 assets 寫成新的 active copy；同一 user 的 financial goals 與 exchange rates 會先刪除後重建。

重要限制：

- Cloud copy 不等於 sync。
- app 目前仍使用本機瀏覽器 localStorage。
- 手機與電腦不會自動同步。
- v1.0 才會評估 cloud mode 作為主資料源。

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

- Cloudflare D1 雲端同步
- cloud copy 到 dashboard 的人工比對 / 還原工具
- cloud mode 作為主資料源（v1.0 後再評估）
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
