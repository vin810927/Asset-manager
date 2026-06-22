import { createHttpError } from "./http.js";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
export const ACCESS_AUTH_COOKIE = "CF_Authorization";

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return "";

  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
}

export function getAccessJwtFromRequest(request) {
  return request.headers.get(ACCESS_JWT_HEADER) || getCookieValue(request.headers.get("Cookie"), ACCESS_AUTH_COOKIE);
}

export async function getCurrentUserFromRequest(request, env = {}) {
  const token = getAccessJwtFromRequest(request);
  if (!token) return null;

  // v0.7 intentionally does not trust unverified headers, cookies, or front-end supplied email.
  // TODO(v0.8): verify the Access JWT with ACCESS_TEAM_DOMAIN + ACCESS_AUD and Cloudflare Access JWKS,
  // then return a stable user id from the verified JWT subject plus the verified email claim.
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  return null;
}

export async function requireAuthenticatedUser(request, env = {}) {
  const user = await getCurrentUserFromRequest(request, env);

  if (!user) {
    throw createHttpError("Unauthorized: Cloudflare Access JWT verification is not configured in v0.7.", 401);
  }

  return user;
}
