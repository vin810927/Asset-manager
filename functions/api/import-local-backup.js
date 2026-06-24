import { requireAuthenticatedUser } from "../_shared/access.js";
import { importLocalBackupToCloudCopy } from "../_shared/cloud-copy.js";
import { requireD1Database } from "../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const payload = await readJsonBody(request);
    const result = await importLocalBackupToCloudCopy({ db, user, payload });

    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
