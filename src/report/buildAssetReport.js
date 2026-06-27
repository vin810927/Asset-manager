import {
  ASSET_TYPES,
  BASE_CURRENCY,
  STALE_STOCK_PRICE_DAYS,
  buildAttentionItems,
  formatNumber,
  getAssetAmount,
  getAssetDisplayName,
  getAssetTypeLabel,
  getAssetUpdatedAt,
  getAssetValueInTwd,
  getConcentrationItems,
  getDaysSince,
  getGoalMetrics,
  isAssetStale,
  isRiskAssetType,
  isTradedAssetType,
  parseAssetStore,
  parseExchangeRateStore,
  parseFinancialGoals,
  summarizeByCurrency,
  summarizeInBaseCurrency,
  toNumber,
} from "../utils.js";

const REPORT_SCHEMA_VERSION = 1;
const ASSET_TYPE_VALUES = ASSET_TYPES.map((item) => item.value);

function createRiskFlag(code, label, severity = "warning", meta = {}) {
  return {
    code,
    severity,
    label,
    ...meta,
  };
}

function createActionItem(code, label, priority = "medium", meta = {}) {
  return {
    code,
    priority,
    label,
    ...meta,
  };
}

function roundNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function maxIsoTimestamp(values) {
  const timestamp = Math.max(
    0,
    ...values.map((value) => {
      const time = new Date(value || 0).getTime();
      return Number.isFinite(time) ? time : 0;
    }),
  );

  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function getLatestSnapshotAt(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;

  return maxIsoTimestamp(snapshots.map((snapshot) => snapshot.createdAt || snapshot.updatedAt || snapshot.snapshotDate));
}

function getTypeSummary(assetList, exchangeRates, totalAssetsTwd) {
  return ASSET_TYPE_VALUES.map((type) => {
    const typeAssets = assetList.filter((asset) => asset.type === type);
    const valueTwd = typeAssets.reduce((total, asset) => total + (getAssetValueInTwd(asset, exchangeRates) ?? 0), 0);
    const includedInAssets = type !== "loan";

    return {
      type,
      label: getAssetTypeLabel(type),
      count: typeAssets.length,
      valueTwd: roundNumber(valueTwd),
      percentOfTotalAssets:
        includedInAssets && totalAssetsTwd > 0 ? roundNumber((valueTwd / totalAssetsTwd) * 100) : 0,
      role: type === "loan" ? "liability" : "asset",
    };
  }).filter((item) => item.count > 0 || item.type !== "other");
}

function getCurrencyExposure(currencySummary, exchangeRates, totalAssetsTwd) {
  return currencySummary.map((item) => {
    const rateToTwd = exchangeRates.rates[item.currency]?.rateToTwd;
    const hasRate = Number(rateToTwd) > 0;
    const assetsTwd = hasRate ? item.assets * Number(rateToTwd) : null;
    const liabilitiesTwd = hasRate ? item.liabilities * Number(rateToTwd) : null;
    const netTwd = hasRate ? item.net * Number(rateToTwd) : null;

    return {
      currency: item.currency,
      assetsNative: roundNumber(item.assets),
      liabilitiesNative: roundNumber(item.liabilities),
      netNative: roundNumber(item.net),
      assetsTwd: assetsTwd === null ? null : roundNumber(assetsTwd),
      liabilitiesTwd: liabilitiesTwd === null ? null : roundNumber(liabilitiesTwd),
      netTwd: netTwd === null ? null : roundNumber(netTwd),
      percentOfTotalAssets: assetsTwd !== null && totalAssetsTwd > 0 ? roundNumber((assetsTwd / totalAssetsTwd) * 100) : null,
      missingRate: !hasRate,
    };
  });
}

function getDuplicateNameWarnings(assetList) {
  const groups = new Map();

  for (const asset of assetList) {
    const name = getAssetDisplayName(asset).trim();
    if (!name) continue;

    const key = `${asset.type || "other"}:${asset.currency || BASE_CURRENCY}:${name.toLowerCase()}`;
    const current = groups.get(key) ?? {
      name,
      type: asset.type || "other",
      currency: asset.currency || BASE_CURRENCY,
      count: 0,
      ids: [],
    };

    current.count += 1;
    current.ids.push(asset.id);
    groups.set(key, current);
  }

  return [...groups.values()]
    .filter((item) => item.count > 1)
    .map((item) => ({
      name: item.name,
      type: item.type,
      currency: item.currency,
      count: item.count,
      ids: item.ids,
      label: `${getAssetTypeLabel(item.type)} ${item.currency}「${item.name}」有 ${item.count} 筆同名資料`,
    }));
}

function getStaleAssets(assetList, goals, now) {
  return assetList
    .filter((asset) => isAssetStale(asset, goals, now))
    .map((asset) => {
      const basisAt = isTradedAssetType(asset.type) ? asset.marketPriceUpdatedAt || getAssetUpdatedAt(asset) : getAssetUpdatedAt(asset);

      return {
        id: asset.id,
        type: asset.type,
        label: getAssetDisplayName(asset),
        currency: asset.currency || BASE_CURRENCY,
        updatedAt: getAssetUpdatedAt(asset),
        staleBasisAt: basisAt,
        daysSinceUpdate: getDaysSince(basisAt, now),
      };
    });
}

function getDataQuality(assetList, exchangeRates, goals, now, currencySummary) {
  const tradedAssets = assetList.filter((asset) => isTradedAssetType(asset.type));
  const missingMarketPriceAssets = tradedAssets.filter((asset) => toNumber(asset.marketPrice) <= 0);
  const staleMarketPriceAssets = tradedAssets.filter(
    (asset) => (getDaysSince(asset.marketPriceUpdatedAt || getAssetUpdatedAt(asset), now) ?? 0) > STALE_STOCK_PRICE_DAYS,
  );
  const missingTickerAssets = tradedAssets.filter((asset) => !String(asset.ticker || "").trim());
  const missingCurrencyWarnings = currencySummary
    .filter((item) => !exchangeRates.rates[item.currency]?.rateToTwd)
    .map((item) => ({
      currency: item.currency,
      label: `${item.currency} 缺少 TWD 匯率，相關估值未納入 TWD 摘要`,
    }));

  return {
    assetCount: assetList.length,
    missingMarketPriceCount: missingMarketPriceAssets.length,
    staleMarketPriceCount: staleMarketPriceAssets.length,
    missingTickerCount: missingTickerAssets.length,
    staleAssetCount: getStaleAssets(assetList, goals, now).length,
    duplicateNameWarnings: getDuplicateNameWarnings(assetList),
    missingCurrencyWarnings,
  };
}

function getSummaryByType(allocationByType) {
  const getValue = (type) => allocationByType.find((item) => item.type === type)?.valueTwd ?? 0;

  return {
    cashTwd: getValue("cash"),
    stockTwd: getValue("stock"),
    etfTwd: getValue("etf"),
    fundTwd: getValue("fund"),
    loanTwd: getValue("loan"),
    otherTwd: getValue("other"),
  };
}

function getReportRiskAndActions({
  assetList,
  attentionItems,
  concentrationItems,
  dataQuality,
  financialGoals,
  goalMetrics,
  latestSnapshotAt,
  cloudMode,
  staleAssets,
}) {
  const riskFlags = [];
  const actionItems = attentionItems.map((item) => createActionItem(item.key, item.label, "medium", { focusQuery: item.focusQuery }));
  const singleHoldingLimitBreaches = concentrationItems.filter((item) => item.isWarning);

  if (singleHoldingLimitBreaches.length > 0) {
    riskFlags.push(
      createRiskFlag(
        "single-holding-concentration",
        `${singleHoldingLimitBreaches[0].ticker} 占總資產 ${formatNumber(
          singleHoldingLimitBreaches[0].totalAssetPercent,
        )}%，高於單一標的上限 ${formatNumber(financialGoals.singleHoldingLimitPercent)}%`,
        "warning",
        { count: singleHoldingLimitBreaches.length },
      ),
    );
  }

  if (financialGoals.stockExposureLimitPercent > 0 && goalMetrics.riskExposurePercent > financialGoals.stockExposureLimitPercent) {
    riskFlags.push(
      createRiskFlag(
        "risk-asset-exposure",
        `股票 / ETF / 基金曝險 ${formatNumber(goalMetrics.riskExposurePercent)}%，高於設定上限 ${formatNumber(
          financialGoals.stockExposureLimitPercent,
        )}%`,
      ),
    );
  }

  if (financialGoals.debtRatioLimitPercent > 0 && goalMetrics.debtRatioPercent > financialGoals.debtRatioLimitPercent) {
    riskFlags.push(
      createRiskFlag(
        "debt-ratio",
        `負債比 ${formatNumber(goalMetrics.debtRatioPercent)}%，高於設定上限 ${formatNumber(financialGoals.debtRatioLimitPercent)}%`,
      ),
    );
  }

  if (goalMetrics.emergencyTarget > 0 && goalMetrics.cashValueTwd < goalMetrics.emergencyTarget) {
    const emergencyFundMonths =
      financialGoals.monthlyLivingExpense > 0 ? goalMetrics.cashValueTwd / financialGoals.monthlyLivingExpense : 0;
    const label = `緊急預備金約 ${formatNumber(emergencyFundMonths)} 個月，低於目標 ${formatNumber(
      financialGoals.emergencyMonths,
    )} 個月`;

    riskFlags.push(createRiskFlag("emergency-fund-shortfall", label));
    actionItems.push(createActionItem("emergency-fund-shortfall", label, "high"));
  }

  if (dataQuality.missingCurrencyWarnings.length > 0) {
    actionItems.push(
      createActionItem(
        "missing-currency-rates",
        `缺少 ${dataQuality.missingCurrencyWarnings.map((item) => item.currency).join(", ")} 匯率，請補齊後再檢查 TWD 摘要`,
        "high",
      ),
    );
  }

  if (dataQuality.missingMarketPriceCount > 0) {
    actionItems.push(
      createActionItem("missing-market-price", `${dataQuality.missingMarketPriceCount} 筆股票 / ETF 缺少目前市價`, "medium"),
    );
  }

  if (staleAssets.length > 0) {
    actionItems.push(createActionItem("stale-assets", `${staleAssets.length} 筆資產資料過期，建議重新確認`, "medium"));
  }

  if (cloudMode && !latestSnapshotAt) {
    actionItems.push(createActionItem("missing-cloud-snapshot", "Cloud Mode 尚無 D1 snapshot，建議先建立一筆雲端備份", "medium"));
  }

  if (assetList.length === 0) {
    actionItems.push(createActionItem("empty-assets", "尚未建立任何資產資料", "low"));
  }

  return {
    riskFlags,
    actionItems,
  };
}

export function buildAssetReport({
  assets = [],
  financialGoals = {},
  exchangeRates = {},
  snapshots = [],
  dataSourceMode = "localStorage",
  cloudMode = false,
  generatedAt = new Date().toISOString(),
  now = new Date(),
} = {}) {
  const assetList = parseAssetStore({ assets }).assets;
  const goals = parseFinancialGoals(financialGoals);
  const rates = parseExchangeRateStore(exchangeRates);
  const currencySummary = summarizeByCurrency(assetList);
  const twdSummary = summarizeInBaseCurrency(currencySummary, rates);
  const goalMetrics = getGoalMetrics({ assets: assetList, exchangeRates: rates, financialGoals: goals });
  const allocationByType = getTypeSummary(assetList, rates, twdSummary.assets);
  const allocationByCurrency = getCurrencyExposure(currencySummary, rates, twdSummary.assets);
  const typeSummary = getSummaryByType(allocationByType);
  const concentrationItems = getConcentrationItems({ assets: assetList, exchangeRates: rates, financialGoals: goals });
  const staleAssets = getStaleAssets(assetList, goals, now);
  const dataQuality = getDataQuality(assetList, rates, goals, now, currencySummary);
  const latestSnapshotAt = cloudMode ? getLatestSnapshotAt(snapshots) : null;
  const attentionItems = buildAttentionItems({ assets: assetList, exchangeRates: rates, financialGoals: goals, now });
  const emergencyFundMonths = goals.monthlyLivingExpense > 0 ? goalMetrics.cashValueTwd / goals.monthlyLivingExpense : 0;
  const { riskFlags, actionItems } = getReportRiskAndActions({
    assetList,
    attentionItems,
    concentrationItems,
    dataQuality,
    financialGoals: goals,
    goalMetrics,
    latestSnapshotAt,
    cloudMode,
    staleAssets,
  });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    source: {
      dataSourceMode,
      cloudMode,
      exchangeRatesFetchedAt: rates.fetchedAt ?? null,
      exchangeRatesSourceUpdatedAt: rates.sourceUpdatedAt ?? null,
      latestSnapshotAt,
    },
    summary: {
      netWorthTwd: roundNumber(twdSummary.net),
      totalAssetsTwd: roundNumber(twdSummary.assets),
      totalLiabilitiesTwd: roundNumber(twdSummary.liabilities),
      ...typeSummary,
    },
    allocation: {
      byAssetType: allocationByType,
      byCurrency: allocationByCurrency,
      stockExposurePercent: roundNumber(goalMetrics.riskExposurePercent),
      debtRatioPercent: roundNumber(goalMetrics.debtRatioPercent),
      emergencyFundMonths: roundNumber(emergencyFundMonths),
      emergencyFundTargetMonths: roundNumber(goals.emergencyMonths),
    },
    riskFlags,
    actionItems,
    staleAssets,
    concentration: {
      topHoldings: concentrationItems.slice(0, 8).map((item) => ({
        key: item.key,
        type: item.type,
        ticker: item.ticker,
        currency: item.currency,
        valueTwd: item.valueTwd === null ? null : roundNumber(item.valueTwd),
        totalAssetPercent: item.totalAssetPercent === null ? null : roundNumber(item.totalAssetPercent),
        stockSharePercent: item.stockSharePercent === null ? null : roundNumber(item.stockSharePercent),
        isWarning: item.isWarning,
      })),
      singleHoldingLimitBreaches: concentrationItems
        .filter((item) => item.isWarning)
        .map((item) => ({
          key: item.key,
          ticker: item.ticker,
          type: item.type,
          currency: item.currency,
          valueTwd: item.valueTwd === null ? null : roundNumber(item.valueTwd),
          totalAssetPercent: item.totalAssetPercent === null ? null : roundNumber(item.totalAssetPercent),
          limitPercent: roundNumber(goals.singleHoldingLimitPercent),
        })),
    },
    dataQuality,
    metadata: {
      reportType: "deterministic-asset-report",
      usesAi: false,
      writesToD1: false,
      assetValueBasis: "existing-app-logic",
      emergencyFundUnit: "TWD",
      missingCurrencyCount: twdSummary.missingCurrencies.length,
      totalNativeAssetAmount: roundNumber(assetList.reduce((total, asset) => total + Math.max(0, getAssetAmount(asset)), 0)),
      riskAssetTypes: ASSET_TYPE_VALUES.filter((type) => isRiskAssetType(type)),
    },
  };
}
