export const STORAGE_KEY = "asset-agent.assets.v1";
export const EXCHANGE_RATE_STORAGE_KEY = "asset-agent.exchange-rates.v1";
export const FINANCIAL_GOALS_STORAGE_KEY = "asset-agent.financial-goals.v1";
export const CURRENT_SCHEMA_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;
export const BASE_CURRENCY = "TWD";
export const EXCHANGE_RATE_PROVIDER = {
  name: "ExchangeRate-API Open Access",
  url: "https://www.exchangerate-api.com",
  documentationUrl: "https://www.exchangerate-api.com/docs/free",
};

export const ASSET_TYPES = [
  { value: "cash", label: "現金" },
  { value: "stock", label: "股票" },
  { value: "fund", label: "基金" },
  { value: "loan", label: "貸款" },
  { value: "other", label: "其他" },
];

export const CURRENCIES = ["TWD", "USD", "JPY", "EUR", "GBP", "AUD", "CAD", "HKD", "SGD", "CNY"];
export const DEFAULT_FINANCIAL_GOALS = {
  monthlyLivingExpense: 50000,
  emergencyMonths: 6,
  singleHoldingLimitPercent: 20,
  stockExposureLimitPercent: 60,
  debtRatioLimitPercent: 50,
  staleAssetDays: 30,
};
export const STALE_EXCHANGE_RATE_DAYS = 7;
export const STALE_STOCK_PRICE_DAYS = 7;

export function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 2,
  }).format(number);
}

export function formatMoney(value, currency = "TWD") {
  const number = Number(value || 0);
  return `${currency} ${formatNumber(number)}`;
}

export function formatCompactMoney(value, currency = "TWD") {
  const number = Number(value || 0);
  const absoluteNumber = Math.abs(number);
  const sign = number < 0 ? "-" : "";

  if (absoluteNumber >= 100000000) {
    return `${currency} ${sign}${formatNumber(absoluteNumber / 100000000)}億`;
  }

  if (absoluteNumber >= 1000000) {
    return `${currency} ${sign}${formatNumber(absoluteNumber / 10000)}萬`;
  }

  return formatMoney(number, currency);
}

export function formatRate(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 6,
  }).format(number);
}

export function formatDateTime(value) {
  if (!value) return "尚未更新";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLocalStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage;
}

function normalizeAsset(asset, fallbackTimestamp) {
  const createdAt = asset.createdAt || fallbackTimestamp;
  const updatedAt = asset.updatedAt || createdAt || fallbackTimestamp;

  return {
    ...asset,
    createdAt,
    updatedAt,
  };
}

function normalizeAssets(value) {
  if (!Array.isArray(value)) return [];

  const fallbackTimestamp = new Date().toISOString();
  return value
    .filter((asset) => asset && typeof asset === "object")
    .map((asset) => normalizeAsset(asset, fallbackTimestamp));
}

export function createAssetStore(assets) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    assets: normalizeAssets(assets),
  };
}

export function parseAssetStore(payload) {
  if (Array.isArray(payload)) {
    return createAssetStore(payload);
  }

  if (payload && typeof payload === "object") {
    return {
      schemaVersion: toNumber(payload.schemaVersion) || CURRENT_SCHEMA_VERSION,
      updatedAt: payload.updatedAt || null,
      assets: normalizeAssets(payload.assets),
    };
  }

  return createAssetStore([]);
}

export function loadAssets() {
  try {
    const storage = getLocalStorage();
    if (!storage) return [];

    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return parseAssetStore(parsed).assets;
  } catch {
    return [];
  }
}

export function saveAssets(assets) {
  const storage = getLocalStorage();
  if (!storage) return;

  storage.setItem(STORAGE_KEY, JSON.stringify(createAssetStore(assets)));
}

function normalizeExchangeRate(currency, value) {
  const rawRate = value && typeof value === "object" ? value.rateToTwd ?? value.rate : value;
  const rate = currency === BASE_CURRENCY ? 1 : toNumber(rawRate);
  const hasRate = currency === BASE_CURRENCY || rate > 0;

  return {
    currency,
    rateToTwd: hasRate ? rate : null,
    source:
      value && typeof value === "object"
        ? value.source ?? (hasRate ? "manual" : "empty")
        : hasRate
          ? "manual"
          : "empty",
    updatedAt: value && typeof value === "object" ? value.updatedAt ?? null : null,
  };
}

export function createExchangeRateStore(rates = {}, metadata = {}) {
  const normalizedRates = {};
  const providerName =
    metadata.provider && metadata.provider !== EXCHANGE_RATE_PROVIDER.url
      ? metadata.provider
      : EXCHANGE_RATE_PROVIDER.name;

  for (const currency of CURRENCIES) {
    normalizedRates[currency] = normalizeExchangeRate(currency, rates[currency]);
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    baseCurrency: BASE_CURRENCY,
    provider: providerName,
    providerUrl: metadata.providerUrl ?? EXCHANGE_RATE_PROVIDER.url,
    providerDocumentationUrl: metadata.providerDocumentationUrl ?? EXCHANGE_RATE_PROVIDER.documentationUrl,
    fetchedAt: metadata.fetchedAt ?? null,
    sourceUpdatedAt: metadata.sourceUpdatedAt ?? null,
    sourceNextUpdateAt: metadata.sourceNextUpdateAt ?? null,
    rates: normalizedRates,
  };
}

export function parseExchangeRateStore(payload) {
  if (!payload || typeof payload !== "object") {
    return createExchangeRateStore();
  }

  return createExchangeRateStore(payload.rates ?? {}, payload);
}

export function loadExchangeRates() {
  try {
    const storage = getLocalStorage();
    if (!storage) return createExchangeRateStore();

    const raw = storage.getItem(EXCHANGE_RATE_STORAGE_KEY);
    if (!raw) return createExchangeRateStore();

    return parseExchangeRateStore(JSON.parse(raw));
  } catch {
    return createExchangeRateStore();
  }
}

export function saveExchangeRates(exchangeRateStore) {
  const storage = getLocalStorage();
  if (!storage) return;

  storage.setItem(EXCHANGE_RATE_STORAGE_KEY, JSON.stringify(parseExchangeRateStore(exchangeRateStore)));
}

export function parseFinancialGoals(payload) {
  const value = payload && typeof payload === "object" ? payload.financialGoals ?? payload : {};

  return {
    monthlyLivingExpense: Math.max(0, toNumber(value.monthlyLivingExpense ?? DEFAULT_FINANCIAL_GOALS.monthlyLivingExpense)),
    emergencyMonths: Math.max(0, toNumber(value.emergencyMonths ?? DEFAULT_FINANCIAL_GOALS.emergencyMonths)),
    singleHoldingLimitPercent: Math.max(
      0,
      toNumber(value.singleHoldingLimitPercent ?? DEFAULT_FINANCIAL_GOALS.singleHoldingLimitPercent),
    ),
    stockExposureLimitPercent: Math.max(
      0,
      toNumber(value.stockExposureLimitPercent ?? DEFAULT_FINANCIAL_GOALS.stockExposureLimitPercent),
    ),
    debtRatioLimitPercent: Math.max(0, toNumber(value.debtRatioLimitPercent ?? DEFAULT_FINANCIAL_GOALS.debtRatioLimitPercent)),
    staleAssetDays: Math.max(1, toNumber(value.staleAssetDays ?? DEFAULT_FINANCIAL_GOALS.staleAssetDays)),
  };
}

export function loadFinancialGoals() {
  try {
    const storage = getLocalStorage();
    if (!storage) return DEFAULT_FINANCIAL_GOALS;

    const raw = storage.getItem(FINANCIAL_GOALS_STORAGE_KEY);
    if (!raw) return DEFAULT_FINANCIAL_GOALS;

    return parseFinancialGoals(JSON.parse(raw));
  } catch {
    return DEFAULT_FINANCIAL_GOALS;
  }
}

export function saveFinancialGoals(financialGoals) {
  const storage = getLocalStorage();
  if (!storage) return;

  storage.setItem(
    FINANCIAL_GOALS_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      financialGoals: parseFinancialGoals(financialGoals),
    }),
  );
}

export function createBackupPayload({ assets, exchangeRates, financialGoals, lastCheckedAt = new Date().toISOString() }) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    lastCheckedAt,
    assets: createAssetStore(assets).assets,
    exchangeRates: parseExchangeRateStore(exchangeRates),
    financialGoals: parseFinancialGoals(financialGoals),
  };
}

export function parseBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("匯入失敗：JSON 根節點必須是物件。");
  }

  if (!Array.isArray(payload.assets)) {
    throw new Error("匯入失敗：找不到 assets 陣列。");
  }

  if (!payload.exchangeRates || typeof payload.exchangeRates !== "object") {
    throw new Error("匯入失敗：找不到 exchangeRates 物件。");
  }

  if (!payload.financialGoals || typeof payload.financialGoals !== "object") {
    throw new Error("匯入失敗：找不到 financialGoals 物件。");
  }

  return {
    schemaVersion: toNumber(payload.schemaVersion) || BACKUP_SCHEMA_VERSION,
    exportedAt: payload.exportedAt ?? null,
    lastCheckedAt: payload.lastCheckedAt ?? null,
    assets: parseAssetStore({ schemaVersion: CURRENT_SCHEMA_VERSION, assets: payload.assets }).assets,
    exchangeRates: parseExchangeRateStore(payload.exchangeRates),
    financialGoals: parseFinancialGoals(payload.financialGoals),
  };
}

export function setManualExchangeRate(exchangeRateStore, currency, rateToTwd) {
  const current = parseExchangeRateStore(exchangeRateStore);
  const nextRate = normalizeExchangeRate(currency, {
    rateToTwd,
    source: "manual",
    updatedAt: new Date().toISOString(),
  });

  return {
    ...current,
    rates: {
      ...current.rates,
      [currency]: nextRate,
    },
  };
}

export async function fetchLatestExchangeRates() {
  const response = await fetch(`https://open.er-api.com/v6/latest/${BASE_CURRENCY}`);

  if (!response.ok) {
    throw new Error(`匯率 API 回應失敗：${response.status}`);
  }

  const data = await response.json();

  if (data.result !== "success") {
    throw new Error(data["error-type"] ?? "匯率 API 回傳失敗");
  }

  const fetchedAt = new Date().toISOString();
  const rates = {
    [BASE_CURRENCY]: {
      rateToTwd: 1,
      source: "base",
      updatedAt: fetchedAt,
    },
  };

  for (const currency of CURRENCIES) {
    if (currency === BASE_CURRENCY) continue;

    const baseToCurrency = toNumber(data.rates?.[currency]);
    if (baseToCurrency > 0) {
      rates[currency] = {
        rateToTwd: 1 / baseToCurrency,
        source: "api",
        updatedAt: fetchedAt,
      };
    }
  }

  return createExchangeRateStore(rates, {
    provider: EXCHANGE_RATE_PROVIDER.name,
    providerUrl: data.provider ?? EXCHANGE_RATE_PROVIDER.url,
    providerDocumentationUrl: data.documentation ?? EXCHANGE_RATE_PROVIDER.documentationUrl,
    fetchedAt,
    sourceUpdatedAt: data.time_last_update_utc ?? null,
    sourceNextUpdateAt: data.time_next_update_utc ?? null,
  });
}

export function createAssetId() {
  return `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getAssetTypeLabel(type) {
  return ASSET_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function getAssetDisplayName(asset) {
  if (asset.type === "stock") return asset.ticker || "未命名股票";
  return asset.name || getAssetTypeLabel(asset.type);
}

export function getMonthDifference(startDateValue, endDateValue = new Date()) {
  const startDate = new Date(startDateValue);
  const endDate = new Date(endDateValue);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  let months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + endDate.getMonth() - startDate.getMonth();
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  return Math.max(0, months);
}

export function getLoanSnapshot(asset, asOfDate = new Date()) {
  const principal = toNumber(asset.principal);
  const years = toNumber(asset.years);
  const annualRate = toNumber(asset.annualRate);
  const totalMonths = Math.max(0, Math.round(years * 12));
  const paidMonths = Math.min(totalMonths, getMonthDifference(asset.startDate, asOfDate));
  const monthlyRate = annualRate > 0 ? annualRate / 100 / 12 : 0;

  if (principal <= 0 || totalMonths <= 0) {
    return {
      principal,
      monthlyPayment: 0,
      totalMonths,
      paidMonths,
      progressPercent: 0,
      remainingPrincipal: principal,
    };
  }

  const monthlyPayment =
    monthlyRate > 0
      ? (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -totalMonths)
      : principal / totalMonths;

  const remainingPrincipal =
    monthlyRate > 0
      ? principal * (1 + monthlyRate) ** paidMonths -
        monthlyPayment * (((1 + monthlyRate) ** paidMonths - 1) / monthlyRate)
      : principal - monthlyPayment * paidMonths;

  const clampedRemaining = Math.min(principal, Math.max(0, remainingPrincipal));

  return {
    principal,
    monthlyPayment,
    totalMonths,
    paidMonths,
    progressPercent: totalMonths > 0 ? (paidMonths / totalMonths) * 100 : 0,
    remainingPrincipal: clampedRemaining,
  };
}

export function getAssetAmount(asset) {
  switch (asset.type) {
    case "stock":
      return toNumber(asset.shares) * toNumber(asset.buyPrice);
    case "loan":
      return -getLoanSnapshot(asset).remainingPrincipal;
    default:
      return toNumber(asset.amount);
  }
}

function normalizeGroupKeyPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function groupStockHoldings(assets) {
  const stockAssets = assets.filter((asset) => asset.type === "stock");
  const groups = new Map();

  for (const asset of stockAssets) {
    const ticker = (asset.ticker || "").trim().toUpperCase();
    const currency = asset.currency || "TWD";
    if (!ticker) continue;

    const key = `${ticker}_${currency}`;
    const current = groups.get(key) ?? {
      key,
      ticker,
      currency,
      totalShares: 0,
      totalCost: 0,
      lots: [],
    };

    const shares = toNumber(asset.shares);
    const buyPrice = toNumber(asset.buyPrice);
    const cost = shares * buyPrice;

    current.totalShares += shares;
    current.totalCost += cost;
    current.lots.push({
      ...asset,
      shares,
      buyPrice,
      cost,
    });

    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    averageCost: group.totalShares > 0 ? group.totalCost / group.totalShares : 0,
  }));
}

export function groupNonStockAssets(assets) {
  const groups = new Map();

  for (const asset of assets) {
    if (asset.type === "stock") continue;

    const type = asset.type || "other";
    const currency = asset.currency || "TWD";
    const name = getAssetDisplayName(asset);
    const key = `${type}_${currency}_${normalizeGroupKeyPart(name)}`;
    const amount = getAssetAmount(asset);
    const current = groups.get(key) ?? {
      key,
      type,
      currency,
      name,
      totalAmount: 0,
      entries: [],
    };

    current.totalAmount += amount;
    current.entries.push({
      ...asset,
      amountValue: amount,
    });

    groups.set(key, current);
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.type !== b.type) return getAssetTypeLabel(a.type).localeCompare(getAssetTypeLabel(b.type), "zh-Hant");
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

export function summarizeByCurrency(assets) {
  const summary = new Map();

  for (const asset of assets) {
    const currency = asset.currency || "TWD";
    const current = summary.get(currency) ?? {
      currency,
      assets: 0,
      liabilities: 0,
      net: 0,
    };

    const amount = getAssetAmount(asset);
    if (amount >= 0) {
      current.assets += amount;
    } else {
      current.liabilities += Math.abs(amount);
    }
    current.net += amount;

    summary.set(currency, current);
  }

  return Array.from(summary.values());
}

export function getRateToTwd(exchangeRateStore, currency) {
  const store = parseExchangeRateStore(exchangeRateStore);
  const rate = store.rates[currency]?.rateToTwd;
  return Number(rate) > 0 ? Number(rate) : null;
}

export function summarizeInBaseCurrency(currencySummary, exchangeRateStore) {
  const totals = {
    currency: BASE_CURRENCY,
    assets: 0,
    liabilities: 0,
    net: 0,
    missingCurrencies: [],
  };

  for (const item of currencySummary) {
    const rate = getRateToTwd(exchangeRateStore, item.currency);
    if (!rate) {
      totals.missingCurrencies.push(item.currency);
      continue;
    }

    totals.assets += item.assets * rate;
    totals.liabilities += item.liabilities * rate;
    totals.net += item.net * rate;
  }

  totals.missingCurrencies = [...new Set(totals.missingCurrencies)];

  return totals;
}

export function getDaysSince(value, now = new Date()) {
  if (!value) return null;

  const date = new Date(value);
  const endDate = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(endDate.getTime())) return null;

  return Math.floor((endDate.getTime() - date.getTime()) / 86400000);
}

export function getAssetUpdatedAt(asset, fallbackTimestamp = new Date().toISOString()) {
  return asset.updatedAt || asset.createdAt || fallbackTimestamp;
}

export function getLatestUpdatedAt(entries, fallbackTimestamp = new Date().toISOString()) {
  const timestamp = Math.max(
    0,
    ...entries.map((asset) => {
      const updatedAt = new Date(getAssetUpdatedAt(asset, fallbackTimestamp)).getTime();
      return Number.isNaN(updatedAt) ? 0 : updatedAt;
    }),
  );

  return timestamp > 0 ? new Date(timestamp).toISOString() : fallbackTimestamp;
}

export function getStockTickerCurrencySuggestion(ticker) {
  const normalizedTicker = String(ticker || "").trim();
  if (/^\d+$/.test(normalizedTicker)) return "TWD";
  if (/^[A-Za-z]+$/.test(normalizedTicker)) return "USD";
  return null;
}

export function getMarketPriceGapPercent(asset) {
  if (asset.type !== "stock") return null;

  const buyPrice = toNumber(asset.buyPrice);
  const marketPrice = toNumber(asset.marketPrice);
  if (buyPrice <= 0 || marketPrice <= 0) return null;

  return (Math.abs(marketPrice - buyPrice) / buyPrice) * 100;
}

export function getAssetAbsoluteAmount(asset) {
  return Math.abs(getAssetAmount(asset));
}

export function getAssetValueInTwd(asset, exchangeRateStore) {
  const rateToTwd = getRateToTwd(exchangeRateStore, asset.currency || BASE_CURRENCY);
  if (!rateToTwd) return null;

  return getAssetAbsoluteAmount(asset) * rateToTwd;
}

export function getConcentrationItems({ assets, exchangeRates, financialGoals }) {
  const goals = parseFinancialGoals(financialGoals);
  const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(assets), exchangeRates);
  const items = groupStockHoldings(assets).map((holding) => {
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
      const stockSharePercent = item.valueTwd !== null && totalStockValue > 0 ? (item.valueTwd / totalStockValue) * 100 : null;
      const totalAssetPercent = item.valueTwd !== null && twdSummary.assets > 0 ? (item.valueTwd / twdSummary.assets) * 100 : null;

      return {
        ...item,
        stockSharePercent,
        totalAssetPercent,
        isWarning: totalAssetPercent !== null && totalAssetPercent > goals.singleHoldingLimitPercent,
      };
    })
    .sort((a, b) => (b.valueTwd ?? -1) - (a.valueTwd ?? -1));
}

export function getGoalMetrics({ assets, exchangeRates, financialGoals }) {
  const goals = parseFinancialGoals(financialGoals);
  const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(assets), exchangeRates);
  let cashValueTwd = 0;
  let riskAssetValueTwd = 0;
  let missingValueCount = 0;

  for (const asset of assets) {
    const valueTwd = getAssetValueInTwd(asset, exchangeRates);
    if (valueTwd === null) {
      missingValueCount += 1;
      continue;
    }

    if (asset.type === "cash") {
      cashValueTwd += valueTwd;
    }

    if (asset.type === "stock" || asset.type === "fund") {
      riskAssetValueTwd += valueTwd;
    }
  }

  return {
    cashValueTwd,
    debtRatioPercent: twdSummary.assets > 0 ? (twdSummary.liabilities / twdSummary.assets) * 100 : 0,
    emergencyTarget: goals.monthlyLivingExpense * goals.emergencyMonths,
    missingValueCount,
    riskAssetValueTwd,
    riskExposurePercent: twdSummary.assets > 0 ? (riskAssetValueTwd / twdSummary.assets) * 100 : 0,
    twdSummary,
  };
}

export function buildAttentionItems({ assets, exchangeRates, financialGoals, now = new Date() }) {
  const goals = parseFinancialGoals(financialGoals);
  const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(assets), exchangeRates);
  const concentrationItems = getConcentrationItems({ assets, exchangeRates, financialGoals: goals });
  const goalMetrics = getGoalMetrics({ assets, exchangeRates, financialGoals: goals });
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

  const exchangeRateAge = getDaysSince(exchangeRates.sourceUpdatedAt || exchangeRates.fetchedAt, now);
  if (exchangeRateAge !== null && exchangeRateAge > STALE_EXCHANGE_RATE_DAYS) {
    items.push({ key: "stale-rates", label: `匯率資料已超過 ${exchangeRateAge} 天未更新` });
  }

  const staleCashAssets = assets.filter(
    (asset) => asset.type === "cash" && (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleCashAssets.length > 0) {
    items.push({
      key: "stale-cash",
      label: `${staleCashAssets.length} 筆現金超過 ${goals.staleAssetDays} 天未更新，建議重新匯入或確認`,
    });
  }

  const staleStockAssets = assets.filter(
    (asset) =>
      asset.type === "stock" &&
      (getDaysSince(asset.marketPriceUpdatedAt || getAssetUpdatedAt(asset), now) ?? 0) > STALE_STOCK_PRICE_DAYS,
  );
  if (staleStockAssets.length > 0) {
    items.push({
      key: "stale-stock-price",
      label: `${staleStockAssets.length} 筆股票超過 ${STALE_STOCK_PRICE_DAYS} 天未更新市價`,
    });
  }

  const staleLoanAssets = assets.filter(
    (asset) => asset.type === "loan" && (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleLoanAssets.length > 0) {
    items.push({
      key: "stale-loan",
      label: `${staleLoanAssets.length} 筆貸款超過 ${goals.staleAssetDays} 天未更新本金`,
    });
  }

  const staleOtherAssets = assets.filter(
    (asset) =>
      (asset.type === "fund" || asset.type === "other") &&
      (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleOtherAssets.length > 0) {
    items.push({
      key: "stale-other-assets",
      label: `${staleOtherAssets.length} 筆基金 / 其他資產超過 ${goals.staleAssetDays} 天未更新`,
    });
  }

  const priceGapAssets = assets.filter((asset) => (getMarketPriceGapPercent(asset) ?? 0) > 80);
  if (priceGapAssets.length > 0) {
    items.push({
      key: "price-gap",
      label: `${priceGapAssets.length} 筆股票成本與目前市價差距超過 80%，請確認資料`,
    });
  }

  const concentratedItems = concentrationItems.filter((item) => item.isWarning);
  if (concentratedItems.length > 0) {
    items.push({
      key: "concentration",
      label: `${concentratedItems[0].ticker} 占總資產超過 ${formatNumber(
        goals.singleHoldingLimitPercent,
      )}%，建議人工檢視集中度`,
    });
  }

  if (goalMetrics.emergencyTarget > 0 && goalMetrics.cashValueTwd < goalMetrics.emergencyTarget) {
    items.push({
      key: "emergency-fund",
      label: `緊急預備金不足：現金 ${formatCompactMoney(goalMetrics.cashValueTwd, BASE_CURRENCY)} / 目標 ${formatCompactMoney(
        goalMetrics.emergencyTarget,
        BASE_CURRENCY,
      )}`,
    });
  }

  if (goals.stockExposureLimitPercent > 0 && goalMetrics.riskExposurePercent > goals.stockExposureLimitPercent) {
    items.push({
      key: "risk-exposure",
      label: `股票 / 基金曝險 ${formatNumber(goalMetrics.riskExposurePercent)}%，高於設定上限 ${formatNumber(
        goals.stockExposureLimitPercent,
      )}%`,
    });
  }

  if (goals.debtRatioLimitPercent > 0 && goalMetrics.debtRatioPercent > goals.debtRatioLimitPercent) {
    items.push({
      key: "liability-ratio",
      label: `負債比 ${formatNumber(goalMetrics.debtRatioPercent)}%，高於設定上限 ${formatNumber(
        goals.debtRatioLimitPercent,
      )}%`,
    });
  }

  return items;
}
