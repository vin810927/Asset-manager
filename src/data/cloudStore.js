import { parseAssetStore, parseExchangeRateStore, parseFinancialGoals } from "../utils.js";

const DEFAULT_API_BASE_URL = "/api";

function createCloudStoreError(message) {
  return new Error(`Cloud data source is not configured: ${message}`);
}

function assertPlainSnapshotPayload(payload, label) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} 回應格式不正確。`);
  }

  return payload;
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `Cloud request failed with ${response.status}.`);
  }

  return payload;
}

export function normalizeAssetsResponse(payload) {
  if (Array.isArray(payload)) {
    return {
      assets: parseAssetStore({ assets: payload }).assets,
      error: "",
    };
  }

  if (Array.isArray(payload?.assets)) {
    return {
      assets: parseAssetStore({ assets: payload.assets }).assets,
      error: "",
    };
  }

  return {
    assets: [],
    error: "Cloud Mode 載入失敗：assets 回應格式不正確。",
  };
}

export function normalizeCloudRevisionResponse(payload) {
  const revision = payload?.revision ?? payload;

  if (!revision || typeof revision !== "object" || Array.isArray(revision)) {
    throw new Error("Cloud revision 回應格式不正確。");
  }

  const normalized = {
    assetsUpdatedAt: revision.assetsUpdatedAt ?? null,
    financialGoalsUpdatedAt: revision.financialGoalsUpdatedAt ?? null,
    exchangeRatesUpdatedAt: revision.exchangeRatesUpdatedAt ?? null,
    cloudUpdatedAt: revision.cloudUpdatedAt ?? null,
  };
  const hasInvalidValue = Object.values(normalized).some((value) => value !== null && typeof value !== "string");

  if (hasInvalidValue) {
    throw new Error("Cloud revision 回應格式不正確。");
  }

  return normalized;
}

export function createCloudStore({ apiBaseUrl = DEFAULT_API_BASE_URL, fetcher = globalThis.fetch } = {}) {
  function assertConfigured() {
    if (typeof fetcher !== "function") {
      throw createCloudStoreError("fetch API is unavailable.");
    }
  }

  async function request(path, options = {}) {
    assertConfigured();

    const response = await fetcher(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    return parseJsonResponse(response);
  }

  return {
    mode: "cloud",
    apiBaseUrl,
    status: {
      mode: "cloud",
      label: "Cloudflare D1 雲端資料",
      description: "Cloud Mode 已啟用；assets / financialGoals / exchangeRates 由 D1 read/write 管理，但不做自動雙向同步。",
    },
    isConfigured() {
      return typeof fetcher === "function";
    },
    getHealth() {
      return request("/health");
    },
    getCloudStatus() {
      return request("/cloud-status");
    },
    async getCloudRevision() {
      const payload = await request("/cloud-revision");
      return normalizeCloudRevisionResponse(payload);
    },
    async getAssets() {
      const payload = await request("/assets");
      const result = normalizeAssetsResponse(payload);

      if (result.error) {
        throw new Error(result.error);
      }

      return result.assets;
    },
    async createAsset(asset) {
      const payload = await request("/assets", {
        method: "POST",
        body: JSON.stringify(asset),
      });
      return payload.asset;
    },
    async updateAsset(id, asset) {
      const payload = await request(`/assets/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(asset),
      });
      return payload.asset;
    },
    deleteAsset(id) {
      return request(`/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async getFinancialGoals() {
      const payload = await request("/financial-goals");
      return parseFinancialGoals(payload.financialGoals);
    },
    async updateFinancialGoals(financialGoals) {
      const payload = await request("/financial-goals", {
        method: "PUT",
        body: JSON.stringify(financialGoals),
      });
      return parseFinancialGoals(payload.financialGoals);
    },
    saveFinancialGoals(financialGoals) {
      return this.updateFinancialGoals(financialGoals);
    },
    async getExchangeRates() {
      const payload = await request("/exchange-rates");
      return parseExchangeRateStore(payload.exchangeRates);
    },
    async updateExchangeRates(exchangeRates) {
      const payload = await request("/exchange-rates", {
        method: "PUT",
        body: JSON.stringify(exchangeRates),
      });
      return parseExchangeRateStore(payload.exchangeRates);
    },
    saveExchangeRates(exchangeRates) {
      return this.updateExchangeRates(exchangeRates);
    },
    importLocalBackup(backupPayload) {
      return request("/import-local-backup", {
        method: "POST",
        body: JSON.stringify(backupPayload),
      });
    },
    async listSnapshots() {
      const payload = await request("/snapshots");

      if (!Array.isArray(payload.snapshots)) {
        throw new Error("D1 snapshot list 回應格式不正確。");
      }

      return payload.snapshots;
    },
    async createSnapshot({ reason = "manual", label = "" } = {}) {
      const payload = await request("/snapshots", {
        method: "POST",
        body: JSON.stringify({ reason, label }),
      });

      return assertPlainSnapshotPayload(payload.snapshot, "D1 snapshot");
    },
    async getSnapshot(snapshotId) {
      const payload = await request(`/snapshots/${encodeURIComponent(snapshotId)}`);

      return assertPlainSnapshotPayload(payload.snapshot, "D1 snapshot");
    },
    async getRestorePreview(snapshotId) {
      const payload = await request(`/snapshots/${encodeURIComponent(snapshotId)}/restore-preview`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      return assertPlainSnapshotPayload(payload.preview, "D1 restore preview");
    },
    async restoreSnapshot(snapshotId, { confirm } = {}) {
      const payload = await request(`/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm }),
      });

      const result = assertPlainSnapshotPayload(payload, "D1 restore");

      if (!Number.isFinite(Number(result.restoredAssetCount)) || !result.beforeRestoreSnapshotId) {
        throw new Error("D1 restore 回應格式不正確。");
      }

      return result;
    },
    async loadSnapshot() {
      const [assets, financialGoals, exchangeRates, revision] = await Promise.all([
        this.getAssets(),
        this.getFinancialGoals(),
        this.getExchangeRates(),
        this.getCloudRevision(),
      ]);

      return {
        assets,
        exchangeRates,
        financialGoals,
        revision,
      };
    },
  };
}

export const cloudStore = createCloudStore();
