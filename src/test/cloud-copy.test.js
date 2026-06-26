import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_JWT_HEADER } from "../../functions/_shared/access.js";
import { getCloudCopyStatus } from "../../functions/_shared/cloud-copy.js";
import { onRequestDelete as onAssetDelete, onRequestPut as onAssetPut } from "../../functions/api/assets/[id].js";
import { onRequestGet as onAssetsGet, onRequestPost as onAssetsPost } from "../../functions/api/assets/index.js";
import { onRequestGet as onCloudStatusGet } from "../../functions/api/cloud-status.js";
import { onRequestGet as onExchangeRatesGet, onRequestPut as onExchangeRatesPut } from "../../functions/api/exchange-rates.js";
import { onRequestGet as onFinancialGoalsGet, onRequestPut as onFinancialGoalsPut } from "../../functions/api/financial-goals.js";
import { onRequestPost as onImportLocalBackupPost } from "../../functions/api/import-local-backup.js";
import { onRequestGet as onSnapshotGet } from "../../functions/api/snapshots/[id].js";
import { onRequestPost as onSnapshotRestorePost } from "../../functions/api/snapshots/[id]/restore.js";
import { onRequestPost as onSnapshotRestorePreviewPost } from "../../functions/api/snapshots/[id]/restore-preview.js";
import { onRequestGet as onSnapshotsGet, onRequestPost as onSnapshotsPost } from "../../functions/api/snapshots/index.js";
import { getCloudModeGateState, previewCloudBackupPayload } from "../utils.js";
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

async function createAuthenticatedRequest(url, { method = "GET", body = null, payloadOverrides = {} } = {}) {
  const { token, jwks } = await createSignedAccessJwt(payloadOverrides);

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
    assetSnapshots: new Map(),
    failSnapshotInsert: false,
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

    if (sql.startsWith("UPDATE assets SET deleted_at") && sql.includes("WHERE user_id = ?")) {
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

    if (sql.startsWith("UPDATE assets SET") && sql.includes("type = ?")) {
      const [
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
        updatedAt,
        id,
        userId,
      ] = values;
      const existing = state.assets.get(id);
      if (existing?.user_id === userId && existing.deleted_at === null) {
        state.assets.set(id, {
          ...existing,
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
          updated_at: updatedAt,
        });
      }
      return { success: true };
    }

    if (sql.startsWith("UPDATE assets SET deleted_at = ?")) {
      const [deletedAt, updatedAt, id, userId] = values;
      const existing = state.assets.get(id);
      if (existing?.user_id === userId && existing.deleted_at === null) {
        existing.deleted_at = deletedAt;
        existing.updated_at = updatedAt;
      }
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

    if (sql.startsWith("INSERT INTO asset_snapshots")) {
      if (state.failSnapshotInsert) throw new Error("snapshot insert failed");

      const [
        id,
        userId,
        snapshotDate,
        netWorthTwd,
        totalAssetsTwd,
        totalLiabilitiesTwd,
        payloadJson,
        createdAt,
      ] = values;

      state.assetSnapshots.set(id, {
        id,
        user_id: userId,
        snapshot_date: snapshotDate,
        net_worth_twd: netWorthTwd,
        total_assets_twd: totalAssetsTwd,
        total_liabilities_twd: totalLiabilitiesTwd,
        payload_json: payloadJson,
        created_at: createdAt,
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

    if (sql.startsWith("SELECT * FROM assets WHERE id = ?")) {
      const [id, userId] = values;
      const row = state.assets.get(id);
      return row?.user_id === userId && row.deleted_at === null ? row : null;
    }

    if (sql.startsWith("SELECT goals_json")) {
      return state.financialGoals.get(values[0]) ?? null;
    }

    if (sql.startsWith("SELECT rates_json")) {
      return (
        state.exchangeRates
          .filter((row) => row.user_id === values[0])
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null
      );
    }

    if (sql.startsWith("SELECT * FROM asset_snapshots WHERE id = ?")) {
      const [id, userId] = values;
      const row = state.assetSnapshots.get(id);
      return row?.user_id === userId ? row : null;
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

    if (sql.startsWith("SELECT id, snapshot_date")) {
      const userId = values[0];
      return {
        results: [...state.assetSnapshots.values()]
          .filter((row) => row.user_id === userId)
          .sort((a, b) => String(b.snapshot_date).localeCompare(String(a.snapshot_date))),
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

  it("replace cloud copy 前會自動建立 before_cloud_import snapshot", async () => {
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
    const response = await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload({ assets: [assetsFixture[0]] })),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);
    const snapshots = [...db.state.assetSnapshots.values()].map((row) => JSON.parse(row.payload_json));

    expect(response.status).toBe(200);
    expect(payload.beforeImportSnapshotId).toBeTruthy();
    expect(snapshots.some((snapshot) => snapshot.reason === "before_cloud_import")).toBe(true);
    expect(snapshots.at(-1).data.assets).toHaveLength(2);
  });

  it("before_cloud_import snapshot 建立失敗時不會覆蓋 D1", async () => {
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
    db.state.failSnapshotInsert = true;

    const response = await onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(createBackupPayload({ assets: [assetsFixture[0]] })),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const activeAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at === null);

    expect(response.status).toBe(500);
    expect(activeAssets).toHaveLength(2);
  });
});

describe("D1 cloud snapshots and guarded restore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importBackup(db, backup = createBackupPayload()) {
    return onImportLocalBackupPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/import-local-backup", {
        method: "POST",
        body: JSON.stringify(backup),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
  }

  async function createManualSnapshot(db, payloadOverrides = {}) {
    const response = await onSnapshotsPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/snapshots", {
        method: "POST",
        body: JSON.stringify({
          reason: "manual",
          label: "Test snapshot",
          user_id: "malicious-user",
          email: "attacker@example.com",
          ...payloadOverrides,
        }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);
    return payload.snapshot;
  }

  it("snapshot endpoints 未登入會回 401", async () => {
    const db = createFakeD1();
    const env = { ...ACCESS_ENV, ASSET_AGENT_DB: db };

    const listResponse = await onSnapshotsGet({ request: new Request("https://asset-agent.test/api/snapshots"), env });
    const createResponse = await onSnapshotsPost({
      request: new Request("https://asset-agent.test/api/snapshots", { method: "POST", body: "{}" }),
      env,
    });
    const getResponse = await onSnapshotGet({
      request: new Request("https://asset-agent.test/api/snapshots/snapshot-1"),
      env,
      params: { id: "snapshot-1" },
    });

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
    expect(getResponse.status).toBe(401);
  });

  it("POST /api/snapshots 驗證後可建立目前 user snapshot，payload 含完整 cloud data 且不含 secrets", async () => {
    const db = createFakeD1();
    await importBackup(db);

    const snapshot = await createManualSnapshot(db);
    const response = await onSnapshotGet({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}`),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });
    const payload = await jsonFromResponse(response);
    const snapshotText = JSON.stringify(payload.snapshot);

    expect(snapshot).toEqual(
      expect.objectContaining({
        reason: "manual",
        label: "Test snapshot",
        assetCount: 2,
      }),
    );
    expect(payload.snapshot).toEqual(
      expect.objectContaining({
        version: "asset-agent-snapshot-v1",
        source: "cloudflare-d1",
        data: expect.objectContaining({
          assets: expect.any(Array),
          financialGoals: expect.any(Object),
          exchangeRates: expect.any(Object),
        }),
      }),
    );
    expect(snapshotText).not.toContain("ACCESS_AUD");
    expect(snapshotText).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(snapshotText).not.toContain("Cf-Access-Jwt-Assertion");
    expect(snapshotText).not.toContain("asset-agent-aud");
  });

  it("GET /api/snapshots 只回 metadata，不回完整 snapshot payload", async () => {
    const db = createFakeD1();
    await importBackup(db);
    await createManualSnapshot(db);

    const response = await onSnapshotsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/snapshots"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(200);
    expect(payload.snapshots).toHaveLength(2);
    expect(payload.snapshots[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        reason: expect.any(String),
        assetCount: expect.any(Number),
        createdAt: expect.any(String),
      }),
    );
    expect(payload.snapshots[0].data).toBeUndefined();
    expect(payload.snapshots[0].snapshot).toBeUndefined();
  });

  it("user A 不能讀 user B snapshot", async () => {
    const db = createFakeD1();
    await importBackup(db);
    const snapshot = await createManualSnapshot(db);

    const response = await onSnapshotGet({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}`, {
        payloadOverrides: {
          sub: "other-user-id",
          email: "other@example.com",
        },
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });

    expect(response.status).toBe(404);
  });

  it("restore-preview 不修改 D1", async () => {
    const db = createFakeD1();
    await importBackup(db);
    const snapshot = await createManualSnapshot(db);
    const snapshotCountBefore = db.state.assetSnapshots.size;

    const response = await onSnapshotRestorePreviewPost({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}/restore-preview`, {
        method: "POST",
        body: "{}",
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(200);
    expect(payload.preview).toEqual(
      expect.objectContaining({
        currentAssetCount: 2,
        snapshotAssetCount: 2,
        restoreStrategy: "replace_cloud_data",
      }),
    );
    expect(db.state.assetSnapshots.size).toBe(snapshotCountBefore);
  });

  it("restore 缺少 confirm RESTORE 時回 400", async () => {
    const db = createFakeD1();
    await importBackup(db);
    const snapshot = await createManualSnapshot(db);

    const response = await onSnapshotRestorePost({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm: "NOPE" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });

    expect(response.status).toBe(400);
  });

  it("restore 前會建立 before_restore snapshot，restore 後 cloud data 與 snapshot 相符", async () => {
    const db = createFakeD1();
    await importBackup(db, createBackupPayload({ assets: [assetsFixture[0]] }));
    const snapshot = await createManualSnapshot(db);
    await importBackup(db, createBackupPayload({ assets: [assetsFixture[1], assetsFixture[2]] }));

    const response = await onSnapshotRestorePost({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm: "RESTORE" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });
    const payload = await jsonFromResponse(response);
    const activeAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at === null);
    const snapshots = [...db.state.assetSnapshots.values()].map((row) => JSON.parse(row.payload_json));

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        restoredAssetCount: 1,
        restoredFinancialGoals: true,
        restoredExchangeRates: true,
        beforeRestoreSnapshotId: expect.any(String),
      }),
    );
    expect(snapshots.some((item) => item.reason === "before_restore")).toBe(true);
    expect(activeAssets).toHaveLength(1);
    expect(activeAssets[0].id).toBe(assetsFixture[0].id);
    expect(db.state.financialGoals.has("verified-user-id")).toBe(true);
    expect(db.state.exchangeRates.filter((row) => row.user_id === "verified-user-id")).toHaveLength(1);
  });

  it("before_restore snapshot 建立失敗時不執行 restore", async () => {
    const db = createFakeD1();
    await importBackup(db, createBackupPayload({ assets: [assetsFixture[0]] }));
    const snapshot = await createManualSnapshot(db);
    await importBackup(db, createBackupPayload({ assets: [assetsFixture[1]] }));
    db.state.failSnapshotInsert = true;

    const response = await onSnapshotRestorePost({
      request: await createAuthenticatedRequest(`https://asset-agent.test/api/snapshots/${snapshot.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm: "RESTORE" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: snapshot.id },
    });
    const activeAssets = [...db.state.assets.values()].filter((asset) => asset.deleted_at === null);

    expect(response.status).toBe(500);
    expect(activeAssets).toHaveLength(1);
    expect(activeAssets[0].id).toBe(assetsFixture[1].id);
  });
});

describe("D1 cloud copy assets, goals, rates, and status", () => {
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

  it("assets CRUD 未驗證 request 都會回 401", async () => {
    const db = createFakeD1();
    const env = {
      ...ACCESS_ENV,
      ASSET_AGENT_DB: db,
    };

    const createResponse = await onAssetsPost({
      request: new Request("https://asset-agent.test/api/assets", {
        method: "POST",
        body: JSON.stringify(assetsFixture[0]),
      }),
      env,
    });
    const updateResponse = await onAssetPut({
      request: new Request("https://asset-agent.test/api/assets/cash-twd-1", {
        method: "PUT",
        body: JSON.stringify(assetsFixture[0]),
      }),
      env,
      params: { id: "cash-twd-1" },
    });
    const deleteResponse = await onAssetDelete({
      request: new Request("https://asset-agent.test/api/assets/cash-twd-1", { method: "DELETE" }),
      env,
      params: { id: "cash-twd-1" },
    });

    expect(createResponse.status).toBe(401);
    expect(updateResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
  });

  it("POST /api/assets 建立 asset，且不信任 body.user_id", async () => {
    const db = createFakeD1();
    const response = await onAssetsPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets", {
        method: "POST",
        body: JSON.stringify({
          ...assetsFixture[0],
          id: "new-cloud-asset",
          amount: 888,
          user_id: "malicious-user",
        }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(201);
    expect(payload.asset).toEqual(
      expect.objectContaining({
        id: "new-cloud-asset",
        amount: 888,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
    expect(db.state.assets.get("new-cloud-asset").user_id).toBe("verified-user-id");
  });

  it("PUT /api/assets/:id 只更新目前 user 的 active asset", async () => {
    const db = createFakeD1();

    await onAssetsPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets", {
        method: "POST",
        body: JSON.stringify({ ...assetsFixture[0], id: "editable-asset" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });

    const response = await onAssetPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets/editable-asset", {
        method: "PUT",
        body: JSON.stringify({ ...assetsFixture[0], id: "ignored-id", amount: 777, user_id: "malicious-user" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: "editable-asset" },
    });
    const payload = await jsonFromResponse(response);

    expect(response.status).toBe(200);
    expect(payload.asset).toEqual(
      expect.objectContaining({
        id: "editable-asset",
        amount: 777,
      }),
    );
    expect(db.state.assets.get("editable-asset").user_id).toBe("verified-user-id");
  });

  it("user A 不能讀寫 user B 的 assets", async () => {
    const db = createFakeD1();
    db.state.assets.set("other-user-asset", {
      id: "other-user-asset",
      user_id: "other-user-id",
      type: "cash",
      name: "他人資料",
      ticker: null,
      currency: "TWD",
      amount: 999,
      amount_value: null,
      shares: null,
      buy_price: null,
      market_price: null,
      market_price_updated_at: null,
      buy_date: null,
      principal: null,
      years: null,
      annual_rate: null,
      start_date: null,
      note: "",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      deleted_at: null,
    });

    const getResponse = await onAssetsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const putResponse = await onAssetPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets/other-user-asset", {
        method: "PUT",
        body: JSON.stringify({ ...assetsFixture[0], amount: 1 }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: "other-user-asset" },
    });
    const deleteResponse = await onAssetDelete({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets/other-user-asset", {
        method: "DELETE",
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: "other-user-asset" },
    });
    const getPayload = await jsonFromResponse(getResponse);

    expect(getPayload.assets).toHaveLength(0);
    expect(putResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    expect(db.state.assets.get("other-user-asset").deleted_at).toBeNull();
  });

  it("DELETE /api/assets/:id 使用 soft delete，GET 不回 deleted assets", async () => {
    const db = createFakeD1();

    await onAssetsPost({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets", {
        method: "POST",
        body: JSON.stringify({ ...assetsFixture[0], id: "delete-me" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });

    const deleteResponse = await onAssetDelete({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets/delete-me", {
        method: "DELETE",
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
      params: { id: "delete-me" },
    });
    const getResponse = await onAssetsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/assets"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const getPayload = await jsonFromResponse(getResponse);

    expect(deleteResponse.status).toBe(200);
    expect(db.state.assets.get("delete-me").deleted_at).toEqual(expect.any(String));
    expect(getPayload.assets.find((asset) => asset.id === "delete-me")).toBeUndefined();
  });

  it("GET financial-goals / exchange-rates 回目前 user 的 D1 data", async () => {
    const db = createFakeD1();
    db.state.financialGoals.set("verified-user-id", {
      id: "goals",
      user_id: "verified-user-id",
      goals_json: JSON.stringify(financialGoalsFixture),
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    });
    db.state.exchangeRates.push({
      id: "rates-old",
      user_id: "verified-user-id",
      rates_json: JSON.stringify({ ...exchangeRatesFixture, fetchedAt: "2026-01-01T00:00:00.000Z" }),
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    db.state.exchangeRates.push({
      id: "rates-new",
      user_id: "verified-user-id",
      rates_json: JSON.stringify(exchangeRatesFixture),
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    });
    db.state.financialGoals.set("other-user-id", {
      id: "other-goals",
      user_id: "other-user-id",
      goals_json: JSON.stringify({ monthlyLivingExpense: 1 }),
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    });

    const goalsResponse = await onFinancialGoalsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/financial-goals"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const ratesResponse = await onExchangeRatesGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/exchange-rates"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const goalsPayload = await jsonFromResponse(goalsResponse);
    const ratesPayload = await jsonFromResponse(ratesResponse);

    expect(goalsResponse.status).toBe(200);
    expect(ratesResponse.status).toBe(200);
    expect(goalsPayload.financialGoals).toEqual(financialGoalsFixture);
    expect(ratesPayload.exchangeRates.fetchedAt).toBe(exchangeRatesFixture.fetchedAt);
  });

  it("GET / PUT financial-goals 未驗證會回 401", async () => {
    const getResponse = await onFinancialGoalsGet({
      request: new Request("https://asset-agent.test/api/financial-goals"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });
    const putResponse = await onFinancialGoalsPut({
      request: new Request("https://asset-agent.test/api/financial-goals", {
        method: "PUT",
        body: JSON.stringify(financialGoalsFixture),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
  });

  it("PUT /api/financial-goals 驗證後可建立 / 更新目前 user goals，且不信任 body.user_id", async () => {
    const db = createFakeD1();
    const firstGoals = {
      ...financialGoalsFixture,
      monthlyLivingExpense: 88000,
      user_id: "malicious-user-id",
      email: "attacker@example.com",
    };
    const secondGoals = {
      ...financialGoalsFixture,
      monthlyLivingExpense: 99000,
      user_id: "other-user-id",
    };

    const createResponse = await onFinancialGoalsPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/financial-goals", {
        method: "PUT",
        body: JSON.stringify(firstGoals),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const updateResponse = await onFinancialGoalsPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/financial-goals", {
        method: "PUT",
        body: JSON.stringify(secondGoals),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const updatePayload = await jsonFromResponse(updateResponse);

    expect(createResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(updatePayload.financialGoals.monthlyLivingExpense).toBe(99000);
    expect(updatePayload.financialGoals.user_id).toBeUndefined();
    expect(db.state.financialGoals.has("verified-user-id")).toBe(true);
    expect(db.state.financialGoals.has("malicious-user-id")).toBe(false);
    expect(db.state.financialGoals.has("other-user-id")).toBe(false);
  });

  it("user A 不能讀寫 user B goals", async () => {
    const db = createFakeD1();
    db.state.financialGoals.set("other-user-id", {
      id: "other-goals",
      user_id: "other-user-id",
      goals_json: JSON.stringify({ ...financialGoalsFixture, monthlyLivingExpense: 1 }),
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    });

    const getResponse = await onFinancialGoalsGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/financial-goals"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const putResponse = await onFinancialGoalsPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/financial-goals", {
        method: "PUT",
        body: JSON.stringify({ ...financialGoalsFixture, monthlyLivingExpense: 123456 }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const getPayload = await jsonFromResponse(getResponse);

    expect(getResponse.status).toBe(200);
    expect(getPayload.financialGoals).toBeNull();
    expect(putResponse.status).toBe(200);
    expect(JSON.parse(db.state.financialGoals.get("other-user-id").goals_json).monthlyLivingExpense).toBe(1);
    expect(JSON.parse(db.state.financialGoals.get("verified-user-id").goals_json).monthlyLivingExpense).toBe(123456);
  });

  it("GET / PUT exchange-rates 未驗證會回 401", async () => {
    const getResponse = await onExchangeRatesGet({
      request: new Request("https://asset-agent.test/api/exchange-rates"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });
    const putResponse = await onExchangeRatesPut({
      request: new Request("https://asset-agent.test/api/exchange-rates", {
        method: "PUT",
        body: JSON.stringify(exchangeRatesFixture),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createFakeD1(),
      },
    });

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
  });

  it("PUT /api/exchange-rates 驗證後可 replace 目前 user exchangeRates，且不信任 body.user_id", async () => {
    const db = createFakeD1();
    db.state.exchangeRates.push({
      id: "rates-old",
      user_id: "verified-user-id",
      rates_json: JSON.stringify({ ...exchangeRatesFixture, fetchedAt: "2026-01-01T00:00:00.000Z" }),
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const nextRates = {
      ...exchangeRatesFixture,
      fetchedAt: "2026-06-20T00:00:00.000Z",
      user_id: "malicious-user-id",
      email: "attacker@example.com",
    };

    const putResponse = await onExchangeRatesPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/exchange-rates", {
        method: "PUT",
        body: JSON.stringify(nextRates),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const putPayload = await jsonFromResponse(putResponse);
    const verifiedRates = db.state.exchangeRates.filter((row) => row.user_id === "verified-user-id");

    expect(putResponse.status).toBe(200);
    expect(putPayload.exchangeRates.fetchedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(putPayload.exchangeRates.user_id).toBeUndefined();
    expect(verifiedRates).toHaveLength(1);
    expect(db.state.exchangeRates.some((row) => row.user_id === "malicious-user-id")).toBe(false);
  });

  it("user A 不能讀寫 user B exchangeRates", async () => {
    const db = createFakeD1();
    db.state.exchangeRates.push({
      id: "other-rates",
      user_id: "other-user-id",
      rates_json: JSON.stringify({ ...exchangeRatesFixture, fetchedAt: "2026-01-01T00:00:00.000Z" }),
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const getResponse = await onExchangeRatesGet({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/exchange-rates"),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const putResponse = await onExchangeRatesPut({
      request: await createAuthenticatedRequest("https://asset-agent.test/api/exchange-rates", {
        method: "PUT",
        body: JSON.stringify({ ...exchangeRatesFixture, fetchedAt: "2026-06-20T00:00:00.000Z" }),
      }),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: db,
      },
    });
    const getPayload = await jsonFromResponse(getResponse);

    expect(getResponse.status).toBe(200);
    expect(getPayload.exchangeRates).toBeNull();
    expect(putResponse.status).toBe(200);
    expect(JSON.parse(db.state.exchangeRates.find((row) => row.user_id === "other-user-id").rates_json).fetchedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(JSON.parse(db.state.exchangeRates.find((row) => row.user_id === "verified-user-id").rates_json).fetchedAt).toBe(
      "2026-06-20T00:00:00.000Z",
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

  it("Cloud Mode gate 需要 cloud copy 與使用者確認，並能顯示已啟用 badge", () => {
    expect(getCloudModeGateState({ cloudCopyStatus: null, acknowledged: true }).canEnable).toBe(false);
    expect(
      getCloudModeGateState({
        cloudCopyStatus: { hasCloudCopy: true, assetCount: 2 },
        acknowledged: false,
      }),
    ).toEqual(
      expect.objectContaining({
        state: "needs-confirmation",
        canEnable: false,
      }),
    );
    expect(
      getCloudModeGateState({
        cloudCopyStatus: { hasCloudCopy: true, assetCount: 2 },
        acknowledged: true,
      }),
    ).toEqual(
      expect.objectContaining({
        state: "ready",
        canEnable: true,
      }),
    );
    expect(
      getCloudModeGateState({
        cloudCopyStatus: { state: "unavailable", hasCloudCopy: true, assetCount: 2 },
        acknowledged: true,
      }).canEnable,
    ).toBe(false);
    expect(getCloudModeGateState({ isCloudMode: true }).badge).toBe("Cloud Mode：已啟用");
  });
});
