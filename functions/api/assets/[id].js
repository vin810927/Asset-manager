import { requireAuthenticatedUser } from "../../_shared/access.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

function getAssetId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

export async function onRequestPut({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const id = getAssetId(params);
    const asset = await readJsonBody(request);
    const updatedAt = asset.updatedAt || new Date().toISOString();

    await db
      .prepare(
        `UPDATE assets
         SET type = ?, name = ?, ticker = ?, currency = ?, amount = ?, amount_value = ?,
             shares = ?, buy_price = ?, market_price = ?, market_price_updated_at = ?,
             buy_date = ?, principal = ?, years = ?, annual_rate = ?, start_date = ?,
             note = ?, updated_at = ?, deleted_at = NULL
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        asset.type,
        asset.name || null,
        asset.ticker || null,
        asset.currency || "TWD",
        asset.amount ?? null,
        asset.amountValue ?? null,
        asset.shares ?? null,
        asset.buyPrice ?? null,
        asset.marketPrice ?? null,
        asset.marketPriceUpdatedAt || null,
        asset.buyDate || null,
        asset.principal ?? null,
        asset.years ?? null,
        asset.annualRate ?? null,
        asset.startDate || null,
        asset.note || "",
        updatedAt,
        id,
        user.id,
      )
      .run();

    return jsonResponse({ ok: true, id, updatedAt });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const id = getAssetId(params);
    const deletedAt = new Date().toISOString();

    await db
      .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(deletedAt, deletedAt, id, user.id)
      .run();

    return jsonResponse({ ok: true, id, deletedAt });
  } catch (error) {
    return errorResponse(error);
  }
}
