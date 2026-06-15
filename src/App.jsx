import React, { useEffect, useMemo, useState } from "react";
import {
  ASSET_TYPES,
  CURRENCIES,
  createAssetId,
  fetchLatestExchangeRates,
  formatCompactMoney,
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

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyForm(type = "cash") {
  return {
    type,
    currency: "TWD",
    name: "",
    amount: "",
    ticker: "",
    shares: "",
    buyPrice: "",
    buyDate: getTodayDate(),
    principal: "",
    years: "",
    annualRate: "",
    startDate: getTodayDate(),
    note: "",
  };
}

function toFormValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function createFormFromAsset(asset) {
  return {
    ...createEmptyForm(asset.type || "cash"),
    type: asset.type || "cash",
    currency: asset.currency || "TWD",
    name: toFormValue(asset.name),
    amount: toFormValue(asset.amount),
    ticker: toFormValue(asset.ticker),
    shares: toFormValue(asset.shares),
    buyPrice: toFormValue(asset.buyPrice),
    buyDate: asset.buyDate || getTodayDate(),
    principal: toFormValue(asset.principal),
    years: toFormValue(asset.years),
    annualRate: toFormValue(asset.annualRate),
    startDate: asset.startDate || getTodayDate(),
    note: toFormValue(asset.note),
  };
}

function buildAssetFromForm(form, existingAsset = null) {
  const base = {
    id: existingAsset?.id ?? createAssetId(),
    type: form.type,
    currency: form.currency,
    note: form.note.trim(),
    createdAt: existingAsset?.createdAt ?? new Date().toISOString(),
  };

  if (form.type === "stock") {
    if (!form.ticker.trim()) throw new Error("請輸入股票代號。");
    if (toNumber(form.shares) <= 0) throw new Error("請輸入有效股數。");
    if (toNumber(form.buyPrice) < 0) throw new Error("請輸入有效購入價格。");

    return {
      ...base,
      ticker: form.ticker.trim().toUpperCase(),
      shares: toNumber(form.shares),
      buyPrice: toNumber(form.buyPrice),
      buyDate: form.buyDate,
    };
  }

  if (form.type === "loan") {
    if (!form.name.trim()) throw new Error("請輸入貸款名稱。");
    if (toNumber(form.principal) <= 0) throw new Error("請輸入有效本金。");
    if (toNumber(form.years) <= 0) throw new Error("請輸入有效年限。");
    if (toNumber(form.annualRate) < 0) throw new Error("請輸入有效年利率。");
    if (!form.startDate) throw new Error("請輸入貸款起始日期。");

    return {
      ...base,
      name: form.name.trim(),
      principal: toNumber(form.principal),
      years: toNumber(form.years),
      annualRate: toNumber(form.annualRate),
      startDate: form.startDate,
    };
  }

  if (!form.name.trim()) throw new Error("請輸入名稱。");
  if (toNumber(form.amount) < 0) throw new Error("請輸入有效金額。");

  return {
    ...base,
    name: form.name.trim(),
    amount: toNumber(form.amount),
  };
}

function AssetFormFields({ form, onFieldChange, onTypeChange }) {
  return (
    <>
      <div className="form-row compact">
        <label>
          類型
          <select value={form.type} onChange={(event) => onTypeChange(event.target.value)}>
            {ASSET_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          幣別
          <select value={form.currency} onChange={(event) => onFieldChange("currency", event.target.value)}>
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
                onChange={(event) => onFieldChange("ticker", event.target.value)}
                placeholder="例如 2330、AAPL"
              />
            </label>
            <label>
              購入日期
              <input
                type="date"
                value={form.buyDate}
                onChange={(event) => onFieldChange("buyDate", event.target.value)}
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
                onChange={(event) => onFieldChange("shares", event.target.value)}
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
                onChange={(event) => onFieldChange("buyPrice", event.target.value)}
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
              onChange={(event) => onFieldChange("name", event.target.value)}
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
                onChange={(event) => onFieldChange("principal", event.target.value)}
                placeholder="貸款本金"
              />
            </label>
            <label>
              年限
              <input
                type="number"
                min="0"
                value={form.years}
                onChange={(event) => onFieldChange("years", event.target.value)}
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
                onChange={(event) => onFieldChange("annualRate", event.target.value)}
                placeholder="例如 2.1"
              />
            </label>
            <label>
              起始日期
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => onFieldChange("startDate", event.target.value)}
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
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="例如 台幣活存、ETF、黃金"
            />
          </label>
          <label>
            金額
            <input
              type="number"
              min="0"
              value={form.amount}
              onChange={(event) => onFieldChange("amount", event.target.value)}
              placeholder="目前金額"
            />
          </label>
        </div>
      )}

      <label>
        備註
        <input value={form.note} onChange={(event) => onFieldChange("note", event.target.value)} placeholder="選填" />
      </label>
    </>
  );
}

const STYLE_STORAGE_KEY = "asset-agent.style-mode.v1";
const STYLE_MODES = [
  { value: "mist", label: "霧藍", mark: "◐" },
  { value: "clear", label: "清爽", mark: "○" },
  { value: "graphite", label: "石墨", mark: "●" },
];
const PIE_COLORS = ["#365f89", "#7c8da3", "#b7815f", "#6c7a89", "#486b7a", "#8f6f8f"];
const ASSET_SORT_OPTIONS = [
  { value: "value", label: "金額" },
  { value: "date", label: "最近日期" },
  { value: "type", label: "種類" },
  { value: "currency", label: "幣別" },
  { value: "name", label: "名稱" },
];
const STALE_EXCHANGE_RATE_DAYS = 7;
const STALE_ASSET_DATA_DAYS = 30;

function loadStyleMode() {
  try {
    const stored = window.localStorage.getItem(STYLE_STORAGE_KEY);
    return STYLE_MODES.some((mode) => mode.value === stored) ? stored : STYLE_MODES[0].value;
  } catch {
    return STYLE_MODES[0].value;
  }
}

function getTextDensityClass(value) {
  const length = String(value || "").replace(/\s/g, "").length;
  if (length >= 18) return "text-tight";
  if (length >= 13) return "text-compact";
  return "";
}

function getDaysSince(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function getLatestAssetTimestamp(assets) {
  return Math.max(
    0,
    ...assets.map((asset) => {
      const rawDate = asset.type === "stock" ? asset.buyDate : asset.type === "loan" ? asset.startDate : asset.createdAt;
      const timestamp = new Date(rawDate || asset.createdAt || 0).getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }),
  );
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-Hant", { numeric: true });
}

function getAssetSortTimestamp(asset) {
  const dateValue = asset.type === "stock" ? asset.buyDate : asset.type === "loan" ? asset.startDate : asset.createdAt;
  const timestamp = new Date(dateValue || asset.createdAt || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getGroupSortTimestamp(group) {
  return Math.max(0, ...group.entries.map((asset) => getAssetSortTimestamp(asset)));
}

function getEntrySortAmount(asset) {
  if (asset.type === "stock") return toNumber(asset.shares) * toNumber(asset.buyPrice);
  if (asset.type === "loan") return getLoanSnapshot(asset).remainingPrincipal;
  return Math.abs(toNumber(asset.amountValue ?? asset.amount));
}

function sortAssetGroups(groups, sortMode) {
  return [...groups].sort((a, b) => {
    if (sortMode === "date") {
      return getGroupSortTimestamp(b) - getGroupSortTimestamp(a) || compareText(a.name, b.name);
    }

    if (sortMode === "type") {
      return (
        compareText(getAssetTypeLabel(a.type), getAssetTypeLabel(b.type)) ||
        compareText(a.currency, b.currency) ||
        compareText(a.name, b.name)
      );
    }

    if (sortMode === "currency") {
      return compareText(a.currency, b.currency) || compareText(getAssetTypeLabel(a.type), getAssetTypeLabel(b.type));
    }

    if (sortMode === "name") {
      return compareText(a.name, b.name) || compareText(a.currency, b.currency);
    }

    return Math.abs(b.baseValue ?? b.totalAmount ?? 0) - Math.abs(a.baseValue ?? a.totalAmount ?? 0);
  });
}

function sortAssetEntries(entries, sortMode) {
  return [...entries].sort((a, b) => {
    if (sortMode === "type") {
      return compareText(getAssetTypeLabel(a.type), getAssetTypeLabel(b.type)) || getAssetSortTimestamp(b) - getAssetSortTimestamp(a);
    }

    if (sortMode === "currency") {
      return compareText(a.currency, b.currency) || getAssetSortTimestamp(b) - getAssetSortTimestamp(a);
    }

    if (sortMode === "name") {
      return compareText(getAssetDisplayName(a), getAssetDisplayName(b)) || getAssetSortTimestamp(b) - getAssetSortTimestamp(a);
    }

    if (sortMode === "value") {
      return getEntrySortAmount(b) - getEntrySortAmount(a) || getAssetSortTimestamp(b) - getAssetSortTimestamp(a);
    }

    return getAssetSortTimestamp(b) - getAssetSortTimestamp(a);
  });
}

function App() {
  const [assets, setAssets] = useState(() => loadAssets());
  const [exchangeRates, setExchangeRates] = useState(() => loadExchangeRates());
  const [exchangeRateDrafts, setExchangeRateDrafts] = useState({});
  const [exchangeRateStatus, setExchangeRateStatus] = useState("");
  const [isFetchingRates, setIsFetchingRates] = useState(false);
  const [isExchangePanelOpen, setIsExchangePanelOpen] = useState(false);
  const [isAssetFormOpen, setIsAssetFormOpen] = useState(false);
  const [form, setForm] = useState(() => createEmptyForm());
  const [editForm, setEditForm] = useState(() => createEmptyForm());
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [assetToDeleteId, setAssetToDeleteId] = useState(null);
  const [expandedAssetGroups, setExpandedAssetGroups] = useState({});
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [assetSortMode, setAssetSortMode] = useState("value");
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
  const editingAsset = useMemo(
    () => assets.find((asset) => asset.id === editingAssetId) ?? null,
    [assets, editingAssetId],
  );
  const assetToDelete = useMemo(
    () => assets.find((asset) => asset.id === assetToDeleteId) ?? null,
    [assetToDeleteId, assets],
  );
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
          compactAmountText: formatCompactMoney(holding.totalCost, holding.currency),
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
        const compactAmountText = isLoan
          ? `剩餘 ${formatCompactMoney(Math.abs(group.totalAmount), group.currency)}`
          : formatCompactMoney(group.totalAmount, group.currency);

        return {
          key: `asset_${group.key}`,
          type: group.type,
          typeLabel: getAssetTypeLabel(group.type),
          name: group.name,
          currency: group.currency,
          totalAmount: group.totalAmount,
          amountText,
          compactAmountText,
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
  const sortedAssetGroups = useMemo(
    () => sortAssetGroups(filteredAssetGroups, assetSortMode),
    [assetSortMode, filteredAssetGroups],
  );
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
        const compactAmountText = isLoan
          ? `剩餘 ${formatCompactMoney(Math.abs(group.baseValue), "TWD")}`
          : formatCompactMoney(group.baseValue, "TWD");
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
          compactAmountText,
          primaryText,
          secondaryText,
          groupCount: group.detailGroups.length,
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
        key: group.key,
        type: group.type,
        label: group.typeLabel,
        value: group.baseValue,
        amountText: formatMoney(group.baseValue, "TWD"),
      }))
      .sort((a, b) => b.value - a.value);
  }, [assetOverviewGroups]);
  const allocationTotal = allocationItems.reduce((total, item) => total + item.value, 0);
  const concentrationItems = useMemo(() => {
    const items = stockHoldings.map((holding) => {
      const rateToTwd = getRateToTwd(exchangeRates, holding.currency);
      const valueTwd = rateToTwd ? holding.totalCost * rateToTwd : null;

      return {
        key: holding.key,
        ticker: holding.ticker,
        currency: holding.currency,
        valueTwd,
        totalShares: holding.totalShares,
        totalCost: holding.totalCost,
      };
    });
    const totalStockValue = items.reduce((total, item) => total + (item.valueTwd ?? 0), 0);

    return items
      .map((item) => {
        const stockSharePercent =
          item.valueTwd !== null && totalStockValue > 0 ? (item.valueTwd / totalStockValue) * 100 : null;
        const totalAssetPercent =
          item.valueTwd !== null && twdSummary.assets > 0 ? (item.valueTwd / twdSummary.assets) * 100 : null;

        return {
          ...item,
          stockSharePercent,
          totalAssetPercent,
          isWarning: totalAssetPercent !== null && totalAssetPercent > 20,
        };
      })
      .sort((a, b) => (b.valueTwd ?? -1) - (a.valueTwd ?? -1));
  }, [exchangeRates, stockHoldings, twdSummary.assets]);
  const attentionItems = useMemo(() => {
    const items = [];

    if (assets.length === 0) {
      items.push({ key: "empty", label: "尚未建立任何資產資料" });
    }

    if (twdSummary.missingCurrencies.length > 0) {
      items.push({
        key: "missing-rates",
        label: `缺少 ${twdSummary.missingCurrencies.join(", ")} 匯率，部分估值未納入 TWD 淨值`,
      });
    }

    const exchangeRateAge = getDaysSince(exchangeRates.sourceUpdatedAt || exchangeRates.fetchedAt);
    if (exchangeRateAge !== null && exchangeRateAge > STALE_EXCHANGE_RATE_DAYS) {
      items.push({ key: "stale-rates", label: `匯率資料已超過 ${exchangeRateAge} 天未更新` });
    }

    const latestAssetTimestamp = getLatestAssetTimestamp(assets);
    const assetDataAge = latestAssetTimestamp > 0 ? getDaysSince(new Date(latestAssetTimestamp).toISOString()) : null;
    if (assetDataAge !== null && assetDataAge > STALE_ASSET_DATA_DAYS) {
      items.push({ key: "stale-assets", label: `最近一筆資產資料距今 ${assetDataAge} 天` });
    }

    const concentratedItems = concentrationItems.filter((item) => item.isWarning);
    if (concentratedItems.length > 0) {
      items.push({
        key: "concentration",
        label: `${concentratedItems[0].ticker} 占總資產超過 20%，建議人工檢視集中度`,
      });
    }

    if (twdSummary.assets > 0 && twdSummary.liabilities / twdSummary.assets > 0.5) {
      items.push({
        key: "liability-ratio",
        label: `負債約占總資產 ${formatNumber((twdSummary.liabilities / twdSummary.assets) * 100)}%`,
      });
    }

    return items;
  }, [
    assets,
    concentrationItems,
    exchangeRates.fetchedAt,
    exchangeRates.sourceUpdatedAt,
    twdSummary.assets,
    twdSummary.liabilities,
    twdSummary.missingCurrencies,
  ]);

  useEffect(() => {
    if (assetOverviewGroups.length === 0) {
      if (selectedOverviewKey) setSelectedOverviewKey(null);
      return;
    }

    if (!selectedOverviewKey || !assetOverviewGroups.some((group) => group.key === selectedOverviewKey)) {
      setSelectedOverviewKey(assetOverviewGroups[0].key);
    }
  }, [assetOverviewGroups, selectedOverviewKey]);

  function selectOverviewGroup(group) {
    setSelectedOverviewKey(group.key);
    setAssetTypeFilter(group.type);
  }

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

  function updateEditForm(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm(nextType = form.type) {
    setForm(createEmptyForm(nextType));
  }

  function handleTypeChange(type) {
    resetForm(type);
  }

  function handleEditTypeChange(type) {
    setEditForm(createEmptyForm(type));
  }

  function startEditingAsset(asset) {
    setEditingAssetId(asset.id);
    setEditForm(createFormFromAsset(asset));
    setIsAssetFormOpen(false);
  }

  function cancelEditing() {
    setEditingAssetId(null);
    setEditForm(createEmptyForm());
  }

  function handleSubmit(event) {
    event.preventDefault();

    try {
      const asset = buildAssetFromForm(form);
      setAssets((current) => [asset, ...current]);
      resetForm(form.type);
      setIsAssetFormOpen(false);
    } catch (error) {
      window.alert(error.message || "資產資料不完整。");
    }
  }

  function handleEditSubmit(event) {
    event.preventDefault();

    if (!editingAsset) {
      window.alert("找不到要編輯的資產，請重新選擇。");
      cancelEditing();
      return;
    }

    try {
      const asset = buildAssetFromForm(editForm, editingAsset);
      setAssets((current) => current.map((item) => (item.id === editingAsset.id ? asset : item)));
      cancelEditing();
    } catch (error) {
      window.alert(error.message || "資產資料不完整。");
    }
  }

  function requestDeleteAsset(id) {
    const target = assets.find((asset) => asset.id === id);
    if (!target) return;

    setAssetToDeleteId(id);
  }

  function cancelDeleteAsset() {
    setAssetToDeleteId(null);
  }

  function confirmDeleteAsset() {
    if (!assetToDelete) {
      cancelDeleteAsset();
      return;
    }

    const targetId = assetToDelete.id;

    setAssets((current) => current.filter((asset) => asset.id !== targetId));

    if (editingAssetId === targetId) {
      cancelEditing();
    }

    cancelDeleteAsset();
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
    setIsAssetFormOpen(false);
    cancelEditing();
    cancelDeleteAsset();
    resetForm();
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

      <section className="cockpit-grid" aria-label="資產 cockpit">
        <article className="panel net-worth-card">
          <span className="section-kicker">TWD 估算淨資產</span>
          <strong>{formatMoney(twdSummary.net, "TWD")}</strong>
          <dl className="net-worth-metrics">
            <div>
              <dt>總資產</dt>
              <dd>{formatMoney(twdSummary.assets, "TWD")}</dd>
            </div>
            <div>
              <dt>總負債</dt>
              <dd>{formatMoney(twdSummary.liabilities, "TWD")}</dd>
            </div>
          </dl>
        </article>

        <article className="panel attention-panel">
          <div className="panel-header compact-header">
            <h2>待處理事項</h2>
            <span>{attentionItems.length} 項</span>
          </div>
          {attentionItems.length === 0 ? (
            <p className="attention-empty">目前沒有明顯待處理事項</p>
          ) : (
            <ul className="attention-list">
              {attentionItems.map((item) => (
                <li key={item.key}>{item.label}</li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="currency-strip" aria-label="幣別淨值">
        {currencySummary.length === 0 ? (
          <article className="summary-card currency-card empty">
            <span>幣別淨值</span>
            <strong>尚無資料</strong>
          </article>
        ) : (
          currencySummary.map((item) => (
            <article className="summary-card currency-card" key={item.currency}>
              <span>{item.currency} 幣別淨值</span>
              <strong>{formatMoney(item.net, item.currency)}</strong>
              <small>
                資產 {formatMoney(item.assets, item.currency)} · 負債{" "}
                {formatMoney(item.liabilities, item.currency)}
              </small>
            </article>
          ))
        )}
      </section>

      <section className="exchange-shell">
        <div className="panel exchange-trigger">
          <div className="exchange-trigger-copy">
            <strong>匯率</strong>
            <span>資料時間：{formatDateTime(exchangeRates.sourceUpdatedAt)}</span>
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
          <div className="panel exchange-popover">
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
          </div>
        )}
      </section>

      <section className="content-grid">
        <section className={`panel add-asset-panel${isAssetFormOpen ? " is-open" : ""}`}>
          <button
            className="add-asset-toggle"
            type="button"
            aria-expanded={isAssetFormOpen}
            onClick={() => setIsAssetFormOpen((current) => !current)}
          >
            <span>＋ 新增資產 / 負債</span>
            <small>{isAssetFormOpen ? "輸入完成後會自動收合" : `目前預設：${getAssetTypeLabel(form.type)}`}</small>
            <span className="expand-indicator">{isAssetFormOpen ? "⌃" : "⌄"}</span>
          </button>

          {isAssetFormOpen && (
            <form className="form-panel add-asset-form" onSubmit={handleSubmit}>
              <div className="panel-header">
                <h2>新增資產 / 負債</h2>
                <span>{getAssetTypeLabel(form.type)}</span>
              </div>

              <AssetFormFields form={form} onFieldChange={updateForm} onTypeChange={handleTypeChange} />

              <div className="form-actions">
                <button className="primary-button" type="submit">
                  新增
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="panel overview-panel">
          <div className="panel-header">
            <h2>資產配置</h2>
            <span>{assetOverviewGroups.length} 類</span>
          </div>

          <div className="overview-surface">
            {assetOverviewGroups.length === 0 ? (
              <p className="muted">尚無資產資料。</p>
            ) : (
              <>
                <div className="allocation-bar" aria-label="資產配置比例條">
                  {allocationItems.length === 0 ? (
                    <span className="allocation-empty">尚無可配置的正資產</span>
                  ) : (
                    allocationItems.map((item, index) => {
                      const overviewGroup = assetOverviewGroups.find((group) => group.key === item.key);
                      const percent = allocationTotal > 0 ? (item.value / allocationTotal) * 100 : 0;

                      return (
                        <button
                          className={`allocation-segment${selectedOverviewGroup?.key === item.key ? " is-selected" : ""}`}
                          key={item.type}
                          type="button"
                          style={{
                            "--segment-color": PIE_COLORS[index % PIE_COLORS.length],
                            flexGrow: Math.max(percent, 1),
                            flexBasis: `${Math.max(percent, 5)}%`,
                          }}
                          title={`${item.label} ${formatNumber(percent)}% · ${item.amountText}`}
                          onClick={() => overviewGroup && selectOverviewGroup(overviewGroup)}
                        >
                          <span>{item.label}</span>
                          <strong>{formatNumber(percent)}%</strong>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="allocation-summary-grid">
                  {assetOverviewGroups.map((group, index) => {
                    const percent = allocationTotal > 0 && group.baseValue > 0 ? (group.baseValue / allocationTotal) * 100 : 0;

                    return (
                      <button
                        className={`allocation-summary-card${selectedOverviewGroup?.key === group.key ? " is-selected" : ""}${
                          group.type === "loan" ? " is-liability" : ""
                        }`}
                        type="button"
                        key={group.key}
                        title={group.amountText}
                        onClick={() => selectOverviewGroup(group)}
                      >
                        <div className="summary-card-topline">
                          <span
                            className="allocation-dot"
                            style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                            aria-hidden="true"
                          />
                          <strong>{group.name}</strong>
                        </div>
                        <small>
                          {group.groupCount} 組 · {group.count} 筆明細{group.hasMissingRate ? " · 缺匯率" : ""}
                        </small>
                        <div className="summary-card-bottomline">
                          <span>{percent > 0 ? `${formatNumber(percent)}%` : "未列入配置"}</span>
                          <strong>{group.compactAmountText}</strong>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel concentration-panel">
          <div className="panel-header">
            <h2>集中度風險</h2>
            <span>{concentrationItems.length} 檔</span>
          </div>

          {concentrationItems.length === 0 ? (
            <p className="muted">尚無股票部位可檢視。</p>
          ) : (
            <div className="risk-list">
              {concentrationItems.map((item) => {
                const stockShareText =
                  item.stockSharePercent === null ? "未估" : `${formatNumber(item.stockSharePercent)}%`;
                const totalAssetShareText =
                  item.totalAssetPercent === null ? "未估" : `${formatNumber(item.totalAssetPercent)}%`;

                return (
                  <article className={`risk-row${item.isWarning ? " has-warning" : ""}`} key={item.key}>
                    <div className="risk-name">
                      <div>
                        <strong>{item.ticker}</strong>
                        <small>
                          {item.currency} · {formatNumber(item.totalShares)} 股
                        </small>
                      </div>
                      {item.isWarning && <span className="risk-pill">集中</span>}
                    </div>
                    <div className="risk-metrics">
                      <div>
                        <span>股票部位</span>
                        <strong>{stockShareText}</strong>
                      </div>
                      <div>
                        <span>總資產</span>
                        <strong>{totalAssetShareText}</strong>
                      </div>
                      <div>
                        <span>TWD 估值</span>
                        <strong>{item.valueTwd === null ? "缺匯率" : formatCompactMoney(item.valueTwd, "TWD")}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="panel-header asset-detail-header">
          <div>
            <h2>資產明細</h2>
            <span>
              {filteredAssetGroups.length} 組 · {filteredAssetCount} 筆
            </span>
          </div>
          <label className="inline-control">
            排列
            <select value={assetSortMode} onChange={(event) => setAssetSortMode(event.target.value)}>
              {ASSET_SORT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
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
          {sortedAssetGroups.length === 0 ? (
            <p className="muted">
              {assetTypeFilter === "all"
                ? "尚無資產資料。"
                : `尚無${getAssetTypeLabel(assetTypeFilter)}資料。`}
            </p>
          ) : (
            sortedAssetGroups.map((group) => (
              <article className={`asset-group${group.type === "loan" ? " is-liability" : ""}`} key={group.key}>
                <button className="asset-row asset-group-summary" type="button" onClick={() => toggleAssetGroup(group.key)}>
                  <span className="badge">{getAssetTypeLabel(group.type)}</span>
                  <div>
                    <strong className={getTextDensityClass(group.name)} title={group.name}>
                      {group.name}
                    </strong>
                    <small>
                      {group.currency} · {group.entries.length} 筆明細
                    </small>
                  </div>
                  <div>
                    <strong className={getTextDensityClass(group.compactAmountText ?? group.amountText)} title={group.amountText}>
                      {group.compactAmountText ?? group.amountText}
                    </strong>
                    <small>{group.secondaryText}</small>
                  </div>
                  <span className="expand-indicator">{expandedAssetGroups[group.key] ? "⌃" : "⌄"}</span>
                </button>

                {expandedAssetGroups[group.key] && (
                  <div className="detail-list">
                    {sortAssetEntries(group.entries, assetSortMode).map((asset) => {
                      const loanSnapshot = asset.type === "loan" ? getLoanSnapshot(asset) : null;
                      const isStock = asset.type === "stock";
                      const stockCost = isStock ? toNumber(asset.shares) * toNumber(asset.buyPrice) : 0;
                      const detailDate = isStock
                        ? asset.buyDate || "未填日期"
                        : asset.createdAt
                          ? new Date(asset.createdAt).toLocaleDateString("zh-TW")
                          : "未填日期";
                      const detailAmount = isStock
                        ? formatMoney(stockCost, asset.currency)
                        : loanSnapshot
                          ? `剩餘 ${formatMoney(loanSnapshot.remainingPrincipal, asset.currency)}`
                          : formatMoney(asset.amountValue, asset.currency);
                      const compactDetailAmount = isStock
                        ? formatCompactMoney(stockCost, asset.currency)
                        : loanSnapshot
                          ? `剩餘 ${formatCompactMoney(loanSnapshot.remainingPrincipal, asset.currency)}`
                          : formatCompactMoney(asset.amountValue, asset.currency);
                      const detailMeta = isStock
                        ? `${formatNumber(asset.shares)} 股 · 單價 ${formatMoney(asset.buyPrice, asset.currency)}`
                        : loanSnapshot
                          ? `本金 ${formatCompactMoney(asset.principal, asset.currency)} · 月付 ${formatCompactMoney(
                              loanSnapshot.monthlyPayment,
                              asset.currency,
                            )} · 已繳 ${formatNumber(
                              loanSnapshot.progressPercent,
                            )}%`
                          : getAssetTypeLabel(asset.type);

                      return (
                        <article className={`detail-card${asset.type === "loan" ? " is-liability" : ""}`} key={asset.id}>
                          <div className="detail-card-header">
                            <span>{detailDate}</span>
                            <span>{asset.currency}</span>
                          </div>
                          <strong title={detailAmount}>{compactDetailAmount}</strong>
                          <small>{detailMeta}</small>
                          {asset.note && <p>{asset.note}</p>}
                          <div className="detail-actions">
                            <button className="edit-button" type="button" onClick={() => startEditingAsset(asset)}>
                              編輯
                            </button>
                            <button className="delete-button" type="button" onClick={() => requestDeleteAsset(asset.id)}>
                              刪除
                            </button>
                          </div>
                        </article>
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

      {editingAsset && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="panel edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-asset-title"
            onSubmit={handleEditSubmit}
          >
            <div className="panel-header modal-header">
              <div>
                <h2 id="edit-asset-title">編輯資產</h2>
                <p className="muted">
                  {getAssetDisplayName(editingAsset)} · {getAssetTypeLabel(editForm.type)}
                </p>
              </div>
              <button className="icon-button" type="button" aria-label="關閉編輯視窗" onClick={cancelEditing}>
                ×
              </button>
            </div>

            <AssetFormFields form={editForm} onFieldChange={updateEditForm} onTypeChange={handleEditTypeChange} />

            <div className="form-actions modal-actions">
              <button className="primary-button" type="submit">
                儲存修改
              </button>
              <button className="ghost-button" type="button" onClick={cancelEditing}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {assetToDelete && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="panel confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-asset-title"
          >
            <div className="panel-header modal-header">
              <div>
                <h2 id="delete-asset-title">刪除資產</h2>
                <p className="muted">這筆資料刪除後無法復原。</p>
              </div>
              <button className="icon-button" type="button" aria-label="關閉刪除確認" onClick={cancelDeleteAsset}>
                ×
              </button>
            </div>

            <div className="delete-preview">
              <span className="badge">{getAssetTypeLabel(assetToDelete.type)}</span>
              <div>
                <strong>{getAssetDisplayName(assetToDelete)}</strong>
                <small>
                  {assetToDelete.currency || "TWD"} · {assetToDelete.note || "無備註"}
                </small>
              </div>
            </div>

            <div className="form-actions modal-actions">
              <button className="danger-button" type="button" onClick={confirmDeleteAsset}>
                刪除
              </button>
              <button className="ghost-button" type="button" onClick={cancelDeleteAsset}>
                取消
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
