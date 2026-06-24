import { requireAuthenticatedUser } from "../../_shared/access.js";
import { deleteCloudAsset, updateCloudAsset } from "../../_shared/cloud-copy.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

function getAssetId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

export async function onRequestPut({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const asset = await updateCloudAsset({
      db,
      user,
      id: getAssetId(params),
      asset: await readJsonBody(request),
    });

    return jsonResponse({ ok: true, asset });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const result = await deleteCloudAsset({
      db,
      user,
      id: getAssetId(params),
    });

    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
