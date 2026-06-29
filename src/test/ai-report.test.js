import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_REPORT_SYSTEM_PROMPT,
  buildAiReportPrompt,
  buildOpenAiRequestBody,
  onRequestPost as onAiReportPost,
  validateAiReadyReportInput,
} from "../../functions/api/ai-report.js";
import { ACCESS_JWT_HEADER } from "../../functions/_shared/access.js";
import { buildAiReadyReportInput, buildAssetReport, buildMarkdownAssetReport } from "../report/buildAssetReport.js";
import {
  buildAiNarrativeReportPayload,
  copyAiReportMarkdown,
  getAiNarrativeReportFileName,
  requestAiNarrativeReport,
} from "../report/aiNarrativeReport.js";
import { assetsFixture, exchangeRatesFixture, financialGoalsFixture, FIXED_NOW } from "./fixtures.js";

const ACCESS_ENV = {
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "asset-agent-aud",
};

const OPENAI_ENV = {
  ...ACCESS_ENV,
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "test-model",
};

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
    kid: "ai-report-test-key",
    alg: "RS256",
    use: "sig",
  };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const encodedHeader = jsonToBase64Url({ alg: "RS256", typ: "JWT", kid: publicJwk.kid });
  const encodedPayload = jsonToBase64Url({
    iss: ACCESS_ENV.ACCESS_TEAM_DOMAIN,
    aud: ACCESS_ENV.ACCESS_AUD,
    exp: nowSeconds + 3600,
    nbf: nowSeconds - 60,
    sub: "verified-user-id",
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

function createReport() {
  return buildAssetReport({
    assets: assetsFixture,
    financialGoals: financialGoalsFixture,
    exchangeRates: exchangeRatesFixture,
    snapshots: [{ id: "snapshot", createdAt: "2026-06-15T12:00:00.000Z" }],
    dataSourceMode: "cloudflare-d1",
    cloudMode: true,
    generatedAt: FIXED_NOW,
    now: new Date(FIXED_NOW),
  });
}

function createAiReadyPayload(overrides = {}) {
  return {
    ...buildAiReadyReportInput(createReport()),
    ...overrides,
  };
}

async function createAuthenticatedRequest(body, { method = "POST" } = {}) {
  const { token, jwks } = await createSignedAccessJwt();

  return {
    request: new Request("https://asset-agent.test/api/ai-report", {
      method,
      headers: {
        [ACCESS_JWT_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    jwks,
  };
}

function stubAiReportFetch(jwks, { openAiResponse = "# 資產狀況摘要\n\n## 6. Disclaimer\n本報告不是投資建議。", capture = {} } = {}) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.includes("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
    }

    if (urlText === "https://api.openai.com/v1/responses") {
      capture.openAiBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: openAiResponse }), {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch URL: ${urlText}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI narrative report API", () => {
  it("POST /api/ai-report 未登入回 401", async () => {
    const response = await onAiReportPost({
      request: new Request("https://asset-agent.test/api/ai-report", {
        method: "POST",
        body: JSON.stringify(createAiReadyPayload()),
      }),
      env: OPENAI_ENV,
    });

    expect(response.status).toBe(401);
  });

  it("缺少 OPENAI_API_KEY 時回可讀錯誤，不 crash", async () => {
    const { request, jwks } = await createAuthenticatedRequest(createAiReadyPayload());
    stubAiReportFetch(jwks);

    const response = await onAiReportPost({ request, env: ACCESS_ENV });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("OPENAI_API_KEY");
  });

  it("malformed AI-ready JSON 回 400", async () => {
    const { request, jwks } = await createAuthenticatedRequest({ purpose: "raw-assets" });
    const fetchMock = stubAiReportFetch(jwks);

    const response = await onAiReportPost({ request, env: OPENAI_ENV });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AI-ready JSON 即使包含 user_id / email，也不會放進 prompt", async () => {
    const body = createAiReadyPayload({
      user_id: "malicious-user",
      email: "attacker@example.com",
    });
    const { request, jwks } = await createAuthenticatedRequest(body);
    const capture = {};
    stubAiReportFetch(jwks, { capture });

    const response = await onAiReportPost({ request, env: OPENAI_ENV });

    expect(response.status).toBe(200);
    expect(JSON.stringify(capture.openAiBody)).not.toContain("malicious-user");
    expect(JSON.stringify(capture.openAiBody)).not.toContain("attacker@example.com");
  });

  it("API 不讀 D1 raw assets，也不寫 D1", async () => {
    const { request, jwks } = await createAuthenticatedRequest(createAiReadyPayload());
    stubAiReportFetch(jwks);
    const d1 = {
      prepare() {
        throw new Error("D1 should not be used by AI report.");
      },
    };

    const response = await onAiReportPost({
      request,
      env: {
        ...OPENAI_ENV,
        ASSET_AGENT_DB: d1,
      },
    });

    expect(response.status).toBe(200);
  });

  it("Prompt 不包含敏感設定字串，並包含禁止買賣建議限制", () => {
    const aiReady = validateAiReadyReportInput(
      createAiReadyPayload({
        ACCESS_AUD: "secret-aud",
        ACCESS_TEAM_DOMAIN: "secret-team",
        email: "owner@example.com",
      }),
    );
    const prompt = buildAiReportPrompt(aiReady);
    const openAiBodyText = JSON.stringify(buildOpenAiRequestBody(aiReady, "test-model"));

    expect(prompt).not.toContain("ACCESS_AUD");
    expect(prompt).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(prompt).not.toContain("secret-aud");
    expect(prompt).not.toContain("secret-team");
    expect(prompt).not.toContain("owner@example.com");
    expect(prompt).not.toMatch(/\bJWT\b/i);
    expect(prompt).not.toMatch(/\btoken\b/i);
    expect(AI_REPORT_SYSTEM_PROMPT).toContain("禁止提供買進、賣出、加碼、減碼或具體標的推薦");
    expect(openAiBodyText).toContain("禁止提供買進");
  });

  it("模擬 AI response 時可回傳 Markdown", async () => {
    const { request, jwks } = await createAuthenticatedRequest(createAiReadyPayload());
    stubAiReportFetch(jwks, {
      openAiResponse: "# 資產狀況摘要\n\n## 1. 總覽\n這是草稿。\n\n## 6. Disclaimer\n本報告不是投資建議。",
    });

    const response = await onAiReportPost({ request, env: OPENAI_ENV });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("# 資產狀況摘要");
    expect(payload.markdown).toContain("本報告不是投資建議");
    expect(payload.model).toBe("test-model");
  });
});

describe("AI narrative report frontend helpers", () => {
  it("generate AI report 使用 buildAiReadyReportInput(report)，不把 raw assets 傳給 AI endpoint", async () => {
    const report = createReport();
    const fetcher = vi.fn(async (_url, options = {}) => {
      const payload = JSON.parse(options.body);

      expect(payload).toEqual(buildAiNarrativeReportPayload(report));
      expect(payload.purpose).toBe("asset-agent-ai-report-input");
      expect(payload.assets).toBeUndefined();
      expect(payload.rawAssets).toBeUndefined();

      return new Response(JSON.stringify({ markdown: "# 資產狀況摘要\n\n本報告不是投資建議。" }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(requestAiNarrativeReport({ report, fetcher })).resolves.toEqual(
      expect.objectContaining({
        markdown: expect.stringContaining("# 資產狀況摘要"),
      }),
    );
  });

  it("API 失敗時 deterministic report 仍可用", async () => {
    const report = createReport();
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY is not configured." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(requestAiNarrativeReport({ report, fetcher })).rejects.toThrow("OPENAI_API_KEY");
    expect(buildMarkdownAssetReport(report)).toContain("本報告為規則型摘要");
  });

  it("copy / download Markdown helper 正常", async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };

    await expect(copyAiReportMarkdown("# 資產狀況摘要", clipboard)).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("# 資產狀況摘要");
    expect(getAiNarrativeReportFileName(createReport())).toBe("asset-agent-ai-report-2026-06-15.md");
  });
});
