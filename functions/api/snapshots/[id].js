import { requireAuthenticatedUser } from "../../_shared/access.js";
import { getCloudSnapshot } from "../../_shared/cloud-copy.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse } from "../../_shared/http.js";

function getSnapshotId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

export async function onRequestGet({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const result = await getCloudSnapshot(db, user, getSnapshotId(params));

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
