import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ASSET_TYPES,
  CURRENCIES,
  buildAttentionItems,
  createBackupPayload,
  createAssetId,
  createCsvTemplate,
  exportAssetsToCsv,
  fetchLatestExchangeRates,
  formatCompactMoney,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRate,
  getAssetSubmitState,
  getAssetDisplayName,
  getAssetTypeLabel,
  getAssetUpdatedAt,
  getAssetValidationBadges,
  getAssetValidationFingerprint,
  getConcentrationItems,
  getCsvImportState,
  getCsvExportFileName,
  getCsvPreviewFingerprint,
  getLatestUpdatedAt,
  getLoanSnapshot,
  getRateToTwd,
  getTickerCurrencySuggestion,
  groupNonStockAssets,
  groupTradedHoldings,
  isTradedAssetType,
  loadAssets,
  loadExchangeRates,
  loadFinancialGoals,
  parseBackupPayload,
  parseAssetsCsv,
  saveAssets,
  saveExchangeRates,
  saveFinancialGoals,
  setManualExchangeRate,
  summarizeByCurrency,
  summarizeInBaseCurrency,
  toNumber,
  validateAssetInput,
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
    marketPrice: "",
    marketPriceUpdatedAt: getTodayDate(),
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

function ChevronIcon({ isOpen }) {
  return <span className={`chevron-icon${isOpen ? " is-open" : ""}`} aria-hidden="true" />;
}

function StyleModeMark({ mode }) {
  return <span className={`style-mode-mark is-${mode}`} aria-hidden="true" />;
}

function RefreshIcon() {
  return <span className="refresh-icon" aria-hidden="true" />;
}

function LoadingIcon() {
  return <span className="loading-icon" aria-hidden="true" />;
}

function CloseIcon() {
  return <span className="close-icon" aria-hidden="true" />;
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
    marketPrice: toFormValue(asset.marketPrice),
    marketPriceUpdatedAt: asset.marketPriceUpdatedAt ? String(asset.marketPriceUpdatedAt).slice(0, 10) : getTodayDate(),
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
    updatedAt: new Date().toISOString(),
  };

  if (isTradedAssetType(form.type)) {
    return {
      ...base,
      ticker: form.ticker.trim().toUpperCase(),
      shares: toNumber(form.shares),
      buyPrice: toNumber(form.buyPrice),
      ...(toNumber(form.marketPrice) > 0
        ? {
            marketPrice: toNumber(form.marketPrice),
            marketPriceUpdatedAt: form.marketPriceUpdatedAt || new Date().toISOString(),
          }
        : {}),
      buyDate: form.buyDate,
    };
  }

  if (form.type === "loan") {
    return {
      ...base,
      name: form.name.trim(),
      principal: toNumber(form.principal),
      years: toNumber(form.years),
      annualRate: toNumber(form.annualRate),
      startDate: form.startDate,
    };
  }

  return {
    ...base,
    name: form.name.trim(),
    amount: toNumber(form.amount),
  };
}

function createValidationDraftFromForm(form, existingAsset = null) {
  return {
    id: existingAsset?.id ?? "form-draft",
    type: form.type,
    currency: form.currency,
    name: form.name,
    amount: form.amount,
    ticker: form.ticker,
    shares: form.shares,
    buyPrice: form.buyPrice,
    marketPrice: form.marketPrice,
    marketPriceUpdatedAt: form.marketPriceUpdatedAt,
    buyDate: form.buyDate,
    principal: form.principal,
    years: form.years,
    annualRate: form.annualRate,
    startDate: form.startDate,
    note: form.note,
    createdAt: existingAsset?.createdAt,
    updatedAt: existingAsset?.updatedAt,
  };
}

function AssetFormFields({ form, onFieldChange, onTypeChange }) {
  function handleTickerChange(value) {
    const previousSuggestion = getTickerCurrencySuggestion(form.ticker);
    const nextSuggestion = getTickerCurrencySuggestion(value);

    onFieldChange("ticker", value);

    if (nextSuggestion && (!previousSuggestion || form.currency === previousSuggestion)) {
      onFieldChange("currency", nextSuggestion);
    }
  }

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

      {isTradedAssetType(form.type) && (
        <>
          <div className="form-row compact">
            <label>
              {getAssetTypeLabel(form.type)} 代號
              <input
                value={form.ticker}
                onChange={(event) => handleTickerChange(event.target.value)}
                placeholder="例如 2330、0050、VOO"
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

          <div className="form-row compact">
            <label>
              目前市價（選填）
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.marketPrice}
                onChange={(event) => onFieldChange("marketPrice", event.target.value)}
                placeholder="用於資料確認"
              />
            </label>
            <label>
              市價日期
              <input
                type="date"
                value={form.marketPriceUpdatedAt}
                onChange={(event) => onFieldChange("marketPriceUpdatedAt", event.target.value)}
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

      {!isTradedAssetType(form.type) && form.type !== "loan" && (
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

function ValidationSummary({ validation, submitState, confirmed, onConfirmWarnings, notice }) {
  const errors = validation.errors ?? [];
  const warnings = validation.warnings ?? [];

  if (errors.length === 0 && warnings.length === 0 && !notice) return null;

  return (
    <div className="validation-summary" aria-live="polite">
      {errors.length > 0 && (
        <div className="validation-box is-error">
          <strong>需要修正</strong>
          <ul>
            {errors.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="validation-box is-warning">
          <div className="validation-box-header">
            <strong>資料提醒</strong>
            {confirmed && <span>已確認</span>}
          </div>
          <ul>
            {warnings.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
          {submitState.needsWarningConfirmation && (
            <button className="warning-confirm-button secondary-action" type="button" onClick={onConfirmWarnings}>
              我已確認，仍要繼續
            </button>
          )}
        </div>
      )}

      {notice && <p className="validation-notice">{notice}</p>}
    </div>
  );
}

const STYLE_STORAGE_KEY = "asset-agent.style-mode.v1";
const STYLE_MODES = [
  { value: "mist", label: "霧藍" },
  { value: "clear", label: "清爽" },
  { value: "graphite", label: "石墨" },
];
const PIE_COLORS = ["#365f89", "#7c8da3", "#b7815f", "#6c7a89", "#486b7a", "#8f6f8f"];
const ASSET_SORT_OPTIONS = [
  { value: "value", label: "金額" },
  { value: "date", label: "最近日期" },
  { value: "type", label: "種類" },
  { value: "currency", label: "幣別" },
  { value: "name", label: "名稱" },
];
const ASSET_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "全部狀態" },
  { value: "asset", label: "正資產" },
  { value: "liability", label: "負債" },
  { value: "missing-rate", label: "缺匯率" },
];

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

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-Hant", { numeric: true });
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function getAssetSearchText(asset) {
  return normalizeSearchQuery(
    [
      getAssetDisplayName(asset),
      getAssetTypeLabel(asset.type),
      asset.currency,
      asset.note,
      asset.ticker,
      asset.name,
      asset.buyDate,
      asset.startDate,
      asset.createdAt,
      asset.updatedAt,
      asset.amount,
      asset.shares,
      asset.buyPrice,
      asset.marketPrice,
      asset.marketPriceUpdatedAt,
      asset.principal,
      asset.years,
      asset.annualRate,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function groupMatchesSearch(group, query) {
  if (!query) return true;

  const groupText = normalizeSearchQuery(
    [
      group.name,
      group.typeLabel,
      getAssetTypeLabel(group.type),
      group.currency,
      group.amountText,
      group.primaryText,
      group.secondaryText,
      group.updatedAt,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return groupText.includes(query);
}

function groupMatchesStatus(group, statusFilter) {
  if (statusFilter === "all") return true;
  if (statusFilter === "missing-rate") return group.baseValue === null || group.hasMissingRate;
  if (statusFilter === "liability") return group.type === "loan" || (group.baseValue ?? group.totalAmount ?? 0) < 0;
  if (statusFilter === "asset") return group.type !== "loan" && (group.baseValue ?? group.totalAmount ?? 0) >= 0;
  return true;
}

function formatUpdatedAt(value) {
  return `更新 ${formatDateTime(value)}`;
}

function getBackupFileName() {
  return `asset-agent-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getAssetSortTimestamp(asset) {
  const dateValue = asset.updatedAt || (isTradedAssetType(asset.type) ? asset.buyDate : asset.type === "loan" ? asset.startDate : asset.createdAt);
  const timestamp = new Date(dateValue || asset.createdAt || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getGroupSortTimestamp(group) {
  return Math.max(0, ...group.entries.map((asset) => getAssetSortTimestamp(asset)));
}

function getEntrySortAmount(asset) {
  if (isTradedAssetType(asset.type)) return toNumber(asset.shares) * toNumber(asset.buyPrice);
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
  const [financialGoals, setFinancialGoals] = useState(() => loadFinancialGoals());
  const [exchangeRateDrafts, setExchangeRateDrafts] = useState({});
  const [exchangeRateStatus, setExchangeRateStatus] = useState("");
  const [isFetchingRates, setIsFetchingRates] = useState(false);
  const [isExchangePanelOpen, setIsExchangePanelOpen] = useState(false);
  const [isAssetFormOpen, setIsAssetFormOpen] = useState(false);
  const [isCurrencyBreakdownOpen, setIsCurrencyBreakdownOpen] = useState(false);
  const [isDataToolsOpen, setIsDataToolsOpen] = useState(false);
  const [dataToolStatus, setDataToolStatus] = useState("");
  const [form, setForm] = useState(() => createEmptyForm());
  const [editForm, setEditForm] = useState(() => createEmptyForm());
  const [confirmedAddWarningFingerprint, setConfirmedAddWarningFingerprint] = useState("");
  const [confirmedEditWarningFingerprint, setConfirmedEditWarningFingerprint] = useState("");
  const [addFormNotice, setAddFormNotice] = useState("");
  const [editFormNotice, setEditFormNotice] = useState("");
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [assetToDeleteId, setAssetToDeleteId] = useState(null);
  const [expandedAssetGroups, setExpandedAssetGroups] = useState({});
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [assetCurrencyFilter, setAssetCurrencyFilter] = useState("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState("all");
  const [assetSortMode, setAssetSortMode] = useState("value");
  const [styleMode, setStyleMode] = useState(() => loadStyleMode());
  const [selectedOverviewKey, setSelectedOverviewKey] = useState(null);
  const importFileInputRef = useRef(null);
  const csvImportFileInputRef = useRef(null);
  const [csvImportPreview, setCsvImportPreview] = useState(null);
  const [confirmedCsvWarningFingerprint, setConfirmedCsvWarningFingerprint] = useState("");

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

  useEffect(() => {
    saveFinancialGoals(financialGoals);
  }, [financialGoals]);

  const tradedHoldings = useMemo(() => groupTradedHoldings(assets), [assets]);
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
  const addDraftAsset = useMemo(() => createValidationDraftFromForm(form), [form]);
  const addFormValidation = useMemo(
    () =>
      validateAssetInput(addDraftAsset, {
        assets,
        exchangeRates,
        financialGoals,
      }),
    [addDraftAsset, assets, exchangeRates, financialGoals],
  );
  const addValidationFingerprint = useMemo(
    () => getAssetValidationFingerprint(addDraftAsset, addFormValidation),
    [addDraftAsset, addFormValidation],
  );
  const isAddWarningConfirmed =
    addFormValidation.warnings.length > 0 && confirmedAddWarningFingerprint === addValidationFingerprint;
  const addSubmitState = useMemo(
    () => getAssetSubmitState(addFormValidation, isAddWarningConfirmed),
    [addFormValidation, isAddWarningConfirmed],
  );
  const editDraftAsset = useMemo(
    () => (editingAsset ? createValidationDraftFromForm(editForm, editingAsset) : null),
    [editForm, editingAsset],
  );
  const editFormValidation = useMemo(
    () =>
      editDraftAsset
        ? validateAssetInput(editDraftAsset, {
            assets,
            exchangeRates,
            financialGoals,
            existingAssetId: editingAsset?.id ?? null,
          })
        : { errors: [], warnings: [] },
    [assets, editDraftAsset, editingAsset?.id, exchangeRates, financialGoals],
  );
  const editValidationFingerprint = useMemo(
    () => getAssetValidationFingerprint(editDraftAsset, editFormValidation),
    [editDraftAsset, editFormValidation],
  );
  const isEditWarningConfirmed =
    editFormValidation.warnings.length > 0 && confirmedEditWarningFingerprint === editValidationFingerprint;
  const editSubmitState = useMemo(
    () => getAssetSubmitState(editFormValidation, isEditWarningConfirmed),
    [editFormValidation, isEditWarningConfirmed],
  );
  const csvWarningFingerprint = useMemo(() => getCsvPreviewFingerprint(csvImportPreview), [csvImportPreview]);
  const isCsvWarningConfirmed =
    csvImportPreview?.warningCount > 0 && confirmedCsvWarningFingerprint === csvWarningFingerprint;
  const csvImportState = useMemo(
    () => getCsvImportState(csvImportPreview, isCsvWarningConfirmed),
    [csvImportPreview, isCsvWarningConfirmed],
  );
  const tradedDetailGroups = useMemo(
    () =>
      tradedHoldings.map((holding) => {
        const rateToTwd = getRateToTwd(exchangeRates, holding.currency);

        return {
          key: `traded_${holding.key}`,
          type: holding.type,
          typeLabel: holding.typeLabel,
          name: holding.ticker,
          currency: holding.currency,
          totalAmount: holding.totalCost,
          amountText: formatMoney(holding.totalCost, holding.currency),
          compactAmountText: formatCompactMoney(holding.totalCost, holding.currency),
          baseValue: rateToTwd ? holding.totalCost * rateToTwd : null,
          primaryText: `${formatNumber(holding.totalShares)} 股`,
          secondaryText: `均價 ${formatMoney(holding.averageCost, holding.currency)}`,
          updatedAt: getLatestUpdatedAt(holding.lots),
          count: holding.lots.length,
          entries: holding.lots,
        };
      }),
    [exchangeRates, tradedHoldings],
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
          updatedAt: getLatestUpdatedAt(group.entries),
          count: group.entries.length,
          entries: group.entries,
        };
      }),
    [exchangeRates, nonStockGroups],
  );
  const assetDetailGroups = useMemo(
    () =>
      [...tradedDetailGroups, ...otherDetailGroups].sort(
        (a, b) => Math.abs(b.baseValue ?? 0) - Math.abs(a.baseValue ?? 0),
      ),
    [otherDetailGroups, tradedDetailGroups],
  );
  const assetTypeFilters = useMemo(() => [{ value: "all", label: "全部" }, ...ASSET_TYPES], []);
  const assetCurrencyOptions = useMemo(
    () => ["all", ...new Set(assetDetailGroups.map((group) => group.currency).filter(Boolean))],
    [assetDetailGroups],
  );
  const assetTypeCounts = useMemo(() => {
    const counts = { all: assets.length };

    for (const asset of assets) {
      counts[asset.type] = (counts[asset.type] ?? 0) + 1;
    }

    return counts;
  }, [assets]);
  const filteredAssetGroups = useMemo(() => {
    const query = normalizeSearchQuery(assetSearchQuery);

    return assetDetailGroups.flatMap((group) => {
      if (assetTypeFilter !== "all" && group.type !== assetTypeFilter) return [];
      if (assetCurrencyFilter !== "all" && group.currency !== assetCurrencyFilter) return [];
      if (!groupMatchesStatus(group, assetStatusFilter)) return [];

      if (!query) return [group];

      const matchesGroup = groupMatchesSearch(group, query);
      const entries = matchesGroup
        ? group.entries
        : group.entries.filter((asset) => getAssetSearchText(asset).includes(query));

      return entries.length > 0 ? [{ ...group, entries }] : [];
    });
  }, [assetCurrencyFilter, assetDetailGroups, assetSearchQuery, assetStatusFilter, assetTypeFilter]);
  const sortedAssetGroups = useMemo(
    () => sortAssetGroups(filteredAssetGroups, assetSortMode),
    [assetSortMode, filteredAssetGroups],
  );
  const filteredAssetCount = filteredAssetGroups.reduce((total, group) => total + group.entries.length, 0);
  const isAssetFilterActive =
    normalizeSearchQuery(assetSearchQuery) !== "" ||
    assetTypeFilter !== "all" ||
    assetCurrencyFilter !== "all" ||
    assetStatusFilter !== "all";
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
        updatedAt: null,
      };

      if (detailGroup.baseValue === null) {
        current.hasMissingRate = true;
      } else {
        current.baseValue += detailGroup.baseValue;
      }

      current.count += detailGroup.count;
      current.detailGroups.push(detailGroup);
      if (!current.updatedAt || new Date(detailGroup.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
        current.updatedAt = detailGroup.updatedAt;
      }
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
            : group.type === "etf"
              ? `${group.detailGroups.length} 檔ETF`
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
  const concentrationItems = useMemo(
    () => getConcentrationItems({ assets, exchangeRates, financialGoals }),
    [assets, exchangeRates, financialGoals],
  );
  const attentionItems = useMemo(
    () => buildAttentionItems({ assets, exchangeRates, financialGoals }),
    [assets, exchangeRates, financialGoals],
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

  function selectOverviewGroup(group) {
    setSelectedOverviewKey(group.key);
    setAssetTypeFilter(group.type);
  }

  function resetAssetFilters() {
    setAssetSearchQuery("");
    setAssetTypeFilter("all");
    setAssetCurrencyFilter("all");
    setAssetStatusFilter("all");
    setAssetSortMode("value");
  }

  function focusAttentionItem(item) {
    if (!item.focusQuery) return;

    setAssetSearchQuery(item.focusQuery);
    setAssetTypeFilter("all");
    setAssetCurrencyFilter("all");
    setAssetStatusFilter("all");
    setAssetSortMode("value");
  }

  function confirmAddWarnings() {
    setConfirmedAddWarningFingerprint(addValidationFingerprint);
    setAddFormNotice("已確認提醒，可繼續新增。");
  }

  function confirmEditWarnings() {
    setConfirmedEditWarningFingerprint(editValidationFingerprint);
    setEditFormNotice("已確認提醒，可繼續儲存。");
  }

  function getExchangeRateDraft(currency) {
    if (exchangeRateDrafts[currency] !== undefined) return exchangeRateDrafts[currency];
    const rate = exchangeRates.rates[currency]?.rateToTwd;
    return rate ? String(rate) : "";
  }

  function updateForm(field, value) {
    setAddFormNotice("");
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateEditForm(field, value) {
    setEditFormNotice("");
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm(nextType = form.type) {
    setConfirmedAddWarningFingerprint("");
    setAddFormNotice("");
    setForm(createEmptyForm(nextType));
  }

  function handleTypeChange(type) {
    resetForm(type);
  }

  function handleEditTypeChange(type) {
    setConfirmedEditWarningFingerprint("");
    setEditFormNotice("");
    setEditForm(createEmptyForm(type));
  }

  function startEditingAsset(asset) {
    setEditingAssetId(asset.id);
    setEditForm(createFormFromAsset(asset));
    setConfirmedEditWarningFingerprint("");
    setEditFormNotice("");
    setIsAssetFormOpen(false);
  }

  function cancelEditing() {
    setEditingAssetId(null);
    setEditForm(createEmptyForm());
    setConfirmedEditWarningFingerprint("");
    setEditFormNotice("");
  }

  function handleSubmit(event) {
    event.preventDefault();

    try {
      if (addSubmitState.hasErrors) {
        setAddFormNotice("請先修正需要修正的欄位。");
        return;
      }

      if (addSubmitState.needsWarningConfirmation) {
        setAddFormNotice("請先確認資料提醒後再新增。");
        return;
      }

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
      if (editSubmitState.hasErrors) {
        setEditFormNotice("請先修正需要修正的欄位。");
        return;
      }

      if (editSubmitState.needsWarningConfirmation) {
        setEditFormNotice("請先確認資料提醒後再儲存。");
        return;
      }

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
    setCsvImportPreview(null);
    setConfirmedCsvWarningFingerprint("");
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

  function updateFinancialGoal(field, value) {
    const numberValue = toNumber(value);

    setFinancialGoals((current) => ({
      ...current,
      [field]: field === "staleAssetDays" ? Math.max(1, numberValue) : Math.max(0, numberValue),
    }));
  }

  function exportJsonData() {
    const payload = createBackupPayload({
      assets,
      exchangeRates,
      financialGoals,
      lastCheckedAt: new Date().toISOString(),
    });

    downloadTextFile(JSON.stringify(payload, null, 2), getBackupFileName(), "application/json");
    setDataToolStatus(`已匯出 ${payload.assets.length} 筆資產資料。`);
  }

  function exportCsvData() {
    downloadTextFile(exportAssetsToCsv(assets), getCsvExportFileName(), "text/csv;charset=utf-8");
    setDataToolStatus(`已匯出 ${assets.length} 筆資產資料為 CSV。`);
  }

  function downloadCsvTemplate() {
    downloadTextFile(createCsvTemplate(), "asset-agent-template.csv", "text/csv;charset=utf-8");
    setDataToolStatus("已下載 Asset Agent 標準 CSV 範本。");
  }

  async function importJsonData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const payload = parseBackupPayload(JSON.parse(await file.text()));

      setAssets(payload.assets);
      setExchangeRates(payload.exchangeRates);
      setFinancialGoals(payload.financialGoals);
      setExpandedAssetGroups({});
      setSelectedOverviewKey(null);
      setCsvImportPreview(null);
      setConfirmedCsvWarningFingerprint("");
      cancelEditing();
      cancelDeleteAsset();
      resetAssetFilters();
      setDataToolStatus(`匯入成功：${payload.assets.length} 筆資產資料已載入。`);
    } catch (error) {
      setDataToolStatus(error.message || "匯入失敗：檔案格式不正確。");
    } finally {
      event.target.value = "";
    }
  }

  async function importCsvData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const preview = parseAssetsCsv(await file.text(), {
        assets,
        exchangeRates,
        financialGoals,
      });
      setCsvImportPreview(preview);
      setConfirmedCsvWarningFingerprint("");
      setDataToolStatus(
        `CSV 解析完成：可匯入 ${preview.validCount} 筆，錯誤 ${preview.errorCount} 筆，提醒 ${preview.warningCount} 筆。`,
      );
    } catch (error) {
      setCsvImportPreview(null);
      setConfirmedCsvWarningFingerprint("");
      setDataToolStatus(error.message || "CSV 匯入失敗：檔案格式不正確。");
    } finally {
      event.target.value = "";
    }
  }

  function confirmCsvImport() {
    if (!csvImportPreview) return;

    if (csvImportPreview.assets.length === 0) {
      setDataToolStatus("CSV 沒有可匯入的有效資料。");
      return;
    }

    if (!csvImportState.canImport) {
      setDataToolStatus("CSV 仍有 warning，請先在 preview 中確認後再匯入。");
      return;
    }

    setAssets((current) => [...csvImportPreview.assets, ...current]);
    setExpandedAssetGroups({});
    setSelectedOverviewKey(null);
    cancelEditing();
    cancelDeleteAsset();
    resetAssetFilters();
    setDataToolStatus(`CSV 匯入成功：新增 ${csvImportPreview.assets.length} 筆資產資料。`);
    setCsvImportPreview(null);
    setConfirmedCsvWarningFingerprint("");
  }

  function confirmCsvWarnings() {
    setConfirmedCsvWarningFingerprint(csvWarningFingerprint);
    setDataToolStatus("已確認 CSV warning，可繼續匯入可匯入資料。");
  }

  function cancelCsvImport() {
    setCsvImportPreview(null);
    setConfirmedCsvWarningFingerprint("");
    setDataToolStatus("已取消 CSV 匯入。");
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
          className="style-switch-button icon-action-button"
          type="button"
          onClick={cycleStyleMode}
          aria-label={`切換風格，目前是${currentStyleMode.label}`}
          title={`切換風格，目前是${currentStyleMode.label}`}
        >
          <StyleModeMark mode={currentStyleMode.value} />
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

          <div className="currency-breakdown">
            <button
              className="currency-breakdown-toggle disclosure-button card-button"
              type="button"
              aria-expanded={isCurrencyBreakdownOpen}
              onClick={() => setIsCurrencyBreakdownOpen((current) => !current)}
            >
              <span>幣別淨值</span>
              <small>{currencySummary.length === 0 ? "尚無資料" : `${currencySummary.length} 個幣別`}</small>
              <span className="expand-indicator">
                <ChevronIcon isOpen={isCurrencyBreakdownOpen} />
              </span>
            </button>

            {isCurrencyBreakdownOpen && (
              <div className="currency-breakdown-list">
                {currencySummary.length === 0 ? (
                  <p className="muted">尚無幣別資料。</p>
                ) : (
                  currencySummary.map((item) => (
                    <article className="currency-mini-card" key={item.currency}>
                      <span>{item.currency} 幣別淨值</span>
                      <strong>{formatMoney(item.net, item.currency)}</strong>
                      <small>
                        資產 {formatMoney(item.assets, item.currency)} · 負債{" "}
                        {formatMoney(item.liabilities, item.currency)}
                      </small>
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
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
                <li className={item.focusQuery ? "is-focusable" : ""} key={item.key}>
                  {item.focusQuery ? (
                    <button
                      type="button"
                      className="attention-action attention-button card-button"
                      onClick={() => focusAttentionItem(item)}
                    >
                      <span>{item.label}</span>
                      <small>點擊篩選明細</small>
                    </button>
                  ) : (
                    item.label
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
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
                {isFetchingRates ? <LoadingIcon /> : <RefreshIcon />}
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
              <ChevronIcon isOpen={isExchangePanelOpen} />
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
                    className="small-action secondary-action"
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
            className="add-asset-toggle disclosure-button card-button"
            type="button"
            aria-expanded={isAssetFormOpen}
            onClick={() => setIsAssetFormOpen((current) => !current)}
          >
            <span>＋ 新增資產 / 負債</span>
            <small>{isAssetFormOpen ? "輸入完成後會自動收合" : `目前預設：${getAssetTypeLabel(form.type)}`}</small>
            <span className="expand-indicator">
              <ChevronIcon isOpen={isAssetFormOpen} />
            </span>
          </button>

          {isAssetFormOpen && (
            <form className="form-panel add-asset-form" onSubmit={handleSubmit}>
              <div className="panel-header">
                <h2>新增資產 / 負債</h2>
                <span>{getAssetTypeLabel(form.type)}</span>
              </div>

              <AssetFormFields form={form} onFieldChange={updateForm} onTypeChange={handleTypeChange} />

              <ValidationSummary
                validation={addFormValidation}
                submitState={addSubmitState}
                confirmed={isAddWarningConfirmed}
                onConfirmWarnings={confirmAddWarnings}
                notice={addFormNotice}
              />

              <div className="form-actions">
                <button className="primary-button primary-action" type="submit" disabled={!addSubmitState.canSubmit}>
                  {addSubmitState.needsWarningConfirmation ? "確認提醒後新增" : "新增"}
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
                        className={`allocation-summary-card card-button${
                          selectedOverviewGroup?.key === group.key ? " is-selected" : ""
                        }${
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
                          {group.groupCount} 組 · {group.count} 筆明細{group.hasMissingRate ? " · 缺匯率" : ""} ·{" "}
                          {formatUpdatedAt(group.updatedAt)}
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
                          {item.typeLabel} · {item.currency} · {formatNumber(item.totalShares)} 股
                        </small>
                      </div>
                      {item.isWarning && <span className="risk-pill">高集中</span>}
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
        </div>

        <div className="asset-filter-toolbar" aria-label="資產明細搜尋與篩選">
          <label className="search-control">
            搜尋
            <input
              value={assetSearchQuery}
              onChange={(event) => setAssetSearchQuery(event.target.value)}
              placeholder="名稱、代號、備註、日期"
            />
          </label>

          <label className="inline-control">
            幣別
            <select value={assetCurrencyFilter} onChange={(event) => setAssetCurrencyFilter(event.target.value)}>
              {assetCurrencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency === "all" ? "全部幣別" : currency}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-control">
            狀態
            <select value={assetStatusFilter} onChange={(event) => setAssetStatusFilter(event.target.value)}>
              {ASSET_STATUS_FILTER_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

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

          {isAssetFilterActive && (
            <button className="small-action secondary-action filter-reset-button" type="button" onClick={resetAssetFilters}>
              重設
            </button>
          )}
        </div>

        <div className="type-filter" role="group" aria-label="資產類型篩選">
          {assetTypeFilters.map((item) => (
            <button
              className={`type-filter-button filter-chip${assetTypeFilter === item.value ? " is-active" : ""}`}
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
              {isAssetFilterActive
                ? "沒有符合搜尋或篩選條件的資產。"
                : assetTypeFilter === "all"
                  ? "尚無資產資料。"
                  : `尚無${getAssetTypeLabel(assetTypeFilter)}資料。`}
            </p>
          ) : (
            sortedAssetGroups.map((group) => (
              <article className={`asset-group${group.type === "loan" ? " is-liability" : ""}`} key={group.key}>
                <button
                  className="asset-row asset-group-summary card-button"
                  type="button"
                  aria-expanded={Boolean(expandedAssetGroups[group.key])}
                  onClick={() => toggleAssetGroup(group.key)}
                >
                  <span className="badge">{getAssetTypeLabel(group.type)}</span>
                  <div>
                    <strong className={getTextDensityClass(group.name)} title={group.name}>
                      {group.name}
                    </strong>
                    <small>
                      {group.currency} · {group.entries.length} 筆明細 · {formatUpdatedAt(group.updatedAt)}
                    </small>
                  </div>
                  <div>
                    <strong className={getTextDensityClass(group.compactAmountText ?? group.amountText)} title={group.amountText}>
                      {group.compactAmountText ?? group.amountText}
                    </strong>
                    <small>{group.secondaryText}</small>
                  </div>
                  <span className="expand-indicator">
                    <ChevronIcon isOpen={Boolean(expandedAssetGroups[group.key])} />
                  </span>
                </button>

                {expandedAssetGroups[group.key] && (
                  <div className="detail-list">
                    {sortAssetEntries(group.entries, assetSortMode).map((asset) => {
                      const loanSnapshot = asset.type === "loan" ? getLoanSnapshot(asset) : null;
                      const isTradedAsset = isTradedAssetType(asset.type);
                      const tradedCost = isTradedAsset ? toNumber(asset.shares) * toNumber(asset.buyPrice) : 0;
                      const detailDate = isTradedAsset
                        ? asset.buyDate || "未填日期"
                        : asset.createdAt
                          ? new Date(asset.createdAt).toLocaleDateString("zh-TW")
                          : "未填日期";
                      const detailAmount = isTradedAsset
                        ? formatMoney(tradedCost, asset.currency)
                        : loanSnapshot
                          ? `剩餘 ${formatMoney(loanSnapshot.remainingPrincipal, asset.currency)}`
                          : formatMoney(asset.amountValue, asset.currency);
                      const compactDetailAmount = isTradedAsset
                        ? formatCompactMoney(tradedCost, asset.currency)
                        : loanSnapshot
                          ? `剩餘 ${formatCompactMoney(loanSnapshot.remainingPrincipal, asset.currency)}`
                          : formatCompactMoney(asset.amountValue, asset.currency);
                      const marketPriceText =
                        isTradedAsset && toNumber(asset.marketPrice) > 0
                          ? ` · 市價 ${formatMoney(asset.marketPrice, asset.currency)}`
                          : "";
                      const detailMeta = isTradedAsset
                        ? `${formatNumber(asset.shares)} 股 · 單價 ${formatMoney(asset.buyPrice, asset.currency)}${marketPriceText}`
                        : loanSnapshot
                          ? `本金 ${formatCompactMoney(asset.principal, asset.currency)} · 月付 ${formatCompactMoney(
                              loanSnapshot.monthlyPayment,
                              asset.currency,
                            )} · 已繳 ${formatNumber(
                              loanSnapshot.progressPercent,
                            )}%`
                          : getAssetTypeLabel(asset.type);
                      const detailBadges = getAssetValidationBadges({
                        asset,
                        assets,
                        exchangeRates,
                        financialGoals,
                      });

                      return (
                        <article className={`detail-card${asset.type === "loan" ? " is-liability" : ""}`} key={asset.id}>
                          <div className="detail-card-header">
                            <span>{detailDate}</span>
                            <span>{asset.currency}</span>
                          </div>
                          {detailBadges.length > 0 && (
                            <div className="detail-badge-list" aria-label="資料提醒">
                              {detailBadges.map((badge) => (
                                <span className={`detail-badge is-${badge.key}`} key={badge.key}>
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <strong title={detailAmount}>{compactDetailAmount}</strong>
                          <small className="updated-text">{formatUpdatedAt(getAssetUpdatedAt(asset))}</small>
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

      <section className={`panel data-tools-panel${isDataToolsOpen ? " is-open" : ""}`} aria-label="理財目標與備份">
        <button
          className="data-tools-toggle disclosure-button card-button"
          type="button"
          aria-expanded={isDataToolsOpen}
          onClick={() => setIsDataToolsOpen((current) => !current)}
        >
          <span>理財目標與備份</span>
          <small>設定提醒門檻、JSON 備份、CSV 匯入匯出</small>
          <span className="expand-indicator">
            <ChevronIcon isOpen={isDataToolsOpen} />
          </span>
        </button>

        {isDataToolsOpen && (
          <div className="data-tools-body">
            <div className="goal-grid" aria-label="理財目標設定">
              <label>
                每月生活費
                <input
                  type="number"
                  min="0"
                  value={financialGoals.monthlyLivingExpense}
                  onChange={(event) => updateFinancialGoal("monthlyLivingExpense", toNumber(event.target.value))}
                />
              </label>
              <label>
                緊急預備金月數
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={financialGoals.emergencyMonths}
                  onChange={(event) => updateFinancialGoal("emergencyMonths", toNumber(event.target.value))}
                />
              </label>
              <label>
                單一標的上限 %
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={financialGoals.singleHoldingLimitPercent}
                  onChange={(event) => updateFinancialGoal("singleHoldingLimitPercent", toNumber(event.target.value))}
                />
              </label>
              <label>
                股票總曝險上限 %
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={financialGoals.stockExposureLimitPercent}
                  onChange={(event) => updateFinancialGoal("stockExposureLimitPercent", toNumber(event.target.value))}
                />
              </label>
              <label>
                負債比上限 %
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={financialGoals.debtRatioLimitPercent}
                  onChange={(event) => updateFinancialGoal("debtRatioLimitPercent", toNumber(event.target.value))}
                />
              </label>
              <label>
                幾天沒更新後提醒
                <input
                  type="number"
                  min="1"
                  value={financialGoals.staleAssetDays}
                  onChange={(event) => updateFinancialGoal("staleAssetDays", toNumber(event.target.value))}
                />
              </label>
            </div>

            <div className="backup-actions">
              <button className="ghost-button secondary-action" type="button" onClick={exportJsonData}>
                匯出 JSON
              </button>
              <button className="ghost-button secondary-action" type="button" onClick={() => importFileInputRef.current?.click()}>
                匯入 JSON
              </button>
              <input
                ref={importFileInputRef}
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                onChange={importJsonData}
              />
              <button className="ghost-button secondary-action" type="button" onClick={exportCsvData}>
                匯出 CSV
              </button>
              <button className="ghost-button secondary-action" type="button" onClick={downloadCsvTemplate}>
                下載 CSV 範本
              </button>
              <button className="ghost-button secondary-action" type="button" onClick={() => csvImportFileInputRef.current?.click()}>
                匯入 CSV
              </button>
              <input
                ref={csvImportFileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={importCsvData}
              />
              <button className="subtle-danger-button" type="button" onClick={clearAll}>
                清空資料
              </button>
            </div>

            {csvImportPreview && (
              <div className="csv-preview" aria-live="polite">
                <div className="csv-preview-summary">
                  <div>
                    <strong>CSV 匯入預覽</strong>
                    <small>只支援 Asset Agent 標準 CSV，不支援銀行或券商原始檔。</small>
                  </div>
                  <span>
                    可匯入 {csvImportPreview.validCount} 筆 · 正常 {csvImportPreview.validRows?.length ?? 0} 筆 · 提醒{" "}
                    {csvImportPreview.warningCount} 筆 · 錯誤 {csvImportPreview.errorCount} 筆
                  </span>
                </div>

                {csvImportPreview.errors.length > 0 && (
                  <div className="csv-error-box">
                    <strong>錯誤列</strong>
                    <ul>
                      {csvImportPreview.errors.map((error) => (
                        <li key={`${error.rowNumber}-${error.message}`}>
                          第 {error.rowNumber} 列：{error.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {csvImportPreview.warnings.length > 0 && (
                  <div className="csv-warning-box">
                    <div className="csv-box-header">
                      <strong>提醒列</strong>
                      {isCsvWarningConfirmed && <span>已確認</span>}
                    </div>
                    <ul>
                      {csvImportPreview.warnings.map((warning) => (
                        <li key={`${warning.rowNumber}-${warning.message}`}>
                          第 {warning.rowNumber} 列：{warning.message}
                        </li>
                      ))}
                    </ul>
                    {csvImportState.needsWarningConfirmation && (
                      <button className="warning-confirm-button secondary-action" type="button" onClick={confirmCsvWarnings}>
                        我已確認 CSV warning
                      </button>
                    )}
                  </div>
                )}

                <div className="form-actions">
                  <button
                    className="primary-button primary-action"
                    type="button"
                    onClick={confirmCsvImport}
                    disabled={!csvImportState.canImport}
                  >
                    {csvImportState.needsWarningConfirmation ? "確認 warning 後匯入" : "確認匯入"}
                  </button>
                  <button className="ghost-button secondary-action" type="button" onClick={cancelCsvImport}>
                    取消匯入
                  </button>
                </div>
              </div>
            )}

            {dataToolStatus && <p className="rate-status">{dataToolStatus}</p>}
          </div>
        )}
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
                <CloseIcon />
              </button>
            </div>

            <AssetFormFields form={editForm} onFieldChange={updateEditForm} onTypeChange={handleEditTypeChange} />

            <ValidationSummary
              validation={editFormValidation}
              submitState={editSubmitState}
              confirmed={isEditWarningConfirmed}
              onConfirmWarnings={confirmEditWarnings}
              notice={editFormNotice}
            />

            <div className="form-actions modal-actions">
              <button className="primary-button primary-action" type="submit" disabled={!editSubmitState.canSubmit}>
                {editSubmitState.needsWarningConfirmation ? "確認提醒後儲存" : "儲存修改"}
              </button>
              <button className="ghost-button secondary-action" type="button" onClick={cancelEditing}>
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
                <CloseIcon />
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
              <button className="danger-button primary-action" type="button" onClick={confirmDeleteAsset}>
                刪除
              </button>
              <button className="ghost-button secondary-action" type="button" onClick={cancelDeleteAsset}>
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
