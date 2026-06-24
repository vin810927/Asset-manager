import { requireAuthenticatedUser } from "../_shared/access.js";
import { getCloudFinancialGoals } from "../_shared/cloud-copy.js";
import { requireD1Database } from "../_shared/db.js";
import { createHttpError, errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

const GOALS_SYNC_NOT_IMPLEMENTED = "Cloud financial goals sync is not implemented yet. LocalStorage remains the primary data source.";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const result = await getCloudFinancialGoals(db, user);

    return jsonResponse({ ok: true, ...result, readOnly: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    await requireAuthenticatedUser(request, env);
    await readJsonBody(request);
    throw createHttpError(GOALS_SYNC_NOT_IMPLEMENTED, 501);
  } catch (error) {
    return errorResponse(error);
  }
}
