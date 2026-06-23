import { requireAuthenticatedUser } from "../../_shared/access.js";
import { createHttpError, errorResponse, readJsonBody } from "../../_shared/http.js";

const ASSETS_SYNC_NOT_IMPLEMENTED = "Cloud asset sync is not implemented yet. LocalStorage remains the primary data source.";

export async function onRequestGet({ request, env }) {
  try {
    await requireAuthenticatedUser(request, env);
    throw createHttpError(ASSETS_SYNC_NOT_IMPLEMENTED, 501);
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
