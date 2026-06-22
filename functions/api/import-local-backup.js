import { requireAuthenticatedUser } from "../_shared/access.js";
import { requireD1Database } from "../_shared/db.js";
import { createHttpError, errorResponse, readJsonBody } from "../_shared/http.js";

export async function onRequestPost({ request, env }) {
  try {
    await requireAuthenticatedUser(request, env);
    requireD1Database(env);
    await readJsonBody(request);

    throw createHttpError("Import local backup to D1 is intentionally not implemented until v0.8 sync.", 501);
  } catch (error) {
    return errorResponse(error);
  }
}
