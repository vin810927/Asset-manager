import { createHttpError } from "./http.js";

const SUPPORTED_BACKUP_SCHEMA_VERSION = 1;
const ASSET_TYPES = new Set(["cash", "stock", "etf", "fund", "loan", "other"]);

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
