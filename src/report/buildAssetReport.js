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
const AI_READY_SCHEMA_VERSION = 1;
const ASSET_TYPE_VALUES = ASSET_TYPES.map((item) => item.value);
const MONTHLY_EXPENSE_LEGACY_TEN_THOUSAND_THRESHOLD = 1000;
const TEN_THOUSAND_TWD = 10000;

const ACTION_CATEGORY_BY_ATTENTION_KEY = {
  empty: "review",
  "missing-rates": "data_quality",
  "stale-rates": "market_price_update",
  "stale-cash": "data_quality",
  "stale-stock-price": "market_price_update",
  "stale-loan": "data_quality",
  "stale-other-assets": "data_quality",
  "price-gap": "data_quality",
  concentration: "risk_control",
  "emergency-fund": "risk_control",
  "risk-exposure": "risk_control",
  "liability-ratio": "risk_control",
};

const ACTION_TITLE_BY_ATTENTION_KEY = {
  empty: "尚未建立資產資料",
  "missing-rates": "匯率資料待確認",
  "stale-rates": "匯率資料過期",
  "stale-cash": "現金資料待更新",
  "stale-stock-price": "市價資料待更新",
  "stale-loan": "貸款本金待確認",
  "stale-other-assets": "資產資料待更新",
  "price-gap": "價格差異過大",
  concentration: "集中度需要人工檢視",
  "emergency-fund": "緊急預備金待確認",
  "risk-exposure": "風險資產曝險待確認",
  "liability-ratio": "負債比待確認",
};

function createRiskFlag({ id, severity = "warning", category = "review", title, message, relatedAssetIds = [], ...meta }) {
  const label = [title, message].filter(Boolean).join("：");

  return {
    id,
    code: id,
    severity,
    category,
    title,
    message,
    label,
    relatedAssetIds,
    ...meta,
  };
}

function createActionItem({ id, priority = "medium", category = "review", title, message, relatedAssetIds = [], ...meta }) {
  const label = [title, message].filter(Boolean).join("：");

  return {
    id,
    code: id,
    priority,
    category,
    title,
    message,
    label,
    relatedAssetIds,
    ...meta,
  };
}

function getAttentionCategory(key) {
  if (String(key || "").startsWith("validation-")) return "data_quality";
  return ACTION_CATEGORY_BY_ATTENTION_KEY[key] ?? "review";
}

function getAttentionTitle(key) {
  if (String(key || "").startsWith("validation-")) return "資料可疑項目";
  return ACTION_TITLE_BY_ATTENTION_KEY[key] ?? "需要人工檢視";
}

function createActionItemFromAttention(item) {
  const category = getAttentionCategory(item.key);
  const priority = category === "risk_control" || category === "data_quality" ? "medium" : "low";
  const title = getAttentionTitle(item.key);

  return createActionItem({
    id: item.key,
    priority,
    category,
    title,
    message: `${item.label}；建議確認資料後再判讀報告。`,
    focusQuery: item.focusQuery,
  });
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

function getEmergencyFundExpenseBasis(financialGoals) {
  const rawMonthlyLivingExpense = Math.max(0, toNumber(financialGoals.monthlyLivingExpense));
  const usesLegacyTenThousandInput =
    rawMonthlyLivingExpense > 0 && rawMonthlyLivingExpense < MONTHLY_EXPENSE_LEGACY_TEN_THOUSAND_THRESHOLD;
  const monthlyLivingExpenseTwd = usesLegacyTenThousandInput
    ? rawMonthlyLivingExpense * TEN_THOUSAND_TWD
    : rawMonthlyLivingExpense;

  return {
    rawMonthlyLivingExpense: roundNumber(rawMonthlyLivingExpense),
    monthlyLivingExpenseTwd: roundNumber(monthlyLivingExpenseTwd),
    unit: usesLegacyTenThousandInput ? "ten-thousand-twd" : "TWD",
    unitLabel: usesLegacyTenThousandInput ? "萬元 TWD（相容換算）" : "TWD",
    unitAssumption: usesLegacyTenThousandInput ? "legacy-ten-thousand-input" : "stored-twd",
    usesLegacyTenThousandInput,
  };
}

function getReportRiskAndActions({
  assetList,
  attentionItems,
  concentrationItems,
  dataQuality,
  emergencyFundExpenseBasis,
  financialGoals,
  goalMetrics,
  latestSnapshotAt,
  cloudMode,
  staleAssets,
}) {
  const riskFlags = [];
  const actionItems = attentionItems.map(createActionItemFromAttention);
  const singleHoldingLimitBreaches = concentrationItems.filter((item) => item.isWarning);

  if (singleHoldingLimitBreaches.length > 0) {
    const primaryBreach = singleHoldingLimitBreaches[0];
    const severity =
      primaryBreach.totalAssetPercent !== null && primaryBreach.totalAssetPercent >= financialGoals.singleHoldingLimitPercent * 1.5
        ? "critical"
        : "warning";

    riskFlags.push(
      createRiskFlag({
        id: "single-holding-concentration",
        severity,
        category: "concentration",
        title: "單一標的集中度偏高",
        message: `${primaryBreach.ticker} 占總資產 ${formatNumber(
          primaryBreach.totalAssetPercent,
        )}%，高於設定上限 ${formatNumber(financialGoals.singleHoldingLimitPercent)}%；建議人工檢視集中度。`,
        count: singleHoldingLimitBreaches.length,
      }),
    );
  }

  if (financialGoals.stockExposureLimitPercent > 0 && goalMetrics.riskExposurePercent > financialGoals.stockExposureLimitPercent) {
    riskFlags.push(
      createRiskFlag({
        id: "risk-asset-exposure",
        severity:
          goalMetrics.riskExposurePercent >= financialGoals.stockExposureLimitPercent + 20 ? "critical" : "warning",
        category: "allocation",
        title: "股票 / ETF / 基金曝險偏高",
        message: `目前曝險 ${formatNumber(goalMetrics.riskExposurePercent)}%，高於設定上限 ${formatNumber(
          financialGoals.stockExposureLimitPercent,
        )}%；建議確認是否符合自己的風險設定。`,
      }),
    );
  }

  if (financialGoals.debtRatioLimitPercent > 0 && goalMetrics.debtRatioPercent > financialGoals.debtRatioLimitPercent) {
    riskFlags.push(
      createRiskFlag({
        id: "debt-ratio",
        severity: goalMetrics.debtRatioPercent >= financialGoals.debtRatioLimitPercent + 20 ? "critical" : "warning",
        category: "debt",
        title: "負債比偏高",
        message: `目前負債比 ${formatNumber(goalMetrics.debtRatioPercent)}%，高於設定上限 ${formatNumber(
          financialGoals.debtRatioLimitPercent,
        )}%；建議確認本金與負債資料。`,
      }),
    );
  }

  if (emergencyFundExpenseBasis.usesLegacyTenThousandInput) {
    actionItems.push(
      createActionItem({
        id: "monthly-living-expense-unit-check",
        priority: "medium",
        category: "data_quality",
        title: "確認每月生活費單位",
        message: `每月生活費原始值 ${formatNumber(
          emergencyFundExpenseBasis.rawMonthlyLivingExpense,
        )} 已在報告中視為 ${formatNumber(
          emergencyFundExpenseBasis.rawMonthlyLivingExpense,
        )} 萬 TWD（${BASE_CURRENCY} ${formatNumber(
          emergencyFundExpenseBasis.monthlyLivingExpenseTwd,
        )}）；建議確認理財目標是否應輸入完整 TWD 金額。`,
      }),
    );
  }

  if (goalMetrics.emergencyTarget > 0 && goalMetrics.cashValueTwd < goalMetrics.emergencyTarget) {
    const emergencyFundMonths =
      emergencyFundExpenseBasis.monthlyLivingExpenseTwd > 0
        ? goalMetrics.cashValueTwd / emergencyFundExpenseBasis.monthlyLivingExpenseTwd
        : 0;
    const message = `目前約 ${formatNumber(emergencyFundMonths)} 個月，低於目標 ${formatNumber(
      financialGoals.emergencyMonths,
    )} 個月；每月生活費以 ${BASE_CURRENCY} ${formatNumber(
      emergencyFundExpenseBasis.monthlyLivingExpenseTwd,
    )} 計算，建議確認現金水位與生活費設定。`;

    riskFlags.push(
      createRiskFlag({
        id: "emergency-fund-shortfall",
        severity: emergencyFundMonths < 1 ? "critical" : "warning",
        category: "allocation",
        title: "緊急預備金低於目標",
        message,
      }),
    );
    actionItems.push(
      createActionItem({
        id: "emergency-fund-shortfall",
        priority: "high",
        category: "risk_control",
        title: "確認緊急預備金",
        message,
      }),
    );
  }

  if (dataQuality.missingCurrencyWarnings.length > 0) {
    actionItems.push(
      createActionItem({
        id: "missing-currency-rates",
        priority: "high",
        category: "data_quality",
        title: "補齊匯率資料",
        message: `缺少 ${dataQuality.missingCurrencyWarnings.map((item) => item.currency).join(", ")} 匯率；建議更新匯率後再檢查 TWD 摘要。`,
      }),
    );
  }

  if (dataQuality.missingMarketPriceCount > 0) {
    actionItems.push(
      createActionItem({
        id: "missing-market-price",
        priority: "medium",
        category: "market_price_update",
        title: "補齊股票 / ETF 市價",
        message: `${dataQuality.missingMarketPriceCount} 筆股票 / ETF 缺少目前市價；建議更新資料後再判讀曝險。`,
        relatedAssetIds: assetList.filter((asset) => isTradedAssetType(asset.type) && toNumber(asset.marketPrice) <= 0).map((asset) => asset.id),
      }),
    );
  }

  if (staleAssets.length > 0) {
    actionItems.push(
      createActionItem({
        id: "stale-assets",
        priority: "medium",
        category: "data_quality",
        title: "更新過期資產資料",
        message: `${staleAssets.length} 筆資產資料過期；建議重新確認資料時間與金額。`,
        relatedAssetIds: staleAssets.map((asset) => asset.id),
      }),
    );
  }

  if (cloudMode && !latestSnapshotAt) {
    actionItems.push(
      createActionItem({
        id: "missing-cloud-snapshot",
        priority: "medium",
        category: "backup",
        title: "建立 D1 snapshot",
        message: "Cloud Mode 尚無 D1 snapshot；建議先建立一筆雲端備份，方便後續人工檢查或還原。",
      }),
    );
  }

  if (assetList.length === 0) {
    actionItems.push(
      createActionItem({
        id: "empty-assets",
        priority: "low",
        category: "review",
        title: "新增或匯入資產資料",
        message: "尚未建立任何資產資料；可先新增資產或匯入備份。",
      }),
    );
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
  const emergencyFundExpenseBasis = getEmergencyFundExpenseBasis(goals);
  const reportGoalMetrics = {
    ...goalMetrics,
    emergencyTarget: emergencyFundExpenseBasis.monthlyLivingExpenseTwd * goals.emergencyMonths,
  };
  const dataQuality = {
    ...getDataQuality(assetList, rates, goals, now, currencySummary),
    monthlyLivingExpense: {
      rawValue: emergencyFundExpenseBasis.rawMonthlyLivingExpense,
      amountTwd: emergencyFundExpenseBasis.monthlyLivingExpenseTwd,
      unit: emergencyFundExpenseBasis.unit,
      unitLabel: emergencyFundExpenseBasis.unitLabel,
      unitAssumption: emergencyFundExpenseBasis.unitAssumption,
    },
    monthlyLivingExpenseWarnings: emergencyFundExpenseBasis.usesLegacyTenThousandInput
      ? [
          {
            key: "monthly-living-expense-unit",
            label: `每月生活費 ${formatNumber(
              emergencyFundExpenseBasis.rawMonthlyLivingExpense,
            )} 已以萬元相容格式估算；建議確認單位。`,
          },
        ]
      : [],
  };
  const latestSnapshotAt = cloudMode ? getLatestSnapshotAt(snapshots) : null;
  const attentionItems = buildAttentionItems({ assets: assetList, exchangeRates: rates, financialGoals: goals, now });
  const emergencyFundMonths =
    emergencyFundExpenseBasis.monthlyLivingExpenseTwd > 0
      ? goalMetrics.cashValueTwd / emergencyFundExpenseBasis.monthlyLivingExpenseTwd
      : 0;
  const { riskFlags, actionItems } = getReportRiskAndActions({
    assetList,
    attentionItems,
    concentrationItems,
    dataQuality,
    emergencyFundExpenseBasis,
    financialGoals: goals,
    goalMetrics: reportGoalMetrics,
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
      emergencyFundMonthlyExpenseRaw: emergencyFundExpenseBasis.rawMonthlyLivingExpense,
      emergencyFundMonthlyExpenseTwd: emergencyFundExpenseBasis.monthlyLivingExpenseTwd,
      emergencyFundUnit: emergencyFundExpenseBasis.unit,
      emergencyFundUnitLabel: emergencyFundExpenseBasis.unitLabel,
      emergencyFundTargetTwd: roundNumber(reportGoalMetrics.emergencyTarget),
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
      emergencyFundUnit: emergencyFundExpenseBasis.unit,
      emergencyFundUnitLabel: emergencyFundExpenseBasis.unitLabel,
      emergencyFundMonthlyExpenseRaw: emergencyFundExpenseBasis.rawMonthlyLivingExpense,
      emergencyFundMonthlyExpenseTwd: emergencyFundExpenseBasis.monthlyLivingExpenseTwd,
      emergencyFundUnitAssumption: emergencyFundExpenseBasis.unitAssumption,
      missingCurrencyCount: twdSummary.missingCurrencies.length,
      totalNativeAssetAmount: roundNumber(assetList.reduce((total, asset) => total + Math.max(0, getAssetAmount(asset)), 0)),
      riskAssetTypes: ASSET_TYPE_VALUES.filter((type) => isRiskAssetType(type)),
    },
  };
}

function normalizeReportCollection(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id ?? item.code ?? "unknown",
    code: item.code ?? item.id ?? "unknown",
    severity: item.severity,
    priority: item.priority,
    category: item.category ?? "review",
    title: item.title ?? item.label ?? "需要人工檢視",
    message: item.message ?? item.label ?? "",
    label: item.label ?? [item.title, item.message].filter(Boolean).join("："),
    relatedAssetIds: Array.isArray(item.relatedAssetIds) ? item.relatedAssetIds : [],
  }));
}

export function buildAiReadyReportInput(report) {
  const safeReport = report ?? buildAssetReport();
  const riskFlags = normalizeReportCollection(safeReport.riskFlags);
  const actionItems = normalizeReportCollection(safeReport.actionItems);

  return {
    schemaVersion: AI_READY_SCHEMA_VERSION,
    purpose: "asset-agent-ai-report-input",
    generatedAt: safeReport.generatedAt,
    language: "zh-TW",
    disclaimer: "This is structured input for future AI narration. It is not investment advice.",
    source: {
      dataSourceMode: safeReport.source?.dataSourceMode ?? "localStorage",
      cloudMode: Boolean(safeReport.source?.cloudMode),
      exchangeRatesFetchedAt: safeReport.source?.exchangeRatesFetchedAt ?? null,
      exchangeRatesSourceUpdatedAt: safeReport.source?.exchangeRatesSourceUpdatedAt ?? null,
      latestSnapshotAt: safeReport.source?.latestSnapshotAt ?? null,
    },
    financialSummary: safeReport.summary ?? {},
    allocationSummary: safeReport.allocation ?? {},
    riskSummary: {
      riskFlags: riskFlags.map(({ id, severity, category, title, message, relatedAssetIds }) => ({
        id,
        severity,
        category,
        title,
        message,
        relatedAssetIds,
      })),
      actionItems: actionItems.map(({ id, priority, category, title, message, relatedAssetIds }) => ({
        id,
        priority,
        category,
        title,
        message,
        relatedAssetIds,
      })),
    },
    dataQuality: safeReport.dataQuality ?? {},
    reportMetadata: safeReport.metadata ?? {},
    constraints: {
      doNotProvideBuySellInstructions: true,
      doNotInferMissingMarketPrices: true,
      askForConfirmationBeforeHighImpactAdvice: true,
    },
  };
}

function formatReportTwd(value) {
  return `TWD ${formatNumber(value)}`;
}

function formatEmergencyFundMonthlyExpense(allocation = {}) {
  const amountTwd = allocation.emergencyFundMonthlyExpenseTwd ?? 0;
  const rawValue = allocation.emergencyFundMonthlyExpenseRaw ?? amountTwd;

  if (allocation.emergencyFundUnit === "ten-thousand-twd") {
    return `每月生活費以 ${formatNumber(rawValue)} 萬 TWD 相容換算（${formatReportTwd(amountTwd)}）`;
  }

  return `每月生活費以 ${formatReportTwd(amountTwd)} 計算`;
}

function formatReportPercent(value) {
  return value === null || value === undefined ? "未估" : `${formatNumber(value)}%`;
}

function formatMarkdownList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) return `- ${emptyText}`;

  return items.map((item) => `- ${item}`).join("\n");
}

export function buildMarkdownAssetReport(report) {
  const safeReport = report ?? buildAssetReport();
  const riskFlags = normalizeReportCollection(safeReport.riskFlags);
  const actionItems = normalizeReportCollection(safeReport.actionItems);
  const source = safeReport.source ?? {};
  const summary = safeReport.summary ?? {};
  const allocation = safeReport.allocation ?? {};
  const dataQuality = safeReport.dataQuality ?? {};

  const typeLines = (allocation.byAssetType ?? []).map(
    (item) => `${item.label}: ${formatReportTwd(item.valueTwd)} (${formatReportPercent(item.percentOfTotalAssets)})`,
  );
  const currencyLines = (allocation.byCurrency ?? []).map((item) =>
    item.missingRate
      ? `${item.currency}: 缺匯率，未納入 TWD 估值`
      : `${item.currency}: ${formatReportTwd(item.assetsTwd)} (${formatReportPercent(item.percentOfTotalAssets)})`,
  );
  const riskLines = riskFlags.map((item) => `[${item.severity}] ${item.title}: ${item.message}`);
  const actionLines = actionItems.map((item) => `[${item.priority}] ${item.title}: ${item.message}`);

  return [
    "# Asset Agent 規則型資產報告",
    "",
    `產生時間：${safeReport.generatedAt}`,
    `資料來源：${source.cloudMode ? "Cloudflare D1" : "localStorage"}`,
    "",
    "## 資產摘要",
    `- 淨資產：${formatReportTwd(summary.netWorthTwd)}`,
    `- 總資產：${formatReportTwd(summary.totalAssetsTwd)}`,
    `- 總負債：${formatReportTwd(summary.totalLiabilitiesTwd)}`,
    `- 緊急預備金：約 ${formatNumber(allocation.emergencyFundMonths)} 個月`,
    `- ${formatEmergencyFundMonthlyExpense(allocation)}`,
    "",
    "## 配置摘要",
    formatMarkdownList(typeLines, "尚無可用配置資料。"),
    "",
    "## 幣別曝險",
    formatMarkdownList(currencyLines, "尚無幣別資料。"),
    "",
    "## 風險提示",
    formatMarkdownList(riskLines, "目前沒有明顯風險提示。"),
    "",
    "## 待處理事項",
    formatMarkdownList(actionLines, "目前沒有明顯待處理事項。"),
    "",
    "## 資料品質",
    `- 資產筆數：${dataQuality.assetCount ?? 0}`,
    `- 缺市價：${dataQuality.missingMarketPriceCount ?? 0}`,
    `- 市價過期：${dataQuality.staleMarketPriceCount ?? 0}`,
    `- 缺代號：${dataQuality.missingTickerCount ?? 0}`,
    `- 同名提醒：${dataQuality.duplicateNameWarnings?.length ?? 0}`,
    "",
    "## Snapshot 狀態",
    `- 最近 snapshot：${source.latestSnapshotAt ?? "尚無"}`,
    "",
    "## Disclaimer",
    "本報告為規則型摘要，未使用 AI，不構成投資建議；資料來源為目前 App 已載入資料。",
    "",
  ].join("\n");
}
