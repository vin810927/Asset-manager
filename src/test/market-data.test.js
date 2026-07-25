import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ACCESS_JWT_HEADER } from "../../functions/_shared/access.js";
import {
  buildExchangeRatePreview,
  buildStockPricePreview,
  fetchAlphaVantageLatestClose,
  isMarketDataUpdateEnabled,
  normalizeAlphaVantageDailyClose,
  normalizeExchangeRateApiResponse,
  normalizeExchangeRatePreview,
  normalizeStockPricePreview,
} from "../../functions/_shared/market-data.js";
import { onRequestPost as onExchangeRatePreviewPost } from "../../functions/api/market-data/exchange-rates/preview.js";
import { onRequestPost as onStockPricePreviewPost } from "../../functions/api/market-data/stock-prices/preview.js";
import { createCloudStore } from "../data/cloudStore.js";
import { DATA_SOURCE_MODES, STALE_CLOUD_DATA_ERROR_CODE, createDataSource } from "../data/dataSource.js";
import { createLocalStore } from "../data/localStore.js";
import {
  applyMarketDataPreviewSelection,
  buildExchangeRatePreviewRequest,
  buildStockPricePreviewRequest,
  createMarketDataRequestGate,
  createMarketDataSelection,
  getMarketDataActionState,
  getMarketDataSelectionCounts,
  getStockPreviewRequestSummary,
  isApplicableExchangeRatePreview,
  isApplicablePricePreview,
  isMarketDataUpdateUiEnabled,
} from "../marketData/marketData.js";
import { buildAiReadyReportInput, buildAssetReport, buildMarkdownAssetReport } from "../report/buildAssetReport.js";
import { createExchangeRateStore, formatRate, parseAssetsCsv, parseBackupPayload } from "../utils.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

const ACCESS_ENV = {
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "asset-agent-aud",
};
const MARKET_ENV = {
  ...ACCESS_ENV,
  ENABLE_MARKET_DATA_UPDATE: "true",
  MARKET_DATA_PROVIDER: "mock",
  MARKET_DATA_API_KEY: "test-market-data-key",
};
const REAL_PROVIDER_ENV = {
  ...ACCESS_ENV,
  ENABLE_MARKET_DATA_UPDATE: "true",
  MARKET_DATA_PROVIDER: "alpha_vantage",
  MARKET_DATA_API_KEY: "test-alpha-key",
  EXCHANGE_RATE_API_KEY: "test-rate-key",
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
    kid: "market-data-test-key",
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

async function createAuthenticatedRequest(url, body) {
  const { token, jwks } = await createSignedAccessJwt();

  return {
    request: new Request(url, {
      method: "POST",
      headers: {
        [ACCESS_JWT_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    jwks,
  };
}

function stubAccessFetch(jwks) {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("v1.7 market data preview API", () => {
  it("feature flag disabled 時直接拒絕，且不呼叫外部 provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onExchangeRatePreviewPost({
      request: new Request("https://asset-agent.test/api/market-data/exchange-rates/preview", {
        method: "POST",
        body: JSON.stringify({ baseCurrency: "TWD", currencies: ["USD"] }),
      }),
      env: { ...ACCESS_ENV, MARKET_DATA_API_KEY: "test-market-data-key" },
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Market data update is disabled.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isMarketDataUpdateEnabled({ ENABLE_MARKET_DATA_UPDATE: "false" })).toBe(false);
  });

  it("未登入時回 401", async () => {
    const response = await onStockPricePreviewPost({
      request: new Request("https://asset-agent.test/api/market-data/stock-prices/preview", {
        method: "POST",
        body: JSON.stringify({ holdings: [] }),
      }),
      env: MARKET_ENV,
    });

    expect(response.status).toBe(401);
  });

  it("localhost + LOCAL_DEV_AUTH=true 可通過 market data preview auth，且不讀寫 D1", async () => {
    const d1Binding = {
      prepare() {
        throw new Error("D1 should not be touched by market data preview");
      },
    };
    const env = {
      ...MARKET_ENV,
      LOCAL_DEV_AUTH: "true",
      ASSET_AGENT_DB: d1Binding,
    };

    const exchangeResponse = await onExchangeRatePreviewPost({
      request: new Request("http://localhost:5173/api/market-data/exchange-rates/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Email": "attacker@example.com",
        },
        body: JSON.stringify({ baseCurrency: "TWD", currencies: ["USD"], currentRates: { USD: { rateToTwd: 31.8 } } }),
      }),
      env,
    });
    const exchangePayload = await exchangeResponse.json();

    const stockResponse = await onStockPricePreviewPost({
      request: new Request("http://127.0.0.1:5173/api/market-data/stock-prices/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer fake-user-token",
        },
        body: JSON.stringify({
          holdings: [{ assetId: "asset-1", type: "stock", ticker: "AAPL", market: "US", currency: "USD" }],
        }),
      }),
      env,
    });
    const stockPayload = await stockResponse.json();

    expect(exchangeResponse.status).toBe(200);
    expect(exchangePayload.ratesPreview[0]).toMatchObject({ currency: "USD", status: "ready" });
    expect(stockResponse.status).toBe(200);
    expect(stockPayload.pricePreview[0]).toMatchObject({ assetId: "asset-1", ticker: "AAPL", status: "ready" });
  });

  it("缺 API key 時回可讀錯誤", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/exchange-rates/preview",
      { baseCurrency: "TWD", currencies: ["USD"] },
    );
    stubAccessFetch(jwks);

    const response = await onExchangeRatePreviewPost({
      request,
      env: { ...ACCESS_ENV, ENABLE_MARKET_DATA_UPDATE: "true", MARKET_DATA_PROVIDER: "alpha_vantage" },
    });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("EXCHANGE_RATE_API_KEY");
  });

  it("malformed input 回 400", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/exchange-rates/preview",
      { baseCurrency: "USD", currencies: "USD" },
    );
    stubAccessFetch(jwks);

    const response = await onExchangeRatePreviewPost({ request, env: MARKET_ENV });

    expect(response.status).toBe(400);
  });

  it("匯率 preview 會 normalize old / new / source / fetchedAt", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/exchange-rates/preview",
      { baseCurrency: "TWD", currencies: ["USD"], currentRates: { USD: { rateToTwd: 31.8 } } },
    );
    stubAccessFetch(jwks);

    const response = await onExchangeRatePreviewPost({ request, env: MARKET_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, provider: "mock-market-data", baseCurrency: "TWD" });
    expect(payload.ratesPreview[0]).toMatchObject({
      currency: "USD",
      oldRateToTwd: 31.8,
      newRateToTwd: 31.9,
      status: "ready",
      source: "mock-market-data",
    });
    expect(payload.ratesPreview[0].fetchedAt).toBeTruthy();
  });

  it("ExchangeRate-API adapter 會把 TWD base response normalize 成 rateToTwd", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/exchange-rates/preview",
      { baseCurrency: "TWD", currencies: ["TWD", "USD", "JPY"], currentRates: { USD: { rateToTwd: 31.8 } } },
    );
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
      }

      expect(String(url)).toContain("/latest/TWD");
      expect(String(url)).not.toContain("test-alpha-key");
      return new Response(
        JSON.stringify({
          result: "success",
          base_code: "TWD",
          time_last_update_utc: "Mon, 15 Jun 2026 00:00:01 +0000",
          conversion_rates: {
            TWD: 1,
            USD: 0.03125,
            JPY: 4.7619047619,
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onExchangeRatePreviewPost({ request, env: REAL_PROVIDER_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.provider).toBe("ExchangeRate-API");
    expect(payload.ratesPreview.find((item) => item.currency === "TWD").newRateToTwd).toBe(1);
    expect(payload.ratesPreview.find((item) => item.currency === "USD").newRateToTwd).toBe(32);
    expect(payload.ratesPreview.find((item) => item.currency === "JPY").newRateToTwd).toBeCloseTo(0.21, 5);
    expect(JSON.stringify(payload)).not.toContain("test-rate-key");
  });

  it("ExchangeRate-API fallback base response 也可 normalize 成 rateToTwd", () => {
    const normalized = normalizeExchangeRateApiResponse(
      {
        result: "success",
        base_code: "USD",
        time_last_update_unix: 1781481600,
        conversion_rates: {
          USD: 1,
          TWD: 32,
          JPY: 152,
          EUR: 0.9,
        },
      },
      ["TWD", "USD", "JPY", "EUR"],
    );

    expect(normalized.rates.TWD).toBe(1);
    expect(normalized.rates.USD).toBe(32);
    expect(normalized.rates.JPY).toBeCloseTo(32 / 152, 5);
    expect(normalized.rates.EUR).toBeCloseTo(32 / 0.9, 5);
  });

  it("股票 / ETF preview 會 normalize latest-close 欄位", async () => {
    const holding = {
      assetId: "stock-us-1",
      type: "stock",
      ticker: "AAPL",
      currency: "USD",
      oldMarketPrice: 100,
      buyPrice: 90,
    };
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/stock-prices/preview",
      { holdings: [holding] },
    );
    stubAccessFetch(jwks);

    const response = await onStockPricePreviewPost({ request, env: MARKET_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pricePreview[0]).toMatchObject({
      assetId: "stock-us-1",
      ticker: "AAPL",
      currency: "USD",
      oldMarketPrice: 100,
      newMarketPrice: 101,
      priceCurrency: "USD",
      basis: "latest-close",
      status: "ready",
    });
  });

  it("Alpha Vantage adapter 會 normalize TIME_SERIES_DAILY latest close", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/stock-prices/preview",
      { holdings: [{ assetId: "asset-us-1", type: "stock", ticker: "TEST", currency: "USD", oldMarketPrice: 99 }] },
    );
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
      }

      expect(String(url)).toContain("function=TIME_SERIES_DAILY");
      expect(String(url)).toContain("symbol=TEST");
      return new Response(
        JSON.stringify({
          "Meta Data": { "2. Symbol": "TEST" },
          "Time Series (Daily)": {
            "2026-06-14": { "4. close": "100.00" },
            "2026-06-15": { "4. close": "101.23" },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onStockPricePreviewPost({ request, env: REAL_PROVIDER_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.provider).toBe("Alpha Vantage");
    expect(payload.pricePreview[0]).toMatchObject({
      assetId: "asset-us-1",
      ticker: "TEST",
      newMarketPrice: 101.23,
      priceCurrency: "USD",
      priceDate: "2026-06-15",
      source: "Alpha Vantage",
      basis: "latest-close",
    });
    expect(JSON.stringify(payload)).not.toContain("test-alpha-key");
  });

  it("Alpha Vantage 會依 normalized symbol 去重，序列查詢後映射回每個 assetId", async () => {
    const symbols = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetcher = vi.fn(async (url) => {
      const symbol = new URL(url).searchParams.get("symbol");
      symbols.push(symbol);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;

      return new Response(
        JSON.stringify({
          "Time Series (Daily)": {
            "2099-01-01": { "4. close": symbol === "AAPL" ? "201.25" : "401.50" },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const holdings = [
      { assetId: "aapl-1", type: "stock", ticker: "AAPL", market: "US", currency: "USD" },
      { assetId: "aapl-2", type: "stock", ticker: "aapl", market: "US", currency: "USD" },
      { assetId: "msft-1", type: "stock", ticker: "MSFT", market: "US", currency: "USD" },
    ];
    const result = await fetchAlphaVantageLatestClose({
      env: REAL_PROVIDER_ENV,
      holdings,
      fetcher,
    });

    expect(symbols).toEqual(["AAPL", "MSFT"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(maxActiveRequests).toBe(1);
    expect(result.prices.map((item) => item.assetId)).toEqual(["aapl-1", "aapl-2", "msft-1"]);
    expect(result.prices.filter((item) => item.ticker.toUpperCase() === "AAPL").every((item) => item.newMarketPrice === 201.25)).toBe(
      true,
    );
    expect(result.summary).toEqual({
      attemptedSymbolCount: 2,
      successfulSymbolCount: 2,
      failedSymbolCount: 0,
      skippedSymbolCount: 0,
      providerCallCount: 2,
      stoppedEarly: false,
      stopReason: null,
    });
  });

  it("Alpha Vantage quota 後停止查詢並以 HTTP 200 保留 partial preview", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/stock-prices/preview",
      {
        holdings: [
          { assetId: "aapl-1", type: "stock", ticker: "AAPL", market: "US", currency: "USD" },
          { assetId: "msft-1", type: "stock", ticker: "MSFT", market: "US", currency: "USD" },
          { assetId: "nvda-1", type: "stock", ticker: "NVDA", market: "US", currency: "USD" },
        ],
      },
    );
    const providerSymbols = [];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
      }

      const symbol = new URL(url).searchParams.get("symbol");
      providerSymbols.push(symbol);
      if (symbol === "AAPL") {
        return new Response(
          JSON.stringify({ "Time Series (Daily)": { "2099-01-01": { "4. close": "201.25" } } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (symbol === "MSFT") {
        return new Response(JSON.stringify({ Information: "provider quota message that must not be exposed" }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected provider request for ${symbol}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onStockPricePreviewPost({ request, env: REAL_PROVIDER_ENV });
    const payload = await response.json();
    const byAssetId = Object.fromEntries(payload.pricePreview.map((item) => [item.assetId, item]));

    expect(response.status).toBe(200);
    expect(providerSymbols).toEqual(["AAPL", "MSFT"]);
    expect(byAssetId["aapl-1"]).toMatchObject({ status: "ready", newMarketPrice: 201.25 });
    expect(byAssetId["msft-1"]).toMatchObject({ status: "failed", errorCode: "provider_quota_reached" });
    expect(byAssetId["nvda-1"]).toMatchObject({ status: "needs_review", errorCode: "provider_request_skipped" });
    expect(payload.summary).toEqual({
      attemptedSymbolCount: 2,
      successfulSymbolCount: 1,
      failedSymbolCount: 1,
      skippedSymbolCount: 1,
      providerCallCount: 2,
      stoppedEarly: true,
      stopReason: "provider_quota_reached",
    });
    expect(JSON.stringify(payload)).not.toContain("provider quota message");
    expect(JSON.stringify(payload)).not.toContain("test-alpha-key");
  });

  it("Alpha Vantage rate limit / missing symbol 會回 failed preview，不 crash", () => {
    const holding = { assetId: "asset-us-1", type: "stock", ticker: "TEST", currency: "USD", market: "US" };
    const rateLimited = normalizeAlphaVantageDailyClose({
      holding,
      data: { Note: "Thank you for using Alpha Vantage." },
      fetchedAt: FIXED_NOW,
    });
    const missing = normalizeAlphaVantageDailyClose({
      holding,
      data: { "Error Message": "Invalid API call." },
      fetchedAt: FIXED_NOW,
    });

    expect(rateLimited).toMatchObject({
      status: "failed",
      source: "Alpha Vantage",
      errorCode: "provider_quota_reached",
    });
    expect(rateLimited.message).not.toContain("Thank you for using Alpha Vantage.");
    expect(missing).toMatchObject({ status: "failed", message: "Alpha Vantage 找不到這個 symbol。" });
  });

  it("Alpha Vantage 舊 priceDate 可被標示 needs_review", () => {
    const preview = normalizeStockPricePreview({
      request: {
        holdings: [{ assetId: "asset-us-1", type: "stock", ticker: "TEST", currency: "USD", market: "US", oldMarketPrice: 100 }],
      },
      providerResult: {
        provider: "Alpha Vantage",
        fetchedAt: FIXED_NOW,
        prices: [
          {
            assetId: "asset-us-1",
            ticker: "TEST",
            market: "US",
            priceCurrency: "USD",
            newMarketPrice: 101,
            priceDate: "2020-01-01",
            source: "Alpha Vantage",
            basis: "latest-close",
          },
        ],
      },
    });

    expect(preview.pricePreview[0].status).toBe("needs_review");
    expect(preview.pricePreview[0].message).toContain("收盤價日期偏舊");
  });

  it("TW market 目前回 needs_review / unsupported，不亂接 endpoint", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/stock-prices/preview",
      {
        holdings: [
          { assetId: "asset-tw-1", type: "etf", ticker: "0050", currency: "TWD", oldMarketPrice: 100 },
          { assetId: "asset-unknown-1", type: "stock", ticker: "BAD-TICKER", currency: "USD", oldMarketPrice: 100 },
        ],
      },
    );
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
      }

      throw new Error(`Unexpected provider fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onStockPricePreviewPost({ request, env: REAL_PROVIDER_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pricePreview[0]).toMatchObject({
      market: "TW",
      status: "needs_review",
      message: "目前尚未設定台股收盤價資料來源。",
    });
    expect(payload.pricePreview[1]).toMatchObject({
      market: "unknown",
      status: "needs_review",
      message: "目前尚未設定這個市場的收盤價資料來源。",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("provider failure 不 crash，回 provider adapter 錯誤", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/stock-prices/preview",
      { holdings: [{ assetId: "stock-us-1", type: "stock", ticker: "AAPL", currency: "USD" }] },
    );
    stubAccessFetch(jwks);

    const response = await onStockPricePreviewPost({
      request,
      env: { ...ACCESS_ENV, ENABLE_MARKET_DATA_UPDATE: "true", MARKET_DATA_PROVIDER: "unknown", MARKET_DATA_API_KEY: "key" },
    });
    const payload = await response.json();

    expect(response.status).toBe(501);
    expect(payload.code).toBe("market-data-provider-not-configured");
  });

  it("API 不讀 raw D1 assets、不寫 D1，且 response 不含 secret", async () => {
    const { request, jwks } = await createAuthenticatedRequest(
      "https://asset-agent.test/api/market-data/exchange-rates/preview",
      { baseCurrency: "TWD", currencies: ["USD"], currentRates: { USD: { rateToTwd: 31.8 } } },
    );
    stubAccessFetch(jwks);
    const d1 = {
      prepare() {
        throw new Error("D1 should not be used by market data preview.");
      },
    };

    const response = await onExchangeRatePreviewPost({
      request,
      env: { ...MARKET_ENV, ASSET_AGENT_DB: d1, MARKET_DATA_API_KEY: "super-secret-key" },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("super-secret-key");
    expect(text).not.toContain("ACCESS_AUD");
    expect(text).not.toContain("JWT");
  });

  it("normalize helpers 可回 failed / needs_review preview", () => {
    const exchangePreview = normalizeExchangeRatePreview({
      request: { baseCurrency: "TWD", currencies: ["USD"], currentRates: { USD: { rateToTwd: 31 } } },
      providerResult: { provider: "test", fetchedAt: FIXED_NOW, rates: { USD: 50 } },
    });
    const stockPreview = normalizeStockPricePreview({
      request: {
        holdings: [{ assetId: "tw-etf", type: "etf", ticker: "0050", currency: "USD", market: "TW", oldMarketPrice: 100 }],
      },
      providerResult: {
        provider: "test",
        fetchedAt: FIXED_NOW,
        prices: [{ assetId: "tw-etf", ticker: "0050", newMarketPrice: 101, priceCurrency: "USD", priceDate: "2026-06-15" }],
      },
    });

    expect(exchangePreview.ratesPreview[0].status).toBe("needs_review");
    expect(stockPreview.pricePreview[0].status).toBe("needs_review");
  });

  it("build preview functions 不會輸出 token / secret 欄位", async () => {
    const exchange = await buildExchangeRatePreview({
      body: { baseCurrency: "TWD", currencies: ["USD"], currentRates: { USD: { rateToTwd: 31.8 } } },
      env: MARKET_ENV,
    });
    const stock = await buildStockPricePreview({
      body: { holdings: [{ assetId: "asset-1", type: "stock", ticker: "AAPL", currency: "USD" }] },
      env: MARKET_ENV,
    });
    const text = JSON.stringify({ exchange, stock });

    expect(text).not.toContain("MARKET_DATA_API_KEY");
    expect(text).not.toContain("test-market-data-key");
  });
});

describe("v1.7 market data frontend helpers", () => {
  it("行情更新 actions 使用真正 button，並提供清楚的 fetching / applying 狀態", () => {
    const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
    const idle = getMarketDataActionState({ updateEnabled: true });
    const preview = getMarketDataActionState({ hasPreview: true, updateEnabled: true });
    const fetching = getMarketDataActionState({ hasPreview: true, isChecking: true, selectedCount: 2 });
    const emptyApply = getMarketDataActionState({ hasPreview: true, selectedCount: 0 });
    const readyApply = getMarketDataActionState({ hasPreview: true, selectedCount: 2 });
    const applying = getMarketDataActionState({ hasPreview: true, isApplying: true, selectedCount: 2 });

    expect(appSource).toMatch(/<button[\s\S]{0,180}className="market-data-check-button secondary-action"/);
    expect(appSource).toMatch(/<button[\s\S]{0,180}className="market-data-apply-button primary-action"/);
    expect(idle).toMatchObject({ checkLabel: "檢查行情更新", checkDisabled: false });
    expect(preview.checkLabel).toBe("重新檢查行情");
    expect(fetching).toMatchObject({ checkLabel: "檢查中…", checkDisabled: true, checkAriaBusy: true, applyDisabled: true });
    expect(emptyApply).toMatchObject({ applyLabel: "套用選取更新（0）", applyDisabled: true });
    expect(readyApply).toMatchObject({ applyLabel: "套用選取更新（2）", applyDisabled: false });
    expect(applying).toMatchObject({ applyLabel: "套用中…", applyDisabled: true, applyAriaBusy: true });
  });

  it("market-data preview 兩欄使用自然高度，手機 breakpoint 改為單欄", () => {
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const gridBlock = stylesSource.match(/\.market-data-grid\s*\{([^}]*)\}/)?.[1] ?? "";
    const panelBlock = stylesSource.match(/\.market-data-panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(gridBlock).toContain("align-items: start");
    expect(gridBlock).not.toMatch(/(?:min-)?height\s*:/);
    expect(panelBlock).toContain("align-content: start");
    expect(panelBlock).toContain("min-width: 0");
    expect(panelBlock).not.toMatch(/(?:min-)?height\s*:/);
    expect(stylesSource).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.market-data-grid\s*\{\s*grid-template-columns: 1fr;/);
  });

  it("前端 feature flag 預設停用", () => {
    expect(isMarketDataUpdateUiEnabled({})).toBe(false);
    expect(isMarketDataUpdateUiEnabled({ VITE_ENABLE_MARKET_DATA_UPDATE: "false" })).toBe(false);
    expect(isMarketDataUpdateUiEnabled({ VITE_ENABLE_MARKET_DATA_UPDATE: "true" })).toBe(true);
  });

  it("會建立匯率與股票 preview request，不包含 raw user identity", () => {
    const exchangeRequest = buildExchangeRatePreviewRequest(exchangeRatesFixture);
    const stockRequest = buildStockPricePreviewRequest(assetsFixture);
    const text = JSON.stringify({ exchangeRequest, stockRequest });

    expect(exchangeRequest.baseCurrency).toBe("TWD");
    expect(exchangeRequest.currencies).toContain("USD");
    expect(stockRequest.holdings.every((holding) => ["stock", "etf"].includes(holding.type))).toBe(true);
    expect(text).not.toContain("email");
    expect(text).not.toContain("token");
  });

  it("needsReview 預設不勾，failed 不會被套用", () => {
    const preview = {
      exchangeRates: {
        ratesPreview: [
          { currency: "USD", status: "ready", newRateToTwd: 32 },
          { currency: "JPY", status: "needs_review", newRateToTwd: 0.5 },
          { currency: "EUR", status: "failed", newRateToTwd: null },
        ],
      },
      stockPrices: {
        pricePreview: [
          { assetId: "stock-1", status: "ready", newMarketPrice: 101 },
          { assetId: "stock-2", status: "needs_review", newMarketPrice: 999 },
          { assetId: "stock-3", status: "failed", newMarketPrice: null },
          {
            assetId: "stock-4",
            status: "needs_review",
            errorCode: "provider_request_skipped",
            newMarketPrice: 777,
          },
        ],
      },
    };
    const selection = createMarketDataSelection(preview);

    expect(selection.exchangeRates).toEqual({ USD: true, JPY: false, EUR: false });
    expect(selection.stockPrices).toEqual({ "stock-1": true, "stock-2": false, "stock-3": false, "stock-4": false });
    selection.stockPrices["stock-4"] = true;
    expect(getMarketDataSelectionCounts(preview, selection)).toEqual({ exchangeRateCount: 1, stockPriceCount: 1 });
  });

  it("selection eligibility 只允許有有限正數新值的 ready / unchanged / needsReview 項目", () => {
    const validReviewPrice = { assetId: "price-review", status: "needs_review", newMarketPrice: 333.02, source: "Alpha Vantage" };
    const invalidReviewPrice = { assetId: "price-empty", status: "needs_review", newMarketPrice: null, source: "Alpha Vantage" };
    const unsupportedTw = { assetId: "tw-empty", status: "needs_review", newMarketPrice: null, source: "unsupported" };
    const quotaFailed = {
      assetId: "quota",
      status: "failed",
      errorCode: "provider_quota_reached",
      newMarketPrice: 999,
      source: "Alpha Vantage",
    };
    const skipped = {
      assetId: "skipped",
      status: "needs_review",
      errorCode: "provider_request_skipped",
      newMarketPrice: 999,
      source: "Alpha Vantage",
    };

    expect(isApplicablePricePreview(validReviewPrice)).toBe(true);
    expect(isApplicablePricePreview({ ...validReviewPrice, status: "unchanged" })).toBe(true);
    expect(isApplicablePricePreview(invalidReviewPrice)).toBe(false);
    expect(isApplicablePricePreview(unsupportedTw)).toBe(false);
    expect(isApplicablePricePreview(quotaFailed)).toBe(false);
    expect(isApplicablePricePreview(skipped)).toBe(false);
    expect(isApplicablePricePreview({ ...validReviewPrice, newMarketPrice: 0 })).toBe(false);
    expect(isApplicablePricePreview({ ...validReviewPrice, newMarketPrice: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isApplicableExchangeRatePreview({ currency: "USD", status: "needs_review", newRateToTwd: 32 })).toBe(true);
    expect(isApplicableExchangeRatePreview({ currency: "USD", status: "needs_review", newRateToTwd: "" })).toBe(false);

    const selection = createMarketDataSelection({
      stockPrices: { pricePreview: [validReviewPrice, invalidReviewPrice, unsupportedTw, quotaFailed, skipped] },
    });
    expect(selection.stockPrices).toEqual({
      "price-review": false,
      "price-empty": false,
      "tw-empty": false,
      quota: false,
      skipped: false,
    });
  });

  it("preview refresh 會移除失效 selection，apply count 與 apply 都再次過濾 invalid item", () => {
    const firstPreview = {
      exchangeRates: { ratesPreview: [] },
      stockPrices: { pricePreview: [{ assetId: "stock-1", status: "ready", newMarketPrice: 101, source: "Alpha Vantage" }] },
    };
    const refreshedPreview = {
      exchangeRates: { ratesPreview: [] },
      stockPrices: {
        pricePreview: [
          { assetId: "stock-1", status: "failed", newMarketPrice: null, source: "Alpha Vantage" },
          { assetId: "stock-2", status: "needs_review", newMarketPrice: 202, source: "Alpha Vantage" },
          {
            assetId: "stock-3",
            status: "needs_review",
            errorCode: "provider_request_skipped",
            newMarketPrice: 303,
            source: "Alpha Vantage",
          },
        ],
      },
    };
    const refreshedSelection = createMarketDataSelection(refreshedPreview);
    const injectedSelection = { exchangeRates: {}, stockPrices: { "stock-1": true, "stock-2": true, "stock-3": true } };
    const assets = [
      { id: "stock-1", type: "stock", ticker: "AAPL", shares: 1, buyPrice: 100, marketPrice: 100, currency: "USD" },
      { id: "stock-2", type: "stock", ticker: "MSFT", shares: 1, buyPrice: 100, marketPrice: 100, currency: "USD" },
      { id: "stock-3", type: "stock", ticker: "NVDA", shares: 1, buyPrice: 100, marketPrice: 100, currency: "USD" },
    ];

    expect(createMarketDataSelection(firstPreview).stockPrices["stock-1"]).toBe(true);
    expect(refreshedSelection.stockPrices).toEqual({ "stock-1": false, "stock-2": false, "stock-3": false });
    expect(getMarketDataSelectionCounts(refreshedPreview, injectedSelection)).toEqual({
      exchangeRateCount: 0,
      stockPriceCount: 1,
    });

    const applied = applyMarketDataPreviewSelection({
      assets,
      exchangeRates: exchangeRatesFixture,
      preview: refreshedPreview,
      selection: injectedSelection,
      appliedAt: FIXED_NOW,
    });
    expect(applied.appliedCount).toBe(1);
    expect(applied.assets.find((asset) => asset.id === "stock-1").marketPrice).toBe(100);
    expect(applied.assets.find((asset) => asset.id === "stock-2").marketPrice).toBe(202);
    expect(applied.assets.find((asset) => asset.id === "stock-3").marketPrice).toBe(100);
  });

  it("request gate 在 fetching 期間拒絕第二次 preview request", () => {
    const gate = createMarketDataRequestGate();

    expect(gate.tryStart()).toBe(true);
    expect(gate.isInFlight()).toBe(true);
    expect(gate.tryStart()).toBe(false);
    gate.finish();
    expect(gate.isInFlight()).toBe(false);
    expect(gate.tryStart()).toBe(true);
  });

  it("stock preview summary 會保留成功、失敗、略過與 provider call metadata", () => {
    expect(
      getStockPreviewRequestSummary({
        stockPrices: {
          summary: {
            attemptedSymbolCount: 2,
            successfulSymbolCount: 1,
            failedSymbolCount: 1,
            skippedSymbolCount: 3,
            providerCallCount: 2,
            stoppedEarly: true,
            stopReason: "provider_quota_reached",
          },
        },
      }),
    ).toEqual({
      attemptedSymbolCount: 2,
      successfulSymbolCount: 1,
      failedSymbolCount: 1,
      skippedSymbolCount: 3,
      providerCallCount: 2,
      stoppedEarly: true,
      stopReason: "provider_quota_reached",
    });
  });

  it("ESLint 只忽略 Wrangler 本機產物，不忽略 src 或 functions", async () => {
    const { default: eslintConfig } = await import("../../eslint.config.js");
    const ignoredPatterns = eslintConfig.flatMap((entry) => entry.ignores ?? []);

    expect(ignoredPatterns).toContain(".wrangler/**");
    expect(ignoredPatterns).not.toContain("src/**");
    expect(ignoredPatterns).not.toContain("functions/**");
  });

  it("套用時只更新選取的匯率與市價，不改股數、成本、貸款或現金", () => {
    const stockAsset = { ...assetsFixture.find((asset) => asset.type === "stock"), id: "stock-1", marketPrice: 100 };
    const cashAsset = { ...assetsFixture.find((asset) => asset.type === "cash"), id: "cash-1" };
    const loanAsset = { ...assetsFixture.find((asset) => asset.type === "loan"), id: "loan-1" };
    const preview = {
      exchangeRates: {
        provider: "mock-market-data",
        fetchedAt: FIXED_NOW,
        ratesPreview: [{ currency: "USD", status: "ready", newRateToTwd: 32, fetchedAt: FIXED_NOW }],
      },
      stockPrices: {
        provider: "mock-market-data",
        fetchedAt: FIXED_NOW,
        pricePreview: [
          {
            assetId: "stock-1",
            status: "ready",
            newMarketPrice: 101,
            priceCurrency: stockAsset.currency,
            priceDate: "2026-06-15",
            source: "mock-market-data",
            basis: "latest-close",
          },
        ],
      },
    };
    const result = applyMarketDataPreviewSelection({
      assets: [stockAsset, cashAsset, loanAsset],
      exchangeRates: exchangeRatesFixture,
      preview,
      selection: { exchangeRates: { USD: true }, stockPrices: { "stock-1": true } },
      appliedAt: FIXED_NOW,
    });
    const nextStock = result.assets.find((asset) => asset.id === "stock-1");

    expect(result.exchangeRates.rates.USD.rateToTwd).toBe(32);
    expect(nextStock.marketPrice).toBe(101);
    expect(nextStock.shares).toBe(stockAsset.shares);
    expect(nextStock.buyPrice).toBe(stockAsset.buyPrice);
    expect(result.assets.find((asset) => asset.id === "cash-1")).toEqual(cashAsset);
    expect(result.assets.find((asset) => asset.id === "loan-1")).toEqual(loanAsset);
  });

  it("localStorage mode 可套用 market data helper 後維持 JSON / CSV import 相容", () => {
    const localStore = createLocalStore({
      storage: {
        getItem: () => null,
        setItem: vi.fn(),
      },
    });
    const exchangeRates = createExchangeRateStore({ USD: { rateToTwd: 31.8, source: "manual" } });
    const result = applyMarketDataPreviewSelection({
      assets: assetsFixture,
      exchangeRates,
      preview: {
        exchangeRates: { provider: "mock-market-data", fetchedAt: FIXED_NOW, ratesPreview: [] },
        stockPrices: { provider: "mock-market-data", fetchedAt: FIXED_NOW, pricePreview: [] },
      },
      selection: { exchangeRates: {}, stockPrices: {} },
      appliedAt: FIXED_NOW,
    });

    localStore.saveAssets(result.assets);
    localStore.saveExchangeRates(result.exchangeRates);

    expect(() =>
      parseBackupPayload({
        schemaVersion: 1,
        assets: result.assets,
        exchangeRates: result.exchangeRates,
        financialGoals: financialGoalsFixture,
      }),
    ).not.toThrow();
    expect(parseAssetsCsv("id,type,name,ticker,currency,amount\nasset,cash,Cash,,TWD,100").assets).toHaveLength(1);
  });

  it("cloudStore / dataSource 可呼叫 preview API，且 stale guard 仍保護正式寫入", async () => {
    const calls = [];
    const cloudStore = createCloudStore({
      fetcher: async (url, options = {}) => {
        calls.push({ url, method: options.method ?? "GET", body: options.body });
        if (String(url).endsWith("/market-data/exchange-rates/preview")) {
          return new Response(JSON.stringify({ ok: true, ratesPreview: [] }));
        }
        if (String(url).endsWith("/market-data/stock-prices/preview")) {
          return new Response(JSON.stringify({ ok: true, pricePreview: [] }));
        }
        if (String(url).endsWith("/cloud-revision")) {
          return new Response(
            JSON.stringify({
              ok: true,
              revision: {
                assetsUpdatedAt: "2026-06-20T00:00:00.000Z",
                financialGoalsUpdatedAt: "2026-06-20T00:00:00.000Z",
                exchangeRatesUpdatedAt: "2026-06-20T00:00:00.000Z",
                cloudUpdatedAt:
                  calls.filter((call) => String(call.url).endsWith("/cloud-revision")).length > 1
                    ? "2026-06-21T00:00:00.000Z"
                    : "2026-06-20T00:00:00.000Z",
              },
            }),
          );
        }
        if (String(url).endsWith("/assets/stock-1") && options.method === "PUT") {
          return new Response(JSON.stringify({ ok: true, asset: JSON.parse(options.body) }));
        }
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    const dataSource = createDataSource({
      mode: DATA_SOURCE_MODES.CLOUD,
      cloudStore,
    });

    await expect(dataSource.previewMarketExchangeRates({ baseCurrency: "TWD", currencies: ["USD"] })).resolves.toMatchObject({
      ok: true,
    });
    await dataSource.refreshCloudRevisionBaseline();
    await expect(dataSource.updateAsset("stock-1", { ...assetsFixture[0], id: "stock-1" })).rejects.toMatchObject({
      code: STALE_CLOUD_DATA_ERROR_CODE,
    });
    expect(calls.some((call) => String(call.url).endsWith("/market-data/exchange-rates/preview"))).toBe(true);
    expect(calls.some((call) => String(call.url).endsWith("/market-data/stock-prices/preview"))).toBe(false);
  });

  it("deterministic report / AI-ready JSON / Markdown 可使用更新後市價", () => {
    const updatedAsset = { ...assetsFixture.find((asset) => asset.type === "stock"), marketPrice: 101, marketPriceUpdatedAt: "2026-06-15" };
    const report = buildAssetReport({
      assets: [updatedAsset],
      financialGoals: financialGoalsFixture,
      exchangeRates: exchangeRatesFixture,
      generatedAt: FIXED_NOW,
    });
    const aiReady = buildAiReadyReportInput(report);
    const markdown = buildMarkdownAssetReport(report);

    expect(report.summary.totalAssetsTwd).toBeGreaterThan(0);
    expect(report.dataQuality.missingMarketPriceCount).toBe(0);
    expect(aiReady.purpose).toBe("asset-agent-ai-report-input");
    expect(markdown).toContain("規則型摘要");
    expect(formatRate(42.06452698439406)).toBe("42.064527");
  });
});
