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
      label: "Cloudflare D1 雲端同步",
      description: "v0.7 僅建立 API 與資料表基礎，尚未啟用同步。",
    },
    isConfigured() {
      return typeof fetcher === "function";
    },
    getHealth() {
      return request("/health");
    },
    async getAssets() {
      const payload = await request("/assets");
      return payload.assets ?? [];
    },
    createAsset(asset) {
      return request("/assets", {
        method: "POST",
        body: JSON.stringify(asset),
      });
    },
    updateAsset(id, asset) {
      return request(`/assets/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(asset),
      });
    },
    deleteAsset(id) {
      return request(`/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    getFinancialGoals() {
      return request("/financial-goals");
    },
    saveFinancialGoals(financialGoals) {
      return request("/financial-goals", {
        method: "PUT",
        body: JSON.stringify(financialGoals),
      });
    },
    getExchangeRates() {
      return request("/exchange-rates");
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
  };
}

export const cloudStore = createCloudStore();
