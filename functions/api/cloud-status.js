import { requireAuthenticatedUser } from "../_shared/access.js";
import { getCloudCopyStatus } from "../_shared/cloud-copy.js";
import { requireD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse } from "../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);

    return jsonResponse(await getCloudCopyStatus(db, user));
  } catch (error) {
    return errorResponse(error);
  }
}
