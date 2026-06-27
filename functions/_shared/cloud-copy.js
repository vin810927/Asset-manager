import { createHttpError } from "./http.js";

const SUPPORTED_BACKUP_SCHEMA_VERSION = 1;
const SNAPSHOT_VERSION = "asset-agent-snapshot-v1";
const SNAPSHOT_REASONS = new Set([
  "manual",
  "before_cloud_import",
  "before_restore",
  "before_destructive_operation",
]);
const ASSET_TYPES = new Set(["cash", "stock", "etf", "fund", "loan", "other"]);
const DEFAULT_FINANCIAL_GOALS = {
  monthlyLivingExpense: 50000,
  emergencyMonths: 6,
  singleHoldingLimitPercent: 20,
  stockExposureLimitPercent: 60,
  debtRatioLimitPercent: 50,
  staleAssetDays: 30,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeSnapshotReason(value) {
  const reason = normalizeOptionalText(value) || "manual";
  return SNAPSHOT_REASONS.has(reason) ? reason : "manual";
}

function normalizeGoalNumber(value, fallback, minimum = 0) {
  const numberValue = Number(value ?? fallback);
  return Math.max(minimum, Number.isFinite(numberValue) ? numberValue : fallback);
}

function getNowIso(now = new Date()) {
  return typeof now === "string" ? now : now.toISOString();
}

function getStableUserId(user) {
  return user?.sub || user?.id || user?.email || "";
}

function assertVerifiedUser(user) {
  const id = getStableUserId(user);
  const email = user?.email || "";

  if (!id || !email) {
    throw createHttpError("Verified Cloudflare Access user identity is incomplete.", 401);
  }

  return {
    id,
    email,
    displayName: user.name || null,
  };
}

export function validateBackupPayload(payload) {
  if (!isPlainObject(payload)) {
    throw createHttpError("Invalid backup payload: root value must be an object.", 400);
  }

  if (Number(payload.schemaVersion) !== SUPPORTED_BACKUP_SCHEMA_VERSION) {
    throw createHttpError("Invalid backup payload: unsupported schemaVersion.", 400);
  }

  if (!Array.isArray(payload.assets)) {
    throw createHttpError("Invalid backup payload: assets must be an array.", 400);
  }

  if (!Object.hasOwn(payload, "exchangeRates")) {
    throw createHttpError("Invalid backup payload: exchangeRates is required.", 400);
  }

  if (payload.exchangeRates !== null && !isPlainObject(payload.exchangeRates)) {
    throw createHttpError("Invalid backup payload: exchangeRates must be an object or null.", 400);
  }

  if (!Object.hasOwn(payload, "financialGoals")) {
    throw createHttpError("Invalid backup payload: financialGoals is required.", 400);
  }

  if (payload.financialGoals !== null && !isPlainObject(payload.financialGoals)) {
    throw createHttpError("Invalid backup payload: financialGoals must be an object or null.", 400);
  }

  payload.assets.forEach((asset, index) => {
    if (!isPlainObject(asset)) {
      throw createHttpError(`Invalid backup payload: asset ${index + 1} must be an object.`, 400);
    }

    if (!ASSET_TYPES.has(asset.type)) {
      throw createHttpError(`Invalid backup payload: asset ${index + 1} has unsupported type.`, 400);
    }
  });

  return {
    schemaVersion: SUPPORTED_BACKUP_SCHEMA_VERSION,
    assets: payload.assets,
    exchangeRates: payload.exchangeRates,
    financialGoals: payload.financialGoals,
  };
}

function assetToParams(asset, userId, now, createId) {
  const id = normalizeOptionalText(asset.id) || createId();

  return {
    id,
    userId,
    type: asset.type,
    name: normalizeOptionalText(asset.name),
    ticker: normalizeOptionalText(asset.ticker),
    currency: normalizeOptionalText(asset.currency) || "TWD",
    amount: normalizeOptionalNumber(asset.amount),
    amountValue: normalizeOptionalNumber(asset.amountValue),
    shares: normalizeOptionalNumber(asset.shares),
    buyPrice: normalizeOptionalNumber(asset.buyPrice),
    marketPrice: normalizeOptionalNumber(asset.marketPrice),
    marketPriceUpdatedAt: normalizeOptionalText(asset.marketPriceUpdatedAt),
    buyDate: normalizeOptionalText(asset.buyDate),
    principal: normalizeOptionalNumber(asset.principal),
    years: normalizeOptionalNumber(asset.years),
    annualRate: normalizeOptionalNumber(asset.annualRate),
    startDate: normalizeOptionalText(asset.startDate),
    note: normalizeOptionalText(asset.note) || "",
    createdAt: normalizeOptionalText(asset.createdAt) || now,
    updatedAt: normalizeOptionalText(asset.updatedAt) || now,
  };
}

function profileUpsertStatement(db, verifiedUser, timestamp) {
  return db
    .prepare(
      `INSERT INTO profiles (id, email, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
    )
    .bind(verifiedUser.id, verifiedUser.email, verifiedUser.displayName, timestamp, timestamp);
}

function assetUpsertStatement(db, params) {
  return db
    .prepare(
      `INSERT INTO assets (
        id, user_id, type, name, ticker, currency, amount, amount_value, shares,
        buy_price, market_price, market_price_updated_at, buy_date, principal,
        years, annual_rate, start_date, note, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        ticker = excluded.ticker,
        currency = excluded.currency,
        amount = excluded.amount,
        amount_value = excluded.amount_value,
        shares = excluded.shares,
        buy_price = excluded.buy_price,
        market_price = excluded.market_price,
        market_price_updated_at = excluded.market_price_updated_at,
        buy_date = excluded.buy_date,
        principal = excluded.principal,
        years = excluded.years,
        annual_rate = excluded.annual_rate,
        start_date = excluded.start_date,
        note = excluded.note,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = NULL
      WHERE assets.user_id = excluded.user_id`,
    )
    .bind(
      params.id,
      params.userId,
      params.type,
      params.name,
      params.ticker,
      params.currency,
      params.amount,
      params.amountValue,
      params.shares,
      params.buyPrice,
      params.marketPrice,
      params.marketPriceUpdatedAt,
      params.buyDate,
      params.principal,
      params.years,
      params.annualRate,
      params.startDate,
      params.note,
      params.createdAt,
      params.updatedAt,
    );
}

function assetInsertStatement(db, params) {
  return db
    .prepare(
      `INSERT INTO assets (
        id, user_id, type, name, ticker, currency, amount, amount_value, shares,
        buy_price, market_price, market_price_updated_at, buy_date, principal,
        years, annual_rate, start_date, note, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      params.id,
      params.userId,
      params.type,
      params.name,
      params.ticker,
      params.currency,
      params.amount,
      params.amountValue,
      params.shares,
      params.buyPrice,
      params.marketPrice,
      params.marketPriceUpdatedAt,
      params.buyDate,
      params.principal,
      params.years,
      params.annualRate,
      params.startDate,
      params.note,
      params.createdAt,
      params.updatedAt,
    );
}

function assetUpdateStatement(db, params) {
  return db
    .prepare(
      `UPDATE assets SET
        type = ?,
        name = ?,
        ticker = ?,
        currency = ?,
        amount = ?,
        amount_value = ?,
        shares = ?,
        buy_price = ?,
        market_price = ?,
        market_price_updated_at = ?,
        buy_date = ?,
        principal = ?,
        years = ?,
        annual_rate = ?,
        start_date = ?,
        note = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      params.type,
      params.name,
      params.ticker,
      params.currency,
      params.amount,
      params.amountValue,
      params.shares,
      params.buyPrice,
      params.marketPrice,
      params.marketPriceUpdatedAt,
      params.buyDate,
      params.principal,
      params.years,
      params.annualRate,
      params.startDate,
      params.note,
      params.updatedAt,
      params.id,
      params.userId,
    );
}

function financialGoalsInsertStatement(db, userId, financialGoals, now, createId) {
  return db
    .prepare("INSERT INTO financial_goals (id, user_id, goals_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(createId(), userId, JSON.stringify(financialGoals), now, now);
}

function financialGoalsUpsertStatement(db, userId, financialGoals, now, createId) {
  return db
    .prepare(
      `INSERT INTO financial_goals (id, user_id, goals_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         goals_json = excluded.goals_json,
         updated_at = excluded.updated_at`,
    )
    .bind(createId(), userId, JSON.stringify(financialGoals), now, now);
}

function exchangeRatesInsertStatement(db, userId, exchangeRates, now, createId) {
  return db
    .prepare(
      `INSERT INTO exchange_rates (
        id, user_id, base_currency, provider, provider_url, provider_documentation_url,
        fetched_at, source_updated_at, source_next_update_at, rates_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      createId(),
      userId,
      normalizeOptionalText(exchangeRates.baseCurrency) || "TWD",
      normalizeOptionalText(exchangeRates.provider),
      normalizeOptionalText(exchangeRates.providerUrl),
      normalizeOptionalText(exchangeRates.providerDocumentationUrl),
      normalizeOptionalText(exchangeRates.fetchedAt),
      normalizeOptionalText(exchangeRates.sourceUpdatedAt),
      normalizeOptionalText(exchangeRates.sourceNextUpdateAt),
      JSON.stringify(exchangeRates),
      now,
      now,
    );
}

function snapshotInsertStatement(db, userId, snapshotId, snapshotPayload, summary, now) {
  return db
    .prepare(
      `INSERT INTO asset_snapshots (
        id, user_id, snapshot_date, net_worth_twd, total_assets_twd,
        total_liabilities_twd, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      snapshotId,
      userId,
      snapshotPayload.createdAt,
      summary.netWorthTwd,
      summary.totalAssetsTwd,
      summary.totalLiabilitiesTwd,
      JSON.stringify(snapshotPayload),
      now,
    );
}

function normalizeFinancialGoalsPayload(payload) {
  const value = isPlainObject(payload?.financialGoals) ? payload.financialGoals : payload;

  if (!isPlainObject(value)) {
    throw createHttpError("Financial goals payload must be an object.", 400);
  }

  return {
    monthlyLivingExpense: normalizeGoalNumber(value.monthlyLivingExpense, DEFAULT_FINANCIAL_GOALS.monthlyLivingExpense),
    emergencyMonths: normalizeGoalNumber(value.emergencyMonths, DEFAULT_FINANCIAL_GOALS.emergencyMonths),
    singleHoldingLimitPercent: normalizeGoalNumber(
      value.singleHoldingLimitPercent,
      DEFAULT_FINANCIAL_GOALS.singleHoldingLimitPercent,
    ),
    stockExposureLimitPercent: normalizeGoalNumber(
      value.stockExposureLimitPercent,
      DEFAULT_FINANCIAL_GOALS.stockExposureLimitPercent,
    ),
    debtRatioLimitPercent: normalizeGoalNumber(value.debtRatioLimitPercent, DEFAULT_FINANCIAL_GOALS.debtRatioLimitPercent),
    staleAssetDays: normalizeGoalNumber(value.staleAssetDays, DEFAULT_FINANCIAL_GOALS.staleAssetDays, 1),
  };
}

function normalizeExchangeRatesPayload(payload, now) {
  const value = isPlainObject(payload?.exchangeRates) ? payload.exchangeRates : payload;

  if (!isPlainObject(value)) {
    throw createHttpError("Exchange rates payload must be an object.", 400);
  }

  return {
    schemaVersion: Number(value.schemaVersion) || SUPPORTED_BACKUP_SCHEMA_VERSION,
    baseCurrency: normalizeOptionalText(value.baseCurrency) || "TWD",
    provider: normalizeOptionalText(value.provider),
    providerUrl: normalizeOptionalText(value.providerUrl),
    providerDocumentationUrl: normalizeOptionalText(value.providerDocumentationUrl),
    fetchedAt: normalizeOptionalText(value.fetchedAt) || now,
    sourceUpdatedAt: normalizeOptionalText(value.sourceUpdatedAt),
    sourceNextUpdateAt: normalizeOptionalText(value.sourceNextUpdateAt),
    rates: isPlainObject(value.rates) ? value.rates : {},
  };
}

function getRateToTwd(exchangeRates, currency) {
  if (currency === "TWD") return 1;
  const rate = Number(exchangeRates?.rates?.[currency]?.rateToTwd);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function getAssetNativeValue(asset) {
  if (asset.type === "loan") {
    return Math.abs(
      normalizeOptionalNumber(asset.principal) ??
        normalizeOptionalNumber(asset.amountValue) ??
        normalizeOptionalNumber(asset.amount) ??
        0,
    );
  }

  if (asset.type === "stock" || asset.type === "etf") {
    const shares = normalizeOptionalNumber(asset.shares) ?? 0;
    const price = normalizeOptionalNumber(asset.marketPrice) ?? normalizeOptionalNumber(asset.buyPrice) ?? 0;
    return shares * price;
  }

  return normalizeOptionalNumber(asset.amountValue) ?? normalizeOptionalNumber(asset.amount) ?? 0;
}

function summarizeSnapshotPayload(payload) {
  const assets = Array.isArray(payload?.data?.assets) ? payload.data.assets : [];
  const exchangeRates = isPlainObject(payload?.data?.exchangeRates) ? payload.data.exchangeRates : null;

  return assets.reduce(
    (summary, asset) => {
      const rateToTwd = getRateToTwd(exchangeRates, asset.currency);
      const valueTwd = getAssetNativeValue(asset) * rateToTwd;

      if (asset.type === "loan") {
        summary.totalLiabilitiesTwd += valueTwd;
      } else {
        summary.totalAssetsTwd += valueTwd;
      }

      summary.netWorthTwd = summary.totalAssetsTwd - summary.totalLiabilitiesTwd;
      return summary;
    },
    {
      netWorthTwd: 0,
      totalAssetsTwd: 0,
      totalLiabilitiesTwd: 0,
    },
  );
}

function normalizeSnapshotOptions(body = {}) {
  const value = isPlainObject(body) ? body : {};

  return {
    reason: normalizeSnapshotReason(value.reason),
    label: normalizeOptionalText(value.label),
  };
}

function assertSnapshotPayload(payload) {
  if (!isPlainObject(payload) || payload.version !== SNAPSHOT_VERSION) {
    throw createHttpError("Stored snapshot payload is invalid.", 500);
  }

  if (!isPlainObject(payload.data) || !Array.isArray(payload.data.assets)) {
    throw createHttpError("Stored snapshot payload is missing assets.", 500);
  }

  return payload;
}

function mapSnapshotRowToMetadata(row) {
  const payload = parseJsonColumn(row?.payload_json, {});
  const metadata = isPlainObject(payload.metadata) ? payload.metadata : {};

  return {
    id: row.id,
    reason: normalizeOptionalText(payload.reason) || "manual",
    label: normalizeOptionalText(metadata.label),
    assetCount: Number(metadata.assetCount ?? 0),
    hasFinancialGoals: Boolean(metadata.hasFinancialGoals),
    hasExchangeRates: Boolean(metadata.hasExchangeRates),
    netWorthTwd: Number(row.net_worth_twd ?? 0),
    totalAssetsTwd: Number(row.total_assets_twd ?? 0),
    totalLiabilitiesTwd: Number(row.total_liabilities_twd ?? 0),
    createdAt: payload.createdAt || row.created_at || row.snapshot_date,
    updatedAt: row.created_at || row.snapshot_date,
  };
}

async function getCloudSnapshotRowById(db, userId, id) {
  return db
    .prepare("SELECT * FROM asset_snapshots WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(id, userId)
    .first();
}

async function buildCloudSnapshotPayload({ db, user, reason = "manual", label = null, now = new Date() } = {}) {
  const timestamp = getNowIso(now);
  const [assets, financialGoalsResult, exchangeRatesResult] = await Promise.all([
    getCloudCopyAssets(db, user),
    getCloudFinancialGoals(db, user),
    getCloudExchangeRates(db, user),
  ]);
  const financialGoals = financialGoalsResult.financialGoals;
  const exchangeRates = exchangeRatesResult.exchangeRates;

  return {
    version: SNAPSHOT_VERSION,
    createdAt: timestamp,
    reason: normalizeSnapshotReason(reason),
    source: "cloudflare-d1",
    data: {
      assets,
      financialGoals,
      exchangeRates,
    },
    metadata: {
      label: normalizeOptionalText(label),
      assetCount: assets.length,
      hasFinancialGoals: Boolean(financialGoals),
      hasExchangeRates: Boolean(exchangeRates),
    },
  };
}

export async function importLocalBackupToCloudCopy({
  db,
  user,
  payload,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const backup = validateBackupPayload(payload);
  const timestamp = getNowIso(now);
  const beforeImportSnapshot = await createCloudSnapshot({
    db,
    user: verifiedUser,
    reason: "before_cloud_import",
    label: "Before local JSON import",
    now,
    createId,
  });
  const statements = [
    profileUpsertStatement(db, verifiedUser, timestamp),
    // Replace cloud copy strategy:
    // mark current user's cloud assets deleted, then upsert this backup's assets as the active copy.
    db
      .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, verifiedUser.id),
    db.prepare("DELETE FROM financial_goals WHERE user_id = ?").bind(verifiedUser.id),
    db.prepare("DELETE FROM exchange_rates WHERE user_id = ?").bind(verifiedUser.id),
    ...backup.assets.map((asset) => assetUpsertStatement(db, assetToParams(asset, verifiedUser.id, timestamp, createId))),
  ];

  if (backup.financialGoals) {
    statements.push(financialGoalsInsertStatement(db, verifiedUser.id, backup.financialGoals, timestamp, createId));
  }

  if (backup.exchangeRates) {
    statements.push(exchangeRatesInsertStatement(db, verifiedUser.id, backup.exchangeRates, timestamp, createId));
  }

  await db.batch(statements);

  return {
    ok: true,
    imported: {
      assets: backup.assets.length,
      financialGoals: Boolean(backup.financialGoals),
      exchangeRates: Boolean(backup.exchangeRates),
    },
    cloudCopyStatus: "created",
    userEmail: verifiedUser.email,
    timestamp,
    beforeImportSnapshotId: beforeImportSnapshot.id,
  };
}

export function mapAssetRowToAsset(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name ?? "",
    ticker: row.ticker ?? "",
    currency: row.currency,
    amount: row.amount,
    amountValue: row.amount_value,
    shares: row.shares,
    buyPrice: row.buy_price,
    marketPrice: row.market_price,
    marketPriceUpdatedAt: row.market_price_updated_at,
    buyDate: row.buy_date,
    principal: row.principal,
    years: row.years,
    annualRate: row.annual_rate,
    startDate: row.start_date,
    note: row.note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function validateAssetBody(asset) {
  if (!isPlainObject(asset)) {
    throw createHttpError("Asset payload must be an object.", 400);
  }

  if (!ASSET_TYPES.has(asset.type)) {
    throw createHttpError("Asset payload has unsupported type.", 400);
  }

  return asset;
}

async function getCloudAssetRowById(db, userId, id) {
  return db
    .prepare("SELECT * FROM assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id, userId)
    .first();
}

export async function getCloudCopyAssets(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const { results = [] } = await db
    .prepare(
      "SELECT * FROM assets WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC, id ASC",
    )
    .bind(verifiedUser.id)
    .all();

  return results.map(mapAssetRowToAsset);
}

export async function createCloudAsset({ db, user, asset, now = new Date(), createId = () => crypto.randomUUID() } = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const assetPayload = validateAssetBody(asset);
  const timestamp = getNowIso(now);
  const params = assetToParams(
    {
      ...assetPayload,
      id: normalizeOptionalText(assetPayload.id) || createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    verifiedUser.id,
    timestamp,
    createId,
  );

  await db.batch([profileUpsertStatement(db, verifiedUser, timestamp), assetInsertStatement(db, params)]);

  const row = await getCloudAssetRowById(db, verifiedUser.id, params.id);
  return mapAssetRowToAsset(row);
}

export async function updateCloudAsset({ db, user, id, asset, now = new Date(), createId = () => crypto.randomUUID() } = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const assetId = normalizeOptionalText(id);
  const existingRow = assetId ? await getCloudAssetRowById(db, verifiedUser.id, assetId) : null;

  if (!existingRow) {
    throw createHttpError("Asset not found.", 404);
  }

  const assetPayload = validateAssetBody(asset);
  const timestamp = getNowIso(now);
  const params = assetToParams(
    {
      ...assetPayload,
      id: assetId,
      createdAt: existingRow.created_at,
      updatedAt: timestamp,
    },
    verifiedUser.id,
    timestamp,
    createId,
  );

  await assetUpdateStatement(db, params).run();

  const row = await getCloudAssetRowById(db, verifiedUser.id, assetId);
  return mapAssetRowToAsset(row);
}

export async function deleteCloudAsset({ db, user, id, now = new Date() } = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const assetId = normalizeOptionalText(id);
  const existingRow = assetId ? await getCloudAssetRowById(db, verifiedUser.id, assetId) : null;

  if (!existingRow) {
    throw createHttpError("Asset not found.", 404);
  }

  const timestamp = getNowIso(now);
  await db
    .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(timestamp, timestamp, assetId, verifiedUser.id)
    .run();

  return {
    ok: true,
    deleted: true,
    id: assetId,
    deletedAt: timestamp,
  };
}

function parseJsonColumn(value, fallback = null) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    throw createHttpError("Stored cloud data is invalid.", 500);
  }
}

export async function getCloudFinancialGoals(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const row = await db
    .prepare("SELECT goals_json, updated_at FROM financial_goals WHERE user_id = ? LIMIT 1")
    .bind(verifiedUser.id)
    .first();

  return {
    financialGoals: parseJsonColumn(row?.goals_json, null),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updateCloudFinancialGoals({
  db,
  user,
  financialGoals,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const goalsPayload = normalizeFinancialGoalsPayload(financialGoals);
  const timestamp = getNowIso(now);

  await db.batch([
    profileUpsertStatement(db, verifiedUser, timestamp),
    financialGoalsUpsertStatement(db, verifiedUser.id, goalsPayload, timestamp, createId),
  ]);

  return getCloudFinancialGoals(db, user);
}

export async function getCloudExchangeRates(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const row = await db
    .prepare("SELECT rates_json, updated_at FROM exchange_rates WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1")
    .bind(verifiedUser.id)
    .first();

  return {
    exchangeRates: parseJsonColumn(row?.rates_json, null),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getCloudRevision(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const [assetsRow, financialGoalsRow, exchangeRatesRow] = await Promise.all([
    db
      .prepare("SELECT MAX(updated_at) AS assetsUpdatedAt FROM assets WHERE user_id = ?")
      .bind(verifiedUser.id)
      .first(),
    db
      .prepare("SELECT MAX(updated_at) AS financialGoalsUpdatedAt FROM financial_goals WHERE user_id = ?")
      .bind(verifiedUser.id)
      .first(),
    db
      .prepare(
        "SELECT MAX(COALESCE(updated_at, fetched_at, created_at)) AS exchangeRatesUpdatedAt FROM exchange_rates WHERE user_id = ?",
      )
      .bind(verifiedUser.id)
      .first(),
  ]);
  const revision = {
    assetsUpdatedAt: assetsRow?.assetsUpdatedAt ?? null,
    financialGoalsUpdatedAt: financialGoalsRow?.financialGoalsUpdatedAt ?? null,
    exchangeRatesUpdatedAt: exchangeRatesRow?.exchangeRatesUpdatedAt ?? null,
  };

  revision.cloudUpdatedAt =
    [revision.assetsUpdatedAt, revision.financialGoalsUpdatedAt, revision.exchangeRatesUpdatedAt]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  return {
    ok: true,
    revision,
  };
}

export async function updateCloudExchangeRates({
  db,
  user,
  exchangeRates,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const timestamp = getNowIso(now);
  const exchangeRatesPayload = normalizeExchangeRatesPayload(exchangeRates, timestamp);

  await db.batch([
    profileUpsertStatement(db, verifiedUser, timestamp),
    db.prepare("DELETE FROM exchange_rates WHERE user_id = ?").bind(verifiedUser.id),
    exchangeRatesInsertStatement(db, verifiedUser.id, exchangeRatesPayload, timestamp, createId),
  ]);

  return getCloudExchangeRates(db, user);
}

export async function listCloudSnapshots(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const { results = [] } = await db
    .prepare(
      `SELECT id, snapshot_date, net_worth_twd, total_assets_twd, total_liabilities_twd, payload_json, created_at
       FROM asset_snapshots
       WHERE user_id = ?
       ORDER BY snapshot_date DESC, created_at DESC, id DESC
       LIMIT 50`,
    )
    .bind(verifiedUser.id)
    .all();

  return results.map(mapSnapshotRowToMetadata);
}

export async function createCloudSnapshot({
  db,
  user,
  reason = "manual",
  label = null,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  const verifiedUser = assertVerifiedUser(user);
  const timestamp = getNowIso(now);
  const snapshotId = createId();
  const snapshotPayload = await buildCloudSnapshotPayload({
    db,
    user: verifiedUser,
    reason,
    label,
    now: timestamp,
  });
  const summary = summarizeSnapshotPayload(snapshotPayload);

  await db.batch([
    profileUpsertStatement(db, verifiedUser, timestamp),
    snapshotInsertStatement(db, verifiedUser.id, snapshotId, snapshotPayload, summary, timestamp),
  ]);

  const row = await getCloudSnapshotRowById(db, verifiedUser.id, snapshotId);
  const metadata = mapSnapshotRowToMetadata(row);

  return metadata;
}

export async function createCloudSnapshotFromBody({
  db,
  user,
  body,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  const options = normalizeSnapshotOptions(body);
  return createCloudSnapshot({
    db,
    user,
    reason: options.reason,
    label: options.label,
    now,
    createId,
  });
}

export async function getCloudSnapshot(db, user, id) {
  const verifiedUser = assertVerifiedUser(user);
  const snapshotId = normalizeOptionalText(id);
  const row = snapshotId ? await getCloudSnapshotRowById(db, verifiedUser.id, snapshotId) : null;

  if (!row) {
    throw createHttpError("Snapshot not found.", 404);
  }

  const snapshot = assertSnapshotPayload(parseJsonColumn(row.payload_json, null));

  return {
    metadata: mapSnapshotRowToMetadata(row),
    snapshot,
  };
}

export async function getCloudSnapshotRestorePreview(db, user, id) {
  const verifiedUser = assertVerifiedUser(user);
  const [{ snapshot }, currentAssets, currentGoals, currentRates] = await Promise.all([
    getCloudSnapshot(db, verifiedUser, id),
    getCloudCopyAssets(db, verifiedUser),
    getCloudFinancialGoals(db, verifiedUser),
    getCloudExchangeRates(db, verifiedUser),
  ]);
  const snapshotData = snapshot.data;

  return {
    currentAssetCount: currentAssets.length,
    snapshotAssetCount: snapshotData.assets.length,
    currentHasFinancialGoals: Boolean(currentGoals.financialGoals),
    snapshotHasFinancialGoals: Boolean(snapshotData.financialGoals),
    currentHasExchangeRates: Boolean(currentRates.exchangeRates),
    snapshotHasExchangeRates: Boolean(snapshotData.exchangeRates),
    restoreStrategy: "replace_cloud_data",
    warning: "這會用 snapshot 內容取代目前 D1 cloud data。",
  };
}

export async function restoreCloudSnapshot({
  db,
  user,
  id,
  confirm,
  now = new Date(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) {
    throw createHttpError("Cloudflare D1 binding ASSET_AGENT_DB is not configured.", 503);
  }

  if (confirm !== "RESTORE") {
    throw createHttpError('Restore requires confirm: "RESTORE".', 400);
  }

  const verifiedUser = assertVerifiedUser(user);
  const { snapshot } = await getCloudSnapshot(db, verifiedUser, id);
  const beforeRestoreSnapshot = await createCloudSnapshot({
    db,
    user: verifiedUser,
    reason: "before_restore",
    label: "Before snapshot restore",
    now,
    createId,
  });
  const timestamp = getNowIso(now);
  const snapshotData = snapshot.data;
  const statements = [
    profileUpsertStatement(db, verifiedUser, timestamp),
    db
      .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, verifiedUser.id),
    db.prepare("DELETE FROM financial_goals WHERE user_id = ?").bind(verifiedUser.id),
    db.prepare("DELETE FROM exchange_rates WHERE user_id = ?").bind(verifiedUser.id),
    ...snapshotData.assets.map((asset) =>
      assetUpsertStatement(db, assetToParams(asset, verifiedUser.id, timestamp, createId)),
    ),
  ];

  if (snapshotData.financialGoals) {
    statements.push(financialGoalsInsertStatement(db, verifiedUser.id, snapshotData.financialGoals, timestamp, createId));
  }

  if (snapshotData.exchangeRates) {
    statements.push(exchangeRatesInsertStatement(db, verifiedUser.id, snapshotData.exchangeRates, timestamp, createId));
  }

  await db.batch(statements);

  return {
    restoredAssetCount: snapshotData.assets.length,
    restoredFinancialGoals: Boolean(snapshotData.financialGoals),
    restoredExchangeRates: Boolean(snapshotData.exchangeRates),
    beforeRestoreSnapshotId: beforeRestoreSnapshot.id,
    restoreStrategy: "replace_cloud_data",
    timestamp,
  };
}

export async function getCloudCopyStatus(db, user) {
  const verifiedUser = assertVerifiedUser(user);
  const assetCountRow = await db
    .prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS lastUpdatedAt FROM assets WHERE user_id = ? AND deleted_at IS NULL")
    .bind(verifiedUser.id)
    .first();
  const financialGoalsRow = await db
    .prepare("SELECT updated_at FROM financial_goals WHERE user_id = ? LIMIT 1")
    .bind(verifiedUser.id)
    .first();
  const exchangeRatesRow = await db
    .prepare("SELECT updated_at FROM exchange_rates WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(verifiedUser.id)
    .first();
  const lastCloudUpdate =
    [assetCountRow?.lastUpdatedAt, financialGoalsRow?.updated_at, exchangeRatesRow?.updated_at]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const assetCount = Number(assetCountRow?.count ?? 0);
  const hasFinancialGoals = Boolean(financialGoalsRow);
  const hasExchangeRates = Boolean(exchangeRatesRow);

  return {
    ok: true,
    authenticated: true,
    userEmail: verifiedUser.email,
    hasCloudCopy: assetCount > 0 || hasFinancialGoals || hasExchangeRates,
    assetCount,
    hasFinancialGoals,
    hasExchangeRates,
    lastCloudUpdate,
  };
}
