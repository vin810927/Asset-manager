import { describe, expect, it } from "vitest";
import {
  ASSET_TYPES,
  buildAttentionItems,
  createBackupPayload,
  getAssetSubmitState,
  getGoalMetrics,
  getAssetValidationBadges,
  getAssetValidationFingerprint,
  getAssetTypeLabel,
  getCsvImportState,
  getCsvPreviewFingerprint,
  groupTradedHoldings,
  parseAssetsCsv,
  parseBackupPayload,
  summarizeByCurrency,
  summarizeInBaseCurrency,
  validateAssetInput,
} from "../utils.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

const etfLot = {
  id: "etf-twd-1",
  type: "etf",
  currency: "TWD",
  ticker: "0050",
  shares: 10,
  buyPrice: 160,
  buyDate: "2026-06-01",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  note: "",
};

function csvFromRecords(records) {
  const columns = [
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

  return [
    columns.join(","),
    ...records.map((record) => columns.map((column) => record[column] ?? "").join(",")),
  ].join("\n");
}

function issueCodes(result, kind) {
  return result[kind].map((issue) => issue.code);
}

describe("Asset Agent v0.5 validation and ETF support", () => {
  it("ETF 是獨立資產類型，會出現在 type filters 來源", () => {
    expect(ASSET_TYPES).toContainEqual({ value: "etf", label: "ETF" });
    expect(getAssetTypeLabel("etf")).toBe("ETF");
  });

  it("ETF 可分組並計算 TWD 估值", () => {
    const assets = [
      etfLot,
      {
        ...etfLot,
        id: "etf-twd-2",
        shares: 5,
        buyPrice: 170,
      },
    ];
    const etfGroups = groupTradedHoldings(assets).filter((group) => group.type === "etf");
    const summary = summarizeInBaseCurrency(summarizeByCurrency(assets), exchangeRatesFixture);

    expect(etfGroups).toHaveLength(1);
    expect(etfGroups[0].ticker).toBe("0050");
    expect(etfGroups[0].totalShares).toBe(15);
    expect(etfGroups[0].totalCost).toBe(2450);
    expect(summary.assets).toBe(2450);
    expect(summary.net).toBe(2450);
  });

  it("stock + ETF + fund 共同納入股票總曝險與待處理事項", () => {
    const assets = [
      {
        id: "stock-risk",
        type: "stock",
        currency: "TWD",
        ticker: "2330",
        shares: 10,
        buyPrice: 10000,
        buyDate: "2026-06-01",
      },
      {
        id: "etf-risk",
        type: "etf",
        currency: "TWD",
        ticker: "0050",
        shares: 10,
        buyPrice: 10000,
        buyDate: "2026-06-01",
      },
      {
        id: "fund-risk",
        type: "fund",
        currency: "TWD",
        name: "全球股票基金",
        amount: 100000,
      },
      {
        id: "cash-risk",
        type: "cash",
        currency: "TWD",
        name: "現金",
        amount: 100000,
      },
    ];
    const goals = { ...financialGoalsFixture, stockExposureLimitPercent: 60 };
    const metrics = getGoalMetrics({ assets, exchangeRates: exchangeRatesFixture, financialGoals: goals });
    const attentionKeys = buildAttentionItems({
      assets,
      exchangeRates: exchangeRatesFixture,
      financialGoals: goals,
      now: FIXED_NOW,
    }).map((item) => item.key);

    expect(metrics.riskExposurePercent).toBe(75);
    expect(attentionKeys).toContain("risk-exposure");
  });

  it("數字 ticker 搭配 USD 會產生 warning", () => {
    const result = validateAssetInput({ ...etfLot, currency: "USD" });

    expect(issueCodes(result, "warnings")).toContain("ticker-currency");
    expect(result.warnings[0].message).toContain("TWD");
  });

  it("英文 ticker 搭配 TWD 會產生 warning", () => {
    const result = validateAssetInput({ ...etfLot, ticker: "AAPL", currency: "TWD" });

    expect(issueCodes(result, "warnings")).toContain("ticker-currency");
    expect(result.warnings[0].message).toContain("USD");
  });

  it("stock / ETF 缺 ticker、shares <= 0、buyPrice <= 0 會產生 error", () => {
    const stockResult = validateAssetInput({
      type: "stock",
      currency: "TWD",
      ticker: "",
      shares: 0,
      buyPrice: 0,
      buyDate: "2026-06-01",
    });
    const etfResult = validateAssetInput({
      type: "etf",
      currency: "TWD",
      ticker: "",
      shares: 0,
      buyPrice: 0,
      buyDate: "2026-06-01",
    });

    expect(issueCodes(stockResult, "errors")).toEqual(
      expect.arrayContaining(["missing-ticker", "invalid-shares", "invalid-buy-price"]),
    );
    expect(issueCodes(etfResult, "errors")).toEqual(
      expect.arrayContaining(["missing-ticker", "invalid-shares", "invalid-buy-price"]),
    );
  });

  it("不合法 type 會產生 error", () => {
    const result = validateAssetInput({ type: "crypto", currency: "TWD", name: "BTC", amount: 1 });

    expect(issueCodes(result, "errors")).toContain("invalid-type");
  });

  it("價格與既有同 ticker 平均成本差異超過 80% 時產生 warning", () => {
    const result = validateAssetInput(
      {
        ...etfLot,
        id: "etf-twd-new",
        buyPrice: 500,
      },
      {
        assets: [etfLot],
      },
    );

    expect(issueCodes(result, "warnings")).toContain("price-gap");
  });

  it("CSV 匯入 ETF 成功，warning row 會列入 preview，error row 不進 assets", () => {
    const result = parseAssetsCsv(
      csvFromRecords([
        {
          id: "csv-etf-ok",
          type: "etf",
          ticker: "0050",
          currency: "TWD",
          shares: 10,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-etf-warning",
          type: "etf",
          ticker: "0050",
          currency: "USD",
          shares: 10,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-etf-error",
          type: "etf",
          ticker: "",
          currency: "TWD",
          shares: 0,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
      ]),
      {
        now: FIXED_NOW,
      },
    );

    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.assets.map((asset) => asset.id)).toEqual(["csv-etf-ok", "csv-etf-warning"]);
    expect(result.errors[0].rowNumber).toBe(4);
    expect(result.warnings[0].rowNumber).toBe(3);
  });

  it("ETF JSON 匯出 / 匯入 round-trip 後 dashboard 計算一致", () => {
    const assets = [etfLot, ...assetsFixture];
    const before = summarizeInBaseCurrency(summarizeByCurrency(assets), exchangeRatesFixture);
    const exported = createBackupPayload({
      assets,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      lastCheckedAt: FIXED_NOW,
    });
    const imported = parseBackupPayload(JSON.parse(JSON.stringify(exported)));
    const after = summarizeInBaseCurrency(summarizeByCurrency(imported.assets), imported.exchangeRates);

    expect(imported.assets.find((asset) => asset.id === etfLot.id)).toEqual(expect.objectContaining({ type: "etf" }));
    expect(after.assets).toBeCloseTo(before.assets, 2);
    expect(after.liabilities).toBeCloseTo(before.liabilities, 2);
    expect(after.net).toBeCloseTo(before.net, 2);
  });
});

describe("Asset Agent v0.6 inline validation helpers", () => {
  it("validateAssetInput 有 error 時表單不能新增", () => {
    const validation = validateAssetInput({
      type: "etf",
      currency: "TWD",
      ticker: "",
      shares: 0,
      buyPrice: 0,
      buyDate: "2026-06-01",
    });
    const submitState = getAssetSubmitState(validation, false);

    expect(submitState.hasErrors).toBe(true);
    expect(submitState.canSubmit).toBe(false);
  });

  it("warning confirmation 在欄位變更後會 reset", () => {
    const originalDraft = { ...etfLot, currency: "USD", shares: 10 };
    const changedDraft = { ...originalDraft, shares: 11 };
    const originalValidation = validateAssetInput(originalDraft);
    const changedValidation = validateAssetInput(changedDraft);
    const confirmedFingerprint = getAssetValidationFingerprint(originalDraft, originalValidation);
    const changedFingerprint = getAssetValidationFingerprint(changedDraft, changedValidation);

    expect(getAssetSubmitState(originalValidation, confirmedFingerprint === confirmedFingerprint).canSubmit).toBe(true);
    expect(confirmedFingerprint).not.toBe(changedFingerprint);
    expect(getAssetSubmitState(changedValidation, confirmedFingerprint === changedFingerprint)).toEqual(
      expect.objectContaining({
        needsWarningConfirmation: true,
        canSubmit: false,
      }),
    );
  });

  it("CSV preview 正確分出 valid / warning / error rows", () => {
    const preview = parseAssetsCsv(
      csvFromRecords([
        {
          id: "csv-etf-valid",
          type: "etf",
          ticker: "0050",
          currency: "TWD",
          shares: 10,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-etf-warning",
          type: "etf",
          ticker: "0050",
          currency: "USD",
          shares: 10,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-etf-error",
          type: "etf",
          ticker: "",
          currency: "TWD",
          shares: 0,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
      ]),
      {
        now: FIXED_NOW,
      },
    );

    expect(preview.validRows.map((row) => row.rowNumber)).toEqual([2]);
    expect(preview.warningRows.map((row) => row.rowNumber)).toEqual([3]);
    expect(preview.errorRows.map((row) => row.rowNumber)).toEqual([4]);
    expect(preview.assets.map((asset) => asset.id)).toEqual(["csv-etf-valid", "csv-etf-warning"]);
  });

  it("CSV error row 不會匯入，warning row 需確認後才匯入", () => {
    const preview = parseAssetsCsv(
      csvFromRecords([
        {
          id: "csv-etf-warning",
          type: "etf",
          ticker: "0050",
          currency: "USD",
          shares: 10,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-etf-error",
          type: "etf",
          ticker: "",
          currency: "TWD",
          shares: 0,
          buyPrice: 160,
          buyDate: "2026-06-01",
        },
      ]),
      {
        now: FIXED_NOW,
      },
    );
    const fingerprint = getCsvPreviewFingerprint(preview);

    expect(preview.assets.map((asset) => asset.id)).toEqual(["csv-etf-warning"]);
    expect(getCsvImportState(preview, false)).toEqual(
      expect.objectContaining({
        needsWarningConfirmation: true,
        canImport: false,
      }),
    );
    expect(getCsvImportState(preview, fingerprint === getCsvPreviewFingerprint(preview)).canImport).toBe(true);
  });

  it("badge helper 能辨識幣別待確認、高集中、資料過期", () => {
    const currencyWarningBadges = getAssetValidationBadges({
      asset: { ...etfLot, currency: "USD" },
      assets: [{ ...etfLot, currency: "USD" }],
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      now: FIXED_NOW,
    }).map((badge) => badge.key);
    const concentrationBadges = getAssetValidationBadges({
      asset: assetsFixture.find((asset) => asset.id === "stock-twd-1"),
      assets: assetsFixture,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      now: FIXED_NOW,
    }).map((badge) => badge.key);
    const staleBadges = getAssetValidationBadges({
      asset: assetsFixture.find((asset) => asset.id === "cash-twd-1"),
      assets: assetsFixture,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      now: FIXED_NOW,
    }).map((badge) => badge.key);

    expect(currencyWarningBadges).toContain("currency-warning");
    expect(concentrationBadges).toContain("concentration");
    expect(staleBadges).toContain("stale");
  });
});
