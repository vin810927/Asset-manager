import { describe, expect, it } from "vitest";
import { buildAiReadyReportInput, buildAssetReport, buildMarkdownAssetReport } from "../report/buildAssetReport.js";
import { createExchangeRateStore } from "../utils.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

function getReportAssetType(report, type) {
  return report.allocation.byAssetType.find((item) => item.type === type);
}

describe("deterministic asset report", () => {
  it("空 assets 可產生有效 report", () => {
    const report = buildAssetReport({
      assets: [],
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        generatedAt: FIXED_NOW,
        summary: expect.objectContaining({
          netWorthTwd: 0,
          totalAssetsTwd: 0,
          totalLiabilitiesTwd: 0,
        }),
      }),
    );
    expect(report.dataQuality.assetCount).toBe(0);
    expect(report.actionItems.some((item) => item.code === "empty-assets")).toBe(true);
  });

  it("riskFlags 具有 v1.5 schema 且保留舊 code / label 相容欄位", () => {
    const report = buildAssetReport({
      assets: assetsFixture,
      financialGoals: { ...financialGoalsFixture, singleHoldingLimitPercent: 10 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });
    const flag = report.riskFlags.find((item) => item.code === "single-holding-concentration");

    expect(flag).toEqual(
      expect.objectContaining({
        id: "single-holding-concentration",
        code: "single-holding-concentration",
        severity: expect.stringMatching(/^(info|warning|critical)$/),
        category: "concentration",
        title: expect.any(String),
        message: expect.any(String),
        label: expect.any(String),
        relatedAssetIds: expect.any(Array),
      }),
    );
  });

  it("actionItems 具有 v1.5 schema 且依類別描述待處理事項", () => {
    const report = buildAssetReport({
      assets: [
        {
          id: "old-cash",
          type: "cash",
          currency: "TWD",
          name: "舊現金",
          amount: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      financialGoals: { ...financialGoalsFixture, staleAssetDays: 30 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date("2026-06-15T00:00:00.000Z"),
    });
    const action = report.actionItems.find((item) => item.code === "stale-assets");

    expect(action).toEqual(
      expect.objectContaining({
        id: "stale-assets",
        priority: expect.stringMatching(/^(low|medium|high)$/),
        category: "data_quality",
        title: expect.any(String),
        message: expect.stringContaining("建議"),
        relatedAssetIds: ["old-cash"],
      }),
    );
  });

  it("cash / stock / loan 正確計算 totalAssets / totalLiabilities / netWorth", () => {
    const assets = [
      { id: "cash", type: "cash", currency: "TWD", name: "現金", amount: 100000, createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
      {
        id: "stock",
        type: "stock",
        currency: "TWD",
        ticker: "2330",
        shares: 10,
        buyPrice: 500,
        buyDate: "2026-06-01",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
      {
        id: "loan",
        type: "loan",
        currency: "TWD",
        name: "貸款",
        principal: 30000,
        years: 1,
        annualRate: 0,
        startDate: "2099-01-01",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    ];
    const report = buildAssetReport({
      assets,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.summary.totalAssetsTwd).toBe(105000);
    expect(report.summary.totalLiabilitiesTwd).toBe(30000);
    expect(report.summary.netWorthTwd).toBe(75000);
    expect(report.summary.cashTwd).toBe(100000);
    expect(report.summary.stockTwd).toBe(5000);
    expect(report.summary.loanTwd).toBe(30000);
  });

  it("多幣別資產可依 exchangeRates 換算 TWD", () => {
    const report = buildAssetReport({
      assets: assetsFixture.filter((asset) => asset.id === "cash-usd" || asset.id === "cash-jpy"),
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });
    const usd = report.allocation.byCurrency.find((item) => item.currency === "USD");
    const jpy = report.allocation.byCurrency.find((item) => item.currency === "JPY");

    expect(usd.assetsTwd).toBe(150000);
    expect(jpy.assetsTwd).toBe(22000);
    expect(report.summary.totalAssetsTwd).toBe(172000);
  });

  it("缺少匯率時產生 dataQuality warning，不 crash", () => {
    const rates = createExchangeRateStore(
      {
        TWD: { rateToTwd: 1 },
        USD: { rateToTwd: 0 },
      },
      { fetchedAt: FIXED_NOW },
    );
    const report = buildAssetReport({
      assets: [assetsFixture.find((asset) => asset.id === "cash-usd")],
      financialGoals: financialGoalsFixture,
      exchangeRates: rates,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.summary.totalAssetsTwd).toBe(0);
    expect(report.dataQuality.missingCurrencyWarnings).toEqual([
      expect.objectContaining({ currency: "USD" }),
    ]);
    expect(report.actionItems.some((item) => item.code === "missing-currency-rates")).toBe(true);
  });

  it("stockExposurePercent 與 debtRatioPercent 正確", () => {
    const report = buildAssetReport({
      assets: assetsFixture,
      financialGoals: { ...financialGoalsFixture, debtRatioLimitPercent: 10 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.allocation.stockExposurePercent).toBeGreaterThan(60);
    expect(report.allocation.debtRatioPercent).toBeGreaterThan(0);
    expect(report.riskFlags.some((item) => item.code === "risk-asset-exposure")).toBe(true);
    expect(report.riskFlags.some((item) => item.code === "debt-ratio")).toBe(true);
  });

  it("emergency fund months 使用 financialGoals monthlyLivingExpense 的 TWD 單位", () => {
    const report = buildAssetReport({
      assets: [assetsFixture[0], assetsFixture[1]],
      financialGoals: { ...financialGoalsFixture, monthlyLivingExpense: 50000, emergencyMonths: 6 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.summary.cashTwd).toBe(150000);
    expect(report.allocation.emergencyFundMonths).toBe(3);
    expect(report.riskFlags.some((item) => item.code === "emergency-fund-shortfall")).toBe(true);
  });

  it("單一持股超過 singleHoldingLimitPercent 時產生 riskFlag", () => {
    const report = buildAssetReport({
      assets: assetsFixture,
      financialGoals: { ...financialGoalsFixture, singleHoldingLimitPercent: 10 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.concentration.singleHoldingLimitBreaches.length).toBeGreaterThan(0);
    expect(report.riskFlags.some((item) => item.code === "single-holding-concentration")).toBe(true);
  });

  it("stale asset 超過 staleAssetDays 時產生 actionItem", () => {
    const report = buildAssetReport({
      assets: [
        {
          id: "old-cash",
          type: "cash",
          currency: "TWD",
          name: "舊現金",
          amount: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      financialGoals: { ...financialGoalsFixture, staleAssetDays: 30 },
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(report.staleAssets).toHaveLength(1);
    expect(report.actionItems.some((item) => item.code === "stale-assets")).toBe(true);
  });

  it("duplicate asset names 產生 warning", () => {
    const report = buildAssetReport({
      assets: [assetsFixture[0], assetsFixture[1]],
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.dataQuality.duplicateNameWarnings).toEqual([
      expect.objectContaining({
        name: "銀行活存",
        type: "cash",
        count: 2,
      }),
    ]);
  });

  it("latestSnapshotAt 可被帶入 report source", () => {
    const report = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      snapshots: [
        { id: "old", createdAt: "2026-06-01T00:00:00.000Z" },
        { id: "new", createdAt: "2026-06-15T12:00:00.000Z" },
      ],
      dataSourceMode: "cloudflare-d1",
      cloudMode: true,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(report.source.latestSnapshotAt).toBe("2026-06-15T12:00:00.000Z");
    expect(report.actionItems.some((item) => item.code === "missing-cloud-snapshot")).toBe(false);
  });

  it("Cloud Mode 無 snapshot 時產生 actionItem，local mode 不強制 snapshot", () => {
    const cloudReport = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      snapshots: [],
      dataSourceMode: "cloudflare-d1",
      cloudMode: true,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });
    const localReport = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      snapshots: [],
      dataSourceMode: "localStorage",
      cloudMode: false,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(cloudReport.actionItems.some((item) => item.code === "missing-cloud-snapshot")).toBe(true);
    expect(localReport.actionItems.some((item) => item.code === "missing-cloud-snapshot")).toBe(false);
  });

  it("report JSON 不包含 secret / Access token / JWT / ACCESS env 實際值", () => {
    const reportText = JSON.stringify(
      buildAssetReport({
        assets: assetsFixture,
        financialGoals: financialGoalsFixture,
        exchangeRates: exchangeRatesFixture,
        generatedAt: FIXED_NOW,
        now: new Date(FIXED_NOW),
      }),
    );

    expect(reportText).not.toContain("ACCESS_AUD");
    expect(reportText).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(reportText).not.toContain("Cf-Access-Jwt-Assertion");
    expect(reportText).not.toContain("JWT");
    expect(reportText).not.toContain("token");
    expect(getReportAssetType(JSON.parse(reportText), "cash").valueTwd).toBeGreaterThan(0);
  });

  it("AI-ready JSON export 包含 deterministic report summary 與安全 constraints", () => {
    const report = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });
    const aiInput = buildAiReadyReportInput(report);

    expect(aiInput).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        purpose: "asset-agent-ai-report-input",
        language: "zh-TW",
        financialSummary: expect.objectContaining({
          netWorthTwd: report.summary.netWorthTwd,
          totalAssetsTwd: report.summary.totalAssetsTwd,
        }),
        riskSummary: expect.objectContaining({
          riskFlags: expect.any(Array),
          actionItems: expect.any(Array),
        }),
        constraints: expect.objectContaining({
          doNotProvideBuySellInstructions: true,
          doNotInferMissingMarketPrices: true,
          askForConfirmationBeforeHighImpactAdvice: true,
        }),
      }),
    );
  });

  it("AI-ready JSON export 不包含 Access token / JWT / secret / ACCESS env 實際值或交易指令", () => {
    const aiInputText = JSON.stringify(
      buildAiReadyReportInput(
        buildAssetReport({
          assets: assetsFixture,
          financialGoals: financialGoalsFixture,
          exchangeRates: exchangeRatesFixture,
          generatedAt: FIXED_NOW,
          now: new Date(FIXED_NOW),
        }),
      ),
    );

    expect(aiInputText).not.toContain("ACCESS_AUD");
    expect(aiInputText).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(aiInputText).not.toContain("Cf-Access-Jwt-Assertion");
    expect(aiInputText).not.toContain("JWT");
    expect(aiInputText).not.toContain("token");
    expect(aiInputText).not.toMatch(/buy\s+\w+/i);
    expect(aiInputText).not.toMatch(/sell\s+\w+/i);
  });

  it("Markdown export 可產生人類可讀章節與 disclaimer", () => {
    const markdown = buildMarkdownAssetReport(
      buildAssetReport({
        assets: assetsFixture,
        financialGoals: financialGoalsFixture,
        exchangeRates: exchangeRatesFixture,
        generatedAt: FIXED_NOW,
        now: new Date(FIXED_NOW),
      }),
    );

    expect(markdown).toContain("# Asset Agent 規則型資產報告");
    expect(markdown).toContain("## 資產摘要");
    expect(markdown).toContain("## 風險提示");
    expect(markdown).toContain("## 待處理事項");
    expect(markdown).toContain("## 資料品質");
    expect(markdown).toContain("## Disclaimer");
    expect(markdown).toContain("未使用 AI");
    expect(markdown).toContain("不構成投資建議");
  });

  it("local mode / Cloud Mode report export 都可正常帶入來源與 snapshot metadata", () => {
    const localReport = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      dataSourceMode: "localStorage",
      cloudMode: false,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });
    const cloudReport = buildAssetReport({
      assets: assetsFixture,
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      snapshots: [{ id: "snapshot", createdAt: "2026-06-15T12:00:00.000Z" }],
      dataSourceMode: "cloudflare-d1",
      cloudMode: true,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(buildAiReadyReportInput(localReport).source).toEqual(expect.objectContaining({ dataSourceMode: "localStorage" }));
    expect(buildAiReadyReportInput(cloudReport).source).toEqual(
      expect.objectContaining({
        dataSourceMode: "cloudflare-d1",
        cloudMode: true,
        latestSnapshotAt: "2026-06-15T12:00:00.000Z",
      }),
    );
  });

  it("空 assets 仍可 export AI-ready JSON / Markdown，不 crash", () => {
    const report = buildAssetReport({
      assets: [],
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
      now: new Date(FIXED_NOW),
    });

    expect(buildAiReadyReportInput(report).financialSummary.totalAssetsTwd).toBe(0);
    expect(buildMarkdownAssetReport(report)).toContain("總資產：TWD 0");
    expect(buildMarkdownAssetReport(report)).toContain("不構成投資建議");
  });
});
