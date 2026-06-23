import { requireAuthenticatedUser } from "../../_shared/access.js";
import { createHttpError, errorResponse, readJsonBody } from "../../_shared/http.js";

function getAssetId(params) {
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

const ASSETS_SYNC_NOT_IMPLEMENTED = "Cloud asset sync is not implemented yet. LocalStorage remains the primary data source.";

export async function onRequestPut({ request, env, params }) {
  try {
    await requireAuthenticatedUser(request, env);
    getAssetId(params);
    await readJsonBody(request);
    throw createHttpError(ASSETS_SYNC_NOT_IMPLEMENTED, 501);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    await requireAuthenticatedUser(request, env);
    getAssetId(params);
    throw createHttpError(ASSETS_SYNC_NOT_IMPLEMENTED, 501);
  } catch (error) {
    return errorResponse(error);
  }
}
