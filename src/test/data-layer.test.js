import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createCloudStore } from "../data/cloudStore.js";
import { createDataSource, getDefaultDataSourceMode } from "../data/dataSource.js";
import { createLocalStore } from "../data/localStore.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture } from "./fixtures.js";

function createMemoryLocalStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

describe("Asset Agent v0.7 data layer foundation", () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryLocalStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it("local data layer 可以讀寫既有 assets / exchangeRates / financialGoals", () => {
    const localStore = createLocalStore();

    localStore.saveAssets(assetsFixture);
    localStore.saveExchangeRates(exchangeRatesFixture);
    localStore.saveFinancialGoals(financialGoalsFixture);

    expect(localStore.loadAssets()).toHaveLength(assetsFixture.length);
    expect(localStore.loadExchangeRates().rates.USD.rateToTwd).toBe(exchangeRatesFixture.rates.USD.rateToTwd);
    expect(localStore.loadFinancialGoals()).toEqual(financialGoalsFixture);
  });

  it("dataSource 預設仍是 localStorage 模式", () => {
    const dataSource = createDataSource({ localStore: createLocalStore() });

    dataSource.saveAssets([assetsFixture[0]]);

    expect(getDefaultDataSourceMode()).toBe("local");
    expect(dataSource.mode).toBe("local");
    expect(dataSource.status.label).toContain("localStorage");
    expect(dataSource.loadAssets()).toEqual([assetsFixture[0]]);
  });

  it("cloudStore 在 fetch API 未設定時會明確失敗，不影響 local 預設", async () => {
    const cloudStore = createCloudStore({ fetcher: null });

    expect(cloudStore.isConfigured()).toBe(false);
    await expect(cloudStore.getAssets()).rejects.toThrow("Cloud data source is not configured");
  });

  it("D1 migration SQL 存在並包含核心 tables", () => {
    const migrationSql = readFileSync(
      new URL("../../migrations/0001_cloud_sync_foundation.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS profiles");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS assets");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS exchange_rates");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS financial_goals");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS asset_snapshots");
  });
});
