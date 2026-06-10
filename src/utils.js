export const STORAGE_KEY = "asset-agent.assets.v1";

export const ASSET_TYPES = [
  { value: "cash", label: "現金" },
  { value: "stock", label: "股票" },
  { value: "fund", label: "基金" },
  { value: "loan", label: "貸款" },
  { value: "other", label: "其他" },
];

export const CURRENCIES = ["TWD", "USD", "JPY"];

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

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function loadAssets() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAssets(assets) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
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

export function getAssetAmount(asset) {
  switch (asset.type) {
    case "stock":
      return toNumber(asset.shares) * toNumber(asset.buyPrice);
    case "loan":
      return -toNumber(asset.principal);
    default:
      return toNumber(asset.amount);
  }
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
