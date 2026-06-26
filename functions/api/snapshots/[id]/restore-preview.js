import { requireAuthenticatedUser } from "../../../_shared/access.js";
import { getCloudSnapshotRestorePreview } from "../../../_shared/cloud-copy.js";
import { requireD1Database } from "../../../_shared/db.js";
import { errorResponse, jsonResponse } from "../../../_shared/http.js";

function getSnapshotId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const preview = await getCloudSnapshotRestorePreview(db, user, getSnapshotId(params));

    return jsonResponse({ ok: true, preview });
  } catch (error) {
    return errorResponse(error);
  }
}
