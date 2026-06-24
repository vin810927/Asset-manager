# TODO

## 近期優先

- [ ] v1.1：支援 financialGoals / exchangeRates cloud write
- [ ] v1.2：設計雲端同步衝突偵測與 rollback 策略
- [ ] 新增 cloud copy 與本機資料的人工比對 / 還原流程
- [ ] 改善 CSV preview 的欄位對照與錯誤定位
- [ ] 新增基金類型的專屬欄位
- [ ] 補 asset validation 的 component / e2e 測試
- [ ] 評估更高頻率或付費即時匯率來源

## 中期功能

- [ ] 啟用 Cloudflare D1 跨裝置同步
- [ ] 建立 asset snapshots 與 weekly report 資料來源
- [ ] 加入 Cloudflare Access 使用者 profile 管理
- [ ] 加入多人共同管理
- [ ] 接股票價格 API
- [ ] 顯示股票損益
- [ ] 顯示月度淨值變化
- [ ] 加入定期提醒匯入功能

## AI Agent 功能

- [ ] 每週產生資產摘要
- [ ] 提醒資產資料過久未更新
- [ ] 根據理財目標產生風險提示
- [ ] 整理投資部位集中度
- [ ] 提醒現金水位過低或槓桿過高
- [ ] 產生可供人工審閱的投資研究摘要

## 安全與限制

- [ ] 明確標示非投資建議
- [ ] 禁止自動下單流程
- [ ] 禁止保存券商帳密
- [ ] 禁止保存 API key 於前端
- [x] 加入資料匯出與刪除功能

## 已完成

- [x] 建立 Vite + React 專案
- [x] 將 Vite 入口整理為 React 主版本
- [x] 建立 README / TODO / decisions / AGENTS
- [x] 建立 localStorage starter app
- [x] 建立股票分次購入與合併顯示
- [x] 建立貸款輸入欄位
- [x] 加入資產淨值總覽
- [x] 加入依幣別分組統計
- [x] 將 localStorage 資料結構整理成 versioned schema
- [x] 加入匯率查看、更新與手動編輯
- [x] 合併顯示同股票與同帳戶/同標的資產
- [x] 加入資產明細的類型篩選
- [x] 加入資產大類圓餅圖與類別內佔比
- [x] 加入貸款月付金、繳款比例與剩餘本金估算
- [x] 加入資產編輯功能
- [x] 加入資產刪除確認 modal
- [x] 將首頁整理為資產 cockpit 資訊層級
- [x] 加入資產明細搜尋與精準篩選
- [x] 加入資料可靠性檢查與新鮮度提醒
- [x] 加入理財目標設定與風險提示
- [x] 加入 JSON 匯入匯出備份
- [x] 補上基礎 smoke test
- [x] 加入 Asset Agent 標準 CSV 匯出、範本下載與匯入 preview
- [x] 將 ETF 獨立成資產類型
- [x] 加入表單與 CSV 共用資料驗證 helper
- [x] CSV 匯入 preview 區分 error 與 warning
- [x] v0.6：加入表單 inline validation，移除 validation 主要流程的 window.confirm
- [x] v0.6：CSV preview warning 改為頁面內確認後匯入
- [x] v0.6：資產明細加入幣別待確認、高集中與資料過期 badge
- [x] v0.6：待處理事項可點擊填入資產明細搜尋
- [x] v0.6：補手機版 header、收合箭頭、集中度風險與分類卡 compact spacing
- [x] 支援 GitHub Pages 與 Cloudflare Pages 的 Vite base path 差異
- [x] v0.7：建立 Cloudflare D1 schema 草案與 Pages Functions API skeleton
- [x] v0.7：新增 local / cloud data layer foundation，預設仍使用 localStorage
- [x] v0.7：UI 顯示目前資料來源與 Cloudflare D1 準備中狀態
- [x] v0.7.1：新增正式 Wrangler D1 設定與 migration 操作文件
- [x] 建立 D1 database、Pages D1 binding 並套用 v0.7 foundation migration
- [x] v0.8：完成 Cloudflare Access JWT 驗證
- [x] v0.8：加入 D1 binding health check
- [x] v0.9：實作本機 JSON backup 匯入 D1 雲端副本
- [x] v0.9：新增 read-only cloud copy assets 與 cloud-status endpoint
- [x] v0.9：前端加入 D1 雲端副本 preview / 確認匯入 UI
- [x] v1.0：加入 opt-in Cloud Mode，使用者確認後才以 D1 作為 assets 主資料源
- [x] v1.0：實作 D1 assets CRUD，並維持 localStorage 為預設資料源
- [x] v1.0：financialGoals / exchangeRates 在 Cloud Mode 下從 D1 read-only 載入
