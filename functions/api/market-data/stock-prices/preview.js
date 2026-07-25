import { requireAuthenticatedUser } from "../../../_shared/access.js";
import { errorResponse, jsonResponse, readJsonBody } from "../../../_shared/http.js";
import { buildStockPricePreview, assertMarketDataUpdateEnabled } from "../../../_shared/market-data.js";

export async function onRequestPost({ request, env }) {
  try {
    assertMarketDataUpdateEnabled(env);
    await requireAuthenticatedUser(request, env);

    const preview = await buildStockPricePreview({
      body: await readJsonBody(request),
      env,
    });

    return jsonResponse(preview);
  } catch (error) {
    return errorResponse(error);
  }
}
