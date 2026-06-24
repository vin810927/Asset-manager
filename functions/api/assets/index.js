import { requireAuthenticatedUser } from "../../_shared/access.js";
import { getCloudCopyAssets } from "../../_shared/cloud-copy.js";
import { requireD1Database } from "../../_shared/db.js";
import { createHttpError, errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

const ASSETS_SYNC_NOT_IMPLEMENTED = "Cloud asset sync is not implemented yet. LocalStorage remains the primary data source.";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const assets = await getCloudCopyAssets(db, user);

    return jsonResponse({ ok: true, assets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAuthenticatedUser(request, env);
    await readJsonBody(request);
    throw createHttpError(ASSETS_SYNC_NOT_IMPLEMENTED, 501);
  } catch (error) {
    return errorResponse(error);
  }
}
