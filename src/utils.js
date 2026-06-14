export const STORAGE_KEY = "asset-agent.assets.v1";
export const EXCHANGE_RATE_STORAGE_KEY = "asset-agent.exchange-rates.v1";
export const CURRENT_SCHEMA_VERSION = 1;
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

function normalizeAssets(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((asset) => asset && typeof asset === "object");
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
