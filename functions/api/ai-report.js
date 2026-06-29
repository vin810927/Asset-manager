import { requireAuthenticatedUser } from "../_shared/access.js";
import { createHttpError, errorResponse, jsonResponse, readJsonBody } from "../_shared/http.js";

const AI_READY_PURPOSE = "asset-agent-ai-report-input";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const REJECTED_RAW_DATA_KEYS = new Set(["assets", "rawAssets", "assetRows", "holdings", "transactions", "snapshots"]);
const OMITTED_IDENTITY_KEYS = new Set([
  "user_id",
  "userId",
  "email",
  "token",
  "jwt",
  "accessToken",
  "authorization",
  "ACCESS_AUD",
  "ACCESS_TEAM_DOMAIN",
  "OPENAI_API_KEY",
]);

export function isAiReportEnabled(env = {}) {
  return String(env.ENABLE_AI_REPORT ?? "").trim() === "true";
}

export const AI_REPORT_SYSTEM_PROMPT = [
  "你是 Asset Agent 的資產報告整理助手。",
  "你只能根據使用者提供的 AI-ready JSON 產生繁體中文 Markdown 報告。",
  "禁止提供買進、賣出、加碼、減碼或具體標的推薦。",
  "不要推測缺漏市價，不要編造 AI-ready JSON 沒有提供的資料。",
  "所有高影響事項都必須改寫為建議人工確認。",
  "資料品質不足時，優先提醒補資料。",
  "不要輸出任何登入憑證、密鑰或環境變數值。",
].join("\n");

export const AI_REPORT_DEVELOPER_PROMPT = [
  "請輸出 Markdown，固定使用以下結構：",
  "# 資產狀況摘要",
  "## 1. 總覽",
  "## 2. 主要曝險",
  "## 3. 風險提醒",
  "## 4. 資料品質",
  "## 5. 建議人工檢查事項",
  "## 6. Disclaimer",
  "",
  "規則：",
  "- 只根據 riskFlags 撰寫風險提醒。",
  "- 只根據 actionItems 撰寫人工檢查事項。",
  "- 使用 info / warning / critical 的語氣差異，但不要誇大。",
  "- 報告必須明確寫：本報告不是投資建議。",
  "- 報告必須明確寫：僅根據目前 App 已載入資料。",
  "- 若有缺漏市價、過期資料或單位提醒，必須提醒先更新或確認資料。",
].join("\n");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw createHttpError(`${label} must be an object.`, 400, "invalid-ai-ready-report");
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw createHttpError(`${label} must be an array.`, 400, "invalid-ai-ready-report");
  }
}

function cleanStructuredValue(value, path = "") {
  if (Array.isArray(value)) {
    return value.map((item, index) => cleanStructuredValue(item, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
    return null;
  }

  const cleaned = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (REJECTED_RAW_DATA_KEYS.has(key)) {
      throw createHttpError(`AI-ready report must not include raw ${key}.`, 400, "raw-data-not-allowed");
    }

    if (OMITTED_IDENTITY_KEYS.has(key)) continue;
    cleaned[key] = cleanStructuredValue(nestedValue, path ? `${path}.${key}` : key);
  }

  return cleaned;
}

function normalizeRiskFlags(items) {
  return items.map((item) => ({
    id: String(item?.id ?? item?.code ?? "unknown"),
    severity: String(item?.severity ?? "info"),
    category: String(item?.category ?? "review"),
    title: String(item?.title ?? "需要人工檢視"),
    message: String(item?.message ?? ""),
    relatedAssetIds: Array.isArray(item?.relatedAssetIds) ? item.relatedAssetIds.map(String) : [],
  }));
}

function normalizeActionItems(items) {
  return items.map((item) => ({
    id: String(item?.id ?? item?.code ?? "unknown"),
    priority: String(item?.priority ?? "medium"),
    category: String(item?.category ?? "review"),
    title: String(item?.title ?? "需要人工檢視"),
    message: String(item?.message ?? ""),
    relatedAssetIds: Array.isArray(item?.relatedAssetIds) ? item.relatedAssetIds.map(String) : [],
  }));
}

export function validateAiReadyReportInput(payload) {
  assertPlainObject(payload, "AI-ready report");

  if (payload.purpose !== AI_READY_PURPOSE) {
    throw createHttpError("AI-ready report purpose is invalid.", 400, "invalid-ai-ready-report");
  }

  assertPlainObject(payload.source, "AI-ready report source");
  assertPlainObject(payload.financialSummary, "AI-ready report financialSummary");
  assertPlainObject(payload.allocationSummary, "AI-ready report allocationSummary");
  assertPlainObject(payload.riskSummary, "AI-ready report riskSummary");
  assertPlainObject(payload.dataQuality, "AI-ready report dataQuality");
  assertPlainObject(payload.constraints, "AI-ready report constraints");
  assertArray(payload.riskSummary.riskFlags, "AI-ready report riskFlags");
  assertArray(payload.riskSummary.actionItems, "AI-ready report actionItems");

  if (payload.constraints.doNotProvideBuySellInstructions !== true) {
    throw createHttpError("AI-ready report constraints are missing buy/sell guard.", 400, "invalid-ai-ready-report");
  }

  const cleaned = cleanStructuredValue(payload);

  return {
    schemaVersion: Number(cleaned.schemaVersion) || 1,
    purpose: AI_READY_PURPOSE,
    generatedAt: String(cleaned.generatedAt ?? new Date().toISOString()),
    language: "zh-TW",
    disclaimer: String(cleaned.disclaimer ?? "This is structured input for future AI narration. It is not investment advice."),
    source: cleaned.source,
    financialSummary: cleaned.financialSummary,
    allocationSummary: cleaned.allocationSummary,
    riskSummary: {
      riskFlags: normalizeRiskFlags(cleaned.riskSummary.riskFlags),
      actionItems: normalizeActionItems(cleaned.riskSummary.actionItems),
    },
    dataQuality: cleaned.dataQuality,
    reportMetadata: isPlainObject(cleaned.reportMetadata) ? cleaned.reportMetadata : {},
    constraints: {
      doNotProvideBuySellInstructions: true,
      doNotInferMissingMarketPrices: cleaned.constraints.doNotInferMissingMarketPrices === true,
      askForConfirmationBeforeHighImpactAdvice: cleaned.constraints.askForConfirmationBeforeHighImpactAdvice === true,
    },
  };
}

export function buildAiReportPrompt(aiReadyReport) {
  return [
    AI_REPORT_DEVELOPER_PROMPT,
    "",
    "以下是唯一可使用的 AI-ready JSON。請勿要求或推測 raw assets。",
    "```json",
    JSON.stringify(aiReadyReport, null, 2),
    "```",
  ].join("\n");
}

export function buildOpenAiRequestBody(aiReadyReport, model) {
  return {
    model,
    instructions: AI_REPORT_SYSTEM_PROMPT,
    input: buildAiReportPrompt(aiReadyReport),
  };
}

function getOpenAiConfig(env = {}) {
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();

  if (!apiKey) {
    throw createHttpError("OPENAI_API_KEY is not configured.", 503, "openai-api-key-missing");
  }

  return {
    apiKey,
    model: String(env.OPENAI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL,
  };
}

function extractOpenAiMarkdown(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const outputText = (payload?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (outputText) return outputText;

  const chatText = payload?.choices?.[0]?.message?.content;
  if (typeof chatText === "string" && chatText.trim()) return chatText;

  throw createHttpError("AI report response format is invalid.", 502, "invalid-openai-response");
}

export async function callOpenAiForNarrative({ aiReadyReport, apiKey, model, fetcher = globalThis.fetch }) {
  if (typeof fetcher !== "function") {
    throw createHttpError("AI report fetch is unavailable.", 503, "openai-fetch-unavailable");
  }

  const response = await fetcher(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildOpenAiRequestBody(aiReadyReport, model)),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with ${response.status}.`;
    throw createHttpError(`AI report generation failed: ${message}`, 502, "openai-request-failed");
  }

  return extractOpenAiMarkdown(payload);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAiReportEnabled(env)) {
      throw createHttpError("AI report is disabled.", 403, "ai-report-disabled");
    }

    await requireAuthenticatedUser(request, env);

    const aiReadyReport = validateAiReadyReportInput(await readJsonBody(request));
    const { apiKey, model } = getOpenAiConfig(env);
    const markdown = await callOpenAiForNarrative({ aiReadyReport, apiKey, model });

    return jsonResponse({
      ok: true,
      markdown,
      model,
      generatedAt: new Date().toISOString(),
      source: {
        inputPurpose: AI_READY_PURPOSE,
        dataSourceMode: aiReadyReport.source.dataSourceMode ?? null,
        cloudMode: Boolean(aiReadyReport.source.cloudMode),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
