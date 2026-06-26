import { requireAuthenticatedUser } from "../../_shared/access.js";
import { createCloudSnapshotFromBody, listCloudSnapshots } from "../../_shared/cloud-copy.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const snapshots = await listCloudSnapshots(db, user);

    return jsonResponse({ ok: true, snapshots });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const snapshot = await createCloudSnapshotFromBody({
      db,
      user,
      body: await readJsonBody(request),
    });

    return jsonResponse({ ok: true, snapshot }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
