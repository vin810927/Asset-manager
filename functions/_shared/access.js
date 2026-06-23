import { createHttpError } from "./http.js";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
export const ACCESS_AUTH_COOKIE = "CF_Authorization";
export const ACCESS_CONFIG_MISSING = "access-config-missing";
export const ACCESS_TOKEN_MISSING = "access-token-missing";
export const ACCESS_TOKEN_INVALID = "access-token-invalid";

const CLOCK_TOLERANCE_SECONDS = 60;

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return "";

  const rawValue = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  return rawValue ? decodeCookieValue(rawValue) : "";
}

export function getAccessJwtFromRequest(request) {
  return request.headers.get(ACCESS_JWT_HEADER) || getCookieValue(request.headers.get("Cookie"), ACCESS_AUTH_COOKIE);
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlToJson(value) {
  const bytes = base64UrlToBytes(value);
  const text = new TextDecoder().decode(bytes);

  return JSON.parse(text);
}

function normalizeTeamDomain(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";

  const withProtocol = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "https:") {
    throw createHttpError("Cloudflare Access configuration is invalid.", 503, ACCESS_CONFIG_MISSING);
  }

  return url.origin;
}

export function getAccessConfig(env = {}) {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = String(env.ACCESS_AUD ?? "").trim();

  if (!teamDomain || !audience) {
    throw createHttpError("Cloudflare Access configuration is missing.", 503, ACCESS_CONFIG_MISSING);
  }

  return { teamDomain, audience };
}

export function hasAccessConfig(env = {}) {
  try {
    getAccessConfig(env);
    return true;
  } catch {
    return false;
  }
}

async function fetchAccessJwks(teamDomain, fetcher = globalThis.fetch) {
  if (typeof fetcher !== "function") {
    throw createHttpError("Cloudflare Access JWKS fetch is unavailable.", 503, ACCESS_CONFIG_MISSING);
  }

  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`);

  if (!response.ok) {
    throw createHttpError("Cloudflare Access JWKS fetch failed.", 401, ACCESS_TOKEN_INVALID);
  }

  const jwks = await response.json();
  return Array.isArray(jwks.keys) ? jwks.keys : [];
}

function getExpectedAudience(payloadAudience) {
  return Array.isArray(payloadAudience) ? payloadAudience.map(String) : [String(payloadAudience ?? "")];
}

function assertAccessClaims(payload, { teamDomain, audience }, nowSeconds) {
  if (payload.iss !== teamDomain) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  if (!getExpectedAudience(payload.aud).includes(audience)) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  if (!Number.isFinite(payload.exp) || payload.exp + CLOCK_TOLERANCE_SECONDS < nowSeconds) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  if (Number.isFinite(payload.nbf) && payload.nbf - CLOCK_TOLERANCE_SECONDS > nowSeconds) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }
}

function createUserFromPayload(payload) {
  const sub = payload.sub ? String(payload.sub) : "";
  const email = payload.email ? String(payload.email) : "";
  const name = payload.name ? String(payload.name) : "";
  const id = sub || email;

  if (!id) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  return { id, sub, email, name };
}

export async function verifyAccessJwt(token, env = {}, options = {}) {
  const config = getAccessConfig(env);
  const [encodedHeader, encodedPayload, encodedSignature] = String(token).split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  let header;
  let payload;

  try {
    header = base64UrlToJson(encodedHeader);
    payload = base64UrlToJson(encodedPayload);
  } catch {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  const fetchJwks = options.fetchJwks ?? fetchAccessJwks;
  const jwks = await fetchJwks(config.teamDomain, options.fetcher);
  const jwk = jwks.find((key) => key.kid === header.kid && key.kty === "RSA");

  if (!jwk) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  const cryptoImpl = options.crypto ?? globalThis.crypto;
  const subtle = cryptoImpl?.subtle;

  if (!subtle) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  const key = await subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  const verified = await subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);

  if (!verified) {
    throw createHttpError("Cloudflare Access JWT verification failed.", 401, ACCESS_TOKEN_INVALID);
  }

  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  assertAccessClaims(payload, config, Math.floor(nowMs / 1000));

  return createUserFromPayload(payload);
}

export async function getCurrentUserFromRequest(request, env = {}, options = {}) {
  const token = getAccessJwtFromRequest(request);
  if (!token) return null;

  return verifyAccessJwt(token, env, options);
}

export async function requireAuthenticatedUser(request, env = {}, options = {}) {
  const user = await getCurrentUserFromRequest(request, env, options);

  if (!user) {
    throw createHttpError("Unauthorized: missing Cloudflare Access JWT.", 401, ACCESS_TOKEN_MISSING);
  }

  return user;
}
