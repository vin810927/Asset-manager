import { useEffect, useMemo, useState } from "react";
import {
  ASSET_TYPES,
  CURRENCIES,
  createAssetId,
  formatMoney,
  formatNumber,
  getAssetAmount,
  getAssetDisplayName,
  getAssetTypeLabel,
  groupStockHoldings,
  loadAssets,
  saveAssets,
  summarizeByCurrency,
  toNumber,
} from "./utils.js";

const emptyForm = {
  type: "cash",
  currency: "TWD",
  name: "",
  amount: "",
  ticker: "",
  shares: "",
  buyPrice: "",
  buyDate: new Date().toISOString().slice(0, 10),
  principal: "",
  years: "",
  annualRate: "",
  startDate: new Date().toISOString().slice(0, 10),
  note: "",
};

function App() {
  const [assets, setAssets] = useState(() => loadAssets());
  const [form, setForm] = useState(emptyForm);
  const [expandedStocks, setExpandedStocks] = useState({});

  useEffect(() => {
    saveAssets(assets);
  }, [assets]);

  const stockHoldings = useMemo(() => groupStockHoldings(assets), [assets]);
  const currencySummary = useMemo(() => summarizeByCurrency(assets), [assets]);
  const nonStockAssets = assets.filter((asset) => asset.type !== "stock");

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm(nextType = form.type) {
    setForm({
      ...emptyForm,
      type: nextType,
      buyDate: new Date().toISOString().slice(0, 10),
      startDate: new Date().toISOString().slice(0, 10),
    });
  }

  function handleTypeChange(type) {
    resetForm(type);
  }

  function handleSubmit(event) {
    event.preventDefault();

    const base = {
      id: createAssetId(),
      type: form.type,
      currency: form.currency,
      note: form.note.trim(),
      createdAt: new Date().toISOString(),
    };

    let asset;

    if (form.type === "stock") {
      if (!form.ticker.trim()) return alert("請輸入股票代號。");
      if (toNumber(form.shares) <= 0) return alert("請輸入有效股數。");
      if (toNumber(form.buyPrice) < 0) return alert("請輸入有效購入價格。");

      asset = {
        ...base,
        ticker: form.ticker.trim().toUpperCase(),
        shares: toNumber(form.shares),
        buyPrice: toNumber(form.buyPrice),
        buyDate: form.buyDate,
      };
    } else if (form.type === "loan") {
      if (!form.name.trim()) return alert("請輸入貸款名稱。");
      if (toNumber(form.principal) <= 0) return alert("請輸入有效本金。");

      asset = {
        ...base,
        name: form.name.trim(),
        principal: toNumber(form.principal),
        years: toNumber(form.years),
        annualRate: toNumber(form.annualRate),
        startDate: form.startDate,
      };
    } else {
      if (!form.name.trim()) return alert("請輸入名稱。");
      if (toNumber(form.amount) < 0) return alert("請輸入有效金額。");

      asset = {
        ...base,
        name: form.name.trim(),
        amount: toNumber(form.amount),
      };
    }

    setAssets((current) => [asset, ...current]);
    resetForm(form.type);
  }

  function deleteAsset(id) {
    const target = assets.find((asset) => asset.id === id);
    if (!target) return;

    const label = getAssetDisplayName(target);
    if (!window.confirm(`確定刪除「${label}」？`)) return;

    setAssets((current) => current.filter((asset) => asset.id !== id));
  }

  function clearAll() {
    if (!window.confirm("確定清空所有資產資料？此動作無法復原。")) return;
    setAssets([]);
    setExpandedStocks({});
  }

  function toggleStock(key) {
    setExpandedStocks((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Asset Agent</p>
          <h1>個人資產管理</h1>
          <p className="hero-subtitle">
            先用最小可行版本記錄資產，未來再接 Supabase、匯率、股價與 AI 摘要。
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={clearAll}>
          清空資料
        </button>
      </header>

      <section className="summary-grid" aria-label="資產摘要">
        {currencySummary.length === 0 ? (
          <article className="summary-card empty">
            <span>尚無資料</span>
            <strong>新增第一筆資產</strong>
          </article>
        ) : (
          currencySummary.map((item) => (
            <article className="summary-card" key={item.currency}>
              <span>{item.currency}</span>
              <strong>{formatMoney(item.net, item.currency)}</strong>
              <small>
                資產 {formatMoney(item.assets, item.currency)} · 負債{" "}
                {formatMoney(item.liabilities, item.currency)}
              </small>
            </article>
          ))
        )}
      </section>

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <h2>新增資產</h2>
            <span>{getAssetTypeLabel(form.type)}</span>
          </div>

          <div className="form-row compact">
            <label>
              類型
              <select value={form.type} onChange={(event) => handleTypeChange(event.target.value)}>
                {ASSET_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              幣別
              <select value={form.currency} onChange={(event) => updateForm("currency", event.target.value)}>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.type === "stock" && (
            <>
              <div className="form-row compact">
                <label>
                  股票代號
                  <input
                    value={form.ticker}
                    onChange={(event) => updateForm("ticker", event.target.value)}
                    placeholder="例如 2330、AAPL"
                  />
                </label>
                <label>
                  購入日期
                  <input
                    type="date"
                    value={form.buyDate}
                    onChange={(event) => updateForm("buyDate", event.target.value)}
                  />
                </label>
              </div>

              <div className="form-row compact">
                <label>
                  股數
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={form.shares}
                    onChange={(event) => updateForm("shares", event.target.value)}
                    placeholder="例如 10"
                  />
                </label>
                <label>
                  購入價格
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={form.buyPrice}
                    onChange={(event) => updateForm("buyPrice", event.target.value)}
                    placeholder="每股價格"
                  />
                </label>
              </div>
            </>
          )}

          {form.type === "loan" && (
            <>
              <label>
                貸款名稱
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="例如 房貸、車貸"
                />
              </label>

              <div className="form-row compact">
                <label>
                  本金
                  <input
                    type="number"
                    min="0"
                    value={form.principal}
                    onChange={(event) => updateForm("principal", event.target.value)}
                    placeholder="貸款本金"
                  />
                </label>
                <label>
                  年限
                  <input
                    type="number"
                    min="0"
                    value={form.years}
                    onChange={(event) => updateForm("years", event.target.value)}
                    placeholder="例如 30"
                  />
                </label>
              </div>

              <div className="form-row compact">
                <label>
                  年利率 %
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.annualRate}
                    onChange={(event) => updateForm("annualRate", event.target.value)}
                    placeholder="例如 2.1"
                  />
                </label>
                <label>
                  起始日期
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => updateForm("startDate", event.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {!["stock", "loan"].includes(form.type) && (
            <div className="form-row compact">
              <label>
                名稱
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="例如 台幣活存、ETF、黃金"
                />
              </label>
              <label>
                金額
                <input
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(event) => updateForm("amount", event.target.value)}
                  placeholder="目前金額"
                />
              </label>
            </div>
          )}

          <label>
            備註
            <input
              value={form.note}
              onChange={(event) => updateForm("note", event.target.value)}
              placeholder="選填"
            />
          </label>

          <button className="primary-button" type="submit">
            新增
          </button>
        </form>

        <section className="panel">
          <div className="panel-header">
            <h2>股票總覽</h2>
            <span>{stockHoldings.length} 檔</span>
          </div>

          <div className="list">
            {stockHoldings.length === 0 ? (
              <p className="muted">尚無股票資料。</p>
            ) : (
              stockHoldings.map((holding) => (
                <article className="list-item stock-item" key={holding.key}>
                  <button className="stock-summary" type="button" onClick={() => toggleStock(holding.key)}>
                    <div>
                      <strong>{holding.ticker}</strong>
                      <small>{holding.currency}</small>
                    </div>
                    <div>
                      <strong>{formatNumber(holding.totalShares)} 股</strong>
                      <small>均價 {formatMoney(holding.averageCost, holding.currency)}</small>
                    </div>
                    <div>
                      <strong>{formatMoney(holding.totalCost, holding.currency)}</strong>
                      <small>{holding.lots.length} 筆明細</small>
                    </div>
                  </button>

                  {expandedStocks[holding.key] && (
                    <div className="detail-list">
                      {holding.lots.map((lot) => (
                        <div className="detail-row" key={lot.id}>
                          <span>{lot.buyDate || "未填日期"}</span>
                          <span>{formatNumber(lot.shares)} 股</span>
                          <span>{formatMoney(lot.buyPrice, lot.currency)}</span>
                          <span>{formatMoney(lot.cost, lot.currency)}</span>
                          <button type="button" onClick={() => deleteAsset(lot.id)}>
                            刪除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>其他資產與負債</h2>
          <span>{nonStockAssets.length} 筆</span>
        </div>

        <div className="table-like">
          {nonStockAssets.length === 0 ? (
            <p className="muted">尚無其他資產或貸款資料。</p>
          ) : (
            nonStockAssets.map((asset) => (
              <article className="asset-row" key={asset.id}>
                <span className="badge">{getAssetTypeLabel(asset.type)}</span>
                <div>
                  <strong>{getAssetDisplayName(asset)}</strong>
                  <small>{asset.note || "無備註"}</small>
                </div>
                <div>
                  <strong>{formatMoney(getAssetAmount(asset), asset.currency)}</strong>
                  {asset.type === "loan" && (
                    <small>
                      {asset.years || 0} 年 · {asset.annualRate || 0}% · {asset.startDate}
                    </small>
                  )}
                </div>
                <button type="button" onClick={() => deleteAsset(asset.id)}>
                  刪除
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
