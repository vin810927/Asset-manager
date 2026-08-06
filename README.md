# Asset Agent

個人資產管理與理財輔助工具 starter project。

此專案目標是建立一個可逐步演進的資產管理 App，讓使用者能定期匯入資產數值，彙整現金、股票、基金、貸款與其他資產，未來可接上 Cloudflare D1 雲端同步、匯率、股價 API 與 AI 輔助分析。

## 目前功能

- 使用 React + Vite 建立前端專案
- 預設仍以 `localStorage` 作為主資料源，不需後端即可使用
- v1.0 新增 opt-in Cloud Mode；使用者明確啟用後，assets 會改以 Cloudflare D1 作為主資料源
- v1.1 起，Cloud Mode 下 assets、financialGoals 與 exchangeRates 都會以 Cloudflare D1 read/write 管理
- v1.2 新增 D1 snapshot / 雲端備份安全層，可手動建立、下載與 guarded restore
- v1.3 新增 Cloud Mode 寫入前 stale data guard，避免覆蓋其他裝置已更新的 D1 資料
- v1.4 新增 deterministic asset report foundation，提供規則型摘要、風險旗標與資料品質檢查
- v1.5 優化 deterministic report UX，並新增 AI-ready JSON 與 Markdown report export
- v1.6 新增 AI 報告草稿；後端只接收 AI-ready JSON，不直接讀 raw assets，不寫入 D1
- v1.7 新增手動行情更新 preview foundation，可檢查匯率與股票 / ETF 最新可用收盤價，但預設停用且套用前必須人工確認
- v1.7.1 將匯率、美股與台股行情操作拆開；匯率與美股各自 preview / apply，台股入口保持停用且不呼叫 provider
- Cloud Mode 不是自動雙向同步；手機與電腦共用 D1 資料，但需要重新整理或重新讀取才會看到另一端變更
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
- 可從「行情更新」先檢查公開匯率，人工選取並套用後再以 TWD 估算跨幣別淨資產
- 支援手動編輯匯率，方便在公開資料延遲或需要保守估值時覆寫
- 支援手動行情更新 preview；只顯示 old / new / source / fetchedAt / warning，使用者選取並確認後才會更新匯率或市價欄位
- 支援本地資料可靠性提醒、理財目標設定與 JSON 匯入匯出備份
- 支援 Asset Agent 標準 CSV 匯出、CSV 範本下載與匯入 preview
- 支援新增表單與 CSV 匯入共用的資料驗證，error 會阻止寫入，warning 需在頁面內人工確認
- 資產明細會以低飽和 badge 標示幣別待確認、高集中與資料過期
- 資產報告可即時計算並下載 deterministic JSON、AI-ready JSON 與 Markdown；報告未使用 AI，也不會寫入 D1
- 新增貸款時需輸入：
  - 貸款名稱
  - 本金
  - 年限
  - 利率
  - 起始日期
  - 幣別
- 頁面採精簡單頁設計，減少捲動需求

## 資料來源狀態

預設資料源仍是目前瀏覽器內的 `localStorage`，因此未啟用 Cloud Mode 時，手機、電腦與不同瀏覽器之間仍會各自保存資料。啟用 Cloud Mode 後，Cloudflare D1 會成為主要資料源。

Cloudflare Access 目前保護 Cloudflare Pages 入口，API 也會驗證 Access JWT。v0.9 可以把本機 JSON 備份建立成 D1 雲端副本。v1.0 起，使用者可以在已有 D1 雲端副本後，手動 opt-in 啟用 Cloud Mode，讓 assets 的新增、編輯與刪除寫入 D1。v1.1 起，financialGoals 與 exchangeRates 也會在 Cloud Mode 下寫入 D1。

Cloud Mode 不是自動同步。啟用前後都不會自動把 D1 資料覆蓋回 localStorage，也不會做雙向同步、背景同步、offline queue 或 conflict resolution。
`localStorage` 仍可作為 fallback / 本機模式；切回本機模式時會使用瀏覽器原本保存的本機資料。

目前 UI 會明確顯示：

- 目前資料來源：本機瀏覽器 `localStorage`
- Cloud Mode：未啟用 / 已啟用
- Cloudflare D1 雲端副本：可建立 / 已建立 / 已啟用 / 無法檢查

Cloud Mode 啟用後：

- assets：D1 read/write
- financialGoals：D1 read/write
- exchangeRates：D1 read/write
- D1 snapshots：可手動建立、下載，restore 前會 preview 並要求明確確認
- localStorage：僅作為本機 fallback / 手動備份
- 寫入前會檢查 D1 revision；若其他裝置已更新，會阻止寫入並要求重新整理雲端資料
- 仍不做自動雙向同步

啟用 Cloud Mode 的條件：

- Cloudflare Access 已登入
- D1 binding 可用
- 已用 JSON backup 建立 D1 cloud copy
- D1 cloud copy 的 assets 筆數大於 0
- 使用者已確認啟用前建議先匯出 JSON 備份，且了解 localStorage 不會自動雙向同步

v1.2 已加入 D1 snapshot / cloud backup safety layer。Snapshot 內容包含目前 Cloud Mode 的 assets、financialGoals 與 exchangeRates；使用者可以手動建立與下載 snapshot JSON。`POST /api/import-local-backup` 在 replace D1 cloud copy 前會自動建立 `before_cloud_import` snapshot，即使目前 D1 是空資料也會建立一筆空 snapshot 作為操作紀錄。Restore 只支援從目前登入使用者自己的 D1 snapshot 還原，不支援任意 JSON restore；restore 前會先顯示 summary，要求輸入 `RESTORE`，並自動建立 `before_restore` snapshot。若 `before_restore` 建立失敗，restore 不會繼續。

v1.3 的 stale data guard 是輕量 changed-elsewhere 防呆：Cloud Mode 載入時記錄 D1 revision，新增、編輯、刪除、理財目標、匯率、snapshot restore 與 JSON replace cloud copy 前會重新檢查 revision；若 D1 已被其他裝置或頁面更新，本次寫入會被阻止，畫面不會先更新，也不會改 localStorage。使用者需要按「重新整理雲端資料」後再修改。

v1.5 延續 deterministic asset report foundation。Report 只從目前 App 已載入的 assets、financialGoals、exchangeRates 與 snapshot metadata 即時計算，包含淨資產、類別配置、幣別曝險、集中度、緊急預備金、stale assets、待處理事項與資料品質。Report 可下載 deterministic JSON、AI-ready JSON 與 Markdown，未使用 AI、不呼叫任何 AI API、不寫入 D1，也不是投資建議。

v1.6 新增 AI narrative report 草稿。前端流程固定為 deterministic report -> `buildAiReadyReportInput(report)` -> `POST /api/ai-report`；後端只接受 AI-ready JSON，會再次驗證 schema 並移除不可信的 user / email 欄位，不直接讀 raw assets、不讀 D1 assets、不寫入 D1。AI 報告只用於自然語言整理資產摘要、風險提醒、資料品質提醒與人工檢查清單，不提供買賣指令或具體標的推薦。v1.6.2 起，AI report 預設由 `ENABLE_AI_REPORT=false` 停用，即使 `OPENAI_API_KEY` 存在也不會呼叫 OpenAI API；使用者仍可下載 AI-ready JSON / Markdown 或複製 GPT 分析提示詞後手動分析。

v1.6 仍不做自動雙向同步、merge、override、background sync、offline queue、完整 conflict resolution、scheduled report、scheduled snapshot、email、notification、PDF 或 D1 report storage。

v1.7 新增 manual market data update preview。這不是即時盤中報價，也不是投資建議；只用於資產估值資料更新。`ENABLE_MARKET_DATA_UPDATE` 與 `VITE_ENABLE_MARKET_DATA_UPDATE` 預設都是 false；停用時前端只顯示提示，Pages Function 不會呼叫外部行情 provider。啟用後 API 仍只回 preview，不寫 D1；前端必須由使用者選取項目後才會透過既有 dataSource 寫入 exchangeRates 或 asset marketPrice。匯率使用 ExchangeRate-API adapter，美股 / ETF latest close 使用 Alpha Vantage `TIME_SERIES_DAILY` adapter。美股查詢會先依 provider、market、ticker 與 price currency 去重，再以最大併發 1 逐一查詢；同 ticker 多筆資產只消耗一次 provider request。遇到 Alpha Vantage quota / rate-limit 訊息後會立即停止後續 request，保留先前成功結果，並把未查詢 symbol 標示為 skipped / needsReview。台股 / unknown market 目前不硬接不可驗證 endpoint。

v1.7.1 將原本合併的「檢查行情更新」拆成「檢查匯率」、「檢查美股收盤價」與 disabled 的「台股尚未支援」。匯率與美股各自持有 fetching、preview、selection、error、summary 與 apply state；查詢或套用其中一類不會清除或覆蓋另一類。所有外部匯率查詢只由「行情更新 → 檢查匯率」觸發，必須經過 preview、人工選取與套用；上方「匯率設定」只保留正式資料時間、展開 / 收合與個別幣別手動儲存。Header 的「最近套用 / 儲存」只取正式套用或手動儲存後寫入各幣別 row 的 `updatedAt`，未套用的 preview `fetchedAt` 與 provider `sourceUpdatedAt` 不會影響顯示；沒有有效正式時間時顯示「尚未更新」。美股 request 只包含前端判定為 US、類型為 stock / ETF 且 ticker 有效的 holdings，TW / unknown market 不會送往 Alpha Vantage。Failed、skipped、unsupported 或沒有有限正數新值的項目不可選取；needsReview 預設不勾選，但有有效新值時可由使用者人工選取。

本機 Pages Functions E2E 可在 `.dev.vars` 設 `LOCAL_DEV_AUTH=true` 使用固定 local identity，但只有 `localhost`、`127.0.0.1` 或 `::1` request 會生效。Production / preview Pages hostname 即使誤設 `LOCAL_DEV_AUTH=true`，仍會走原本 Cloudflare Access JWT 驗證，不會使用 local stub。

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
    report/
      buildAssetReport.js
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

即使 D1 已建立，App 預設仍是 localStorage mode。只有使用者手動啟用 Cloud Mode 後，D1 才會成為主資料源。

localStorage 與 D1 的對應關係：

| localStorage 資料 | D1 table | 說明 |
| --- | --- | --- |
| `assets[]` | `assets` | 逐筆資產資料，保留現有 cash / stock / ETF / fund / loan / other 欄位，並加入 `deleted_at` 供未來 soft delete / sync 使用 |
| `exchangeRates` | `exchange_rates` | 目前匯率 store 以 `rates_json` 保存，保留 provider、fetched/source updated time |
| `financialGoals` | `financial_goals` | 理財目標以 `goals_json` 保存，先避免頻繁 schema migration |
| D1 cloud backup | `asset_snapshots` | v1.2 保存完整 cloud snapshot payload，供手動下載與 guarded restore |
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
GET    /api/cloud-revision
GET    /api/snapshots
POST   /api/snapshots
GET    /api/snapshots/:id
POST   /api/snapshots/:id/restore-preview
POST   /api/snapshots/:id/restore
POST   /api/import-local-backup
```

v1.3 已實作：

```text
GET    /api/assets               讀取目前 verified user 的 active D1 assets
POST   /api/assets               新增單筆 D1 asset
PUT    /api/assets/:id           更新目前 verified user 的單筆 D1 asset
DELETE /api/assets/:id           soft delete 目前 verified user 的單筆 D1 asset
GET    /api/financial-goals      讀取目前 verified user 的 D1 goals_json
PUT    /api/financial-goals      upsert 目前 verified user 的 D1 goals_json
GET    /api/exchange-rates       讀取目前 verified user 最新 D1 rates_json
PUT    /api/exchange-rates       replace 目前 verified user 的最新 D1 rates_json
GET    /api/cloud-status         回傳目前登入使用者是否已有雲端副本
GET    /api/cloud-revision       回傳目前登入使用者的 D1 revision timestamps，供寫入前 stale check
GET    /api/snapshots            只回目前 verified user 的 snapshot metadata list
POST   /api/snapshots            從目前 D1 cloud data 建立 snapshot
GET    /api/snapshots/:id        讀取目前 verified user 的完整 snapshot JSON
POST   /api/snapshots/:id/restore-preview  回傳 restore summary，不修改 D1
POST   /api/snapshots/:id/restore          需要 confirm: "RESTORE"，restore 前建立 before_restore snapshot
POST   /api/import-local-backup  將本機 JSON backup 建立為 D1 雲端副本，replace 前會建立 before_cloud_import snapshot
```

仍未實作：

- localStorage 與 D1 的雙向同步、自動同步、衝突處理
- offline queue

Cloudflare Access identity 設計：

- Worker / Pages Functions 必須從 Cloudflare Access JWT 取得身份，不可相信前端傳來的 email
- v0.8 已讓 `getCurrentUserFromRequest(request, env)` 與 `requireAuthenticatedUser(request, env)` 使用 Cloudflare Access JWKS 驗證 `Cf-Access-Jwt-Assertion` header 或 `CF_Authorization` cookie
- v0.8 驗證 issuer、audience、signature、`exp` 與 `nbf`，並從已驗證 token 取得 `sub`、`email` 與 `name`
- 若缺少 token、token 無效、audience 不符或 token 過期，資料 API 會回 401
- 若 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 未設定，資料 API 會明確回報 Access 設定缺失，不會假裝成功
- v1.1 在使用者 opt-in Cloud Mode 後，讓 assets、financial goals 與 exchange rates 都寫入 D1

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

AI 報告草稿需要在 Cloudflare Pages production / preview environment variables 設定：

```text
ENABLE_AI_REPORT=false
OPENAI_API_KEY=<set in Cloudflare Pages only>
OPENAI_MODEL=<optional lightweight text model>
```

`OPENAI_API_KEY` 可以保留在 Cloudflare Pages environment variables，避免未來忘記如何設定；但只有 `ENABLE_AI_REPORT=true` 時，`POST /api/ai-report` 才會繼續驗證 Access JWT、讀取 `OPENAI_API_KEY` 並呼叫 OpenAI。若 `ENABLE_AI_REPORT` 未設定或不是字串 `true`，API 會直接回 `403` 與 `AI report is disabled.`，不讀 key、不呼叫 OpenAI、不讀寫 D1。

若未來要重新啟用 production AI report，請將 Cloudflare Pages environment variable 設為：

```text
ENABLE_AI_REPORT=true
```

然後 redeploy production。若啟用後 `OPENAI_API_KEY` 未設定，`POST /api/ai-report` 會回傳可讀錯誤，前端 deterministic report、AI-ready JSON export 與 Markdown export 仍可正常使用。

手動行情更新 preview 預設停用。若未來要測試 production provider，Cloudflare Pages 需設定：

```text
VITE_ENABLE_MARKET_DATA_UPDATE=true
ENABLE_MARKET_DATA_UPDATE=true
MARKET_DATA_PROVIDER=alpha_vantage
MARKET_DATA_API_KEY=<set in Cloudflare Pages only>
EXCHANGE_RATE_API_KEY=<set in Cloudflare Pages only if provider requires a separate rate key>
```

`VITE_ENABLE_MARKET_DATA_UPDATE` 只控制前端是否顯示可操作 UI；`ENABLE_MARKET_DATA_UPDATE` 才是 Pages Function 是否允許呼叫 provider 的 server-side guard。即使前端被打開，只要 server flag 不是字串 `true`，preview API 仍會拒絕且不呼叫外部 provider。Exchange rates 使用 `EXCHANGE_RATE_API_KEY`，US stock / ETF latest close 使用 `MARKET_DATA_API_KEY`；兩者都只能設定在 Cloudflare Pages，不要把 API key 寫進 repo。

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
3. 後端會先建立 `before_cloud_import` snapshot；即使目前 D1 是空資料也會建立一筆空 snapshot 作為操作紀錄。
4. 如果 snapshot 建立失敗，匯入不會繼續覆蓋 D1。
5. 後端只使用已驗證 Access JWT 的 `sub` / `email` 作為 user identity，不信任 body 裡的 `email`、`user_id` 或其他身份欄位。
6. 後端會 upsert `profiles`，並將 assets、financial goals、exchange rates 寫入目前使用者的 cloud copy。
7. 匯入採 replace cloud copy 策略：同一 user 既有 active assets 先 soft delete，再把這次 JSON backup 的 assets 寫成新的 active copy；同一 user 的 financial goals 與 exchange rates 會先刪除後重建。

v1.3 Cloud Mode：

- 預設仍是 localStorage mode
- 只有使用者明確勾選確認並按下啟用後，才會把資料來源切到 D1
- cloud mode 下 assets 的新增、編輯與刪除會寫入 D1
- cloud mode 下 financialGoals / exchangeRates 也會寫入 D1
- 手機與電腦在 Cloud Mode 下共用 D1 資料，但需要重新整理或重新讀取才會看到另一端變更
- 寫入前會檢查 D1 revision；若其他裝置已更新，會阻止本次寫入並提示重新整理雲端資料
- cloud 寫入失敗時，畫面不會先更新，並會提示「資料未變更」
- 若 D1 / Access / network 發生錯誤，使用者可以切回本機模式

重要限制：

- Cloud copy 不等於 sync。
- v1.3 stale guard 不是 merge / conflict resolution，也沒有 override 寫入。
- v1.3 仍不做雙向同步、背景同步、offline queue 或完整 conflict resolution。
- localStorage 不會被 D1 自動覆蓋。

## Deterministic asset report

v1.5 的 report builder 位於 `src/report/buildAssetReport.js`。這是一個純前端、規則型 report builder，輸入目前 App 已載入的 `assets`、`financialGoals`、`exchangeRates` 與 Cloud Mode 已載入的 snapshot metadata，輸出 schema version 1 的 deterministic JSON：

```js
{
  schemaVersion: 1,
  generatedAt: "ISO timestamp",
  source: {
    dataSourceMode: "localStorage | cloudflare-d1",
    cloudMode: true,
    exchangeRatesFetchedAt: "...",
    latestSnapshotAt: "..."
  },
  summary: {
    netWorthTwd: 0,
    totalAssetsTwd: 0,
    totalLiabilitiesTwd: 0,
    cashTwd: 0,
    stockTwd: 0,
    etfTwd: 0,
    fundTwd: 0,
    loanTwd: 0
  },
  allocation: {
    byAssetType: [],
    byCurrency: [],
    stockExposurePercent: 0,
    debtRatioPercent: 0,
    emergencyFundMonths: 0,
    emergencyFundMonthlyExpenseRaw: 0,
    emergencyFundMonthlyExpenseTwd: 0,
    emergencyFundUnit: "TWD | ten-thousand-twd"
  },
  riskFlags: [],
  actionItems: [],
  staleAssets: [],
  concentration: {
    topHoldings: [],
    singleHoldingLimitBreaches: []
  },
  dataQuality: {
    assetCount: 0,
    missingMarketPriceCount: 0,
    staleMarketPriceCount: 0,
    missingTickerCount: 0,
    duplicateNameWarnings: [],
    monthlyLivingExpense: {
      rawValue: 0,
      amountTwd: 0,
      unit: "TWD | ten-thousand-twd",
      unitAssumption: "stored-twd | legacy-ten-thousand-input"
    }
  }
}
```

`riskFlags` 在 v1.5 採用下列 schema，並保留 `code` / `label` 作為相容欄位：

```js
{
  id: "single-holding-concentration",
  severity: "info | warning | critical",
  category: "allocation | concentration | debt | stale_data | data_quality | backup",
  title: "單一標的集中度偏高",
  message: "需要人工檢視的規則型說明",
  relatedAssetIds: []
}
```

`actionItems` 在 v1.5 採用下列 schema，並依 UI 分為資料品質、風險控管、市價更新、備份 / snapshot、其他：

```js
{
  id: "stale-assets",
  priority: "low | medium | high",
  category: "data_quality | risk_control | market_price_update | backup | review",
  title: "更新過期資產資料",
  message: "建議確認資料後再判讀報告",
  relatedAssetIds: []
}
```

Report 規則沿用既有 `utils.js` 的淨值、曝險、集中度、stale asset 與 financial goals 計算。`monthlyLivingExpense` 的標準單位是 TWD，UI 會標示「每月生活費（TWD）」並建議輸入完整金額，例如 `50000` 代表每月 5 萬元。為了相容早期 UI 沒有明確標示單位時可能留下的舊資料，report builder 只在報告計算層將 `1..999` 這類小值視為「萬元簡寫」換算成 TWD，例如 `40` 會以 TWD 400,000 計算，並在 `metadata.emergencyFundUnit`、`allocation.emergencyFundUnit` 與 `dataQuality.monthlyLivingExpense` 標示 `ten-thousand-twd` / `legacy-ten-thousand-input`。這不會改 financialGoals schema，也不會自動轉換 localStorage 或 D1 中的既有資料。

v1.5 新增兩種 export：

- AI-ready JSON：`purpose: "asset-agent-ai-report-input"`，包含 `financialSummary`、`allocationSummary`、`riskSummary`、`dataQuality` 與 constraints。這只是未來 AI narrative report 的結構化 input，不呼叫 AI、不上傳外部服務、不包含 Access token / secret。
- Markdown report：人類可讀的資產摘要、配置摘要、幣別曝險、風險提示、待處理事項、資料品質、snapshot 狀態與 disclaimer。

Report 不呼叫 AI、不需要 API key、不做投資買賣建議、不寫入 D1、不建立 report table，也不產生 PDF；使用者可在 UI 重新產生並下載 JSON / AI-ready JSON / Markdown。

## AI narrative report

v1.6 的 AI 報告草稿由 Cloudflare Pages Function `POST /api/ai-report` 產生。v1.6.2 起，API 第一層會檢查 `ENABLE_AI_REPORT === "true"`；預設停用時直接回 403，不會讀取 `OPENAI_API_KEY` 或呼叫 OpenAI。啟用後，API 必須通過 Cloudflare Access JWT 驗證，並只接受 AI-ready JSON：

```text
current app state
-> build deterministic report
-> buildAiReadyReportInput(report)
-> POST /api/ai-report
-> AI markdown narrative
```

安全邊界：

- AI input 只能使用 `buildAiReadyReportInput(report)` 的輸出
- 不直接把 raw assets 傳給 AI
- 不把 Access token、JWT、secret、`ACCESS_AUD` 或 `ACCESS_TEAM_DOMAIN` 傳給 AI
- 不讀 D1 raw assets，也不寫入 D1
- 不讓 AI 修改 assets、financialGoals、exchangeRates 或 snapshots
- 不提供買進、賣出、加碼、減碼或具體標的推薦
- 報告必須標示不是投資建議，且僅根據目前 App 已載入資料

前端預設不顯示「產生 AI 報告草稿」按鈕，也不顯示 generation UI；會保留 AI-ready JSON / Markdown export 與「複製 GPT 分析提示詞」功能。若未來以 build flag 重新啟用 AI report UI，UI 會顯示 AI 報告狀態、Markdown 草稿、複製 Markdown 與下載 AI 報告 Markdown。若 API key 未設定或 OpenAI API 回錯，UI 只顯示錯誤，不影響 deterministic report。

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

- cloud copy 到 dashboard 的人工比對 / 還原工具
- 更完整的 conflict detection / last-write-wins warning / changed elsewhere 詳細差異提示
- agent report / scheduled snapshot
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
