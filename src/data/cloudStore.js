import { parseExchangeRateStore, parseFinancialGoals } from "../utils.js";

const DEFAULT_API_BASE_URL = "/api";

function createCloudStoreError(message) {
  return new Error(`Cloud data source is not configured: ${message}`);
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `Cloud request failed with ${response.status}.`);
  }

  return payload;
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
      description: "Cloud Mode 已啟用；D1 是主資料源，但不做自動雙向同步。",
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
    async getAssets() {
      const payload = await request("/assets");
      return payload.assets ?? [];
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
    saveFinancialGoals(financialGoals) {
      return request("/financial-goals", {
        method: "PUT",
        body: JSON.stringify(financialGoals),
      });
    },
    async getExchangeRates() {
      const payload = await request("/exchange-rates");
      return parseExchangeRateStore(payload.exchangeRates);
    },
    saveExchangeRates(exchangeRates) {
      return request("/exchange-rates", {
        method: "PUT",
        body: JSON.stringify(exchangeRates),
      });
    },
    importLocalBackup(backupPayload) {
      return request("/import-local-backup", {
        method: "POST",
        body: JSON.stringify(backupPayload),
      });
    },
    async loadSnapshot() {
      const [assets, financialGoals, exchangeRates] = await Promise.all([
        this.getAssets(),
        this.getFinancialGoals(),
        this.getExchangeRates(),
      ]);

      return {
        assets,
        exchangeRates,
        financialGoals,
      };
    },
  };
}

export const cloudStore = createCloudStore();
