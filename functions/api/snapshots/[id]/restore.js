import { requireAuthenticatedUser } from "../../../_shared/access.js";
import { restoreCloudSnapshot } from "../../../_shared/cloud-copy.js";
import { requireD1Database } from "../../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../../_shared/http.js";

function getSnapshotId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const body = await readJsonBody(request);
    const result = await restoreCloudSnapshot({
      db,
      user,
      id: getSnapshotId(params),
      confirm: body?.confirm,
    });

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
