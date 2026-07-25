import { createHttpError } from "./http.js";

const BASE_CURRENCY = "TWD";
const TRADED_TYPES = new Set(["stock", "etf"]);
const MARKET_DATA_DISABLED_ERROR = "market-data-disabled";
const MARKET_DATA_PROVIDER_NOT_CONFIGURED = "market-data-provider-not-configured";
const MARKET_DATA_API_KEY_MISSING = "market-data-api-key-missing";
const MAX_REVIEW_CHANGE_PERCENT = 20;
const MAX_PRICE_AGE_DAYS = 7;
const EXCHANGE_RATE_API_BASE_URL = "https://v6.exchangerate-api.com/v6";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_PROVIDER = "Alpha Vantage";
const PROVIDER_QUOTA_REACHED = "provider_quota_reached";
const PROVIDER_REQUEST_SKIPPED = "provider_request_skipped";
const MOCK_RATES_TO_TWD = {
  TWD: 1,
  USD: 31.9,
  JPY: 0.21,
  EUR: 34.2,
  GBP: 40.5,
  AUD: 20.8,
  CAD: 23.2,
  HKD: 4.08,
  SGD: 23.8,
  CNY: 4.4,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeCurrency(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeTicker(value) {
  return normalizeText(value).toUpperCase();
}

function getNowIso() {
  return new Date().toISOString();
}

function getChangePercent(oldValue, newValue) {
  if (!Number.isFinite(oldValue) || oldValue <= 0 || !Number.isFinite(newValue)) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

function isOlderThanDays(value, days) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > days * 24 * 60 * 60 * 1000;
}

function inferMarketFromTicker(ticker) {
  if (/^\d+$/.test(ticker)) return "TW";
  if (/^[A-Z.]+$/.test(ticker)) return "US";
  return "unknown";
}

function getCurrentRateToTwd(currentRates, currency) {
  const source = currentRates?.rates ?? currentRates ?? {};
  return toNumberOrNull(source?.[currency]?.rateToTwd ?? source?.[currency]?.rate ?? source?.[currency]);
}

function getProviderKey(env, kind) {
  const key = kind === "exchange-rates" ? normalizeText(env.EXCHANGE_RATE_API_KEY) : normalizeText(env.MARKET_DATA_API_KEY);

  if (!key) {
    throw createHttpError(
      kind === "exchange-rates"
        ? "EXCHANGE_RATE_API_KEY is not configured."
        : "MARKET_DATA_API_KEY is not configured.",
      503,
      MARKET_DATA_API_KEY_MISSING,
    );
  }

  return key;
}

export function isMarketDataUpdateEnabled(env = {}) {
  return normalizeText(env.ENABLE_MARKET_DATA_UPDATE) === "true";
}

export function assertMarketDataUpdateEnabled(env = {}) {
  if (!isMarketDataUpdateEnabled(env)) {
    throw createHttpError("Market data update is disabled.", 403, MARKET_DATA_DISABLED_ERROR);
  }
}

export function normalizeExchangeRatePreviewRequest(payload) {
  if (!isPlainObject(payload)) {
    throw createHttpError("Exchange-rate preview payload must be an object.", 400, "invalid-market-data-payload");
  }

  const baseCurrency = normalizeCurrency(payload.baseCurrency || BASE_CURRENCY);
  if (baseCurrency !== BASE_CURRENCY) {
    throw createHttpError("Only TWD base currency is supported.", 400, "invalid-market-data-base-currency");
  }

  if (!Array.isArray(payload.currencies)) {
    throw createHttpError("Exchange-rate preview currencies must be an array.", 400, "invalid-market-data-payload");
  }

  const currencies = [...new Set(payload.currencies.map(normalizeCurrency).filter((currency) => /^[A-Z]{3}$/.test(currency)))];

  return {
    baseCurrency,
    currencies,
    currentRates: isPlainObject(payload.currentRates) ? payload.currentRates : {},
  };
}

export function normalizeStockPricePreviewRequest(payload) {
  if (!isPlainObject(payload)) {
    throw createHttpError("Stock-price preview payload must be an object.", 400, "invalid-market-data-payload");
  }

  if (!Array.isArray(payload.holdings)) {
    throw createHttpError("Stock-price preview holdings must be an array.", 400, "invalid-market-data-payload");
  }

  const holdings = payload.holdings
    .filter(isPlainObject)
    .map((holding) => {
      const ticker = normalizeTicker(holding.ticker);
      const type = normalizeText(holding.type);
      const inferredMarket = ticker ? inferMarketFromTicker(ticker) : "unknown";

      return {
        assetId: normalizeText(holding.assetId || holding.id),
        type,
        name: normalizeText(holding.name),
        ticker,
        market: normalizeText(holding.market).toUpperCase() || inferredMarket,
        exchange: normalizeText(holding.exchange),
        currency: normalizeCurrency(holding.currency || "TWD"),
        oldMarketPrice: toNumberOrNull(holding.oldMarketPrice ?? holding.marketPrice),
        buyPrice: toNumberOrNull(holding.buyPrice),
      };
    })
    .filter((holding) => holding.assetId && TRADED_TYPES.has(holding.type));

  return { holdings };
}

function createMockMarketDataProvider() {
  return {
    name: "mock-market-data",
    async fetchExchangeRates({ currencies }) {
      const fetchedAt = getNowIso();

      return {
        provider: "mock-market-data",
        fetchedAt,
        sourceUpdatedAt: fetchedAt,
        rates: Object.fromEntries(currencies.map((currency) => [currency, MOCK_RATES_TO_TWD[currency] ?? null])),
      };
    },
    async fetchStockPrices({ holdings }) {
      const fetchedAt = getNowIso();
      const priceDate = fetchedAt.slice(0, 10);

      return {
        provider: "mock-market-data",
        fetchedAt,
        prices: holdings.map((holding) => {
          const basisPrice = holding.oldMarketPrice ?? holding.buyPrice ?? 100;
          const newMarketPrice = Number((basisPrice * 1.01).toFixed(4));

          return {
            assetId: holding.assetId,
            ticker: holding.ticker,
            market: holding.market,
            exchange: holding.exchange,
            currency: holding.currency,
            priceCurrency: holding.currency,
            newMarketPrice,
            priceDate,
            source: "mock-market-data",
            basis: "latest-close",
          };
        }),
      };
    },
  };
}

function normalizeExchangeRateApiRates(data, currencies) {
  const baseCode = normalizeCurrency(data?.base_code || data?.base || data?.baseCurrency);
  const conversionRates = data?.conversion_rates ?? data?.rates;

  if (!baseCode || !isPlainObject(conversionRates)) {
    throw createHttpError("ExchangeRate-API response format is invalid.", 502, "invalid-exchange-rate-response");
  }

  const baseToTwd = baseCode === BASE_CURRENCY ? 1 : toNumberOrNull(conversionRates[BASE_CURRENCY]);
  if (!Number.isFinite(baseToTwd) || baseToTwd <= 0) {
    throw createHttpError("ExchangeRate-API response does not include TWD conversion.", 502, "invalid-exchange-rate-response");
  }

  const rates = { [BASE_CURRENCY]: 1 };
  for (const currency of currencies) {
    if (currency === BASE_CURRENCY) {
      rates[currency] = 1;
      continue;
    }

    if (currency === baseCode) {
      rates[currency] = baseToTwd;
      continue;
    }

    const baseToCurrency = toNumberOrNull(conversionRates[currency]);
    rates[currency] = baseToCurrency && baseToCurrency > 0 ? baseToTwd / baseToCurrency : null;
  }

  return rates;
}

export function normalizeExchangeRateApiResponse(data, currencies) {
  const fetchedAt = getNowIso();
  const sourceUpdatedAt =
    typeof data?.time_last_update_utc === "string"
      ? data.time_last_update_utc
      : data?.time_last_update_unix
        ? new Date(Number(data.time_last_update_unix) * 1000).toISOString()
        : fetchedAt;
  const sourceNextUpdateAt =
    typeof data?.time_next_update_utc === "string"
      ? data.time_next_update_utc
      : data?.time_next_update_unix
        ? new Date(Number(data.time_next_update_unix) * 1000).toISOString()
        : null;

  return {
    provider: "ExchangeRate-API",
    fetchedAt,
    sourceUpdatedAt,
    sourceNextUpdateAt,
    rates: normalizeExchangeRateApiRates(data, currencies),
  };
}

async function fetchExchangeRateApiLatest({ env, currencies, fetcher = globalThis.fetch }) {
  const apiKey = getProviderKey(env, "exchange-rates");
  if (typeof fetcher !== "function") {
    throw createHttpError("Market data fetch is unavailable.", 503, "market-data-fetch-unavailable");
  }

  async function fetchBase(baseCurrency) {
    const response = await fetcher(`${EXCHANGE_RATE_API_BASE_URL}/${encodeURIComponent(apiKey)}/latest/${baseCurrency}`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw createHttpError(`ExchangeRate-API request failed with ${response.status}.`, 502, "exchange-rate-provider-failed");
    }

    if (data?.result && data.result !== "success") {
      const errorType = normalizeText(data["error-type"] || data.error || "provider error");
      const status = errorType === "unsupported-code" ? 400 : 502;
      throw createHttpError(`ExchangeRate-API request failed: ${errorType}.`, status, "exchange-rate-provider-failed");
    }

    return data;
  }

  try {
    return normalizeExchangeRateApiResponse(await fetchBase(BASE_CURRENCY), currencies);
  } catch (error) {
    if (error?.message?.includes("unsupported-code")) {
      return normalizeExchangeRateApiResponse(await fetchBase("USD"), currencies);
    }

    throw error;
  }
}

function normalizeAlphaVantageDailyResponse({ holding, data, fetchedAt = getNowIso() }) {
  if (data?.Note || data?.Information) {
    return {
      assetId: holding.assetId,
      ticker: holding.ticker,
      market: "US",
      currency: holding.currency,
      priceCurrency: "USD",
      source: ALPHA_VANTAGE_PROVIDER,
      basis: "latest-close",
      status: "failed",
      errorCode: PROVIDER_QUOTA_REACHED,
      message: "Alpha Vantage 查詢額度或頻率限制已達，本次已停止後續查詢，請稍後再試。",
    };
  }

  if (data?.["Error Message"]) {
    return {
      assetId: holding.assetId,
      ticker: holding.ticker,
      market: "US",
      currency: holding.currency,
      priceCurrency: "USD",
      source: ALPHA_VANTAGE_PROVIDER,
      basis: "latest-close",
      status: "failed",
      message: "Alpha Vantage 找不到這個 symbol。",
    };
  }

  const series = data?.["Time Series (Daily)"];
  if (!isPlainObject(series)) {
    return {
      assetId: holding.assetId,
      ticker: holding.ticker,
      market: "US",
      currency: holding.currency,
      priceCurrency: "USD",
      source: ALPHA_VANTAGE_PROVIDER,
      basis: "latest-close",
      status: "failed",
      message: "Alpha Vantage 未回傳 daily close 資料。",
    };
  }

  const latestDate = Object.keys(series).sort().reverse()[0];
  const latestRow = latestDate ? series[latestDate] : null;
  const close = toNumberOrNull(latestRow?.["4. close"] ?? latestRow?.close);

  if (!Number.isFinite(close) || close <= 0) {
    return {
      assetId: holding.assetId,
      ticker: holding.ticker,
      market: "US",
      currency: holding.currency,
      priceCurrency: "USD",
      source: ALPHA_VANTAGE_PROVIDER,
      basis: "latest-close",
      status: "failed",
      message: "Alpha Vantage daily close 不是有效正數。",
    };
  }

  return {
    assetId: holding.assetId,
    ticker: holding.ticker,
    market: "US",
    exchange: holding.exchange,
    currency: holding.currency,
    priceCurrency: "USD",
    newMarketPrice: close,
    priceDate: latestDate,
    source: ALPHA_VANTAGE_PROVIDER,
    fetchedAt,
    basis: "latest-close",
  };
}

export function normalizeAlphaVantageDailyClose({ holding, data, fetchedAt }) {
  return normalizeAlphaVantageDailyResponse({ holding, data, fetchedAt });
}

function getAlphaVantageLookupKey(holding) {
  return [ALPHA_VANTAGE_PROVIDER, "US", normalizeTicker(holding.ticker), "USD"].join("|").toUpperCase();
}

function mapAlphaVantageResultToHolding(result, holding) {
  return {
    ...result,
    assetId: holding.assetId,
    ticker: holding.ticker,
    exchange: holding.exchange,
    currency: holding.currency,
  };
}

function createUnsupportedHoldingResult(holding) {
  const isTwMarket = holding.market === "TW";

  return {
    assetId: holding.assetId,
    ticker: holding.ticker,
    market: isTwMarket ? "TW" : holding.market || "unknown",
    exchange: holding.exchange,
    currency: holding.currency,
    priceCurrency: holding.currency,
    source: "unsupported",
    basis: "latest-close",
    status: "needs_review",
    message: isTwMarket
      ? "目前尚未設定台股收盤價資料來源。"
      : "目前尚未設定這個市場的收盤價資料來源。",
  };
}

function createSkippedHoldingResult(holding) {
  return {
    assetId: holding.assetId,
    ticker: holding.ticker,
    market: "US",
    exchange: holding.exchange,
    currency: holding.currency,
    priceCurrency: "USD",
    source: ALPHA_VANTAGE_PROVIDER,
    basis: "latest-close",
    status: "needs_review",
    errorCode: PROVIDER_REQUEST_SKIPPED,
    message: "前一個查詢已達 provider 額度限制，本次未送出這個 symbol，請稍後手動重試。",
  };
}

export async function fetchAlphaVantageLatestClose({ env, holdings, fetcher = globalThis.fetch }) {
  const apiKey = getProviderKey(env, "stock-prices");
  if (typeof fetcher !== "function") {
    throw createHttpError("Market data fetch is unavailable.", 503, "market-data-fetch-unavailable");
  }

  const fetchedAt = getNowIso();
  const prices = [];
  const symbolGroups = new Map();

  for (const holding of holdings) {
    if (holding.market !== "US") {
      prices.push(createUnsupportedHoldingResult(holding));
      continue;
    }

    const lookupKey = getAlphaVantageLookupKey(holding);
    const group = symbolGroups.get(lookupKey);
    if (group) {
      group.holdings.push(holding);
    } else {
      symbolGroups.set(lookupKey, {
        lookupKey,
        ticker: normalizeTicker(holding.ticker),
        holdings: [holding],
      });
    }
  }

  const groups = [...symbolGroups.values()];
  const summary = {
    attemptedSymbolCount: 0,
    successfulSymbolCount: 0,
    failedSymbolCount: 0,
    skippedSymbolCount: 0,
    providerCallCount: 0,
    stoppedEarly: false,
    stopReason: null,
  };

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const holding = group.holdings[0];
    const url = new URL(ALPHA_VANTAGE_URL);
    url.searchParams.set("function", "TIME_SERIES_DAILY");
    url.searchParams.set("symbol", group.ticker);
    url.searchParams.set("apikey", apiKey);
    summary.attemptedSymbolCount += 1;
    summary.providerCallCount += 1;

    try {
      const response = await fetcher(url.toString());
      const data = await response.json().catch(() => null);
      let result;

      if (!response.ok) {
        result = {
          assetId: holding.assetId,
          ticker: group.ticker,
          market: "US",
          currency: holding.currency,
          priceCurrency: "USD",
          source: ALPHA_VANTAGE_PROVIDER,
          basis: "latest-close",
          status: "failed",
          errorCode: response.status === 429 ? PROVIDER_QUOTA_REACHED : "provider_request_failed",
          message:
            response.status === 429
              ? "Alpha Vantage 查詢額度或頻率限制已達，本次已停止後續查詢，請稍後再試。"
              : `Alpha Vantage request failed with ${response.status}.`,
        };
      } else {
        result = normalizeAlphaVantageDailyResponse({ holding, data, fetchedAt });
      }

      prices.push(...group.holdings.map((groupHolding) => mapAlphaVantageResultToHolding(result, groupHolding)));

      if (result.status === "failed") {
        summary.failedSymbolCount += 1;
      } else {
        summary.successfulSymbolCount += 1;
      }

      if (result.errorCode === PROVIDER_QUOTA_REACHED) {
        summary.stoppedEarly = true;
        summary.stopReason = PROVIDER_QUOTA_REACHED;

        for (const skippedGroup of groups.slice(index + 1)) {
          summary.skippedSymbolCount += 1;
          prices.push(...skippedGroup.holdings.map(createSkippedHoldingResult));
        }
        break;
      }
    } catch (error) {
      const result = {
        assetId: holding.assetId,
        ticker: group.ticker,
        market: "US",
        currency: holding.currency,
        priceCurrency: "USD",
        source: ALPHA_VANTAGE_PROVIDER,
        basis: "latest-close",
        status: "failed",
        errorCode: "provider_request_failed",
        message: error.message || "Alpha Vantage request failed.",
      };
      prices.push(...group.holdings.map((groupHolding) => mapAlphaVantageResultToHolding(result, groupHolding)));
      summary.failedSymbolCount += 1;
    }
  }

  return {
    provider: ALPHA_VANTAGE_PROVIDER,
    fetchedAt,
    prices,
    summary,
  };
}

export function createMarketDataProvider(env = {}) {
  const providerName = normalizeText(env.MARKET_DATA_PROVIDER) || "alpha_vantage";

  if (providerName === "mock") {
    getProviderKey(env, "market-data");
    return createMockMarketDataProvider();
  }

  if (providerName === "alpha_vantage") {
    return {
      name: "ExchangeRate-API + Alpha Vantage",
      fetchExchangeRates(request) {
        return fetchExchangeRateApiLatest({ env, currencies: request.currencies });
      },
      fetchStockPrices(request) {
        return fetchAlphaVantageLatestClose({ env, holdings: request.holdings });
      },
    };
  }

  return {
    name: providerName,
    async fetchExchangeRates() {
      getProviderKey(env, "exchange-rates");
      throw createHttpError(
        "Market data provider adapter is not configured. Set MARKET_DATA_PROVIDER to a supported adapter.",
        501,
        MARKET_DATA_PROVIDER_NOT_CONFIGURED,
      );
    },
    async fetchStockPrices() {
      getProviderKey(env, "stock-prices");
      throw createHttpError(
        "Market data provider adapter is not configured. Set MARKET_DATA_PROVIDER to a supported adapter.",
        501,
        MARKET_DATA_PROVIDER_NOT_CONFIGURED,
      );
    },
  };
}

export function normalizeExchangeRatePreview({ request, providerResult }) {
  const fetchedAt = providerResult.fetchedAt || getNowIso();
  const rates = providerResult.rates ?? {};
  const ratesPreview = request.currencies.map((currency) => {
    const oldRateToTwd = getCurrentRateToTwd(request.currentRates, currency);
    const newRateToTwd = toNumberOrNull(rates?.[currency]?.rateToTwd ?? rates?.[currency]);
    const changePercent = getChangePercent(oldRateToTwd, newRateToTwd);
    let status = "ready";
    let message = "可套用更新。";

    if (!Number.isFinite(newRateToTwd) || newRateToTwd <= 0) {
      status = "failed";
      message = "provider 未回傳有效匯率。";
    } else if (changePercent !== null && Math.abs(changePercent) < 0.0001) {
      status = "unchanged";
      message = "匯率沒有明顯變化。";
    } else if (changePercent !== null && Math.abs(changePercent) > MAX_REVIEW_CHANGE_PERCENT) {
      status = "needs_review";
      message = "匯率變動超過 20%，建議人工確認。";
    }

    return {
      currency,
      oldRateToTwd,
      newRateToTwd,
      changePercent,
      source: providerResult.provider,
      sourceUpdatedAt: providerResult.sourceUpdatedAt ?? fetchedAt,
      fetchedAt,
      status,
      message,
    };
  });

  return {
    ok: true,
    provider: providerResult.provider,
    fetchedAt,
    baseCurrency: request.baseCurrency,
    ratesPreview,
    warnings: ratesPreview
      .filter((item) => item.status === "failed" || item.status === "needs_review")
      .map((item) => `${item.currency}: ${item.message}`),
  };
}

export function normalizeStockPricePreview({ request, providerResult }) {
  const fetchedAt = providerResult.fetchedAt || getNowIso();
  const prices = new Map((providerResult.prices ?? []).map((price) => [normalizeText(price.assetId), price]));
  const pricePreview = request.holdings.map((holding) => {
    const providerPrice = prices.get(holding.assetId);
    const oldMarketPrice = holding.oldMarketPrice;
    const newMarketPrice = toNumberOrNull(providerPrice?.newMarketPrice ?? providerPrice?.price);
    const priceCurrency = normalizeCurrency(providerPrice?.priceCurrency || providerPrice?.currency || holding.currency);
    const market = normalizeText(providerPrice?.market || holding.market || "unknown");
    const exchange = normalizeText(providerPrice?.exchange || holding.exchange);
    const priceDate = normalizeText(providerPrice?.priceDate || fetchedAt.slice(0, 10));
    const changePercent = getChangePercent(oldMarketPrice, newMarketPrice);
    const relatedTicker = providerPrice?.ticker ? normalizeTicker(providerPrice.ticker) : holding.ticker;
    let status = providerPrice?.status || "ready";
    let message = providerPrice?.message || "可套用最新收盤價。";

    if (!providerPrice) {
      status = "failed";
      message = "provider 找不到這個代號。";
    } else if (providerPrice.status === "failed") {
      status = "failed";
      message = providerPrice.message || "provider 無法取得最新收盤價。";
    } else if (providerPrice.status === "needs_review") {
      status = "needs_review";
      message = providerPrice.message || "provider 回傳資料需要人工確認。";
    } else if (!Number.isFinite(newMarketPrice) || newMarketPrice <= 0) {
      status = "needs_review";
      message = "市價不是有效正數，建議人工確認。";
    } else if (!holding.ticker) {
      status = "failed";
      message = "缺少 ticker，無法查詢。";
    } else if (market === "unknown") {
      status = "needs_review";
      message = "市場無法判定，建議人工確認。";
    } else if (/^\d+$/.test(relatedTicker) && holding.currency !== "TWD") {
      status = "needs_review";
      message = "數字代號看起來像台股或台股 ETF，建議確認幣別是否為 TWD。";
    } else if (/^[A-Z.]+$/.test(relatedTicker) && holding.currency !== "USD") {
      status = "needs_review";
      message = "英文代號看起來像美股或美股 ETF，建議確認幣別是否為 USD。";
    } else if (priceCurrency && priceCurrency !== holding.currency) {
      status = "needs_review";
      message = "provider 回傳幣別與資產幣別不同，建議人工確認。";
    } else if (isOlderThanDays(priceDate, MAX_PRICE_AGE_DAYS)) {
      status = "needs_review";
      message = "收盤價日期偏舊，建議人工確認。";
    } else if (changePercent !== null && Math.abs(changePercent) < 0.0001) {
      status = "unchanged";
      message = "市價沒有明顯變化。";
    } else if (changePercent !== null && Math.abs(changePercent) > MAX_REVIEW_CHANGE_PERCENT) {
      status = "needs_review";
      message = "市價變動超過 20%，建議人工確認。";
    }

    return {
      assetId: holding.assetId,
      name: holding.name,
      ticker: holding.ticker,
      market,
      exchange,
      currency: holding.currency,
      oldMarketPrice,
      newMarketPrice,
      changePercent,
      priceCurrency,
      priceDate,
      source: providerPrice?.source || providerResult.provider,
      fetchedAt,
      basis: providerPrice?.basis || "latest-close",
      status,
      errorCode: providerPrice?.errorCode || null,
      message,
    };
  });

  return {
    ok: true,
    provider: providerResult.provider,
    fetchedAt,
    pricePreview,
    summary: providerResult.summary ?? null,
    warnings: pricePreview
      .filter((item) => item.status === "failed" || item.status === "needs_review")
      .map((item) => `${item.ticker || item.assetId}: ${item.message}`),
  };
}

export async function buildExchangeRatePreview({ body, env }) {
  assertMarketDataUpdateEnabled(env);
  const request = normalizeExchangeRatePreviewRequest(body);
  const provider = createMarketDataProvider(env);
  const providerResult = await provider.fetchExchangeRates(request);

  return normalizeExchangeRatePreview({ request, providerResult });
}

export async function buildStockPricePreview({ body, env }) {
  assertMarketDataUpdateEnabled(env);
  const request = normalizeStockPricePreviewRequest(body);
  const provider = createMarketDataProvider(env);
  const providerResult = await provider.fetchStockPrices(request);

  return normalizeStockPricePreview({ request, providerResult });
}
