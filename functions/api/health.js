import { ACCESS_CONFIG_MISSING, ACCESS_TOKEN_INVALID, hasAccessConfig, getCurrentUserFromRequest } from "../_shared/access.js";
import { D1_BINDING_NAME, getD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse } from "../_shared/http.js";

async function pingD1(db) {
  if (!db) return { d1Reachable: false, d1Status: "binding-missing" };

  try {
    await db.prepare("SELECT 1 AS ok").first();
    return { d1Reachable: true, d1Status: "ok" };
  } catch (error) {
    return {
      d1Reachable: false,
      d1Status: "query-failed",
      d1Error: error?.message ? String(error.message).slice(0, 160) : "D1 query failed.",
    };
  }
}

function getSafeAuthStatus(error) {
  if (error?.code === ACCESS_CONFIG_MISSING) return "configuration-missing";
  if (error?.code === ACCESS_TOKEN_INVALID) return "invalid-token";
  return "unverified";
}

export async function buildHealthPayload({ request, env, getUser = getCurrentUserFromRequest }) {
  const db = getD1Database(env);
  const d1Health = await pingD1(db);
  const accessConfigured = hasAccessConfig(env);
  let user = null;
  let authStatus = "not-authenticated";

  try {
    user = await getUser(request, env);
    authStatus = user ? "verified" : "not-authenticated";
  } catch (error) {
    authStatus = getSafeAuthStatus(error);
  }

  return {
    ok: true,
    service: "asset-agent-api",
    version: "v0.8-health",
    mode: "localStorage-primary-cloud-foundation",
    d1BindingName: D1_BINDING_NAME,
    hasD1Binding: Boolean(db),
    hasAccessConfig: accessConfigured,
    d1Reachable: d1Health.d1Reachable,
    d1Status: d1Health.d1Status,
    ...(d1Health.d1Error ? { d1Error: d1Health.d1Error } : {}),
    authenticated: Boolean(user),
    authStatus,
    ...(user?.email ? { userEmail: user.email } : {}),
    timestamp: new Date().toISOString(),
  };
}

export async function onRequest({ request, env }) {
  try {
    return jsonResponse(await buildHealthPayload({ request, env }));
  } catch (error) {
    return errorResponse(error);
  }
}
