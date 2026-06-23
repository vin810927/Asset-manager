# Decisions

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
