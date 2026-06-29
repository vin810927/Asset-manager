import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createCloudStore, normalizeAssetsResponse, normalizeCloudRevisionResponse } from "../data/cloudStore.js";
import {
  DATA_SOURCE_MODE_STORAGE_KEY,
  DATA_SOURCE_MODES,
  STALE_CLOUD_DATA_ERROR_CODE,
  createDataSource,
  getDefaultDataSourceMode,
  setStoredDataSourceMode,
} from "../data/dataSource.js";
import { createLocalStore } from "../data/localStore.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture } from "./fixtures.js";
import {
  applyFinancialGoalDraftValue,
  buildAttentionItems,
  createFinancialGoalDrafts,
  createExchangeRateStore,
  formatFinancialGoalDraftPreview,
  formatRate,
  getGoalMetrics,
  groupTradedHoldings,
  parseFinancialGoalDraftValue,
  setManualExchangeRate,
  summarizeByCurrency,
  summarizeInBaseCurrency,
  updateFinancialGoalDraft,
} from "../utils.js";

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

  it("設定 cloud mode 後 dataSource 走 cloudStore assets CRUD 與 goals / rates read-write", async () => {
    const calls = [];
    const cloudStore = createCloudStore({
      fetcher: async (url, options = {}) => {
        calls.push({ url, method: options.method ?? "GET", body: options.body });

        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: {
                assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
                financialGoalsUpdatedAt: "2026-06-20T00:00:00.000Z",
                exchangeRatesUpdatedAt: "2026-06-20T00:00:00.000Z",
                cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
              },
            }),
          );
        }

        if (String(url).endsWith("/assets") && !options.method) {
          return new Response(JSON.stringify({ ok: true, assets: [assetsFixture[0]] }));
        }

        if (String(url).endsWith("/assets") && options.method === "POST") {
          return new Response(JSON.stringify({ ok: true, asset: assetsFixture[1] }), { status: 201 });
        }

        if (String(url).endsWith("/assets/cash-twd-1") && options.method === "PUT") {
          return new Response(JSON.stringify({ ok: true, asset: { ...assetsFixture[0], amount: 123 } }));
        }

        if (String(url).endsWith("/financial-goals") && !options.method) {
          return new Response(JSON.stringify({ ok: true, financialGoals: financialGoalsFixture }));
        }

        if (String(url).endsWith("/financial-goals") && options.method === "PUT") {
          return new Response(JSON.stringify({ ok: true, financialGoals: JSON.parse(options.body) }));
        }

        if (String(url).endsWith("/exchange-rates") && !options.method) {
          return new Response(JSON.stringify({ ok: true, exchangeRates: exchangeRatesFixture }));
        }

        if (String(url).endsWith("/exchange-rates") && options.method === "PUT") {
          return new Response(JSON.stringify({ ok: true, exchangeRates: JSON.parse(options.body) }));
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
    await expect(dataSource.saveFinancialGoals({ ...financialGoalsFixture, monthlyLivingExpense: 123 })).resolves.toMatchObject({
      monthlyLivingExpense: 123,
    });
    await expect(dataSource.saveExchangeRates({ ...exchangeRatesFixture, fetchedAt: "2026-06-20T00:00:00.000Z" })).resolves.toMatchObject({
      fetchedAt: "2026-06-20T00:00:00.000Z",
    });
    expect(calls.filter((call) => String(call.url).endsWith("/cloud-revision"))).toHaveLength(10);
    expect(calls.some((call) => String(call.url).endsWith("/assets") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => String(call.url).endsWith("/financial-goals") && call.method === "PUT")).toBe(true);
    expect(calls.some((call) => String(call.url).endsWith("/exchange-rates") && call.method === "PUT")).toBe(true);
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

  it("cloud revision response malformed 時會丟出可讀錯誤", () => {
    expect(() => normalizeCloudRevisionResponse({ revision: { cloudUpdatedAt: 123 } })).toThrow("Cloud revision");
    expect(() => normalizeCloudRevisionResponse({ revision: [] })).toThrow("Cloud revision");
  });

  it("local mode 不會呼叫 cloud revision API", () => {
    const localStore = createLocalStore();
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.LOCAL,
      localStore,
      cloudStore: {
        getCloudRevision: () => {
          throw new Error("should not call cloud revision");
        },
      },
    });

    dataSource.saveAssets([assetsFixture[0]]);
    expect(localStore.loadAssets()).toEqual([assetsFixture[0]]);
  });

  it("local mode 的手動 cloud backup import 不會呼叫 cloud revision API", async () => {
    const importLocalBackup = vi.fn(async () => ({ ok: true, imported: { assets: 1 } }));
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.LOCAL,
      localStore: createLocalStore(),
      cloudStore: {
        importLocalBackup,
        getCloudRevision: () => {
          throw new Error("should not call cloud revision");
        },
      },
    });

    await expect(
      dataSource.importLocalBackup({
        schemaVersion: 1,
        assets: [assetsFixture[0]],
        financialGoals: financialGoalsFixture,
        exchangeRates: exchangeRatesFixture,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(importLocalBackup).toHaveBeenCalledTimes(1);
  });

  it("cloud mode loadSnapshot 會初始化 revision baseline", async () => {
    const revision = {
      assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
      financialGoalsUpdatedAt: null,
      exchangeRatesUpdatedAt: null,
      cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
    };
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      localStore: createLocalStore(),
      cloudStore: {
        status: { label: "Cloudflare D1 雲端資料" },
        async loadSnapshot() {
          return {
            assets: [assetsFixture[0]],
            financialGoals: financialGoalsFixture,
            exchangeRates: exchangeRatesFixture,
            revision,
          };
        },
      },
    });

    await expect(dataSource.loadSnapshot()).resolves.toMatchObject({ assets: [assetsFixture[0]], revision });
    expect(dataSource.getCloudRevisionBaseline()).toEqual(revision);
  });

  it("cloud mode stale revision 會阻止寫入且不污染 localStore", async () => {
    const localStore = createLocalStore();
    localStore.saveAssets([assetsFixture[0]]);
    const createAsset = vi.fn(async () => assetsFixture[1]);
    const oldRevision = {
      assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
      financialGoalsUpdatedAt: null,
      exchangeRatesUpdatedAt: null,
      cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
    };
    const newerRevision = {
      ...oldRevision,
      assetsUpdatedAt: "2026-06-21T00:00:00.000Z",
      cloudUpdatedAt: "2026-06-21T00:00:00.000Z",
    };
    const revisions = [oldRevision, newerRevision];
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      localStore,
      cloudStore: {
        status: { label: "Cloudflare D1 雲端資料" },
        getCloudRevision: async () => revisions.shift() ?? newerRevision,
        createAsset,
      },
    });

    await dataSource.refreshCloudRevisionBaseline();
    await expect(dataSource.createAsset(assetsFixture[1])).rejects.toMatchObject({
      code: STALE_CLOUD_DATA_ERROR_CODE,
    });
    expect(createAsset).not.toHaveBeenCalled();
    expect(localStore.loadAssets()).toEqual([assetsFixture[0]]);
  });

  it("cloud mode 成功寫入後會更新 revision baseline", async () => {
    const oldRevision = {
      assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
      financialGoalsUpdatedAt: null,
      exchangeRatesUpdatedAt: null,
      cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
    };
    const nextRevision = {
      ...oldRevision,
      assetsUpdatedAt: "2026-06-21T00:00:00.000Z",
      cloudUpdatedAt: "2026-06-21T00:00:00.000Z",
    };
    const revisions = [oldRevision, oldRevision, nextRevision, nextRevision, nextRevision];
    const createAsset = vi.fn(async (asset) => asset);
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      localStore: createLocalStore(),
      cloudStore: {
        status: { label: "Cloudflare D1 雲端資料" },
        getCloudRevision: async () => revisions.shift() ?? nextRevision,
        createAsset,
      },
    });

    await dataSource.refreshCloudRevisionBaseline();
    await expect(dataSource.createAsset(assetsFixture[0])).resolves.toEqual(assetsFixture[0]);
    await expect(dataSource.createAsset(assetsFixture[1])).resolves.toEqual(assetsFixture[1]);
    expect(createAsset).toHaveBeenCalledTimes(2);
    expect(dataSource.getCloudRevisionBaseline()).toEqual(nextRevision);
  });

  it("cloud mode assets / goals / rates / import / restore 寫入都會先檢查 revision", async () => {
    const callOrder = [];
    const revision = {
      assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
      financialGoalsUpdatedAt: "2026-06-20T00:00:00.000Z",
      exchangeRatesUpdatedAt: "2026-06-20T00:00:00.000Z",
      cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
    };
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      localStore: createLocalStore(),
      cloudStore: {
        status: { label: "Cloudflare D1 雲端資料" },
        async getCloudRevision() {
          callOrder.push("revision");
          return revision;
        },
        async createAsset(asset) {
          callOrder.push("createAsset");
          return asset;
        },
        async updateAsset(id, asset) {
          callOrder.push("updateAsset");
          return { ...asset, id };
        },
        async deleteAsset(id) {
          callOrder.push("deleteAsset");
          return { ok: true, deleted: true, id };
        },
        async saveFinancialGoals(goals) {
          callOrder.push("saveFinancialGoals");
          return goals;
        },
        async saveExchangeRates(rates) {
          callOrder.push("saveExchangeRates");
          return rates;
        },
        async importLocalBackup(payload) {
          callOrder.push("importLocalBackup");
          return { ok: true, imported: { assets: payload.assets.length } };
        },
        async restoreSnapshot() {
          callOrder.push("restoreSnapshot");
          return { restoredAssetCount: 1, beforeRestoreSnapshotId: "before-1" };
        },
        async loadSnapshot() {
          callOrder.push("loadSnapshot");
          return {
            assets: [assetsFixture[0]],
            financialGoals: financialGoalsFixture,
            exchangeRates: exchangeRatesFixture,
            revision,
          };
        },
      },
    });

    await dataSource.createAsset(assetsFixture[0]);
    await dataSource.updateAsset(assetsFixture[0].id, assetsFixture[0]);
    await dataSource.deleteAsset(assetsFixture[0].id);
    await dataSource.saveFinancialGoals(financialGoalsFixture);
    await dataSource.saveExchangeRates(exchangeRatesFixture);
    await dataSource.importLocalBackup({
      schemaVersion: 1,
      assets: [assetsFixture[0]],
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
    });
    await dataSource.restoreSnapshot("snapshot-1", { confirm: "RESTORE" });

    expect(callOrder).toEqual([
      "revision",
      "createAsset",
      "revision",
      "revision",
      "updateAsset",
      "revision",
      "revision",
      "deleteAsset",
      "revision",
      "revision",
      "saveFinancialGoals",
      "revision",
      "revision",
      "saveExchangeRates",
      "revision",
      "revision",
      "importLocalBackup",
      "revision",
      "revision",
      "restoreSnapshot",
      "revision",
      "loadSnapshot",
    ]);
  });

  it("cloud 寫入失敗不污染 localStore", async () => {
    const localStore = createLocalStore();
    localStore.saveAssets([assetsFixture[0]]);

    const cloudStore = createCloudStore({
      fetcher: async (url) => {
        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: { assetsUpdatedAt: null, financialGoalsUpdatedAt: null, exchangeRatesUpdatedAt: null, cloudUpdatedAt: null },
            }),
          );
        }

        return new Response(JSON.stringify({ ok: false, error: "D1 write failed" }), { status: 500 });
      },
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

  it("local mode goals / rates 仍走 localStore", () => {
    const localStore = createLocalStore();
    const dataSource = createDataSource({ localStore });
    const nextGoals = { ...financialGoalsFixture, monthlyLivingExpense: 222000 };
    const nextRates = { ...exchangeRatesFixture, fetchedAt: "2026-06-20T00:00:00.000Z" };

    dataSource.saveFinancialGoals(nextGoals);
    dataSource.saveExchangeRates(nextRates);

    expect(localStore.loadFinancialGoals().monthlyLivingExpense).toBe(222000);
    expect(localStore.loadExchangeRates().fetchedAt).toBe("2026-06-20T00:00:00.000Z");
  });

  it("cloud goals / rates write failure 不污染 localStore", async () => {
    const localStore = createLocalStore();
    localStore.saveFinancialGoals(financialGoalsFixture);
    localStore.saveExchangeRates(exchangeRatesFixture);

    const cloudStore = createCloudStore({
      fetcher: async (url) => {
        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: { assetsUpdatedAt: null, financialGoalsUpdatedAt: null, exchangeRatesUpdatedAt: null, cloudUpdatedAt: null },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            ok: false,
            error: String(url).includes("financial-goals") ? "D1 goals write failed" : "D1 rates write failed",
          }),
          { status: 500 },
        );
      },
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore,
    });

    await expect(dataSource.saveFinancialGoals({ ...financialGoalsFixture, monthlyLivingExpense: 1 })).rejects.toThrow(
      "D1 goals write failed",
    );
    await expect(dataSource.saveExchangeRates({ ...exchangeRatesFixture, fetchedAt: "2099-01-01T00:00:00.000Z" })).rejects.toThrow(
      "D1 rates write failed",
    );
    expect(localStore.loadFinancialGoals()).toEqual(financialGoalsFixture);
    expect(localStore.loadExchangeRates()).toEqual(exchangeRatesFixture);
  });

  it("cloud mode dashboard 使用 D1 assets + D1 goals + D1 exchangeRates 計算", async () => {
    const cloudGoals = {
      ...financialGoalsFixture,
      monthlyLivingExpense: 200000,
      emergencyMonths: 3,
    };
    const cloudRates = {
      ...exchangeRatesFixture,
      rates: {
        ...exchangeRatesFixture.rates,
        USD: {
          ...exchangeRatesFixture.rates.USD,
          rateToTwd: 40,
        },
      },
    };
    const cloudStore = createCloudStore({
      fetcher: async (url) => {
        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: {
                assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
                financialGoalsUpdatedAt: "2026-06-20T00:00:00.000Z",
                exchangeRatesUpdatedAt: "2026-06-20T00:00:00.000Z",
                cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
              },
            }),
          );
        }

        if (String(url).endsWith("/assets")) {
          return new Response(JSON.stringify({ ok: true, assets: [assetsFixture.find((asset) => asset.id === "cash-usd")] }));
        }

        if (String(url).endsWith("/financial-goals")) {
          return new Response(JSON.stringify({ ok: true, financialGoals: cloudGoals }));
        }

        return new Response(JSON.stringify({ ok: true, exchangeRates: cloudRates }));
      },
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
      localStore: createLocalStore(),
    });

    const snapshot = await dataSource.loadSnapshot();
    const twdSummary = summarizeInBaseCurrency(summarizeByCurrency(snapshot.assets), snapshot.exchangeRates);
    const goalMetrics = getGoalMetrics({
      assets: snapshot.assets,
      exchangeRates: snapshot.exchangeRates,
      financialGoals: snapshot.financialGoals,
    });

    expect(snapshot.financialGoals.monthlyLivingExpense).toBe(200000);
    expect(twdSummary.assets).toBe(200000);
    expect(goalMetrics.emergencyTarget).toBe(600000);
  });

  it("cloudStore 支援 snapshot list / create / get / preview / restore", async () => {
    const calls = [];
    const cloudStore = createCloudStore({
      fetcher: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method ?? "GET", body: options.body });

        if (String(url).endsWith("/snapshots") && !options.method) {
          return new Response(
            JSON.stringify({
              ok: true,
              snapshots: [{ id: "snapshot-1", reason: "manual", assetCount: 1, createdAt: "2026-06-25T00:00:00.000Z" }],
            }),
          );
        }

        if (String(url).endsWith("/snapshots") && options.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              snapshot: { id: "snapshot-2", reason: "manual", assetCount: 1, createdAt: "2026-06-25T00:01:00.000Z" },
            }),
            { status: 201 },
          );
        }

        if (String(url).endsWith("/restore-preview")) {
          return new Response(
            JSON.stringify({
              ok: true,
              preview: {
                currentAssetCount: 2,
                snapshotAssetCount: 1,
                restoreStrategy: "replace_cloud_data",
              },
            }),
          );
        }

        if (String(url).endsWith("/restore")) {
          return new Response(
            JSON.stringify({
              ok: true,
              restoredAssetCount: 1,
              beforeRestoreSnapshotId: "before-restore-1",
            }),
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            snapshot: {
              version: "asset-agent-snapshot-v1",
              createdAt: "2026-06-25T00:00:00.000Z",
              data: { assets: [assetsFixture[0]], financialGoals: financialGoalsFixture, exchangeRates: exchangeRatesFixture },
            },
          }),
        );
      },
    });

    await expect(cloudStore.listSnapshots()).resolves.toHaveLength(1);
    await expect(cloudStore.createSnapshot({ reason: "manual" })).resolves.toMatchObject({ id: "snapshot-2" });
    await expect(cloudStore.getSnapshot("snapshot-1")).resolves.toMatchObject({ version: "asset-agent-snapshot-v1" });
    await expect(cloudStore.getRestorePreview("snapshot-1")).resolves.toMatchObject({
      restoreStrategy: "replace_cloud_data",
    });
    await expect(cloudStore.restoreSnapshot("snapshot-1", { confirm: "RESTORE" })).resolves.toMatchObject({
      restoredAssetCount: 1,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET", "POST", "POST"]);
  });

  it("snapshot API malformed response 會丟出可讀錯誤", async () => {
    const cloudStore = createCloudStore({
      fetcher: async (url) => {
        if (String(url).endsWith("/snapshots")) {
          return new Response(JSON.stringify({ ok: true, items: [] }));
        }

        return new Response(JSON.stringify({ ok: true, restored: true }));
      },
    });

    await expect(cloudStore.listSnapshots()).rejects.toThrow("snapshot list 回應格式不正確");
    await expect(cloudStore.restoreSnapshot("snapshot-1", { confirm: "RESTORE" })).rejects.toThrow(
      "D1 restore 回應格式不正確",
    );
  });

  it("local mode 不會呼叫 cloud snapshot / restore API", async () => {
    const cloudCalls = [];
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.LOCAL,
      localStore: createLocalStore(),
      cloudStore: {
        listSnapshots: () => {
          cloudCalls.push("listSnapshots");
        },
      },
    });

    await expect(dataSource.listSnapshots()).rejects.toThrow("D1 snapshot 只在 Cloud Mode 下可用");
    expect(cloudCalls).toEqual([]);
  });

  it("cloud mode restore 成功後會重新載入 cloud data，且不污染 localStorage", async () => {
    const localStore = createLocalStore();
    localStore.saveAssets([assetsFixture[0]]);
    const cloudStore = createCloudStore({
      fetcher: async (url, options = {}) => {
        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: {
                assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
                financialGoalsUpdatedAt: "2026-06-20T00:00:00.000Z",
                exchangeRatesUpdatedAt: "2026-06-20T00:00:00.000Z",
                cloudUpdatedAt: "2026-06-20T00:00:00.000Z",
              },
            }),
          );
        }

        if (String(url).endsWith("/restore")) {
          return new Response(JSON.stringify({ ok: true, restoredAssetCount: 1, beforeRestoreSnapshotId: "before-1" }));
        }

        if (String(url).endsWith("/assets")) {
          return new Response(JSON.stringify({ ok: true, assets: [assetsFixture[1]] }));
        }

        if (String(url).endsWith("/financial-goals")) {
          return new Response(JSON.stringify({ ok: true, financialGoals: financialGoalsFixture }));
        }

        if (String(url).endsWith("/exchange-rates")) {
          return new Response(JSON.stringify({ ok: true, exchangeRates: exchangeRatesFixture }));
        }

        return new Response(JSON.stringify({ ok: true, snapshot: {}, method: options.method }));
      },
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      localStore,
      cloudStore,
    });

    const restored = await dataSource.restoreSnapshot("snapshot-1", { confirm: "RESTORE" });

    expect(restored.result.restoredAssetCount).toBe(1);
    expect(restored.snapshot.assets).toEqual([assetsFixture[1]]);
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

  it("numeric input draft 可連續輸入完整金額，keypress 不觸發儲存", () => {
    const saveFinancialGoals = vi.fn();
    let drafts = createFinancialGoalDrafts(financialGoalsFixture);

    for (const value of ["4", "40", "400", "4000", "40000", "400000"]) {
      drafts = updateFinancialGoalDraft(drafts, "monthlyLivingExpense", value);
      expect(drafts.monthlyLivingExpense).toBe(value);
    }

    expect(saveFinancialGoals).not.toHaveBeenCalled();

    const applied = applyFinancialGoalDraftValue(financialGoalsFixture, "monthlyLivingExpense", drafts.monthlyLivingExpense);
    expect(applied).toMatchObject({
      ok: true,
      value: 400000,
      financialGoals: expect.objectContaining({ monthlyLivingExpense: 400000 }),
    });
    expect(formatFinancialGoalDraftPreview("monthlyLivingExpense", drafts.monthlyLivingExpense)).toContain("TWD 400,000");
  });

  it("monthlyLivingExpense apply 後才更新 goals，legacy 40 不會自動改成 D1 資料", () => {
    let drafts = createFinancialGoalDrafts(financialGoalsFixture);

    drafts = updateFinancialGoalDraft(drafts, "monthlyLivingExpense", "40");

    expect(financialGoalsFixture.monthlyLivingExpense).toBe(100000);

    const applied = applyFinancialGoalDraftValue(financialGoalsFixture, "monthlyLivingExpense", drafts.monthlyLivingExpense);

    expect(applied.ok).toBe(true);
    expect(applied.financialGoals.monthlyLivingExpense).toBe(40);
  });

  it("percent threshold draft 可連續輸入 90 或 90%，不會在 keypress 中被格式化", () => {
    let drafts = createFinancialGoalDrafts(financialGoalsFixture);

    drafts = updateFinancialGoalDraft(drafts, "stockExposureLimitPercent", "9");
    drafts = updateFinancialGoalDraft(drafts, "stockExposureLimitPercent", "90");

    expect(drafts.stockExposureLimitPercent).toBe("90");
    expect(parseFinancialGoalDraftValue("stockExposureLimitPercent", drafts.stockExposureLimitPercent)).toMatchObject({
      ok: true,
      value: 90,
    });
    expect(parseFinancialGoalDraftValue("stockExposureLimitPercent", "90%")).toMatchObject({ ok: true, value: 90 });
  });

  it("partial numeric draft 可暫存，apply 時才顯示 inline validation", () => {
    let drafts = createFinancialGoalDrafts(financialGoalsFixture);

    drafts = updateFinancialGoalDraft(drafts, "emergencyMonths", "");
    expect(drafts.emergencyMonths).toBe("");
    expect(parseFinancialGoalDraftValue("emergencyMonths", drafts.emergencyMonths)).toMatchObject({
      ok: false,
      error: "請輸入數字。",
    });

    drafts = updateFinancialGoalDraft(drafts, "emergencyMonths", "0.");
    expect(drafts.emergencyMonths).toBe("0.");
    expect(parseFinancialGoalDraftValue("emergencyMonths", drafts.emergencyMonths)).toMatchObject({
      ok: true,
      value: 0,
    });
  });

  it("Cloud Mode draft typing 不觸發 D1 write，apply 後才儲存且 stale guard 仍由 dataSource 執行", async () => {
    const saveFinancialGoals = vi.fn(async (goals) => goals);
    let drafts = createFinancialGoalDrafts(financialGoalsFixture);

    for (const value of ["2", "22", "222", "2220", "22200", "222000"]) {
      drafts = updateFinancialGoalDraft(drafts, "monthlyLivingExpense", value);
    }

    expect(saveFinancialGoals).not.toHaveBeenCalled();

    const applied = applyFinancialGoalDraftValue(financialGoalsFixture, "monthlyLivingExpense", drafts.monthlyLivingExpense);
    await saveFinancialGoals(applied.financialGoals);

    expect(saveFinancialGoals).toHaveBeenCalledTimes(1);
    expect(saveFinancialGoals).toHaveBeenCalledWith(expect.objectContaining({ monthlyLivingExpense: 222000 }));
  });

  it("exchange rate input 使用 decimal mode 與 step any，避免瀏覽器小數 validation tooltip", () => {
    const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

    expect(appSource).toContain('className="exchange-rate-input"');
    expect(appSource).toContain('inputMode="decimal"');
    expect(appSource).toContain('step="any"');
  });

  it("exchange rate 可保存高精度小數，摘要顯示不輸出過長小數", () => {
    const highPrecisionRate = 42.06452698439406;
    const store = createExchangeRateStore({ USD: { rateToTwd: 31.8796 }, JPY: { rateToTwd: 0.196991 } });
    const nextStore = setManualExchangeRate(store, "USD", highPrecisionRate);

    expect(nextStore.rates.USD.rateToTwd).toBe(highPrecisionRate);
    expect(formatRate(highPrecisionRate)).toBe("42.064527");
    expect(formatRate(0.196991)).toBe("0.196991");
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
