import { createHttpError } from "./http.js";

export const D1_BINDING_NAME = "ASSET_AGENT_DB";

export function getD1Database(env = {}) {
  return env[D1_BINDING_NAME] ?? null;
}

export function requireD1Database(env = {}) {
  const db = getD1Database(env);

  if (!db) {
    throw createHttpError(`Cloudflare D1 binding ${D1_BINDING_NAME} is not configured.`, 503);
  }

  return db;
}
