# Decisions

## 2026-07-26：v1.7.1 行情查詢與套用依資料類型隔離

### 決策
將 v1.7 單一「檢查行情更新」拆成「檢查匯率」、「檢查美股收盤價」與 disabled 的「台股尚未支援」。匯率與美股各自維護 fetching、preview、selection、error、summary、request gate 與 apply gate；重新查詢或套用其中一類，不清除或改寫另一類 state。

「檢查匯率」只呼叫 `/api/market-data/exchange-rates/preview`，套用時只更新 exchangeRates。「檢查美股收盤價」只呼叫 `/api/market-data/stock-prices/preview`，前端 request 只保留判定為 US、類型為 stock / ETF、且 ticker 有效的 holdings；套用時只更新既有 market price 欄位。台股按鈕固定 disabled，不呼叫任何 API；TW / unknown holdings 不送往 Alpha Vantage。

上方「匯率設定」不再提供直接線上更新入口，只保留最近正式套用 / 儲存時間、展開 / 收合、各幣別顯示與個別手動儲存。所有外部 ExchangeRate-API 查詢必須由「行情更新 → 檢查匯率」觸發，並經過 preview、人工選取與套用；header 顯示時間只取正式匯率 row 的 `updatedAt`。Preview 套用時以使用者按下套用的 `appliedAt` 寫入 selected rows，個別手動儲存則沿用該 row 的儲存時間。Provider `fetchedAt`、`sourceUpdatedAt`、`sourceNextUpdateAt` 與尚未套用的 preview 時間都不作為正式操作時間；沒有有效正數 timestamp 時顯示「尚未更新」。

### 理由
- ExchangeRate-API 與 Alpha Vantage 的額度、失敗狀態及使用情境不同，合併查詢會讓美股 quota 問題干擾匯率操作
- 獨立 preview / apply 讓使用者能清楚控制 provider request 額度，也避免重新查詢一類時遺失另一類結果
- 台股 provider 尚未確認前，明確停用比把台股送往不適用的美股 provider 更安全
- 移除重複的直接匯率更新入口，可確保所有線上匯率都遵守 preview-first 的人工確認安全語意

### 限制
v1.7.1 不修改 ExchangeRate-API / Alpha Vantage adapter、ticker dedup、sequential request、quota early-stop、preview API response、資料 schema 或 D1 migration；不新增台股 provider、不做 remote D1 write、不呼叫 OpenAI，也不新增 dependency。

---

## 2026-06-30：v1.7 手動行情更新採 preview-first

### 決策
新增 manual market data update foundation，分成 server-side provider abstraction、preview API 與前端 preview / apply flow。`ENABLE_MARKET_DATA_UPDATE` 與 `VITE_ENABLE_MARKET_DATA_UPDATE` 預設停用；server flag 不是字串 `true` 時，`/api/market-data/*/preview` 第一層直接拒絕，不呼叫外部 provider。

匯率 provider 採 ExchangeRate-API，使用 `EXCHANGE_RATE_API_KEY`，server 端一律 normalize 成 `rateToTwd`。若 provider 回 TWD base，`conversion_rates.USD` 代表 `1 TWD = X USD`，因此 `USD rateToTwd = 1 / X`；若 fallback base 不是 TWD，則用 `baseToTwd / baseToCurrency` 換算。

美股 / ETF latest close provider 採 Alpha Vantage `TIME_SERIES_DAILY`，使用 `MARKET_DATA_PROVIDER=alpha_vantage` 與 `MARKET_DATA_API_KEY`，只取最新可用 daily close，`basis` 固定為 `latest-close`。請求先以 provider + market + normalized ticker + price currency 建立 lookup key，同 symbol 的多筆資產只查一次，再把結果映射回各 assetId。不同 symbol 採最大併發 1 的序列查詢，不自動 retry；Alpha Vantage 回 `Note`、`Information` 或 HTTP 429 時視為 quota reached，該 symbol 回 failed，後續未送出的 symbol 回 `needs_review` / `provider_request_skipped`，並保留已成功的 partial preview。Missing time series 或 invalid symbol 只標記該 symbol failed，不 crash，也不阻止後續 symbol。台股 / unknown market 不送往 Alpha Vantage，直接回 `needs_review` 與 unsupported 說明。

Preview API 只負責驗證 Cloudflare Access JWT、fetch / normalize provider response、回傳 old / new / source / fetchedAt / warning，不讀 D1 raw assets，也不寫 D1。前端使用目前已載入的 assets / exchangeRates 建立 sanitized request，收到 preview 後讓使用者選取項目；只有按「套用選取更新」後才透過既有 dataSource 寫入 exchangeRates 或 asset `marketPrice` / `marketPriceUpdatedAt`。Cloud Mode 寫入仍走既有 stale data guard。

行情操作採明確兩層 hierarchy：「檢查 / 重新檢查行情」是只呼叫 provider 取得 preview 的 secondary action；「套用選取更新」是唯一正式寫入資料的 primary action。Checkbox、selection count 與 apply function 共用 eligibility helper：只有 `ready`、`unchanged` 或 `needs_review` 且新值為有限正數的項目可套用；failed、quota skipped、unsupported 或缺少有效新值一律 disabled。即使 selection state 被手動注入 invalid item，apply 前仍會再次過濾。

為了讓 Wrangler Pages dev 可做本機 E2E，Access shared helper 支援 `LOCAL_DEV_AUTH=true` 的固定 local identity，但必須同時符合 request hostname 是 `localhost`、`127.0.0.1` 或 `::1`。Production / preview Pages hostname 即使誤設 `LOCAL_DEV_AUTH=true`，仍不會使用 stub，會走原本 Cloudflare Access JWT issuer / audience / signature / exp / nbf 驗證。Local identity 固定為 `local-dev-user` / `local-dev@localhost.invalid`，不信任前端 header、email、user_id 或 Authorization 內容。

### 理由
- 行情資料可能有 provider 錯誤、幣別 mismatch、市場判定不明或大幅波動，不能直接覆蓋使用者資料
- Preview-first 可以讓 failed item 不可套用、needsReview 預設不勾選，保留人工確認
- Alpha Vantage 免費額度有限，因此只做手動 preview，不做自動重試或排程
- 台股資料來源若未確認官方 endpoint 與 response schema，不應硬接，以免錯價或錯幣別

### 限制
v1.7 不是即時盤中報價，不做投資建議，不新增 D1 schema / migration，不新增 dependency，不寫 secret，不做 Cloudflare Cron / scheduled update，不做自動 D1 write，不做 snapshot 自動建立，也不呼叫 OpenAI API。D1 assets 目前只持久化 `marketPrice` 與 `marketPriceUpdatedAt`；provider source / fetchedAt / basis 先保留在 preview 與前端套用狀態，不新增 schema 欄位。`LOCAL_DEV_AUTH` 預設停用，只能用於本機 loopback 驗收。

---

## 2026-06-29：v1.6.2 AI report 預設由 feature flag 停用

### 決策
保留 Cloudflare Pages 的 `OPENAI_API_KEY` 設定方式，但新增 `ENABLE_AI_REPORT` feature flag。`POST /api/ai-report` 第一層先檢查 `env.ENABLE_AI_REPORT === "true"`；若未設定或不是字串 `true`，直接回 `403` 與 `AI report is disabled.`，且不驗證 Access JWT、不讀 `OPENAI_API_KEY`、不呼叫 OpenAI、不讀寫 D1。

前端預設不顯示「產生 AI 報告草稿」按鈕與 generation UI，只保留 deterministic report、AI-ready JSON export、Markdown export 與「複製 GPT 分析提示詞」。GPT handoff prompt 是純文字，內容來自 `buildAiReadyReportInput(report)`，不呼叫任何 API。

### 理由
- 使用者希望保留 Cloudflare Pages 的 `OPENAI_API_KEY`，避免未來忘記如何重新設定
- Production 目前應避免誤按 AI report 消耗 OpenAI API 額度
- Feature flag 讓 key 存在與功能啟用分離，避免因 key 存在而自動呼叫 OpenAI

### 限制
v1.6.2 不刪除 `OPENAI_API_KEY` 文件、不新增 secret、不呼叫 OpenAI、不新增 D1 table 或 migration、不做 D1 write、不改 snapshot / restore / import 流程、不新增 dependency、不改 lockfile。未來若要重新啟用，需在 Cloudflare Pages environment variables 設 `ENABLE_AI_REPORT=true` 並 redeploy production。

---

## 2026-06-29：v1.6 AI narrative report 只吃 AI-ready JSON

### 決策
新增 Cloudflare Pages Function `POST /api/ai-report`，由 Cloudflare Access JWT 驗證使用者後，只接受 v1.5 `buildAiReadyReportInput(report)` 產生的 AI-ready JSON。API 會再次驗證 `purpose`、summary、allocation、riskSummary、dataQuality 與 constraints，並移除不可信的 `user_id` / `email` 等身份欄位；若 payload 夾帶 raw `assets`、`rawAssets`、`holdings`、`transactions` 或 `snapshots`，會回 400。

OpenAI API key 僅透過 Cloudflare Pages environment variable `OPENAI_API_KEY` 提供，model 可用 `OPENAI_MODEL` 設定；repo 只放 `.env.example` placeholder，不放實際 secret。若缺少 `OPENAI_API_KEY`，API 回可讀錯誤，前端 deterministic report 仍可使用。

前端「資產報告」區塊新增「產生 AI 報告草稿」，流程固定為 deterministic report -> AI-ready JSON -> `/api/ai-report` -> Markdown。UI 可顯示、複製與下載 AI Markdown，但不讓 AI 修改 assets、financialGoals、exchangeRates 或 snapshots。

### 理由
- v1.5 已建立穩定的 AI-ready JSON input，v1.6 應延續這個安全邊界，而不是直接把 raw assets 丟給 AI
- 後端 Function 代管 OpenAI API key，可避免 secret 進入前端 bundle 或 localStorage
- Prompt 固定要求繁體中文 Markdown、禁止買賣指令與具體標的推薦，並要求資料品質不足時優先提醒人工確認

### 限制
v1.6 不新增 D1 table 或 migration、不讀 D1 raw assets、不寫入 D1、不儲存 report、不做 scheduled report、scheduled snapshot、email、notification、PDF、自動同步、background sync、offline queue、merge、rollback 或完整 conflict resolution。AI narrative report 是草稿，不構成投資建議。

---

## 2026-06-29：v1.5.1 修正 report 緊急預備金生活費單位

### 決策
`financialGoals.monthlyLivingExpense` 的標準單位維持 TWD，不改 schema、不改 localStorage / D1 既有資料，也不做 migration。UI 將欄位標示為「每月生活費（TWD）」並提示需輸入完整 TWD 金額，例如 `50000` 代表每月 5 萬元。

為了相容早期 UI 未明確標示單位時可能留下的資料，deterministic report builder 在報告計算層新增 emergency fund expense basis：當 `monthlyLivingExpense` 大於 0 且小於 1000 時，只在 report 內視為「萬元簡寫」並換算成 TWD，例如 `40` 會以 TWD 400,000 計算。Report 會在 `allocation`、`metadata` 與 `dataQuality.monthlyLivingExpense` 標示原始值、換算後 TWD 值、`emergencyFundUnit` 與 `unitAssumption`，並產生一筆資料品質 action item 要求人工確認單位。

### 理由
- v1.4 / v1.5 report 直接用 `cashTwd / monthlyLivingExpense`，當 Cloud Mode 舊資料為 `40` 時會被視為 TWD 40 元，導致緊急預備金顯示數萬個月
- 直接改 schema 或自動轉換 D1 既有資料風險較高，也會超出 hotfix 範圍
- 在 report 層做相容換算並明確標示單位，可避免荒謬輸出，同時保留使用者人工確認與後續手動修正空間

### 限制
v1.5.1 不呼叫 AI、不新增 API key、不改 D1 schema、不新增 migration、不寫入 D1、不改 Cloudflare Dashboard、不做投資建議、不做自動同步或 conflict resolution。`1..999` 的萬元簡寫判定只用於 report 計算與顯示，不會自動修改已儲存的 financialGoals。

---

## 2026-06-28：v1.5 優化 deterministic report UX 與 AI-ready export

### 決策
v1.5 保留 v1.4 的 deterministic report foundation，但將 UI 中文化為「規則型資產報告」，並把 `riskFlags` 與 `actionItems` 整理成更穩定、可讀的 schema。`riskFlags` 具備 `id`、`severity`、`category`、`title`、`message` 與 `relatedAssetIds`；`actionItems` 具備 `id`、`priority`、`category`、`title`、`message` 與 `relatedAssetIds`。為避免破壞舊 UI 與測試，仍保留 `code` / `label` 相容欄位。

新增兩個純前端 export helper：`buildAiReadyReportInput(report)` 與 `buildMarkdownAssetReport(report)`。AI-ready JSON 只把 deterministic report 轉成未來 AI narrative report 可使用的穩定 input schema；Markdown report 則供人類直接閱讀與保存。

### 理由
- 未來 AI narrative report 需要穩定、去除 UI 雜訊的 input，而不是直接讀 raw assets 或任意 UI text
- 在還沒接 AI API 前，先把風險旗標、待處理事項分類與 disclaimer 固定，可以降低後續 prompt / agent pipeline 的不確定性
- Markdown export 可支援人工審閱與記錄，不需要引入 PDF 或後端 report 儲存

### 限制
v1.5 不呼叫 AI、不新增 OpenAI API key、不新增 secret、不做投資買賣建議、不新增後端 report API、不寫入 D1、不新增 D1 table 或 migration、不做 scheduled report、scheduled snapshot、email、notification、PDF、自動雙向同步、background sync、offline queue、merge、conflict resolution 或 rollback。

---

## 2026-06-27：v1.4 新增 deterministic asset report foundation

### 決策
新增 `src/report/buildAssetReport.js`，以目前 App 已載入的 `assets`、`financialGoals`、`exchangeRates` 與 snapshot metadata 即時計算 schema version 1 的 deterministic asset report。Report 內容包含 summary、allocation、riskFlags、actionItems、staleAssets、concentration 與 dataQuality，並可在 UI 重新產生與下載 JSON。

Report builder 沿用既有 `utils.js` 的淨值、曝險、集中度、stale asset 與 financial goals 計算邏輯，不另寫一套財務算法。`monthlyLivingExpense` 依既有 UI 與 `DEFAULT_FINANCIAL_GOALS` 定義視為 TWD 金額，因此 emergency fund months 使用 `cashTwd / monthlyLivingExpense`。

### 理由
- 未來 AI report 不應直接吃 raw assets；先建立 deterministic report 作為穩定 input，可以讓規則、測試與資料品質先被固定
- 規則型 report 不需要 API key，不會引入 secret 或 AI 服務依賴，也不會讓使用者誤以為這是投資建議
- Report 即時計算且可下載 JSON，能先支援人工檢查與後續 agent pipeline，不需要 D1 schema 或 report table

### 限制
v1.4 不呼叫 AI、不做投資買賣建議、不做 scheduled report、scheduled snapshot、email、notification、PDF、D1 寫入、D1 schema migration、自動雙向同步、background sync、offline queue、merge 或 conflict resolution。Report 只反映目前 App 已載入的資料。

---

## 2026-06-27：v1.3 新增 Cloud Mode stale data write guard

### 決策
新增 `GET /api/cloud-revision`，由 Cloudflare Access JWT 驗證目前使用者後，只回該使用者的 D1 revision timestamps：`assetsUpdatedAt`、`financialGoalsUpdatedAt`、`exchangeRatesUpdatedAt` 與三者最大值 `cloudUpdatedAt`。Assets revision 會包含 soft-deleted rows 的 `updated_at`，避免其他裝置刪除資料時漏偵測。

前端 Cloud Mode 載入 D1 data 時記錄 baseline revision。所有會改變 cloud copy 的操作，包括 assets create / update / delete、financialGoals update、exchangeRates update、`import-local-backup` replace 與 snapshot restore，寫入前都先重新查 revision；若目前 D1 的 `cloudUpdatedAt` 晚於 baseline，dataSource 會丟出 `STALE_CLOUD_DATA`，App 阻止寫入、不更新 UI state、不寫 localStorage，並提示使用者重新整理雲端資料。

### 理由
- v1.0-v1.2 已讓手機與電腦共用 D1 canonical data，但尚未處理同時開多頁或跨裝置先後修改的覆蓋風險
- 在沒有 merge UI、rollback detail 與完整 conflict resolution 前，最安全的最小可行方案是阻止 stale write，要求使用者先重新載入最新雲端資料
- Revision endpoint 只使用既有 `updated_at` 欄位，不需要 D1 schema migration，也不需要保存額外 secret

### 限制
v1.3 不是完整 conflict resolution：不做 merge、不做 override button、不做自動雙向同步、background sync、offline queue、agent report 或 AI 建議。Revision check 只能防止「載入後雲端已更新」的覆蓋風險，無法提供欄位層級差異比較。

---

## 2026-06-26：v1.2 新增 D1 snapshot 與 guarded restore

### 決策
v1.2 使用既有 `asset_snapshots` table，不新增 migration。`payload_json` 保存完整 snapshot payload，包含 `version`、`createdAt`、`reason`、`source`、`data.assets`、`data.financialGoals`、`data.exchangeRates` 與 metadata；`reason` / `label` 也放在 payload metadata 內，list API 從 `payload_json` 解析 metadata，不需要新增欄位。

新增 snapshot API：`GET /api/snapshots` 只回 metadata；`POST /api/snapshots` 從目前 verified user 的 D1 cloud data 建立 snapshot；`GET /api/snapshots/:id` 只允許讀自己的完整 snapshot；restore preview 不修改 D1；restore 必須收到 `confirm: "RESTORE"`，且 restore 前會先建立 `before_restore` snapshot。`POST /api/import-local-backup` 在 replace cloud copy 前會先建立 `before_cloud_import` snapshot，即使目前 D1 是空資料也建立空 snapshot 作為操作紀錄；若 snapshot 建立失敗，匯入不繼續。

### 理由
- 既有 schema 的 `payload_json` 已足夠保存完整 cloud backup，不需要為 reason / label 先做 schema migration
- restore 是覆蓋性操作，必須先 preview、明確確認，並自動建立可回退的 before_restore snapshot
- import-local-backup 也是 replace 操作，因此覆蓋前先建立 snapshot 可以降低 production 操作風險
- Snapshot 只從 D1 current data 產生，不接受任意 JSON restore，可避免不受信任檔案直接覆蓋 cloud data

### 限制
v1.2 仍不做自動雙向同步、background sync、offline queue、conflict resolution、agent report、AI 建議或 scheduled snapshot。localStorage 仍是 local mode / fallback；restore 成功後只重新載入 cloud data，不寫入 localStorage。

---

## 2026-06-25：v1.1 讓 Cloud Mode 寫入 financialGoals 與 exchangeRates

### 決策
Cloud Mode 下，assets、financialGoals 與 exchangeRates 都改由 Cloudflare D1 read/write 管理。`PUT /api/financial-goals` 會以已驗證 Cloudflare Access user 的 `user_id` upsert `financial_goals.goals_json`；`PUT /api/exchange-rates` 會以 replace 策略刪除同 user 舊的 `exchange_rates` rows，再插入最新一筆匯率資料。
前端 `dataSource` 在 local mode 仍只讀寫 localStorage；在 cloud mode 只呼叫 cloudStore，不做同時寫 localStorage 與 D1。Cloud 寫入失敗時，App 不更新 UI state，並顯示「儲存失敗，資料未變更」。

### 理由
- v1.0 已能跨手機 / 電腦共用 D1 assets，但 dashboard 若沿用本機 goals / rates，跨裝置呈現會不完整
- goals 使用 `user_id` unique upsert，可維持每位使用者一份目前設定
- exchangeRates 採 replace 最新資料，能避免累積多筆匯率版本造成讀取語意不清；歷史匯率或 snapshots 應由後續 snapshot 機制處理
- 不做雙寫可降低 localStorage 與 D1 分歧風險

### 限制
v1.1 仍不做自動雙向同步、background sync、offline queue、conflict resolution、agent report 或 AI 建議。手機與電腦在 Cloud Mode 下共用 D1 資料，但需要重新整理或重新讀取才會看到另一端變更。v1.2 才考慮 conflict detection、last-write-wins warning 與 changed elsewhere 提示；v1.3 以後才考慮 agent report / scheduled snapshot。

---

## 2026-06-25：v1.0 採 opt-in Cloud Mode，不做自動同步

### 決策
新增 opt-in Cloud Mode。預設資料源仍是本機瀏覽器 `localStorage`；只有使用者在「理財目標與備份」確認已有 D1 雲端副本、勾選備份與資料來源提醒並按下啟用後，才會把 `assetAgent.dataSourceMode` 設為 `cloud`。
Cloud Mode 啟用後，assets 的新增、編輯與刪除透過 Cloudflare Pages Functions 寫入 D1；`GET /api/assets` 只回目前 verified Access user 的 active assets，`DELETE /api/assets/:id` 使用 soft delete。
financialGoals 與 exchangeRates 在 v1.0 只從 D1 read-only 載入，雲端寫入延到 v1.1。`POST /api/import-local-backup` 保留 v0.9 手動 replace cloud copy 行為，不改成自動同步。

### 理由
- assets 是 dashboard 的核心資料，先讓使用者明確切換主資料源，可以驗證手機與電腦共用 D1 canonical assets
- 不做同時寫 localStorage 與 D1，可避免雙寫失敗造成資料分歧
- financialGoals / exchangeRates 若只依賴本機 localStorage，cloud mode 的 dashboard 會不完整；因此 v1.0 先支援 D1 read-only
- 在尚未設計 conflict detection、offline queue 與 rollback 前，不應啟用背景同步或自動覆蓋

### 限制
v1.0 不做自動雙向同步、背景同步、offline queue、conflict resolution、agent report 或 AI 建議。Cloud 寫入失敗時，前端不更新 UI state，並顯示「資料未變更」。D1 資料不會自動覆蓋 localStorage；使用者可以切回本機模式查看原本的 localStorage 資料。

---

## 2026-06-24：v0.9 只建立 D1 雲端副本，不啟用同步

### 決策
新增 `POST /api/import-local-backup`，讓已通過 Cloudflare Access JWT 驗證的使用者把 Asset Agent JSON backup 匯入 D1，建立該使用者的 cloud copy。
新增 read-only `GET /api/assets` 與 `GET /api/cloud-status`，只查目前 verified user 的 active cloud copy，不讓未驗證 request 讀取 D1。
前端在「理財目標與備份」加入 D1 雲端副本區塊：JSON 檔先 preview，使用者確認後才上傳；文案明確標示目前 app 仍使用本機 localStorage，cloud copy 不是同步。

### 理由
- 先把最完整的本機資料建立成 D1 副本，可以驗證 D1 schema、Access identity 與資料 mapping，為後續 cloud mode 做準備
- 不直接切 cloud mode，可避免手機 / 電腦資料來源突然改變，也避免尚未處理 conflict resolution 時產生資料覆蓋風險
- read-only cloud copy endpoint 可以讓後續人工比對、匯入驗收與還原工具逐步建立

### 匯入策略
採 replace cloud copy 策略：同一 user 匯入前，先將既有 active assets soft delete，再將 JSON backup 的 assets upsert 成 active copy；financial goals 與 exchange rates 則刪除該 user 舊資料後重建。
所有 D1 row 的 `user_id` 只來自已驗證 Access JWT 的 `sub` / stable user id，不信任前端 body 的 email 或 user_id。

### 限制
Cloud copy 不等於 sync；手機與電腦仍不會自動同步。v0.9 不做雙向同步、自動背景同步、衝突處理、agent report 或 AI 建議。v1.0 才會評估 cloud mode 作為主資料源。

---

## 2026-06-24：v0.8 只做 Access JWT 驗證與 D1 health check

### 決策
`functions/_shared/access.js` 改為從 `Cf-Access-Jwt-Assertion` header 或 `CF_Authorization` cookie 讀取 Cloudflare Access JWT，使用 `ACCESS_TEAM_DOMAIN` 的 JWKS 驗證 RS256 signature，並檢查 issuer、audience、`exp` 與 `nbf`。
`GET /api/health` 保持 public health check：回報 D1 binding、Access config、D1 ping 與 timestamp；若 request 帶有效 Access JWT，才額外回傳已驗證的 user identity。
assets、financial goals、exchange rates 與 import-local-backup API 仍不實作 cloud sync；通過 auth 後回 501，避免 v0.8 被誤用為正式同步。
前端 App 行為不變，`localStorage` 仍是預設且唯一啟用的 canonical data source。

### 理由
- Cloudflare Access 保護入口不等於 API 已有可信使用者身份；API 必須自行驗證 Access JWT
- D1 binding health check 可先確認 Cloudflare runtime、binding 與 DB reachability，降低 v0.9 匯入資料時的環境風險
- 在沒有衝突處理與 rollback 前，不應讓資料 API 讀寫 D1，否則會製造使用者誤以為已同步的風險

### 限制
需要在 Cloudflare Pages 設定 `ACCESS_TEAM_DOMAIN` 與 `ACCESS_AUD`。本輪不做 localStorage 匯入 D1、不切 cloud mode、不新增同步排程，也不把任何 secret 寫入 repo。

---

## 2026-06-24：v0.7.1 補正式 Wrangler D1 設定

### 決策
新增最小化 `wrangler.jsonc`，只保存非 secret 的 Cloudflare / D1 設定：app name、compatibility date、`ASSET_AGENT_DB` binding、`asset-agent-prod` database name、database id 與 `migrations` 目錄。
文件補上 `conda activate asset-agent-node`、`npx wrangler@latest whoami`、D1 migration 狀態檢查與 future migration 套用流程。
App 行為不變，`localStorage` 仍是預設且唯一啟用的 canonical data source；v0.8 才處理 Access JWT verification、D1 binding health check 與實際 cloud sync。

### 理由
- v0.7 D1 resource、Pages binding 與 first migration 已完成後，專案需要正式 Wrangler config，避免後續每次 migration 都依賴 `/private/tmp` 一次性 config workaround
- `wrangler.jsonc` 不需要保存 secret，可安全納入 repo，並讓 D1 操作指令固定使用 `ASSET_AGENT_DB`
- 先整理設定與文件，能降低 v0.8 接 Access JWT 與同步流程時的環境不確定性

### 限制
尚未填入 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD`，也未實作 Access JWT 驗證、D1 binding health check、localStorage 匯入 D1 或跨裝置同步。

---

## 2026-06-23：v0.7 只建立 Cloudflare D1 同步基礎

### 決策
v0.7 新增 Cloudflare D1 migration、Pages Functions API skeleton、Cloudflare Access identity helper stub，以及 `src/data/` 下的 local / cloud / dataSource abstraction。
前端 App 透過 `defaultDataSource` 讀寫資料，但預設仍固定使用 localStorage；Cloudflare D1 僅顯示為「準備中」，不讓使用者誤以為已跨裝置同步。
資料 API 需要 `requireAuthenticatedUser`，但目前尚未完成 Access JWT 驗證，因此會安全地回 401；不接受前端傳來的 email 作為身份。

### 理由
- 手機與電腦要共用 canonical data，需要先穩定 D1 schema 與 API 邊界
- 直接把 localStorage 移除或一次切到雲端，會讓既有 JSON / CSV 備份與本機資料風險過高
- Cloudflare Access 只保護入口，不代表 API 已經有可靠 user identity；後端必須自行驗證 Access JWT
- 先建立 data layer，可避免 React component 之後到處散落 localStorage 或 fetch 呼叫

### 限制
尚未建立 Cloudflare D1 resource、未綁定 `ASSET_AGENT_DB`、未套用 migration、未完成 JWT 驗證，也尚未把 UI 接到雲端 API。v0.8 需要補上 Access JWT 驗證、D1 binding、local backup 匯入 D1 與同步衝突策略。

---

## 2026-06-21：部署 base path 依環境決定

### 決策
`vite.config.js` 不再固定使用 GitHub Pages 的 `/Asset-manager/`，改為優先讀取 `VITE_BASE`。若未設定 `VITE_BASE`，Cloudflare Pages 環境偵測到 `CF_PAGES` 時使用 `/`，其他 build 預設仍使用 `/Asset-manager/`。
GitHub Actions workflow 明確設定 `VITE_BASE=/Asset-manager/`，Cloudflare Pages 建議設定 `VITE_BASE=/`，兩邊可用同一個 `npm run build`。

### 理由
- GitHub Pages 部署在 repo 子路徑，需要 `/Asset-manager/` 才能正確載入 assets
- Cloudflare Pages 部署在根網域，需要 `/`，否則會把 JS / CSS 指到不存在的 `/Asset-manager/` 路徑
- 以環境變數控制 base path 可以避免為兩個部署平台維護不同 build script

### 限制
若未來 Cloudflare Pages 改用自訂子路徑或 GitHub Pages repo 名稱變更，需同步調整部署環境的 `VITE_BASE`。

---

## 2026-06-17：validation 採 inline UX，不以 window.confirm 作為主流程

### 決策
新增 / 編輯表單即時顯示 `validateAssetInput` 回傳的 error 與 warning。error 會讓主要送出按鈕 disabled；warning 不阻止資料寫入，但使用者必須先在表單內按下確認，送出才會啟用。
CSV 匯入 preview 同樣在頁面內分區顯示正常列、提醒列與錯誤列；有 warning row 時，需先在 preview 內確認 warning，才允許匯入可匯入資料。
資產明細以低飽和 badge 呈現幣別待確認、高集中與資料過期，待處理事項若能對應資產，點擊後會填入資產明細搜尋框。

### 理由
- `window.confirm` 會中斷使用者檢查表單內容，也不利於日後做更細緻的 agent 提醒與審閱流程
- inline validation 可同時保留警示內容、表單上下文與明確的人工確認動作
- 使用 fingerprint 綁定表單內容與 validation 結果，可避免使用者確認舊 warning 後修改欄位卻直接送出

### 限制
目前仍未加入 React component test 或瀏覽器 e2e test，v0.6 先以 pure helper 測試保護 submit gate、CSV import gate 與 badge 判斷。清空資料等破壞性流程仍保留 browser confirm / prompt 作為額外保護。

---

## 2026-06-16：ETF 獨立類型與共用資料驗證

### 決策
新增 `type: "etf"`，ETF 與股票共用 ticker、shares、buyPrice、buyDate、marketPrice 等欄位，但在資產配置、明細篩選與集中度風險中獨立呈現。
表單新增 / 編輯與 CSV 匯入 preview 共用 `validateAssetInput`，同一套規則負責 ticker 幣別建議、數值欄位、日期格式、價格差異、單一標的集中度與股票 / ETF / 基金總曝險。
validation 結果分為 error 與 warning：error 阻止新增或匯入；warning 不阻止，但表單會要求人工確認，CSV preview 會列出 warning row 並在確認匯入前再次提醒。

### 理由
- ETF 在投資決策與風險控管上通常介於股票與基金之間，混在 stock 或 fund 都會讓分類與集中度判斷失真
- 讓表單與 CSV 共用 validation helper，可避免同一筆資料在不同入口得到不同結果
- warning 不直接阻止寫入，保留使用者處理特殊標的或非典型幣別的彈性；error 才代表資料無法可靠計算

### 限制
目前 ETF 仍需使用者手動輸入價格，不串真實股價 API。表單 warning 仍以 `window.confirm` 呈現，後續可改成更細緻的 inline validation 區塊。

---

## 2026-06-15：CSV 作為人工整理與批次匯入格式

### 決策
新增 Asset Agent 標準 CSV 匯出、CSV 範本下載與匯入 preview。
JSON 維持完整備份格式，包含資產明細、匯率、理財目標與最後檢查時間；CSV 則只處理 `assets`，用於 Excel / Google Sheets 人工整理後批次匯入。
CSV 匯入前先 parse 與驗證，缺少 `id`、`createdAt` 或 `updatedAt` 時由前端補值，使用者確認後才加入目前資料。

### 理由
- JSON 適合完整還原 localStorage 狀態，CSV 適合人工編輯與跨工具整理
- CSV preview 可以避免格式錯誤直接污染目前資料
- 第一版不新增 parser 套件，降低 dependency 維護成本

### 限制
CSV 只支援 Asset Agent 自訂標準格式，不支援銀行、券商、信用卡原始檔，也不支援 xlsx。若日後要支援特定機構格式，需要獨立做欄位 mapping 與資料清理流程。

---

## 2026-06-15：Smoke test 先覆蓋核心資料邏輯

### 決策
測試框架使用 Vitest，第一批 smoke tests 先直接測 `src/utils.js` 裡的純資料計算與提醒 helper。
固定測試資料涵蓋 TWD / USD / JPY 現金、TWD / USD 股票、基金、TWD 貸款、匯率與理財目標；測試重點放在分組、TWD 換算、負債、集中度、新鮮度與 JSON 備份 round-trip。

### 理由
- 目前最容易被 UI 調整不小心破壞的是資產合併、總額與提醒邏輯
- 先測 pure function 可以避免瀏覽器環境成本，也能讓每次本地修改快速驗證
- App 的待處理事項與集中度風險改為呼叫同一組 helper，測試才會保護實際畫面使用的邏輯

### 限制
這批測試不做 React component rendering，也不測真實瀏覽器互動；後續若 UI 邏輯更複雜，再補 component 或 e2e smoke tests。

---

## 2026-06-15：資料可靠性提醒先採 local-only 規則

### 決策
資產資料新增 `updatedAt` 補值與顯示，分組後以組內最新 `updatedAt` 作為最後更新時間。
股票代號會依純數字 / 純英文字母推測 TWD / USD，若代號格式、幣別、高集中度或成本與目前市價差距異常，儲存前以確認提示攔截。
理財目標與 JSON 備份同樣維持在 `localStorage` 與前端檔案匯入匯出，不新增後端、登入或金融 API。

### 理由
- 後續 agent 提醒需要可靠的最後更新時間與可解釋的提醒來源
- 目前仍是 starter project，先用本地規則驗證資料流程，比過早接真實金融服務更安全
- JSON 備份能降低 localStorage 單點遺失風險，也保留未來 migration 的資料邊界

### 限制
目前股票目前市價仍由使用者手動輸入；成本與市價差距提示只在有市價欄位時生效。ETF 尚未獨立成資產類型，會先透過股票或基金類型納入曝險計算。

---

## 2026-06-15：首頁改以資產 cockpit 呈現

### 決策
首頁上方優先呈現 TWD 估算淨資產與待處理事項，資產總覽改為配置比例條與分類摘要卡；新增資產表單預設收合，集中度風險從股票佔比獨立出來。
不同幣別的淨值收合在 TWD 估算淨資產主卡內，不預設佔用首頁垂直空間。
資產明細提供關鍵字、類型、幣別、狀態與排序控制，作為資料量增加時的主要定位方式。

### 理由
- 使用者進首頁時先判斷目前資產狀態與風險，而不是先看到長表單
- 減少幣別、類別與明細資訊在多個區塊重複出現
- 資產筆數增加後，使用者可以先用分類摘要與明細篩選縮小視野
- 幣別淨值屬於次要拆解資訊，放在主卡內按需展開可降低第一屏壅塞

### 限制
本次只調整前端資訊層級與衍生顯示，不改 localStorage 資料模型，也不新增後端或外部金融 API。

---

## 2026-06-14：匯率先使用免金鑰公開來源

### 決策
匯率功能先使用 ExchangeRate-API 的 Open Access endpoint，前端按下更新時抓取 TWD 基準的最新公開匯率，並允許使用者手動覆寫。

### 理由
- 初期不需要保存 API key，降低設定成本
- 使用者可以立即更新最新可用匯率
- 手動覆寫可處理公開資料延遲、保守估值或個人採用銀行牌告匯率的情境

### 限制
免費公開端點官方標示為每日更新，並非交易級即時報價；若日後需要小時級或更高頻率資料，需改接付費 API、銀行牌告來源或自架資料服務。

---

## 2026-06-11：localStorage 使用 versioned store

### 決策
`localStorage` 的資產資料以 `{ schemaVersion, updatedAt, assets }` 儲存，讀取時仍支援舊版單純陣列格式。

### 理由
- 後續匯入、匯出與資料遷移需要明確版本
- 可以在不破壞舊資料的前提下逐步調整資料模型
- 接 Supabase 前先穩定前端資料邊界

### 後續
新增資料欄位或調整資產類型時，透過 schema version 加上明確 migration。

---

## 2026-06-11：React 版本作為主開發入口

### 決策
專案主入口使用 Vite 載入 `src/main.jsx`，後續功能都以 React app 為主。

### 理由
- README、TODO 與原始碼已經以 Vite + React 為主
- 單檔 HTML 雖然方便快速試作，但不利於後續拆分功能、狀態管理與測試
- 後續要加入 CSV、Supabase、圖表與 AI 摘要時，React 結構比較容易維護

### 後續
如果舊版單檔頁面有值得保留的功能，逐項移植到 `src/`，不要直接回到單檔維護模式。

---

## 2026-06-10：先用 localStorage，不接後端

### 決策
第一版先使用 `localStorage` 保存資料，不接 Supabase。

### 理由
- 降低初期開發複雜度
- 快速驗證 UI 與資料結構
- 避免在前端過早處理登入、權限、資料庫 schema
- 適合作為 Codex starter project

### 後續
當資料模型穩定後，再接 Supabase。

---

## 2026-06-10：股票輸入不要求名稱，只要求代號

### 決策
股票資產新增時，只輸入股票代號、股數、購入價格、日期與幣別，不另外要求股票名稱。

### 理由
- 股票名稱與代號重複性高
- 未來可由 API 或對照表自動補名稱
- 減少輸入負擔
- 適合手機快速輸入

---

## 2026-06-10：同一股票代號在總覽合併，明細保留分次購入

### 決策
股票總覽以 `ticker + currency` 聚合，顯示總股數、總成本與平均成本；每筆購入紀錄保留在可展開明細中。

### 理由
- 使用者通常關心同一股票的整體部位
- 分次購入仍需保留以便日後計算成本與損益
- UI 較精簡，不會每筆購買都佔用總覽空間

---

## 2026-06-10：貸款視為負債，但先不計算攤還

### 決策
第一版貸款只記錄本金、年限、利率與起始日期，先不計算剩餘本金或攤還表。

### 理由
- 避免一開始導入過多財務計算邏輯
- 台灣貸款可能有寬限期、浮動利率、提前還款等變化
- 後續可以獨立建立 loan engine

---

## 2026-06-10：所有中文介面使用繁體中文

### 決策
所有 UI、文件與 agent 回覆都使用繁體中文。

### 理由
符合主要使用情境與使用者偏好。
