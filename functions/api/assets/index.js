import { requireAuthenticatedUser } from "../../_shared/access.js";
import { createCloudAsset, getCloudCopyAssets } from "../../_shared/cloud-copy.js";
import { requireD1Database } from "../../_shared/db.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../_shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const assets = await getCloudCopyAssets(db, user);

    return jsonResponse({ ok: true, assets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAuthenticatedUser(request, env);
    const db = requireD1Database(env);
    const asset = await createCloudAsset({
      db,
      user,
      asset: await readJsonBody(request),
    });

    return jsonResponse({ ok: true, asset }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
