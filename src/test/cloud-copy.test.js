import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_JWT_HEADER } from "../../functions/_shared/access.js";
import { getCloudCopyStatus } from "../../functions/_shared/cloud-copy.js";
import { onRequestGet as onAssetsGet } from "../../functions/api/assets/index.js";
import { onRequestGet as onCloudStatusGet } from "../../functions/api/cloud-status.js";
import { onRequestPost as onImportLocalBackupPost } from "../../functions/api/import-local-backup.js";
import { previewCloudBackupPayload } from "../utils.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

const ACCESS_ENV = {
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "asset-agent-aud",
};

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonToBase64Url(payload) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

async function createSignedAccessJwt(payloadOverrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const publicJwk = {
    ...jwk,
    kid: "cloud-copy-test-key",
    alg: "RS256",
    use: "sig",
  };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const encodedHeader = jsonToBase64Url({ alg: "RS256", typ: "JWT", kid: publicJwk.kid });
  const encodedPayload = jsonToBase64Url({
    iss: ACCESS_ENV.ACCESS_TEAM_DOMAIN,
    aud: ACCESS_ENV.ACCESS_AUD,
    exp: nowSeconds + 3600,
    nbf: nowSeconds - 60,
    sub: "verified-user-id",
    email: "owner@example.com",
    name: "Asset Owner",
    ...payloadOverrides,
  });
  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);

  return {
    token: `${encodedHeader}.${encodedPayload}.${toBase64Url(signature)}`,
    jwks: { keys: [publicJwk] },
  };
}

async function createAuthenticatedRequest(url, { method = "GET", body = null } = {}) {
  const { token, jwks } = await createSignedAccessJwt();

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } })),
  );

  return new Request(url, {
    method,
    headers: {
      [ACCESS_JWT_HEADER]: token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

function createBackupPayload(overrides = {}) {
  return {
    schemaVersion: 1,
    exportedAt: FIXED_NOW,
    lastCheckedAt: FIXED_NOW,
    assets: [
      {
        ...assetsFixture[0],
        user_id: "malicious-user-id",
      },
      {
        ...assetsFixture.find((asset) => asset.id === "stock-usd"),
      },
    ],
    exchangeRates: exchangeRatesFixture,
    financialGoals: financialGoalsFixture,
    ...overrides,
  };
}

function createFakeD1() {
  const state = {
    profiles: new Map(),
    assets: new Map(),
    financialGoals: new Map(),
    exchangeRates: [],
  };

  function runStatement(sql, values) {
    if (sql.startsWith("INSERT INTO profiles")) {
      const [id, email, displayName, createdAt, updatedAt] = values;
      const existing = state.profiles.get(id);
      state.profiles.set(id, {
        id,
        email,
        display_name: displayName,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }

    if (sql.startsWith("UPDATE assets SET deleted_at")) {
      const [deletedAt, updatedAt, userId] = values;
      for (const row of state.assets.values()) {
        if (row.user_id === userId && row.deleted_at === null) {
          row.deleted_at = deletedAt;
          row.updated_at = updatedAt;
        }
      }
      return { success: true };
    }

    if (sql.startsWith("DELETE FROM financial_goals")) {
      state.financialGoals.delete(values[0]);
      return { success: true };
    }

    if (sql.startsWith("DELETE FROM exchange_rates")) {
      state.exchangeRates = state.exchangeRates.filter((row) => row.user_id !== values[0]);
      return { success: true };
    }

    if (sql.startsWith("INSERT INTO assets")) {
      const [
        id,
        userId,
        type,
        name,
        ticker,
        currency,
        amount,
        amountValue,
        shares,
        buyPrice,
        marketPrice,
        marketPriceUpdatedAt,
        buyDate,
        principal,
        years,
        annualRate,
        startDate,
        note,
        createdAt,
        updatedAt,
      ] = values;
      const existing = state.assets.get(id);
      if (existing && existing.user_id !== userId) return { success: true };

      state.assets.set(id, {
        id,
        user_id: userId,
        type,
        name,
        ticker,
        currency,
        amount,
        amount_value: amountValue,
        shares,
        buy_price: buyPrice,
        market_price: marketPrice,
        market_price_updated_at: marketPriceUpdatedAt,
        buy_date: buyDate,
        principal,
        years,
        annual_rate: annualRate,
        start_date: startDate,
        note,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
        deleted_at: null,
      });
      return { success: true };
    }

    if (sql.startsWith("INSERT INTO financial_goals")) {
      const [id, userId, goalsJson, createdAt, updatedAt] = values;
      state.financialGoals.set(userId, {
        id,
        user_id: userId,
        goals_json: goalsJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }

    if (sql.startsWith("INSERT INTO exchange_rates")) {
      const [
        id,
        userId,
        baseCurrency,
        provider,
        providerUrl,
        providerDocumentationUrl,
        fetchedAt,
        sourceUpdatedAt,
        sourceNextUpdateAt,
        ratesJson,
        createdAt,
        updatedAt,
      ] = values;
      state.exchangeRates.push({
        id,
        user_id: userId,
        base_currency: baseCurrency,
        provider,
        provider_url: providerUrl,
        provider_documentation_url: providerDocumentationUrl,
        fetched_at: fetchedAt,
        source_updated_at: sourceUpdatedAt,
        source_next_update_at: sourceNextUpdateAt,
        rates_json: ratesJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }

    return { success: true };
  }

  function firstStatement(sql, values) {
    if (sql === "SELECT 1 AS ok") return { ok: 1 };

    if (sql.startsWith("SELECT COUNT(*) AS count")) {
      const userId = values[0];
      const activeAssets = [...state.assets.values()].filter((row) => row.user_id === userId && row.deleted_at === null);
      return {
        count: activeAssets.length,
        lastUpdatedAt: activeAssets.map((row) => row.updated_at).sort().at(-1) ?? null,
      };
    }

    if (sql.startsWith("SELECT updated_at FROM financial_goals")) {
      return state.financialGoals.get(values[0]) ?? null;
    }

    if (sql.startsWith("SELECT updated_at FROM exchange_rates")) {
      return (
        state.exchangeRates
          .filter((row) => row.user_id === values[0])
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null
      );
    }

    return null;
  }

  function allStatement(sql, values) {
    if (sql.startsWith("SELECT * FROM assets")) {
      const userId = values[0];
      return {
        results: [...state.assets.values()]
          .filter((row) => row.user_id === userId && row.deleted_at === null)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))),
      };
    }

    return { results: [] };
  }

  return {
    state,
    prepare(sql) {
      const normalizedSql = sql.trim();
      let boundValues = [];

      return {
        bind(...values) {
          boundValues = values;
          return this;
        },
        async run() {
          return runStatement(normalizedSql, boundValues);
        },
        async first() {
          return firstStatement(normalizedSql, boundValues);
        },
        async all() {
          return allStatement(normalizedSql, boundValues);
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

async function jsonFromResponse(response) {
  return response.json();
}

describe("D1 cloud copy import endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未驗證 request 會回 401", async () => {
    const response = await onImportLocalBackupPost({
      request: new Request("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload()),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("invalid JSON 會回 400", async () => {
    const response = await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: "{",
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });

    expect(response.status).toBe(400);
  });

  it("不支援的 schemaVersion 會回 400", async () => {
    const response = await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload({ schemaVersion: 99 })),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });

    expect(response.status).toBe(400);
  });

  it("valid backup 會 upsert profile 並匯入 assets / goals / rates，user_id 只使用 verified JWT user", async () => {
    const db = createFakeD1();
    const response = await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload()),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);
    const activeAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at === null);

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        imported: {
          assets: 2,
          financialGoals: true,
          exchangeRates: true,
        },
        cloudCopyStatus: "created",
        userEmail: "owner@example.com",
      }),
    );
    expect(db.state.profiles.get("verified-user-id").email).toBe("owner@example.com");
    expect(activeAssets).toHaveLength(2);
    expect(activeAssets.every((asset) => asset.user_id === "verified-user-id")).toBe(true);
    expect(activeAssets.every((asset) => asset.user_id !== "malicious-user-id")).toBe(true);
    expect(db.state.financialGoals.has("verified-user-id")).toBe(true);
    expect(db.state.exchangeRates).toHaveLength(1);
  });

  it("replace cloud copy 會 soft delete 未再次匯入的舊 assets", async () => {
    const db = createFakeD1();

    await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload()),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(
          createBackupPayload({
            assets: [
              {
                ...assetsFixture[0],
                amount: 12345,
              },
            ],
          }),
        ),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });

    const activeAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at === null);
    const deletedAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at !== null);

    expect(activeAssets).toHaveLength(1);
    expect(activeAssets[0].id).toBe(assetsFixture[0].id);
    expect(activeAssets[0].amount).toBe(12345);
    expect(deletedAssets).toHaveLength(1);
  });
});

describe("D1 cloud copy read-only assets and status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /api/assets 未驗證會回 401", async () => {
    const response = await onAssetsGet({
      request: new Request("https://asset-agent.test/api/assets"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });

    expect(response.status).toBe(401);
  });

  it("GET /api/assets 驗證後只回目前 user 且排除 deleted assets", async () => {
    const db = createFakeD1();
    db.state.assets.set("active", {
      id: "active",
      user_id: "verified-user-id",
      type: "stock",
      name: null,
      ticker: "AAPL",
      currency: "USD",
      amount: null,
      amount_value: null,
      shares: 2,
      buy_price: 100,
      market_price: 120,
      market_price_updated_at: "2026-06-20",
      buy_date: "2026-06-01",
      principal: null,
      years: null,
      annual_rate: null,
      start_date: null,
      note: "",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      deleted_at: null,
    });
    db.state.assets.set("deleted", {
      ...db.state.assets.get("active"),
      id: "deleted",
      deleted_at: FIXED_NOW,
    });
    db.state.assets.set("other-user", {
      ...db.state.assets.get("active"),
      id: "other-user",
      user_id: "other-user-id",
    });

    const response = await onAssetsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(200);
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toEqual(
      expect.objectContaining({
        id: "active",
        buyPrice: 100,
        annualRate: null,
        startDate: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }),
    );
  });

  it("cloud status 無 cloud copy 時回 hasCloudCopy false", async () => {
    const db = createFakeD1();
    const status = await getCloudCopyStatus(db, {
      id: "verified-user-id",
      sub: "verified-user-id",
      email: "owner@example.com",
    });

    expect(status).toEqual(
      expect.objectContaining({
        hasCloudCopy: false,
        assetCount: 0,
        hasFinancialGoals: false,
        hasExchangeRates: false,
      }),
    );
  });

  it("GET /api/cloud-status 已匯入後回 hasCloudCopy true 與正確 assetCount", async () => {
    const db = createFakeD1();

    await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload()),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });

    const response = await onCloudStatusGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/cloud-status"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        authenticated: true,
        userEmail: "owner@example.com",
        hasCloudCopy: true,
        assetCount: 2,
        hasFinancialGoals: true,
        hasExchangeRates: true,
      }),
    );
  });
});

describe("Cloud backup preview helper", () => {
  it("正確辨識 JSON backup 的 assets / goals / rates", () => {
    const preview = previewCloudBackupPayload(createBackupPayload());

    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        assetCount: 2,
        hasFinancialGoals: true,
        hasExchangeRates: true,
      }),
    );
  });

  it("invalid backup 會回報安全錯誤", () => {
    expect(() => previewCloudBackupPayload({ schemaVersion: 1, assets: [] })).toThrow("financialGoals");
    expect(() => previewCloudBackupPayload({ schemaVersion: 99, assets: [], financialGoals: null, exchangeRates: null })).toThrow(
      "schemaVersion",
    );
  });
});
