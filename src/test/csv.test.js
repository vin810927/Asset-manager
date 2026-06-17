import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  createCsvTemplate,
  exportAssetsToCsv,
  parseAssetsCsv,
  parseCsvRows,
  summarizeByCurrency,
  summarizeInBaseCurrency,
} from "../utils.js";
import { assetsFixture, exchangeRatesFixture, FIXED_NOW } from "./fixtures.js";

function csvFromRecords(records) {
  return [
    CSV_COLUMNS.join(","),
    ...records.map((record) => CSV_COLUMNS.map((column) => record[column] ?? "").join(",")),
  ].join("\n");
}

function rowToRecord(header, row) {
  return Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""]));
}

function expectCloseToAmount(actual, expected) {
  expect(actual).toBeCloseTo(expected, 2);
}

describe("Asset Agent CSV import/export", () => {
  it("匯出 CSV header 與 cash / stock / loan 欄位", () => {
    const sampleAssets = [
      assetsFixture.find((asset) => asset.id === "cash-twd-1"),
      assetsFixture.find((asset) => asset.id === "stock-usd"),
      assetsFixture.find((asset) => asset.id === "loan-twd"),
    ];
    const rows = parseCsvRows(exportAssetsToCsv(sampleAssets));
    const [header, cashRow, stockRow, loanRow] = rows;
    const cash = rowToRecord(header, cashRow);
    const stock = rowToRecord(header, stockRow);
    const loan = rowToRecord(header, loanRow);

    expect(header).toEqual(CSV_COLUMNS);
    expect(cash).toEqual(
      expect.objectContaining({
        id: "cash-twd-1",
        type: "cash",
        name: "銀行活存",
        currency: "TWD",
        amount: "100000",
      }),
    );
    expect(stock).toEqual(
      expect.objectContaining({
        id: "stock-usd",
        type: "stock",
        ticker: "AAPL",
        currency: "USD",
        shares: "100",
        buyPrice: "100",
        marketPrice: "102",
      }),
    );
    expect(loan).toEqual(
      expect.objectContaining({
        id: "loan-twd",
        type: "loan",
        name: "房貸",
        currency: "TWD",
        principal: "300000",
        years: "10",
        annualRate: "0",
      }),
    );
  });

  it("CSV 範本包含 header 與四筆示例資料", () => {
    const rows = parseCsvRows(createCsvTemplate());
    const [header, ...examples] = rows;
    const records = examples.map((row) => rowToRecord(header, row));

    expect(header).toEqual(CSV_COLUMNS);
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.type)).toEqual(["cash", "stock", "etf", "loan"]);
  });

  it("標準 CSV 可轉成 assets，並保留數值型欄位", () => {
    const result = parseAssetsCsv(
      csvFromRecords([
        {
          id: "csv-cash",
          type: "cash",
          name: "台幣活存",
          currency: "TWD",
          amount: 100000,
          note: "現金示例",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "csv-stock",
          type: "stock",
          ticker: "AAPL",
          currency: "USD",
          shares: 10,
          buyPrice: 100,
          marketPrice: 102,
          marketPriceUpdatedAt: "2026-06-15",
          buyDate: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "csv-loan",
          type: "loan",
          name: "信貸",
          currency: "TWD",
          principal: 50000,
          years: 5,
          annualRate: 2.1,
          startDate: "2099-01-01",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
      ]),
    );

    expect(result.validCount).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.assets[0]).toEqual(expect.objectContaining({ type: "cash", amount: 100000 }));
    expect(result.assets[1]).toEqual(
      expect.objectContaining({
        type: "stock",
        ticker: "AAPL",
        shares: 10,
        buyPrice: 100,
        marketPrice: 102,
      }),
    );
    expect(result.assets[2]).toEqual(expect.objectContaining({ type: "loan", principal: 50000, years: 5 }));
  });

  it("缺 id、createdAt、updatedAt 時會自動補上", () => {
    const result = parseAssetsCsv(
      csvFromRecords([
        {
          type: "cash",
          name: "零用金",
          currency: "TWD",
          amount: 1200,
        },
      ]),
      {
        createId: () => "generated-id",
        now: FIXED_NOW,
      },
    );

    expect(result.validCount).toBe(1);
    expect(result.assets[0]).toEqual(
      expect.objectContaining({
        id: "generated-id",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }),
    );
  });

  it("不合法 type 會回報錯誤，不會寫入可匯入 assets", () => {
    const result = parseAssetsCsv(
      csvFromRecords([
        {
          id: "bad-row",
          type: "crypto",
          name: "BTC",
          currency: "TWD",
          amount: 1,
        },
      ]),
    );

    expect(result.validCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.assets).toEqual([]);
    expect(result.errors[0].message).toContain("type");
  });

  it("匯入後 dashboard 計算結果合理", () => {
    const imported = parseAssetsCsv(
      csvFromRecords([
        {
          id: "csv-cash",
          type: "cash",
          name: "台幣活存",
          currency: "TWD",
          amount: 100000,
        },
        {
          id: "csv-stock",
          type: "stock",
          ticker: "AAPL",
          currency: "USD",
          shares: 10,
          buyPrice: 100,
          buyDate: "2026-06-01",
        },
        {
          id: "csv-loan",
          type: "loan",
          name: "信貸",
          currency: "TWD",
          principal: 50000,
          years: 5,
          annualRate: 2.1,
          startDate: "2099-01-01",
        },
      ]),
      {
        now: FIXED_NOW,
      },
    ).assets;
    const summary = summarizeInBaseCurrency(summarizeByCurrency(imported), exchangeRatesFixture);

    expectCloseToAmount(summary.assets, 130000);
    expectCloseToAmount(summary.liabilities, 50000);
    expectCloseToAmount(summary.net, 80000);
  });
});
