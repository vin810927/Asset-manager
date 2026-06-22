import { requireAuthenticatedUser } from "../../_shared/access.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

function toAsset(row) {
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

function assetParams(asset, userId) {
  const now = new Date().toISOString();

  return {
    id: asset.id || crypto.randomUUID(),
    userId,
    type: asset.type,
    name: asset.name || null,
    ticker: asset.ticker || null,
    currency: asset.currency || "TWD",
    amount: asset.amount ?? null,
    amountValue: asset.amountValue ?? null,
    shares: asset.shares ?? null,
    buyPrice: asset.buyPrice ?? null,
    marketPrice: asset.marketPrice ?? null,
    marketPriceUpdatedAt: asset.marketPriceUpdatedAt || null,
    buyDate: asset.buyDate || null,
    principal: asset.principal ?? null,
    years: asset.years ?? null,
    annualRate: asset.annualRate ?? null,
    startDate: asset.startDate || null,
    note: asset.note || "",
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || now,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const { results = [] } = await db
      .prepare("SELECT * FROM assets WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC")
      .bind(user.id)
      .all();

    return jsonResponse({ assets: results.map(toAsset) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const params = assetParams(await readJsonBody(request), user.id);

    await db
      .prepare(
        `INSERT INTO assets (
          id, user_id, type, name, ticker, currency, amount, amount_value, shares,
          buy_price, market_price, market_price_updated_at, buy_date, principal,
          years, annual_rate, start_date, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();

    return jsonResponse({ asset: { ...params, userId: undefined } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
