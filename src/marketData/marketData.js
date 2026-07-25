import {
  BASE_CURRENCY,
  CURRENCIES,
  TRADED_ASSET_TYPES,
  createExchangeRateStore,
  parseExchangeRateStore,
  toNumber,
} from "../utils.js";

const PROVIDER_REQUEST_SKIPPED = "provider_request_skipped";
const PROVIDER_QUOTA_REACHED = "provider_quota_reached";
const APPLICABLE_PREVIEW_STATUSES = new Set(["ready", "unchanged", "needs_review"]);

export function isMarketDataUpdateUiEnabled(env = {}) {
  return String(env.VITE_ENABLE_MARKET_DATA_UPDATE ?? "").trim() === "true";
}

export function buildExchangeRatePreviewRequest(exchangeRates) {
  const store = parseExchangeRateStore(exchangeRates);

  return {
    baseCurrency: BASE_CURRENCY,
    currencies: CURRENCIES.filter((currency) => currency !== BASE_CURRENCY),
    currentRates: store.rates,
  };
}

export function buildStockPricePreviewRequest(assets = []) {
  const holdings = (Array.isArray(assets) ? assets : [])
    .filter((asset) => TRADED_ASSET_TYPES.includes(asset?.type))
    .map((asset) => ({
      assetId: String(asset.id ?? ""),
      type: asset.type,
      name: asset.name ?? "",
      ticker: asset.ticker ?? "",
      market: asset.market ?? "",
      exchange: asset.exchange ?? "",
      currency: asset.currency ?? BASE_CURRENCY,
      oldMarketPrice: asset.marketPrice ?? null,
      buyPrice: asset.buyPrice ?? null,
    }))
    .filter((holding) => holding.assetId);

  return { holdings };
}

function isReadyByDefault(item) {
  return item?.status === "ready";
}

function isFinitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function hasApplicablePreviewStatus(item) {
  return (
    Boolean(item) &&
    APPLICABLE_PREVIEW_STATUSES.has(item.status) &&
    item.errorCode !== PROVIDER_REQUEST_SKIPPED &&
    item.errorCode !== PROVIDER_QUOTA_REACHED &&
    item.source !== "unsupported"
  );
}

export function isApplicableExchangeRatePreview(item) {
  return hasApplicablePreviewStatus(item) && isFinitePositiveNumber(item.newRateToTwd);
}

export function isApplicablePricePreview(item) {
  return hasApplicablePreviewStatus(item) && isFinitePositiveNumber(item.newMarketPrice);
}

export function createMarketDataRequestGate() {
  let inFlight = false;

  return {
    tryStart() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish() {
      inFlight = false;
    },
    isInFlight() {
      return inFlight;
    },
  };
}

export function getStockPreviewRequestSummary(preview) {
  const summary = preview?.stockPrices?.summary ?? preview?.summary;
  if (!summary) return null;

  return {
    attemptedSymbolCount: Number(summary.attemptedSymbolCount) || 0,
    successfulSymbolCount: Number(summary.successfulSymbolCount) || 0,
    failedSymbolCount: Number(summary.failedSymbolCount) || 0,
    skippedSymbolCount: Number(summary.skippedSymbolCount) || 0,
    providerCallCount: Number(summary.providerCallCount) || 0,
    stoppedEarly: Boolean(summary.stoppedEarly),
    stopReason: summary.stopReason || null,
  };
}

export function getMarketDataActionState({
  hasPreview = false,
  isChecking = false,
  isApplying = false,
  selectedCount = 0,
  updateEnabled = true,
} = {}) {
  const applicableCount = Number.isFinite(Number(selectedCount)) ? Math.max(0, Number(selectedCount)) : 0;

  return {
    checkLabel: isChecking ? "檢查中…" : hasPreview ? "重新檢查行情" : "檢查行情更新",
    checkDisabled: !updateEnabled || isChecking || isApplying,
    checkAriaBusy: isChecking,
    applyLabel: isApplying ? "套用中…" : `套用選取更新（${applicableCount}）`,
    applyDisabled: isChecking || isApplying || applicableCount === 0,
    applyAriaBusy: isApplying,
  };
}

export function createMarketDataSelection(preview) {
  const exchangeRates = {};
  const stockPrices = {};

  for (const item of preview?.exchangeRates?.ratesPreview ?? preview?.ratesPreview ?? []) {
    exchangeRates[item.currency] = isReadyByDefault(item) && isApplicableExchangeRatePreview(item);
  }

  for (const item of preview?.stockPrices?.pricePreview ?? preview?.pricePreview ?? []) {
    stockPrices[item.assetId] = isReadyByDefault(item) && isApplicablePricePreview(item);
  }

  return { exchangeRates, stockPrices };
}

function getSelectedExchangePreviewItems(preview, selection) {
  return (preview?.exchangeRates?.ratesPreview ?? [])
    .filter((item) => selection?.exchangeRates?.[item.currency])
    .filter(isApplicableExchangeRatePreview);
}

function getSelectedStockPricePreviewItems(preview, selection) {
  return (preview?.stockPrices?.pricePreview ?? [])
    .filter((item) => selection?.stockPrices?.[item.assetId])
    .filter(isApplicablePricePreview);
}

export function getMarketDataSelectionCounts(preview, selection) {
  return {
    exchangeRateCount: getSelectedExchangePreviewItems(preview, selection).length,
    stockPriceCount: getSelectedStockPricePreviewItems(preview, selection).length,
  };
}

export function applyMarketDataPreviewSelection({
  assets = [],
  exchangeRates,
  preview,
  selection,
  appliedAt = new Date().toISOString(),
}) {
  const selectedRates = getSelectedExchangePreviewItems(preview, selection);
  const selectedPrices = getSelectedStockPricePreviewItems(preview, selection);
  const currentRates = parseExchangeRateStore(exchangeRates);
  const nextRateRows = { ...currentRates.rates };

  for (const item of selectedRates) {
    nextRateRows[item.currency] = {
      currency: item.currency,
      rateToTwd: toNumber(item.newRateToTwd),
      source: "market-data",
      updatedAt: item.fetchedAt || appliedAt,
    };
  }

  const nextExchangeRates =
    selectedRates.length > 0
      ? createExchangeRateStore(nextRateRows, {
          ...currentRates,
          provider: preview?.exchangeRates?.provider ?? currentRates.provider,
          fetchedAt: preview?.exchangeRates?.fetchedAt ?? appliedAt,
          sourceUpdatedAt: preview?.exchangeRates?.fetchedAt ?? appliedAt,
        })
      : currentRates;
  const priceByAssetId = new Map(selectedPrices.map((item) => [item.assetId, item]));
  const nextAssets = (Array.isArray(assets) ? assets : []).map((asset) => {
    const item = priceByAssetId.get(asset.id);
    if (!item) return asset;

    return {
      ...asset,
      marketPrice: toNumber(item.newMarketPrice),
      marketPriceUpdatedAt: item.priceDate || item.fetchedAt || appliedAt,
      marketPriceSource: item.source || "market-data",
      marketPriceFetchedAt: item.fetchedAt || appliedAt,
      marketPriceCurrency: item.priceCurrency || asset.currency,
      marketPriceBasis: item.basis || "latest-close",
      updatedAt: appliedAt,
    };
  });

  return {
    assets: nextAssets,
    exchangeRates: nextExchangeRates,
    selectedRates,
    selectedPrices,
    appliedCount: selectedRates.length + selectedPrices.length,
  };
}

export function mergeMarketDataPreviewResults(exchangeRatesResult, stockPricesResult) {
  const exchangeRates =
    exchangeRatesResult?.status === "fulfilled"
      ? exchangeRatesResult.value
      : {
          ok: false,
          provider: "",
          fetchedAt: null,
          baseCurrency: BASE_CURRENCY,
          ratesPreview: [],
          warnings: [exchangeRatesResult?.reason?.message || "匯率 preview 失敗。"],
        };
  const stockPrices =
    stockPricesResult?.status === "fulfilled"
      ? stockPricesResult.value
      : {
          ok: false,
          provider: "",
          fetchedAt: null,
          pricePreview: [],
          summary: null,
          warnings: [stockPricesResult?.reason?.message || "市價 preview 失敗。"],
        };

  return {
    exchangeRates,
    stockPrices,
    generatedAt: new Date().toISOString(),
  };
}
