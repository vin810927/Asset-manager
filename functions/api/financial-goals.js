import { requireAuthenticatedUser } from "../_shared/access.js";
import { requireD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const row = await db
      .prepare("SELECT goals_json, updated_at FROM financial_goals WHERE user_id = ?")
      .bind(user.id)
      .first();

    return jsonResponse({
      financialGoals: row ? JSON.parse(row.goals_json) : null,
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
    const financialGoals = await readJsonBody(request);
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO financial_goals (id, user_id, goals_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET goals_json = excluded.goals_json, updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), user.id, JSON.stringify(financialGoals), now, now)
      .run();

    return jsonResponse({ financialGoals, updatedAt: now });
  } catch (error) {
    return errorResponse(error);
  }
}
