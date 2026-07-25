import { describe, expect, it } from "vitest";
import {
  ACCESS_CONFIG_MISSING,
  ACCESS_JWT_HEADER,
  ACCESS_TOKEN_INVALID,
  LOCAL_DEV_AUTH_USER,
  getCurrentUserFromRequest,
  isLocalDevAuthRequest,
  requireAuthenticatedUser,
} from "../../functions/_shared/access.js";
import { buildHealthPayload } from "../../functions/api/health.js";

const ACCESS_ENV = {
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "asset-agent-aud",
};
const NOW_SECONDS = 1_782_240_000;

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonToBase64Url(payload) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

async function createSignedAccessJwt(payloadOverrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const publicJwk = {
    ...jwk,
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const encodedHeader = jsonToBase64Url({ alg: "RS256", typ: "JWT", kid: publicJwk.kid });
  const encodedPayload = jsonToBase64Url({
    iss: ACCESS_ENV.ACCESS_TEAM_DOMAIN,
    aud: ACCESS_ENV.ACCESS_AUD,
    exp: NOW_SECONDS + 3600,
    nbf: NOW_SECONDS - 60,
    sub: "user-subject",
    email: "owner@example.com",
    name: "Asset Owner",
    ...payloadOverrides,
  });
  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);

  return {
    token: `${encodedHeader}.${encodedPayload}.${toBase64Url(signature)}`,
    jwks: { keys: [publicJwk] },
  };
}

function requestWithToken(token) {
  return new Request("https://asset-agent.test/api/health", {
    headers: token ? { [ACCESS_JWT_HEADER]: token } : {},
  });
}

function requestTo(url, headers = {}) {
  return new Request(url, { headers });
}

function createD1Binding() {
  return {
    prepare(sql) {
      return {
        async first() {
          return sql === "SELECT 1 AS ok" ? { ok: 1 } : null;
        },
      };
    },
  };
}

describe("Cloudflare Access JWT helper", () => {
  it.each(["http://localhost:5173/api/health", "http://127.0.0.1:5173/api/health", "http://[::1]:5173/api/health"])(
    "LOCAL_DEV_AUTH=true 且 loopback hostname 時回固定 local identity: %s",
    async (url) => {
      const request = requestTo(url, {
        Authorization: "Bearer fake-user-token",
        "X-User-Email": "attacker@example.com",
        "X-User-Id": "attacker-user",
      });

      await expect(getCurrentUserFromRequest(request, { LOCAL_DEV_AUTH: "true" })).resolves.toEqual(
        LOCAL_DEV_AUTH_USER,
      );
      await expect(requireAuthenticatedUser(request, { LOCAL_DEV_AUTH: "true" })).resolves.toEqual(
        LOCAL_DEV_AUTH_USER,
      );
      expect(isLocalDevAuthRequest(request, { LOCAL_DEV_AUTH: "true" })).toBe(true);
    },
  );

  it("LOCAL_DEV_AUTH=false 時 localhost 不得使用 stub，缺 token 仍拒絕", async () => {
    const request = requestTo("http://localhost:5173/api/health");

    await expect(getCurrentUserFromRequest(request, { LOCAL_DEV_AUTH: "false" })).resolves.toBeNull();
    await expect(requireAuthenticatedUser(request, { LOCAL_DEV_AUTH: "false" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("LOCAL_DEV_AUTH 未設定時 localhost 不得使用 stub", async () => {
    const request = requestTo("http://localhost:5173/api/health");

    await expect(getCurrentUserFromRequest(request, {})).resolves.toBeNull();
  });

  it.each([
    "https://asset-manager-30u.pages.dev/api/health",
    "https://7e04689.asset-agent.pages.dev/api/health",
  ])("LOCAL_DEV_AUTH=true 但非 localhost hostname 時不得使用 stub: %s", async (url) => {
    const request = requestTo(url);

    await expect(getCurrentUserFromRequest(request, { LOCAL_DEV_AUTH: "true" })).resolves.toBeNull();
    await expect(requireAuthenticatedUser(request, { LOCAL_DEV_AUTH: "true" })).rejects.toMatchObject({
      status: 401,
    });
    expect(isLocalDevAuthRequest(request, { LOCAL_DEV_AUTH: "true" })).toBe(false);
  });

  it("LOCAL_DEV_AUTH=true 但 production hostname 有有效 Access JWT 時仍走真實 JWT identity", async () => {
    const { token, jwks } = await createSignedAccessJwt();
    const request = requestTo("https://asset-manager-30u.pages.dev/api/health", {
      [ACCESS_JWT_HEADER]: token,
      "X-User-Email": "attacker@example.com",
    });

    await expect(
      getCurrentUserFromRequest(
        request,
        {
          ...ACCESS_ENV,
          LOCAL_DEV_AUTH: "true",
        },
        {
          fetchJwks: async () => jwks.keys,
          now: () => NOW_SECONDS * 1000,
        },
      ),
    ).resolves.toEqual({
      id: "user-subject",
      sub: "user-subject",
      email: "owner@example.com",
      name: "Asset Owner",
    });
  });

  it("missing token returns null user and requireAuthenticatedUser returns 401", async () => {
    const request = requestWithToken("");

    await expect(getCurrentUserFromRequest(request, ACCESS_ENV)).resolves.toBeNull();
    await expect(requireAuthenticatedUser(request, ACCESS_ENV)).rejects.toMatchObject({ status: 401 });
  });

  it("missing ACCESS config returns a safe configuration error", async () => {
    const { token, jwks } = await createSignedAccessJwt();

    await expect(
      getCurrentUserFromRequest(requestWithToken(token), {}, { fetchJwks: async () => jwks }),
    ).rejects.toMatchObject({
      status: 503,
      code: ACCESS_CONFIG_MISSING,
    });
  });

  it("invalid token returns 401", async () => {
    await expect(
      getCurrentUserFromRequest(requestWithToken("not-a-valid-jwt"), ACCESS_ENV, {
        fetchJwks: async () => ({ keys: [] }),
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: ACCESS_TOKEN_INVALID,
    });
  });

  it("valid token mock returns verified user identity", async () => {
    const { token, jwks } = await createSignedAccessJwt();
    const user = await getCurrentUserFromRequest(requestWithToken(token), ACCESS_ENV, {
      fetchJwks: async () => jwks.keys,
      now: () => NOW_SECONDS * 1000,
    });

    expect(user).toEqual({
      id: "user-subject",
      sub: "user-subject",
      email: "owner@example.com",
      name: "Asset Owner",
    });
  });

  it("valid signature with wrong AUD is rejected", async () => {
    const { token, jwks } = await createSignedAccessJwt({ aud: "wrong-aud" });

    await expect(
      getCurrentUserFromRequest(requestWithToken(token), ACCESS_ENV, {
        fetchJwks: async () => jwks.keys,
        now: () => NOW_SECONDS * 1000,
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: ACCESS_TOKEN_INVALID,
    });
  });
});

describe("Cloudflare health API payload", () => {
  it("reports missing D1 binding and missing Access config without failing", async () => {
    const payload = await buildHealthPayload({
      request: requestWithToken(""),
      env: {},
    });

    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        mode: "localStorage-primary-cloud-foundation",
        hasD1Binding: false,
        hasAccessConfig: false,
        d1Reachable: false,
        authenticated: false,
      }),
    );
  });

  it("reports D1 binding reachability when ASSET_AGENT_DB exists", async () => {
    const payload = await buildHealthPayload({
      request: requestWithToken(""),
      env: {
        ASSET_AGENT_DB: createD1Binding(),
      },
    });

    expect(payload.hasD1Binding).toBe(true);
    expect(payload.d1Reachable).toBe(true);
    expect(payload.d1Status).toBe("ok");
  });

  it("reports authenticated user when Access verification succeeds", async () => {
    const payload = await buildHealthPayload({
      request: requestWithToken(""),
      env: {
        ...ACCESS_ENV,
        ASSET_AGENT_DB: createD1Binding(),
      },
      getUser: async () => ({
        id: "user-subject",
        sub: "user-subject",
        email: "owner@example.com",
        name: "Asset Owner",
      }),
    });

    expect(payload).toEqual(
      expect.objectContaining({
        hasAccessConfig: true,
        authenticated: true,
        authStatus: "verified",
        userEmail: "owner@example.com",
      }),
    );
  });
});
