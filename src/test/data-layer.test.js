import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createCloudStore, normalizeAssetsResponse } from "../data/cloudStore.js";
import {
  DATA_SOURCE_MODE_STORAGE_KEY,
  DATA_SOURCE_MODES,
  createDataSource,
  getDefaultDataSourceMode,
  setStoredDataSourceMode,
} from "../data/dataSource.js";
import { createLocalStore } from "../data/localStore.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture } from "./fixtures.js";
import { buildAttentionItems, groupTradedHoldings, summarizeByCurrency } from "../utils.js";

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

  it("dataSourceMode 會存在 localStorage，但預設缺值仍是 local", () => {
    expect(getDefaultDataSourceMode()).toBe(DATA_SOURCE_MODES.LOCAL);

    setStoredDataSourceMode(DATA_SOURCE_MODES.CLOUD);

    expect(globalThis.localStorage.getItem(DATA_SOURCE_MODE_STORAGE_KEY)).toBe(DATA_SOURCE_MODES.CLOUD);
    expect(getDefaultDataSourceMode()).toBe(DATA_SOURCE_MODES.CLOUD);
  });

  it("cloudStore 在 fetch API 未設定時會明確失敗，不影響 local 預設", async () => {
    const cloudStore = createCloudStore({ fetcher: null });

    expect(cloudStore.isConfigured()).toBe(false);
    await expect(cloudStore.getAssets()).rejects.toThrow("Cloud data source is not configured");
  });

  it("cloudStore 會把 { ok, assets } response normalize 成 assets array", async () => {
    const normalized = normalizeAssetsResponse({ ok: true, assets: [assetsFixture[0]] });
    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify({ ok: true, assets: [assetsFixture[0]] })),
    });

    expect(normalized.assets).toEqual([assetsFixture[0]]);
    expect(normalized.error).toBe("");
    await expect(cloudStore.getAssets()).resolves.toEqual([assetsFixture[0]]);
  });

  it("cloudStore 仍可處理直接回傳 array 的 assets response", async () => {
    const normalized = normalizeAssetsResponse([assetsFixture[0]]);
    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify([assetsFixture[0]])),
    });

    expect(normalized.assets).toEqual([assetsFixture[0]]);
    expect(normalized.error).toBe("");
    await expect(cloudStore.getAssets()).resolves.toEqual([assetsFixture[0]]);
  });

  it("cloudStore 遇到 malformed assets response 會回報可讀錯誤而不是傳出 object", async () => {
    const normalized = normalizeAssetsResponse({ ok: true, items: [assetsFixture[0]] });
    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify({ ok: true, items: [assetsFixture[0]] })),
    });

    expect(normalized.assets).toEqual([]);
    expect(normalized.error).toContain("assets 回應格式不正確");
    await expect(cloudStore.getAssets()).rejects.toThrow("assets 回應格式不正確");
  });

  it("設定 cloud mode 後 dataSource 走 cloudStore assets CRUD 與 goals / rates read", async () => {
    const calls = [];
    const cloudStore = createCloudStore({
      fetcher: async (url, options = {}) => {
        calls.push({ url, method: options.method ?? "GET", body: options.body });

        if (String(url).endsWith("/assets") && !options.method) {
          return new Response(JSON.stringify({ ok: true, assets: [assetsFixture[0]] }));
        }

        if (String(url).endsWith("/assets") && options.method === "POST") {
          return new Response(JSON.stringify({ ok: true, asset: assetsFixture[1] }), { status: 201 });
        }

        if (String(url).endsWith("/assets/cash-twd-1") && options.method === "PUT") {
          return new Response(JSON.stringify({ ok: true, asset: { ...assetsFixture[0], amount: 123 } }));
        }

        if (String(url).endsWith("/financial-goals")) {
          return new Response(JSON.stringify({ ok: true, financialGoals: financialGoalsFixture, readOnly: true }));
        }

        if (String(url).endsWith("/exchange-rates")) {
          return new Response(JSON.stringify({ ok: true, exchangeRates: exchangeRatesFixture, readOnly: true }));
        }

        return new Response(JSON.stringify({ ok: true, deleted: true, id: "cash-twd-1" }));
      },
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore: createLocalStore(),
    });

    expect(dataSource.mode).toBe(DATA_SOURCE_MODES.CLOUD);
    await expect(dataSource.loadAssets()).resolves.toEqual([assetsFixture[0]]);
    await expect(dataSource.createAsset(assetsFixture[1])).resolves.toEqual(assetsFixture[1]);
    await expect(dataSource.updateAsset("cash-twd-1", assetsFixture[0])).resolves.toMatchObject({ amount: 123 });
    await expect(dataSource.deleteAsset("cash-twd-1")).resolves.toMatchObject({ deleted: true });
    await expect(dataSource.loadFinancialGoals()).resolves.toEqual(financialGoalsFixture);
    await expect(dataSource.loadExchangeRates()).resolves.toEqual(exchangeRatesFixture);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "PUT", "DELETE", "GET", "GET"]);
  });

  it("dataSource cloud mode 的 loadAssets 永遠輸出 array", async () => {
    const cloudStore = {
      mode: "cloud",
      status: { label: "Cloudflare D1 雲端資料" },
      getAssets: async () => ({ ok: true, assets: [assetsFixture[0]] }),
    };
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore: createLocalStore(),
    });

    await expect(dataSource.loadAssets()).resolves.toEqual([assetsFixture[0]]);
  });

  it("cloud 寫入失敗不污染 localStore", async () => {
    const localStore = createLocalStore();
    localStore.saveAssets([assetsFixture[0]]);

    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify({ ok: false, error: "D1 write failed" }), { status: 500 }),
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore,
    });

    await expect(dataSource.createAsset(assetsFixture[1])).rejects.toThrow("D1 write failed");
    expect(localStore.loadAssets()).toEqual([assetsFixture[0]]);
  });

  it("cloud 載入格式錯誤不污染 localStore", async () => {
    const localStore = createLocalStore();
    localStore.saveAssets([assetsFixture[0]]);

    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify({ ok: true, items: [assetsFixture[1]] })),
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore,
    });

    await expect(dataSource.loadAssets()).rejects.toThrow("assets 回應格式不正確");
    expect(localStore.loadAssets()).toEqual([assetsFixture[0]]);
  });

  it("cloudStore request error 可被 UI 捕捉", async () => {
    const cloudStore = createCloudStore({
      fetcher: async () => new Response(JSON.stringify({ ok: false, error: "Access token expired" }), { status: 401 }),
    });

    await expect(cloudStore.getAssets()).rejects.toThrow("Access token expired");
  });

  it("dashboard helpers 遇到非 array assets 不會因 .filter crash", () => {
    expect(groupTradedHoldings({ ok: true, assets: assetsFixture })).toEqual([]);
    expect(summarizeByCurrency({ ok: true, assets: assetsFixture })).toEqual([]);
    expect(() =>
      buildAttentionItems({
        assets: { ok: true, assets: assetsFixture },
        exchangeRates: exchangeRatesFixture,
        financialGoals: financialGoalsFixture,
      }),
    ).not.toThrow();
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
