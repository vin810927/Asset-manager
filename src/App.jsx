import React, { useEffect, useMemo, useState } from "react";
import {
  ASSET_TYPES,
  CURRENCIES,
  createAssetId,
  fetchLatestExchangeRates,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRate,
  getAssetDisplayName,
  getAssetTypeLabel,
  getLoanSnapshot,
  getRateToTwd,
  groupNonStockAssets,
  groupStockHoldings,
  loadAssets,
  loadExchangeRates,
  saveAssets,
  saveExchangeRates,
  setManualExchangeRate,
  summarizeByCurrency,
  summarizeInBaseCurrency,
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

const STYLE_STORAGE_KEY = "asset-agent.style-mode.v1";
const STYLE_MODES = [
  { value: "mist", label: "霧藍", mark: "◐" },
  { value: "clear", label: "清爽", mark: "○" },
  { value: "graphite", label: "石墨", mark: "●" },
];
const PIE_COLORS = ["#365f89", "#7c8da3", "#b7815f", "#6c7a89", "#486b7a", "#8f6f8f"];

function loadStyleMode() {
  try {
    const stored = window.localStorage.getItem(STYLE_STORAGE_KEY);
    return STYLE_MODES.some((mode) => mode.value === stored) ? stored : STYLE_MODES[0].value;
  } catch {
    return STYLE_MODES[0].value;
  }
}

function buildPieGradient(items, total) {
  if (total <= 0) return "conic-gradient(var(--control-bg) 0% 100%)";

  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    const end = cursor + (item.value / total) * 100;
    cursor = end;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${end}%`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function App() {
  const [assets, setAssets] = useState(() => loadAssets());
  const [exchangeRates, setExchangeRates] = useState(() => loadExchangeRates());
  const [exchangeRateDrafts, setExchangeRateDrafts] = useState({});
  const [exchangeRateStatus, setExchangeRateStatus] = useState("");
  const [isFetchingRates, setIsFetchingRates] = useState(false);
  const [isExchangePanelOpen, setIsExchangePanelOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [expandedAssetGroups, setExpandedAssetGroups] = useState({});
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [styleMode, setStyleMode] = useState(() => loadStyleMode());
  const [selectedOverviewKey, setSelectedOverviewKey] = useState(null);

  useEffect(() => {
    saveAssets(assets);
  }, [assets]);

  useEffect(() => {
    document.documentElement.dataset.styleMode = styleMode;
    window.localStorage.setItem(STYLE_STORAGE_KEY, styleMode);
  }, [styleMode]);

  useEffect(() => {
    saveExchangeRates(exchangeRates);
  }, [exchangeRates]);

  const stockHoldings = useMemo(() => groupStockHoldings(assets), [assets]);
  const currencySummary = useMemo(() => summarizeByCurrency(assets), [assets]);
  const twdSummary = useMemo(
    () => summarizeInBaseCurrency(currencySummary, exchangeRates),
    [currencySummary, exchangeRates],
  );
  const nonStockGroups = useMemo(() => groupNonStockAssets(assets), [assets]);
  const exchangeRateRows = CURRENCIES.map((currency) => exchangeRates.rates[currency]);
  const currentStyleMode = STYLE_MODES.find((mode) => mode.value === styleMode) ?? STYLE_MODES[0];
  const stockDetailGroups = useMemo(
    () =>
      stockHoldings.map((holding) => {
        const rateToTwd = getRateToTwd(exchangeRates, holding.currency);

        return {
          key: `stock_${holding.key}`,
          type: "stock",
          typeLabel: "股票",
          name: holding.ticker,
          currency: holding.currency,
          totalAmount: holding.totalCost,
          amountText: formatMoney(holding.totalCost, holding.currency),
          baseValue: rateToTwd ? holding.totalCost * rateToTwd : null,
          primaryText: `${formatNumber(holding.totalShares)} 股`,
          secondaryText: `均價 ${formatMoney(holding.averageCost, holding.currency)}`,
          count: holding.lots.length,
          entries: holding.lots,
        };
      }),
    [exchangeRates, stockHoldings],
  );
  const otherDetailGroups = useMemo(
    () =>
      nonStockGroups.map((group) => {
        const rateToTwd = getRateToTwd(exchangeRates, group.currency);
        const isLoan = group.type === "loan";
        const loanSnapshots = isLoan ? group.entries.map((asset) => getLoanSnapshot(asset)) : [];
        const monthlyPaymentTotal = loanSnapshots.reduce((total, item) => total + item.monthlyPayment, 0);
        const amountText = isLoan
          ? `剩餘 ${formatMoney(Math.abs(group.totalAmount), group.currency)}`
          : formatMoney(group.totalAmount, group.currency);

        return {
          key: `asset_${group.key}`,
          type: group.type,
          typeLabel: getAssetTypeLabel(group.type),
          name: group.name,
          currency: group.currency,
          totalAmount: group.totalAmount,
          amountText,
          baseValue: rateToTwd ? group.totalAmount * rateToTwd : null,
          primaryText: isLoan ? `月付 ${formatMoney(monthlyPaymentTotal, group.currency)}` : amountText,
          secondaryText: `${group.entries.length} 筆明細${isLoan ? " · 依剩餘本金估算" : ""}`,
          count: group.entries.length,
          entries: group.entries,
        };
      }),
    [exchangeRates, nonStockGroups],
  );
  const assetDetailGroups = useMemo(
    () =>
      [...stockDetailGroups, ...otherDetailGroups].sort(
        (a, b) => Math.abs(b.baseValue ?? 0) - Math.abs(a.baseValue ?? 0),
      ),
    [otherDetailGroups, stockDetailGroups],
  );
  const assetTypeFilters = useMemo(() => [{ value: "all", label: "全部" }, ...ASSET_TYPES], []);
  const assetTypeCounts = useMemo(() => {
    const counts = { all: assets.length };

    for (const asset of assets) {
      counts[asset.type] = (counts[asset.type] ?? 0) + 1;
    }

    return counts;
  }, [assets]);
  const filteredAssetGroups = useMemo(() => {
    if (assetTypeFilter === "all") return assetDetailGroups;
    return assetDetailGroups.filter((group) => group.type === assetTypeFilter);
  }, [assetDetailGroups, assetTypeFilter]);
  const filteredAssetCount = filteredAssetGroups.reduce((total, group) => total + group.entries.length, 0);
  const assetOverviewGroups = useMemo(() => {
    const groups = new Map();

    for (const detailGroup of assetDetailGroups) {
      const current = groups.get(detailGroup.type) ?? {
        key: `type_${detailGroup.type}`,
        type: detailGroup.type,
        typeLabel: detailGroup.typeLabel,
        name: detailGroup.typeLabel,
        baseValue: 0,
        count: 0,
        detailGroups: [],
        hasMissingRate: false,
      };

      if (detailGroup.baseValue === null) {
        current.hasMissingRate = true;
      } else {
        current.baseValue += detailGroup.baseValue;
      }

      current.count += detailGroup.count;
      current.detailGroups.push(detailGroup);
      groups.set(detailGroup.type, current);
    }

    return Array.from(groups.values())
      .map((group) => {
        const isLoan = group.type === "loan";
        const amountText = isLoan
          ? `剩餘 ${formatMoney(Math.abs(group.baseValue), "TWD")}`
          : formatMoney(group.baseValue, "TWD");
        const primaryText =
          group.type === "stock"
            ? `${group.detailGroups.length} 檔股票`
            : `${group.detailGroups.length} 組${group.typeLabel}`;
        const secondaryText = `${group.count} 筆明細${group.hasMissingRate ? " · 缺匯率" : ""}`;

        return {
          ...group,
          currency: "TWD",
          totalAmount: group.baseValue,
          amountText,
          primaryText,
          secondaryText,
        };
      })
      .sort((a, b) => Math.abs(b.baseValue ?? 0) - Math.abs(a.baseValue ?? 0));
  }, [assetDetailGroups]);
  const selectedOverviewGroup =
    assetOverviewGroups.find((group) => group.key === selectedOverviewKey) ?? assetOverviewGroups[0] ?? null;
  const allocationItems = useMemo(() => {
    return assetOverviewGroups
      .filter((group) => group.baseValue > 0)
      .map((group) => ({
        type: group.type,
        label: group.typeLabel,
        value: group.baseValue,
        amountText: formatMoney(group.baseValue, "TWD"),
      }))
      .sort((a, b) => b.value - a.value);
  }, [assetOverviewGroups]);
  const allocationTotal = allocationItems.reduce((total, item) => total + item.value, 0);
  const pieGradient = useMemo(() => buildPieGradient(allocationItems, allocationTotal), [allocationItems, allocationTotal]);
  const selectedBreakdownItems = useMemo(() => {
    if (!selectedOverviewGroup) return [];

    return selectedOverviewGroup.detailGroups
      .filter((group) => group.baseValue > 0)
      .map((group) => ({
        key: group.key,
        label: group.name,
        value: group.baseValue,
        amountText: formatMoney(group.baseValue, "TWD"),
      }))
      .sort((a, b) => b.value - a.value);
  }, [selectedOverviewGroup]);
  const selectedBreakdownTotal = selectedBreakdownItems.reduce((total, item) => total + item.value, 0);
  const selectedBreakdownGradient = useMemo(
    () => buildPieGradient(selectedBreakdownItems, selectedBreakdownTotal),
    [selectedBreakdownItems, selectedBreakdownTotal],
  );

  useEffect(() => {
    if (assetOverviewGroups.length === 0) {
      if (selectedOverviewKey) setSelectedOverviewKey(null);
      return;
    }

    if (!selectedOverviewKey || !assetOverviewGroups.some((group) => group.key === selectedOverviewKey)) {
      setSelectedOverviewKey(assetOverviewGroups[0].key);
    }
  }, [assetOverviewGroups, selectedOverviewKey]);

  function getExchangeRateDraft(currency) {
    if (exchangeRateDrafts[currency] !== undefined) return exchangeRateDrafts[currency];
    const rate = exchangeRates.rates[currency]?.rateToTwd;
    return rate ? String(rate) : "";
  }

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
      if (toNumber(form.years) <= 0) return alert("請輸入有效年限。");
      if (toNumber(form.annualRate) < 0) return alert("請輸入有效年利率。");
      if (!form.startDate) return alert("請輸入貸款起始日期。");

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
    if (assets.length === 0) {
      window.alert("目前沒有資產資料可清空。");
      return;
    }

    if (!window.confirm("第一步確認：你要清空所有資產資料嗎？")) return;
    if (!window.confirm("第二步確認：清空後無法復原，仍要繼續嗎？")) return;

    const confirmationText = window.prompt('最後確認：請輸入「清空資料」才會執行。');
    if (confirmationText !== "清空資料") {
      window.alert("未輸入指定文字，已取消清空。");
      return;
    }

    setAssets([]);
    setExpandedAssetGroups({});
  }

  async function updateLatestExchangeRates() {
    setIsFetchingRates(true);
    setExchangeRateStatus("正在更新公開匯率...");

    try {
      const latestRates = await fetchLatestExchangeRates();
      setExchangeRates(latestRates);
      setExchangeRateDrafts({});
      setExchangeRateStatus(`匯率已更新，資料時間：${formatDateTime(latestRates.sourceUpdatedAt)}`);
    } catch (error) {
      setExchangeRateStatus(error.message || "匯率更新失敗，請稍後再試。");
    } finally {
      setIsFetchingRates(false);
    }
  }

  function updateExchangeRateDraft(currency, value) {
    setExchangeRateDrafts((current) => ({
      ...current,
      [currency]: value,
    }));
  }

  function saveManualRate(currency) {
    const rate = toNumber(getExchangeRateDraft(currency));
    if (rate <= 0) return alert("請輸入大於 0 的匯率。");

    setExchangeRates((current) => setManualExchangeRate(current, currency, rate));
    setExchangeRateStatus(`${currency} 匯率已手動更新。`);
  }

  function toggleAssetGroup(key) {
    setExpandedAssetGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function cycleStyleMode() {
    const currentIndex = STYLE_MODES.findIndex((mode) => mode.value === styleMode);
    const nextIndex = (currentIndex + 1) % STYLE_MODES.length;
    setStyleMode(STYLE_MODES[nextIndex].value);
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
        <button
          className="style-switch-button"
          type="button"
          onClick={cycleStyleMode}
          aria-label={`切換風格，目前是${currentStyleMode.label}`}
          title={`切換風格，目前是${currentStyleMode.label}`}
        >
          <span aria-hidden="true">{currentStyleMode.mark}</span>
        </button>
      </header>

      <section className="summary-grid" aria-label="資產摘要">
        <article className="summary-card total-card">
          <span>TWD 估算淨資產</span>
          <strong>{formatMoney(twdSummary.net, "TWD")}</strong>
          <small>
            資產 {formatMoney(twdSummary.assets, "TWD")} · 負債{" "}
            {formatMoney(twdSummary.liabilities, "TWD")}
          </small>
          {twdSummary.missingCurrencies.length > 0 && (
            <small className="warning-text">缺少 {twdSummary.missingCurrencies.join(", ")} 匯率</small>
          )}
        </article>

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

      <section className={`panel exchange-panel${isExchangePanelOpen ? "" : " is-collapsed"}`}>
        <div className="panel-header exchange-header">
          <div>
            <h2>匯率</h2>
            <p className="muted">資料時間：{formatDateTime(exchangeRates.sourceUpdatedAt)}</p>
          </div>
          <div className="exchange-actions">
            {isExchangePanelOpen && (
              <button
                className="icon-button"
                type="button"
                aria-label="更新最新匯率"
                title="更新最新匯率"
                onClick={updateLatestExchangeRates}
                disabled={isFetchingRates}
              >
                {isFetchingRates ? "…" : "↻"}
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label={isExchangePanelOpen ? "隱藏匯率" : "顯示匯率"}
              title={isExchangePanelOpen ? "隱藏匯率" : "顯示匯率"}
              aria-expanded={isExchangePanelOpen}
              onClick={() => setIsExchangePanelOpen((current) => !current)}
            >
              {isExchangePanelOpen ? "⌃" : "⌄"}
            </button>
          </div>
        </div>

        {isExchangePanelOpen && (
          <>
            <div className="exchange-meta">
              <span>下次更新：{formatDateTime(exchangeRates.sourceNextUpdateAt)}</span>
              <span>基準：TWD</span>
              <a href={exchangeRates.providerUrl} target="_blank" rel="noreferrer">
                Rates by Exchange Rate API
              </a>
            </div>

            <div className="exchange-grid">
              {exchangeRateRows.map((row) => (
                <div className="exchange-row" key={row.currency}>
                  <div>
                    <strong>{row.currency}</strong>
                    <small>
                      {row.currency === "TWD"
                        ? "基準幣"
                        : `1 ${row.currency} = ${row.rateToTwd ? formatRate(row.rateToTwd) : "未設定"} TWD`}
                    </small>
                  </div>

                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    disabled={row.currency === "TWD"}
                    value={getExchangeRateDraft(row.currency)}
                    onChange={(event) => updateExchangeRateDraft(row.currency, event.target.value)}
                    aria-label={`${row.currency} 匯率`}
                  />

                  <span className="rate-source">
                    {row.source === "base"
                      ? "基準"
                      : row.source === "api"
                        ? "API"
                        : row.source === "manual"
                          ? "手動"
                          : "未設定"}
                  </span>

                  <button
                    className="small-action"
                    type="button"
                    disabled={row.currency === "TWD"}
                    onClick={() => saveManualRate(row.currency)}
                  >
                    儲存
                  </button>
                </div>
              ))}
            </div>

            <p className="rate-status">
              {exchangeRateStatus ||
                `目前來源：${exchangeRates.provider}。公開端點會抓取最新可用資料，必要時可手動覆寫。`}
            </p>
          </>
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

        <section className="panel overview-panel">
          <div className="panel-header">
            <h2>資產總覽</h2>
            <span>{assetOverviewGroups.length} 類</span>
          </div>

          <div className="overview-surface">
            {assetOverviewGroups.length === 0 ? (
              <p className="muted">尚無資產資料。</p>
            ) : (
              <>
                <div className="overview-allocation">
                  <div
                    className="pie-chart"
                    style={{ background: pieGradient }}
                    aria-label="資產配置圓餅圖"
                  />
                  <div className="pie-legend">
                    {allocationItems.length === 0 ? (
                      <p className="muted">尚無可繪製的正資產。</p>
                    ) : (
                      allocationItems.map((item, index) => (
                        <div className="pie-legend-row" key={item.type} tabIndex={0} title={item.amountText}>
                          <span style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                          <strong>{item.label}</strong>
                          <small className="allocation-percent">{formatNumber((item.value / allocationTotal) * 100)}%</small>
                          <small className="allocation-amount">{item.amountText}</small>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="overview-list">
                  {assetOverviewGroups.map((group) => (
                    <button
                      className={`overview-row${selectedOverviewGroup?.key === group.key ? " is-selected" : ""}`}
                      type="button"
                      key={group.key}
                      onClick={() => setSelectedOverviewKey(group.key)}
                    >
                      <div>
                        <strong>{group.name}</strong>
                        <small>
                          資產類別 · {group.currency}
                        </small>
                      </div>
                      <div>
                        <strong>{group.primaryText}</strong>
                        <small>{group.secondaryText}</small>
                      </div>
                      <div>
                        <strong>{group.amountText}</strong>
                        <small>{group.count} 筆明細</small>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedOverviewGroup && (
                  <div className="overview-detail">
                    <div className="overview-detail-header">
                      <div>
                        <h3>{selectedOverviewGroup.name}佔比</h3>
                        <p className="muted">{selectedOverviewGroup.secondaryText}</p>
                      </div>
                      <strong>{selectedOverviewGroup.amountText}</strong>
                    </div>

                    {selectedBreakdownItems.length === 0 ? (
                      <p className="muted">此類別目前沒有可繪製的正資產。</p>
                    ) : (
                      <div className="overview-allocation overview-allocation-secondary">
                        <div
                          className="pie-chart pie-chart-secondary"
                          style={{ background: selectedBreakdownGradient }}
                          aria-label={`${selectedOverviewGroup.name}佔比圓餅圖`}
                        />
                        <div className="pie-legend">
                          {selectedBreakdownItems.map((item, index) => (
                            <div className="pie-legend-row" key={item.key} tabIndex={0} title={item.amountText}>
                              <span style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                              <strong>{item.label}</strong>
                              <small className="allocation-percent">
                                {formatNumber((item.value / selectedBreakdownTotal) * 100)}%
                              </small>
                              <small className="allocation-amount">{item.amountText}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>資產明細</h2>
          <span>
            {filteredAssetGroups.length} 組 · {filteredAssetCount} 筆
          </span>
        </div>

        <div className="type-filter" role="group" aria-label="資產類型篩選">
          {assetTypeFilters.map((item) => (
            <button
              className={`type-filter-button${assetTypeFilter === item.value ? " is-active" : ""}`}
              type="button"
              key={item.value}
              onClick={() => setAssetTypeFilter(item.value)}
            >
              <span>{item.label}</span>
              <small>{assetTypeCounts[item.value] ?? 0}</small>
            </button>
          ))}
        </div>

        <div className="table-like">
          {filteredAssetGroups.length === 0 ? (
            <p className="muted">
              {assetTypeFilter === "all"
                ? "尚無資產資料。"
                : `尚無${getAssetTypeLabel(assetTypeFilter)}資料。`}
            </p>
          ) : (
            filteredAssetGroups.map((group) => (
              <article className="asset-group" key={group.key}>
                <button className="asset-row asset-group-summary" type="button" onClick={() => toggleAssetGroup(group.key)}>
                  <span className="badge">{getAssetTypeLabel(group.type)}</span>
                  <div>
                    <strong>{group.name}</strong>
                    <small>
                      {group.currency} · {group.entries.length} 筆明細
                    </small>
                  </div>
                  <div>
                    <strong>{group.amountText}</strong>
                    <small>{group.secondaryText}</small>
                  </div>
                  <span className="expand-indicator">{expandedAssetGroups[group.key] ? "⌃" : "⌄"}</span>
                </button>

                {expandedAssetGroups[group.key] && (
                  <div className="detail-list">
                    {group.entries.map((asset) => {
                      const loanSnapshot = asset.type === "loan" ? getLoanSnapshot(asset) : null;
                      const isStock = asset.type === "stock";
                      const stockCost = isStock ? toNumber(asset.shares) * toNumber(asset.buyPrice) : 0;

                      return (
                        <div className="detail-row asset-detail-row" key={asset.id}>
                          <span>
                            {isStock
                              ? asset.buyDate || "未填日期"
                              : asset.createdAt
                                ? new Date(asset.createdAt).toLocaleDateString("zh-TW")
                                : "未填日期"}
                          </span>
                          <span>{asset.note || "無備註"}</span>
                          <span>
                            {isStock
                              ? formatMoney(stockCost, asset.currency)
                              : loanSnapshot
                              ? `剩餘 ${formatMoney(loanSnapshot.remainingPrincipal, asset.currency)}`
                              : formatMoney(asset.amountValue, asset.currency)}
                          </span>
                          <span>
                            {isStock
                              ? `${formatNumber(asset.shares)} 股 · 單價 ${formatMoney(asset.buyPrice, asset.currency)}`
                              : loanSnapshot
                              ? `月付 ${formatMoney(loanSnapshot.monthlyPayment, asset.currency)} · 已繳 ${formatNumber(
                                  loanSnapshot.progressPercent,
                                )}%`
                              : getAssetTypeLabel(asset.type)}
                          </span>
                          <button type="button" onClick={() => deleteAsset(asset.id)}>
                            刪除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="data-management" aria-label="資料管理">
        <span>資料管理</span>
        <button className="subtle-danger-button" type="button" onClick={clearAll}>
          清空資料
        </button>
      </section>
    </main>
  );
}

export default App;
