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
  { value: "etf", label: "ETF" },
  { value: "fund", label: "基金" },
  { value: "loan", label: "貸款" },
  { value: "other", label: "其他" },
];

export const CURRENCIES = ["TWD", "USD", "JPY", "EUR", "GBP", "AUD", "CAD", "HKD", "SGD", "CNY"];
export const TRADED_ASSET_TYPES = ["stock", "etf"];
export const RISK_ASSET_TYPES = ["stock", "etf", "fund"];
export const DEFAULT_FINANCIAL_GOALS = {
  monthlyLivingExpense: 50000,
  emergencyMonths: 6,
  singleHoldingLimitPercent: 20,
  stockExposureLimitPercent: 60,
  debtRatioLimitPercent: 50,
  staleAssetDays: 30,
};
export const FINANCIAL_GOAL_DRAFT_FIELDS = [
  "monthlyLivingExpense",
  "emergencyMonths",
  "singleHoldingLimitPercent",
  "stockExposureLimitPercent",
  "debtRatioLimitPercent",
  "staleAssetDays",
];
export const STALE_EXCHANGE_RATE_DAYS = 7;
export const STALE_STOCK_PRICE_DAYS = 7;
export const CSV_COLUMNS = [
  "id",
  "type",
  "name",
  "ticker",
  "currency",
  "amount",
  "shares",
  "buyPrice",
  "marketPrice",
  "marketPriceUpdatedAt",
  "buyDate",
  "principal",
  "years",
  "annualRate",
  "startDate",
  "note",
  "createdAt",
  "updatedAt",
];

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

export function isTradedAssetType(type) {
  return TRADED_ASSET_TYPES.includes(type);
}

export function isRiskAssetType(type) {
  return RISK_ASSET_TYPES.includes(type);
}

function hasInputValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isValidNumberInput(value) {
  if (!hasInputValue(value)) return false;
  return Number.isFinite(Number(value));
}

function isValidDateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
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

function normalizeDraftNumberText(value) {
  return String(value ?? "").trim().replace(/,/g, "");
}

function formatDraftNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";

  return String(parsed);
}

export function createFinancialGoalDrafts(financialGoals) {
  const goals = parseFinancialGoals(financialGoals);

  return FINANCIAL_GOAL_DRAFT_FIELDS.reduce(
    (drafts, field) => ({
      ...drafts,
      [field]: formatDraftNumber(goals[field]),
    }),
    {},
  );
}

export function updateFinancialGoalDraft(drafts, field, value) {
  if (!FINANCIAL_GOAL_DRAFT_FIELDS.includes(field)) return drafts;

  return {
    ...drafts,
    [field]: String(value ?? ""),
  };
}

export function parseFinancialGoalDraftValue(field, value) {
  if (!FINANCIAL_GOAL_DRAFT_FIELDS.includes(field)) {
    return { ok: false, error: "未知的理財目標欄位。" };
  }

  let text = normalizeDraftNumberText(value);
  if (text.endsWith("%")) text = text.slice(0, -1).trim();

  if (!text) {
    return { ok: false, error: "請輸入數字。" };
  }

  if (text === "-" || text === "." || text === "-." || !/\d/.test(text)) {
    return { ok: false, error: "請輸入完整數字。" };
  }

  if (!/^-?\d*(?:\.\d*)?$/.test(text)) {
    return { ok: false, error: "請輸入有效數字。" };
  }

  const numberValue = Number(text);
  if (!Number.isFinite(numberValue)) {
    return { ok: false, error: "請輸入有效數字。" };
  }

  if (numberValue < 0) {
    return { ok: false, error: "數值不可小於 0。" };
  }

  if (field === "staleAssetDays" && numberValue < 1) {
    return { ok: false, error: "提醒天數至少為 1 天。" };
  }

  return { ok: true, value: numberValue };
}

export function applyFinancialGoalDraftValue(financialGoals, field, value) {
  const parsed = parseFinancialGoalDraftValue(field, value);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    value: parsed.value,
    financialGoals: {
      ...parseFinancialGoals(financialGoals),
      [field]: parsed.value,
    },
  };
}

export function formatFinancialGoalDraftPreview(field, value) {
  const parsed = parseFinancialGoalDraftValue(field, value);
  if (!parsed.ok) return "";

  if (field === "monthlyLivingExpense") {
    return `目前將儲存為：${formatMoney(parsed.value, BASE_CURRENCY)}`;
  }

  if (field === "emergencyMonths") {
    return `目前將儲存為：${formatNumber(parsed.value)} 個月`;
  }

  if (field === "staleAssetDays") {
    return `目前將儲存為：${formatNumber(parsed.value)} 天`;
  }

  return `目前將儲存為：${formatNumber(parsed.value)}%`;
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

function isBackupObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function previewCloudBackupPayload(payload) {
  if (!isBackupObject(payload)) {
    throw new Error("雲端副本預覽失敗：JSON 根節點必須是物件。");
  }

  const schemaVersion = toNumber(payload.schemaVersion);
  if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error("雲端副本預覽失敗：目前只支援 schemaVersion 1。");
  }

  if (!Array.isArray(payload.assets)) {
    throw new Error("雲端副本預覽失敗：找不到 assets 陣列。");
  }

  if (!Object.hasOwn(payload, "financialGoals")) {
    throw new Error("雲端副本預覽失敗：找不到 financialGoals 欄位。");
  }

  if (payload.financialGoals !== null && !isBackupObject(payload.financialGoals)) {
    throw new Error("雲端副本預覽失敗：financialGoals 必須是物件或 null。");
  }

  if (!Object.hasOwn(payload, "exchangeRates")) {
    throw new Error("雲端副本預覽失敗：找不到 exchangeRates 欄位。");
  }

  if (payload.exchangeRates !== null && !isBackupObject(payload.exchangeRates)) {
    throw new Error("雲端副本預覽失敗：exchangeRates 必須是物件或 null。");
  }

  return {
    schemaVersion,
    assetCount: payload.assets.length,
    hasFinancialGoals: Boolean(payload.financialGoals),
    hasExchangeRates: Boolean(payload.exchangeRates),
    payload,
  };
}

export function getCloudModeGateState({ cloudCopyStatus = null, acknowledged = false, isCloudMode = false } = {}) {
  const assetCount = Number(cloudCopyStatus?.assetCount ?? 0);
  const hasCloudStatusError = cloudCopyStatus?.state === "unavailable" || cloudCopyStatus?.state === "error";
  const hasUsableCloudCopy = !hasCloudStatusError && Boolean(cloudCopyStatus?.hasCloudCopy) && assetCount > 0;

  if (isCloudMode) {
    return {
      state: "enabled",
      canEnable: false,
      badge: "Cloud Mode：已啟用",
      message: "目前資料來源：Cloudflare D1 雲端資料",
    };
  }

  if (!hasUsableCloudCopy) {
    return {
      state: "missing-cloud-copy",
      canEnable: false,
      badge: "本機模式",
      message: "請先上傳 JSON 建立 D1 雲端副本。",
    };
  }

  if (!acknowledged) {
    return {
      state: "needs-confirmation",
      canEnable: false,
      badge: "本機模式",
      message: "請先確認備份與資料來源提醒。",
    };
  }

  return {
    state: "ready",
    canEnable: true,
    badge: "本機模式",
    message: "可啟用 Cloud Mode。",
  };
}

function escapeCsvValue(value) {
  const text = value === undefined || value === null ? "" : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function getCsvCell(record, key) {
  return record[key] === undefined || record[key] === null ? "" : String(record[key]);
}

function getTrimmedCsvCell(record, key) {
  return getCsvCell(record, key).trim();
}

function hasCsvValue(record, key) {
  return getTrimmedCsvCell(record, key) !== "";
}

function createCsvError(rowNumber, messages) {
  return {
    rowNumber,
    messages,
    message: messages.join("；"),
  };
}

function createCsvIssue(rowNumber, messages) {
  return createCsvError(rowNumber, messages);
}

function createCsvRowPreview(rowNumber, messages, asset = null) {
  return {
    ...createCsvIssue(rowNumber, messages),
    asset,
  };
}

function finalizeCsvAsset(asset, errors, options) {
  if (errors.length > 0) {
    return { asset: null, errors, warnings: [] };
  }

  const validation = validateAssetInput(asset, options);
  const validationErrors = validation.errors.map((issue) => issue.message);
  const warnings = validation.warnings.map((issue) => issue.message);

  return {
    asset: validationErrors.length > 0 ? null : asset,
    errors: validationErrors,
    warnings,
  };
}

function parseOptionalCsvNumber(record, key, label, errors, { min = null, exclusiveMin = null } = {}) {
  if (!hasCsvValue(record, key)) return null;

  const number = Number(getTrimmedCsvCell(record, key));
  if (!Number.isFinite(number)) {
    errors.push(`${label} 必須是數字`);
    return null;
  }

  if (exclusiveMin !== null && number <= exclusiveMin) {
    errors.push(`${label} 必須大於 ${exclusiveMin}`);
  }

  if (min !== null && number < min) {
    errors.push(`${label} 不可小於 ${min}`);
  }

  return number;
}

function parseRequiredCsvNumber(record, key, label, errors, options) {
  if (!hasCsvValue(record, key)) {
    errors.push(`缺少 ${label}`);
    return null;
  }

  return parseOptionalCsvNumber(record, key, label, errors, options);
}

function normalizeCsvDate(record, key, label, errors, { required = false } = {}) {
  const value = getTrimmedCsvCell(record, key);

  if (!value) {
    if (required) errors.push(`缺少 ${label}`);
    return "";
  }

  if (Number.isNaN(new Date(value).getTime())) {
    errors.push(`${label} 日期格式不正確`);
  }

  return value;
}

function normalizeCsvTimestamp(record, key, label, errors, fallbackTimestamp) {
  const value = getTrimmedCsvCell(record, key);

  if (!value) return fallbackTimestamp;

  if (Number.isNaN(new Date(value).getTime())) {
    errors.push(`${label} 日期格式不正確`);
  }

  return value;
}

function normalizeCsvAsset(record, options = {}) {
  const { createId = createAssetId, now = new Date() } = options;
  const errors = [];
  const nowIso = new Date(now).toISOString();
  const allowedTypes = ASSET_TYPES.map((item) => item.value);
  const id = getTrimmedCsvCell(record, "id") || createId();
  const type = getTrimmedCsvCell(record, "type").toLowerCase();
  const currency = getTrimmedCsvCell(record, "currency").toUpperCase();
  const note = getCsvCell(record, "note").trim();

  if (!type) {
    errors.push("缺少 type");
  } else if (!allowedTypes.includes(type)) {
    errors.push(`type 必須是 ${allowedTypes.join(" / ")} 之一`);
  }

  if (!currency) {
    errors.push("缺少 currency");
  } else if (!CURRENCIES.includes(currency)) {
    errors.push(`currency 必須是 ${CURRENCIES.join(" / ")} 之一`);
  }

  const createdAt = normalizeCsvTimestamp(record, "createdAt", "createdAt", errors, nowIso);
  const updatedAt = normalizeCsvTimestamp(record, "updatedAt", "updatedAt", errors, createdAt || nowIso);
  const base = {
    id,
    type,
    currency,
    note,
    createdAt,
    updatedAt,
  };

  if (isTradedAssetType(type)) {
    const ticker = getTrimmedCsvCell(record, "ticker").toUpperCase();

    const shares = parseRequiredCsvNumber(record, "shares", "shares", errors);
    const buyPrice = parseRequiredCsvNumber(record, "buyPrice", "buyPrice", errors);
    const marketPrice = parseOptionalCsvNumber(record, "marketPrice", "marketPrice", errors, { min: 0 });
    const buyDate = normalizeCsvDate(record, "buyDate", "buyDate", errors);
    const marketPriceUpdatedAt = normalizeCsvDate(record, "marketPriceUpdatedAt", "marketPriceUpdatedAt", errors);

    return finalizeCsvAsset(
      {
        ...base,
        ticker,
        shares,
        buyPrice,
        ...(marketPrice !== null
          ? {
              marketPrice,
              marketPriceUpdatedAt: marketPriceUpdatedAt || updatedAt,
            }
          : {}),
        buyDate,
      },
      errors,
      options,
    );
  }

  if (type === "loan") {
    const name = getTrimmedCsvCell(record, "name");
    const principal = parseRequiredCsvNumber(record, "principal", "principal", errors);
    const years = parseRequiredCsvNumber(record, "years", "years", errors);
    const annualRate = parseRequiredCsvNumber(record, "annualRate", "annualRate", errors);
    const startDate = normalizeCsvDate(record, "startDate", "startDate", errors);

    return finalizeCsvAsset(
      {
        ...base,
        name,
        principal,
        years,
        annualRate,
        startDate,
      },
      errors,
      options,
    );
  }

  const name = getTrimmedCsvCell(record, "name");
  const amount = parseRequiredCsvNumber(record, "amount", "amount", errors);

  return finalizeCsvAsset(
    {
      ...base,
      name,
      amount,
    },
    errors,
    options,
  );
}

export function getCsvExportFileName(date = new Date()) {
  const parsedDate = new Date(date);
  const dateText = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsedDate.toISOString().slice(0, 10);

  return `asset-agent-export-${dateText}.csv`;
}

export function exportAssetsToCsv(assets) {
  const rows = [
    CSV_COLUMNS,
    ...createAssetStore(assets).assets.map((asset) => CSV_COLUMNS.map((column) => getCsvCell(asset, column))),
  ];

  return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

export function createCsvTemplate() {
  return exportAssetsToCsv([
    {
      id: "sample-cash-twd",
      type: "cash",
      name: "台幣活存",
      ticker: "",
      currency: "TWD",
      amount: 100000,
      note: "現金示例",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "sample-stock-usd",
      type: "stock",
      name: "",
      ticker: "AAPL",
      currency: "USD",
      shares: 10,
      buyPrice: 180,
      marketPrice: 185,
      marketPriceUpdatedAt: "2026-06-15",
      buyDate: "2026-06-15",
      note: "股票示例",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "sample-etf-twd",
      type: "etf",
      name: "",
      ticker: "0050",
      currency: "TWD",
      shares: 20,
      buyPrice: 160,
      marketPrice: 162,
      marketPriceUpdatedAt: "2026-06-15",
      buyDate: "2026-06-15",
      note: "ETF 示例",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "sample-loan-twd",
      type: "loan",
      name: "房貸",
      ticker: "",
      currency: "TWD",
      principal: 3000000,
      years: 20,
      annualRate: 2.1,
      startDate: "2026-06-15",
      note: "貸款示例",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
  ]);
}

export function parseCsvRows(csvText) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    throw new Error("CSV 格式錯誤：雙引號欄位未關閉。");
  }

  row.push(field);
  if (row.some((cell) => cell !== "") || text.endsWith(",")) {
    rows.push(row);
  }

  return rows;
}

export function parseAssetsCsv(csvText, options = {}) {
  let rows;

  try {
    rows = parseCsvRows(csvText);
  } catch (error) {
    return {
      assets: [],
      errors: [createCsvError(0, [error.message || "CSV 格式錯誤。"])],
      warnings: [],
      validRows: [],
      warningRows: [],
      errorRows: [createCsvRowPreview(0, [error.message || "CSV 格式錯誤。"])],
      totalRows: 0,
      validCount: 0,
      errorCount: 1,
      warningCount: 0,
    };
  }

  if (rows.length === 0 || rows[0].every((cell) => cell.trim() === "")) {
    return {
      assets: [],
      errors: [createCsvError(1, ["CSV 必須包含 header。"])],
      warnings: [],
      validRows: [],
      warningRows: [],
      errorRows: [createCsvRowPreview(1, ["CSV 必須包含 header。"])],
      totalRows: 0,
      validCount: 0,
      errorCount: 1,
      warningCount: 0,
    };
  }

  const headers = rows[0].map((cell) => cell.trim());
  const headerErrors = [];
  for (const column of ["type", "currency"]) {
    if (!headers.includes(column)) headerErrors.push(`缺少必要欄位 ${column}`);
  }

  if (headerErrors.length > 0) {
    const totalRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== "")).length;

    return {
      assets: [],
      errors: [createCsvError(1, headerErrors)],
      warnings: [],
      validRows: [],
      warningRows: [],
      errorRows: [createCsvRowPreview(1, headerErrors)],
      totalRows,
      validCount: 0,
      errorCount: 1,
      warningCount: 0,
    };
  }

  const assets = [];
  const errors = [];
  const warnings = [];
  const validRows = [];
  const warningRows = [];
  const errorRows = [];
  const bodyRows = rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim() !== ""));

  for (const { row, rowNumber } of bodyRows) {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? "";
    });

    const result = normalizeCsvAsset(record, {
      ...options,
      assets: [...(options.assets ?? []), ...assets],
    });
    if (result.errors.length > 0) {
      const error = createCsvError(rowNumber, result.errors);
      errors.push(error);
      errorRows.push(createCsvRowPreview(rowNumber, result.errors));
    } else {
      assets.push(result.asset);
      if (result.warnings.length > 0) {
        const warning = createCsvIssue(rowNumber, result.warnings);
        warnings.push(warning);
        warningRows.push(createCsvRowPreview(rowNumber, result.warnings, result.asset));
      } else {
        validRows.push({ rowNumber, asset: result.asset });
      }
    }
  }

  return {
    assets,
    errors,
    warnings,
    validRows,
    warningRows,
    errorRows,
    totalRows: bodyRows.length,
    validCount: assets.length,
    errorCount: errors.length,
    warningCount: warnings.length,
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
  if (isTradedAssetType(asset.type)) return asset.ticker || `未命名${getAssetTypeLabel(asset.type)}`;
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
    case "etf":
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

export function groupTradedHoldings(assets, types = TRADED_ASSET_TYPES) {
  const tradedAssets = normalizeAssets(assets).filter((asset) => types.includes(asset.type));
  const groups = new Map();

  for (const asset of tradedAssets) {
    const type = asset.type || "stock";
    const ticker = (asset.ticker || "").trim().toUpperCase();
    const currency = asset.currency || "TWD";
    if (!ticker) continue;

    const key = `${type}_${ticker}_${currency}`;
    const current = groups.get(key) ?? {
      key,
      type,
      typeLabel: getAssetTypeLabel(type),
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

export function groupStockHoldings(assets) {
  return groupTradedHoldings(assets, ["stock"]);
}

export function groupNonStockAssets(assets) {
  const groups = new Map();

  for (const asset of normalizeAssets(assets)) {
    if (isTradedAssetType(asset.type)) continue;

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

  for (const asset of normalizeAssets(assets)) {
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

export const getTickerCurrencySuggestion = getStockTickerCurrencySuggestion;

export function getMarketPriceGapPercent(asset) {
  if (!isTradedAssetType(asset.type)) return null;

  const buyPrice = toNumber(asset.buyPrice);
  const marketPrice = toNumber(asset.marketPrice);
  if (buyPrice <= 0 || marketPrice <= 0) return null;

  return (Math.abs(marketPrice - buyPrice) / buyPrice) * 100;
}

function createValidationIssue(code, message) {
  return { code, message };
}

function normalizeFingerprintValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function getAssetValidationFingerprint(asset, validation = { errors: [], warnings: [] }) {
  const trackedAsset = {
    type: normalizeFingerprintValue(asset?.type),
    currency: normalizeFingerprintValue(asset?.currency),
    name: normalizeFingerprintValue(asset?.name),
    ticker: normalizeFingerprintValue(asset?.ticker).trim().toUpperCase(),
    amount: normalizeFingerprintValue(asset?.amount),
    shares: normalizeFingerprintValue(asset?.shares),
    buyPrice: normalizeFingerprintValue(asset?.buyPrice),
    marketPrice: normalizeFingerprintValue(asset?.marketPrice),
    marketPriceUpdatedAt: normalizeFingerprintValue(asset?.marketPriceUpdatedAt),
    buyDate: normalizeFingerprintValue(asset?.buyDate),
    principal: normalizeFingerprintValue(asset?.principal),
    years: normalizeFingerprintValue(asset?.years),
    annualRate: normalizeFingerprintValue(asset?.annualRate),
    startDate: normalizeFingerprintValue(asset?.startDate),
    note: normalizeFingerprintValue(asset?.note),
  };

  return JSON.stringify({
    asset: trackedAsset,
    errors: (validation.errors ?? []).map((issue) => `${issue.code}:${issue.message}`),
    warnings: (validation.warnings ?? []).map((issue) => `${issue.code}:${issue.message}`),
  });
}

export function getAssetSubmitState(validation, isWarningConfirmed = false) {
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return {
    hasErrors,
    hasWarnings,
    needsWarningConfirmation: hasWarnings && !isWarningConfirmed,
    canSubmit: !hasErrors && (!hasWarnings || isWarningConfirmed),
  };
}

export function getCsvPreviewFingerprint(preview) {
  return JSON.stringify(
    (preview?.warningRows ?? preview?.warnings ?? []).map((item) => ({
      rowNumber: item.rowNumber,
      messages: item.messages ?? [item.message],
    })),
  );
}

export function getCsvImportState(preview, isWarningConfirmed = false) {
  const importableCount = preview?.assets?.length ?? 0;
  const warningCount = preview?.warningCount ?? 0;
  const needsWarningConfirmation = warningCount > 0 && !isWarningConfirmed;

  return {
    hasImportableRows: importableCount > 0,
    needsWarningConfirmation,
    canImport: importableCount > 0 && !needsWarningConfirmation,
  };
}

function getExistingAverageCostGapPercent(asset, assets = [], existingAssetId = null) {
  if (!isTradedAssetType(asset.type)) return null;

  const buyPrice = Number(asset.buyPrice);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;

  const normalizedTicker = String(asset.ticker || "").trim().toUpperCase();
  const comparableAssets = normalizeAssets(assets).filter(
    (item) =>
      item.id !== existingAssetId &&
      isTradedAssetType(item.type) &&
      String(item.ticker || "").trim().toUpperCase() === normalizedTicker &&
      (item.currency || BASE_CURRENCY) === (asset.currency || BASE_CURRENCY),
  );
  const totalShares = comparableAssets.reduce((total, item) => total + toNumber(item.shares), 0);
  const totalCost = comparableAssets.reduce((total, item) => total + toNumber(item.shares) * toNumber(item.buyPrice), 0);

  if (totalShares <= 0 || totalCost <= 0) return null;

  const averageCost = totalCost / totalShares;
  return (Math.abs(buyPrice - averageCost) / averageCost) * 100;
}

function getProjectedAssets(assets, asset, existingAssetId = null) {
  const assetList = normalizeAssets(assets);
  if (!asset) return assetList;

  return existingAssetId
    ? assetList.map((item) => (item.id === existingAssetId ? asset : item))
    : [asset, ...assetList];
}

export function validateAssetInput(
  asset,
  { assets = [], exchangeRates = null, financialGoals = DEFAULT_FINANCIAL_GOALS, existingAssetId = null } = {},
) {
  const errors = [];
  const warnings = [];
  const type = String(asset?.type || "").trim();
  const allowedTypes = ASSET_TYPES.map((item) => item.value);
  const currency = String(asset?.currency || "").trim().toUpperCase();

  if (!type) {
    errors.push(createValidationIssue("missing-type", "請選擇資產類型。"));
  } else if (!allowedTypes.includes(type)) {
    errors.push(createValidationIssue("invalid-type", `type 必須是 ${allowedTypes.join(" / ")} 之一。`));
  }

  if (!currency) {
    errors.push(createValidationIssue("missing-currency", "請選擇幣別。"));
  } else if (!CURRENCIES.includes(currency)) {
    errors.push(createValidationIssue("invalid-currency", `currency 必須是 ${CURRENCIES.join(" / ")} 之一。`));
  }

  if (isTradedAssetType(type)) {
    const ticker = String(asset.ticker || "").trim().toUpperCase();
    if (!ticker) {
      errors.push(createValidationIssue("missing-ticker", `${getAssetTypeLabel(type)} 代號不可空白。`));
    }

    if (!isValidNumberInput(asset.shares)) {
      errors.push(createValidationIssue("invalid-shares", "股數必須是有效數字。"));
    } else if (Number(asset.shares) <= 0) {
      errors.push(createValidationIssue("invalid-shares", "股數必須大於 0。"));
    }

    if (!isValidNumberInput(asset.buyPrice)) {
      errors.push(createValidationIssue("invalid-buy-price", "購入價格必須是有效數字。"));
    } else if (Number(asset.buyPrice) <= 0) {
      errors.push(createValidationIssue("invalid-buy-price", "購入價格必須大於 0。"));
    }

    if (hasInputValue(asset.marketPrice)) {
      if (!isValidNumberInput(asset.marketPrice)) {
        errors.push(createValidationIssue("invalid-market-price", "目前市價必須是有效數字。"));
      } else if (Number(asset.marketPrice) < 0) {
        errors.push(createValidationIssue("invalid-market-price", "目前市價不可小於 0。"));
      }
    }

    if (!asset.buyDate || !isValidDateOnly(asset.buyDate)) {
      errors.push(createValidationIssue("invalid-buy-date", "購入日期需為 YYYY-MM-DD。"));
    }

    if (hasInputValue(asset.marketPriceUpdatedAt) && !isValidDateOnly(asset.marketPriceUpdatedAt)) {
      warnings.push(createValidationIssue("invalid-market-price-date", "市價日期建議使用 YYYY-MM-DD。"));
    }

    const suggestedCurrency = getTickerCurrencySuggestion(ticker);
    if (suggestedCurrency === "TWD" && currency && currency !== "TWD") {
      warnings.push(
        createValidationIssue("ticker-currency", "這個代號看起來像台股或台股 ETF，建議使用 TWD。"),
      );
    }

    if (suggestedCurrency === "USD" && currency && currency !== "USD") {
      warnings.push(
        createValidationIssue("ticker-currency", "這個代號看起來像美股或美股 ETF，建議使用 USD。"),
      );
    }

    const marketPriceGapPercent = getMarketPriceGapPercent(asset);
    const averageCostGapPercent = getExistingAverageCostGapPercent(asset, assets, existingAssetId);
    const priceGapPercent = Math.max(marketPriceGapPercent ?? 0, averageCostGapPercent ?? 0);
    if (priceGapPercent > 80) {
      warnings.push(createValidationIssue("price-gap", "價格差異過大，請確認幣別、股數或單價。"));
    }
  } else if (type === "loan") {
    if (!String(asset.name || "").trim()) {
      errors.push(createValidationIssue("missing-name", "請輸入貸款名稱。"));
    }

    if (!isValidNumberInput(asset.principal)) {
      errors.push(createValidationIssue("invalid-principal", "本金必須是有效數字。"));
    } else if (Number(asset.principal) <= 0) {
      errors.push(createValidationIssue("invalid-principal", "本金必須大於 0。"));
    }

    if (!isValidNumberInput(asset.years)) {
      errors.push(createValidationIssue("invalid-years", "年限必須是有效數字。"));
    } else if (Number(asset.years) <= 0) {
      errors.push(createValidationIssue("invalid-years", "年限必須大於 0。"));
    }

    if (!isValidNumberInput(asset.annualRate)) {
      errors.push(createValidationIssue("invalid-annual-rate", "年利率必須是有效數字。"));
    } else if (Number(asset.annualRate) < 0) {
      errors.push(createValidationIssue("invalid-annual-rate", "年利率不可小於 0。"));
    }

    if (!asset.startDate || !isValidDateOnly(asset.startDate)) {
      errors.push(createValidationIssue("invalid-start-date", "起始日期需為 YYYY-MM-DD。"));
    }
  } else if (type && allowedTypes.includes(type)) {
    if (!String(asset.name || "").trim()) {
      errors.push(createValidationIssue("missing-name", "請輸入名稱。"));
    }

    if (!isValidNumberInput(asset.amount)) {
      errors.push(createValidationIssue("invalid-amount", "金額必須是有效數字。"));
    } else if (Number(asset.amount) < 0) {
      errors.push(createValidationIssue("invalid-amount", "金額不可小於 0。"));
    }
  }

  if (errors.length === 0 && exchangeRates && isTradedAssetType(type)) {
    const projectedAssets = getProjectedAssets(assets, asset, existingAssetId);
    const concentrationItem = getConcentrationItems({
      assets: projectedAssets,
      exchangeRates,
      financialGoals,
    }).find(
      (item) =>
        item.type === type &&
        item.ticker === String(asset.ticker || "").trim().toUpperCase() &&
        item.currency === (asset.currency || BASE_CURRENCY),
    );

    if (concentrationItem?.isWarning) {
      warnings.push(
        createValidationIssue(
          "concentration",
          `${concentrationItem.ticker} 占總資產超過 ${formatNumber(
            parseFinancialGoals(financialGoals).singleHoldingLimitPercent,
          )}%，請確認集中度。`,
        ),
      );
    }
  }

  if (errors.length === 0 && exchangeRates && isRiskAssetType(type)) {
    const projectedAssets = getProjectedAssets(assets, asset, existingAssetId);
    const goals = parseFinancialGoals(financialGoals);
    const goalMetrics = getGoalMetrics({ assets: projectedAssets, exchangeRates, financialGoals: goals });

    if (goals.stockExposureLimitPercent > 0 && goalMetrics.riskExposurePercent > goals.stockExposureLimitPercent) {
      warnings.push(
        createValidationIssue(
          "risk-exposure",
          `股票 / ETF / 基金曝險 ${formatNumber(goalMetrics.riskExposurePercent)}%，高於設定上限。`,
        ),
      );
    }
  }

  return { errors, warnings };
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
  const items = groupTradedHoldings(assets).map((holding) => {
    const rateToTwd = getRateToTwd(exchangeRates, holding.currency);
    const valueTwd = rateToTwd ? holding.totalCost * rateToTwd : null;

    return {
      key: holding.key,
      type: holding.type,
      typeLabel: holding.typeLabel,
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

export function isAssetStale(asset, financialGoals = DEFAULT_FINANCIAL_GOALS, now = new Date()) {
  const goals = parseFinancialGoals(financialGoals);

  if (isTradedAssetType(asset.type)) {
    return (getDaysSince(asset.marketPriceUpdatedAt || getAssetUpdatedAt(asset), now) ?? 0) > STALE_STOCK_PRICE_DAYS;
  }

  if (asset.type === "cash" || asset.type === "loan" || asset.type === "fund" || asset.type === "other") {
    return (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays;
  }

  return false;
}

export function getAssetValidationBadges({
  asset,
  assets = [],
  exchangeRates = null,
  financialGoals = DEFAULT_FINANCIAL_GOALS,
  now = new Date(),
}) {
  if (!asset) return [];

  const badges = [];
  const validation = validateAssetInput(asset, {
    assets,
    exchangeRates,
    financialGoals,
    existingAssetId: asset.id,
  });

  if (validation.warnings.some((issue) => issue.code === "ticker-currency")) {
    badges.push({ key: "currency-warning", label: "幣別待確認" });
  }

  if (isTradedAssetType(asset.type)) {
    const concentrationItem = getConcentrationItems({ assets, exchangeRates, financialGoals }).find(
      (item) =>
        item.type === asset.type &&
        item.ticker === String(asset.ticker || "").trim().toUpperCase() &&
        item.currency === (asset.currency || BASE_CURRENCY),
    );

    if (concentrationItem?.isWarning) {
      badges.push({ key: "concentration", label: "高集中" });
    }
  }

  if (isAssetStale(asset, financialGoals, now)) {
    badges.push({ key: "stale", label: "資料過期" });
  }

  return badges;
}

export function getGoalMetrics({ assets, exchangeRates, financialGoals }) {
  const assetList = normalizeAssets(assets);
  const goals = parseFinancialGoals(financialGoals);
  const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(assetList), exchangeRates);
  let cashValueTwd = 0;
  let riskAssetValueTwd = 0;
  let missingValueCount = 0;

  for (const asset of assetList) {
    const valueTwd = getAssetValueInTwd(asset, exchangeRates);
    if (valueTwd === null) {
      missingValueCount += 1;
      continue;
    }

    if (asset.type === "cash") {
      cashValueTwd += valueTwd;
    }

    if (isRiskAssetType(asset.type)) {
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
  const assetList = normalizeAssets(assets);
  const goals = parseFinancialGoals(financialGoals);
  const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(assetList), exchangeRates);
  const concentrationItems = getConcentrationItems({ assets: assetList, exchangeRates, financialGoals: goals });
  const goalMetrics = getGoalMetrics({ assets: assetList, exchangeRates, financialGoals: goals });
  const items = [];

  if (assetList.length === 0) {
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

  const staleCashAssets = assetList.filter(
    (asset) => asset.type === "cash" && (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleCashAssets.length > 0) {
    items.push({
      key: "stale-cash",
      label: `${staleCashAssets.length} 筆現金超過 ${goals.staleAssetDays} 天未更新，建議重新匯入或確認`,
      focusQuery: getAssetDisplayName(staleCashAssets[0]),
    });
  }

  const staleStockAssets = assetList.filter(
    (asset) =>
      isTradedAssetType(asset.type) &&
      (getDaysSince(asset.marketPriceUpdatedAt || getAssetUpdatedAt(asset), now) ?? 0) > STALE_STOCK_PRICE_DAYS,
  );
  if (staleStockAssets.length > 0) {
    items.push({
      key: "stale-stock-price",
      label: `${staleStockAssets.length} 筆股票 / ETF 超過 ${STALE_STOCK_PRICE_DAYS} 天未更新市價`,
      focusQuery: getAssetDisplayName(staleStockAssets[0]),
    });
  }

  const staleLoanAssets = assetList.filter(
    (asset) => asset.type === "loan" && (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleLoanAssets.length > 0) {
    items.push({
      key: "stale-loan",
      label: `${staleLoanAssets.length} 筆貸款超過 ${goals.staleAssetDays} 天未更新本金`,
      focusQuery: getAssetDisplayName(staleLoanAssets[0]),
    });
  }

  const staleOtherAssets = assetList.filter(
    (asset) =>
      (asset.type === "fund" || asset.type === "other") &&
      (getDaysSince(getAssetUpdatedAt(asset), now) ?? 0) > goals.staleAssetDays,
  );
  if (staleOtherAssets.length > 0) {
    items.push({
      key: "stale-other-assets",
      label: `${staleOtherAssets.length} 筆基金 / 其他資產超過 ${goals.staleAssetDays} 天未更新`,
      focusQuery: getAssetDisplayName(staleOtherAssets[0]),
    });
  }

  const priceGapAssets = assetList.filter((asset) => (getMarketPriceGapPercent(asset) ?? 0) > 80);
  if (priceGapAssets.length > 0) {
    items.push({
      key: "price-gap",
      label: `${priceGapAssets.length} 筆股票 / ETF 成本與目前市價差距超過 80%，請確認資料`,
      focusQuery: getAssetDisplayName(priceGapAssets[0]),
    });
  }

  const validationWarnings = assetList.flatMap((asset) =>
    validateAssetInput(asset, {
      assets: assetList,
      exchangeRates,
      financialGoals: goals,
      existingAssetId: asset.id,
    }).warnings
      .filter((issue) => issue.code === "ticker-currency")
      .map((issue) => ({
        key: `validation-${asset.id}-${issue.code}`,
        label: `${getAssetDisplayName(asset)}：${issue.message}`,
        focusQuery: getAssetDisplayName(asset),
      })),
  );

  if (validationWarnings.length > 0) {
    items.push(...validationWarnings.slice(0, 5));
    if (validationWarnings.length > 5) {
      items.push({
        key: "validation-more",
        label: `另有 ${validationWarnings.length - 5} 項資料可疑項目`,
      });
    }
  }

  const concentratedItems = concentrationItems.filter((item) => item.isWarning);
  if (concentratedItems.length > 0) {
    items.push({
      key: "concentration",
      label: `${concentratedItems[0].ticker} 占總資產超過 ${formatNumber(
        goals.singleHoldingLimitPercent,
      )}%，建議人工檢視集中度`,
      focusQuery: concentratedItems[0].ticker,
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
      label: `股票 / ETF / 基金曝險 ${formatNumber(goalMetrics.riskExposurePercent)}%，高於設定上限 ${formatNumber(
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
