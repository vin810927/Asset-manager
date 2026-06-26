import { requireAuthenticatedUser } from "../_shared/access.js";
import { getCloudExchangeRates, updateCloudExchangeRates } from "../_shared/cloud-copy.js";
import { requireD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const result = await getCloudExchangeRates(db, user);

    return jsonResponse({ ok: true, ...result, readOnly: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const exchangeRates = await readJsonBody(request);
    const result = await updateCloudExchangeRates({ db, user, exchangeRates });

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
