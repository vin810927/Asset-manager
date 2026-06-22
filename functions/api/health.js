import { getCurrentUserFromRequest } from "../_shared/access.js";
import { D1_BINDING_NAME, getD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse } from "../_shared/http.js";

export async function onRequest({ request, env }) {
  try {
    const user = await getCurrentUserFromRequest(request, env);

    return jsonResponse({
      ok: true,
      service: "asset-agent-api",
      version: "v0.7-foundation",
      dataSource: "Cloudflare D1 foundation",
      d1BindingName: D1_BINDING_NAME,
      hasD1Binding: Boolean(getD1Database(env)),
      authenticated: Boolean(user),
      authStatus: user ? "verified" : "jwt-verification-pending",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
