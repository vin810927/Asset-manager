import { describe, expect, it } from "vitest";
import {
  buildAttentionItems,
  createBackupPayload,
  getConcentrationItems,
  groupNonStockAssets,
  groupStockHoldings,
  parseBackupPayload,
  summarizeByCurrency,
  summarizeInBaseCurrency,
} from "../utils.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

function expectCloseToAmount(actual, expected) {
  expect(actual).toBeCloseTo(expected, 2);
}

function getAttentionKeys() {
  return buildAttentionItems({
    assets: assetsFixture,
    exchangeRates: exchangeRatesFixture,
    financialGoals: financialGoalsFixture,
    now: FIXED_NOW,
  }).map((item) => item.key);
}

describe("Asset Agent smoke tests", () => {
  it("合併同名稱、同類型、同幣別的現金，但保留不同幣別分組", () => {
    const cashGroups = groupNonStockAssets(assetsFixture).filter((group) => group.type === "cash");
    const twdCash = cashGroups.find((group) => group.currency === "TWD" && group.name === "銀行活存");
    const usdCash = cashGroups.find((group) => group.currency === "USD" && group.name === "銀行活存");
    const jpyCash = cashGroups.find((group) => group.currency === "JPY" && group.name === "銀行活存");

    expect(cashGroups).toHaveLength(3);
    expect(twdCash.entries).toHaveLength(2);
    expect(twdCash.totalAmount).toBe(150000);
    expect(usdCash.totalAmount).toBe(5000);
    expect(jpyCash.totalAmount).toBe(100000);
  });

  it("合併同 ticker、同幣別的股票，並保留不同標的分組", () => {
    const stockGroups = groupStockHoldings(assetsFixture);
    const twdStock = stockGroups.find((group) => group.ticker === "2330" && group.currency === "TWD");
    const usdStock = stockGroups.find((group) => group.ticker === "AAPL" && group.currency === "USD");

    expect(stockGroups).toHaveLength(2);
    expect(twdStock.lots).toHaveLength(2);
    expect(twdStock.totalShares).toBe(1500);
    expect(twdStock.totalCost).toBe(900000);
    expect(twdStock.averageCost).toBe(600);
    expect(usdStock.totalCost).toBe(10000);
  });

  it("貸款列為負債，且不進入正資產配置基礎", () => {
    const nonStockGroups = groupNonStockAssets(assetsFixture);
    const loanGroup = nonStockGroups.find((group) => group.type === "loan");
    const twdSummary = summarizeByCurrency(assetsFixture).find((item) => item.currency === "TWD");

    expect(loanGroup.totalAmount).toBeLessThan(0);
    expect(twdSummary.assets).toBe(1250000);
    expect(twdSummary.liabilities).toBe(300000);
  });

  it("依 rateToTwd 計算總資產、總負債與淨資產", () => {
    const summary = summarizeInBaseCurrency(summarizeByCurrency(assetsFixture), exchangeRatesFixture);

    expectCloseToAmount(summary.assets, 1722000);
    expectCloseToAmount(summary.liabilities, 300000);
    expectCloseToAmount(summary.net, 1422000);
    expect(summary.missingCurrencies).toEqual([]);
  });

  it("單一標的與股票 / 基金曝險超過理財目標時產生提醒", () => {
    const concentrationItems = getConcentrationItems({
      assets: assetsFixture,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
    });
    const twdStock = concentrationItems.find((item) => item.ticker === "2330");
    const attentionKeys = getAttentionKeys();

    expect(twdStock.isWarning).toBe(true);
    expect(twdStock.totalAssetPercent).toBeGreaterThan(financialGoalsFixture.singleHoldingLimitPercent);
    expect(attentionKeys).toContain("concentration");
    expect(attentionKeys).toContain("risk-exposure");
  });

  it("JSON 匯出 / 匯入保留資產、匯率、理財目標與 dashboard 計算結果", () => {
    const before = summarizeInBaseCurrency(summarizeByCurrency(assetsFixture), exchangeRatesFixture);
    const exported = createBackupPayload({
      assets: assetsFixture,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      lastCheckedAt: FIXED_NOW,
    });
    const imported = parseBackupPayload(JSON.parse(JSON.stringify(exported)));
    const after = summarizeInBaseCurrency(summarizeByCurrency(imported.assets), imported.exchangeRates);

    expect(exported).toEqual(
      expect.objectContaining({
        schemaVersion: expect.any(Number),
        exportedAt: expect.any(String),
        lastCheckedAt: FIXED_NOW,
        assets: expect.any(Array),
        exchangeRates: expect.any(Object),
        financialGoals: expect.any(Object),
      }),
    );
    expect(Number.isNaN(new Date(exported.exportedAt).getTime())).toBe(false);
    expect(exported.assets).toHaveLength(assetsFixture.length);
    expect(imported.financialGoals).toEqual(financialGoalsFixture);
    expectCloseToAmount(after.assets, before.assets);
    expectCloseToAmount(after.liabilities, before.liabilities);
    expectCloseToAmount(after.net, before.net);
  });

  it("資料新鮮度提醒涵蓋現金、股票市價與貸款本金", () => {
    const attentionItems = buildAttentionItems({
      assets: assetsFixture,
      exchangeRates: exchangeRatesFixture,
      financialGoals: financialGoalsFixture,
      now: FIXED_NOW,
    });
    const attentionKeys = attentionItems.map((item) => item.key);

    expect(attentionKeys).toContain("stale-cash");
    expect(attentionKeys).toContain("stale-stock-price");
    expect(attentionKeys).toContain("stale-loan");
    expect(attentionItems.find((item) => item.key === "stale-cash").label).toContain(
      `${financialGoalsFixture.staleAssetDays} 天`,
    );
    expect(attentionItems.find((item) => item.key === "stale-loan").label).toContain(
      `${financialGoalsFixture.staleAssetDays} 天`,
    );
    expect(attentionItems.find((item) => item.key === "stale-stock-price").label).toContain("7 天");
  });
});
