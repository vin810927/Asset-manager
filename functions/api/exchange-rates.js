import { requireAuthenticatedUser } from "../_shared/access.js";
import { requireD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const row = await db
      .prepare(
        `SELECT base_currency, provider, provider_url, provider_documentation_url, fetched_at,
                source_updated_at, source_next_update_at, rates_json, updated_at
         FROM exchange_rates
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .bind(user.id)
      .first();

    return jsonResponse({
      exchangeRates: row
        ? {
            baseCurrency: row.base_currency,
            provider: row.provider,
            providerUrl: row.provider_url,
            providerDocumentationUrl: row.provider_documentation_url,
            fetchedAt: row.fetched_at,
            sourceUpdatedAt: row.source_updated_at,
            sourceNextUpdateAt: row.source_next_update_at,
            rates: JSON.parse(row.rates_json),
          }
        : null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const exchangeRates = await readJsonBody(request);
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO exchange_rates (
          id, user_id, base_currency, provider, provider_url, provider_documentation_url,
          fetched_at, source_updated_at, source_next_update_at, rates_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        user.id,
        exchangeRates.baseCurrency || "TWD",
        exchangeRates.provider || null,
        exchangeRates.providerUrl || null,
        exchangeRates.providerDocumentationUrl || null,
        exchangeRates.fetchedAt || null,
        exchangeRates.sourceUpdatedAt || null,
        exchangeRates.sourceNextUpdateAt || null,
        JSON.stringify(exchangeRates.rates ?? {}),
        now,
        now,
      )
      .run();

    return jsonResponse({ exchangeRates, updatedAt: now });
  } catch (error) {
    return errorResponse(error);
  }
}
