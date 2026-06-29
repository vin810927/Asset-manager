import { buildAiReadyReportInput } from "./buildAssetReport.js";

const DEFAULT_AI_REPORT_ENDPOINT = "/api/ai-report";
const DEFAULT_AI_REPORT_UI_ENV = import.meta.env ?? {};

export function isAiNarrativeReportUiEnabled(env = DEFAULT_AI_REPORT_UI_ENV) {
  return String(env.VITE_ENABLE_AI_REPORT ?? env.ENABLE_AI_REPORT ?? "").trim() === "true";
}

export function buildGptAnalysisPrompt(report) {
  const aiReadyPayload = buildAiReadyReportInput(report);

  return [
    "請用繁體中文協助整理以下 Asset Agent AI-ready JSON。",
    "請只做資產狀況摘要、風險提醒、資料品質提醒、待確認事項與下一步人工檢查清單。",
    "請不要提供買進、賣出、加碼、減碼或具體標的推薦；不要推測缺漏市價。",
    "請明確標示：這不是投資建議。",
    "",
    "```json",
    JSON.stringify(aiReadyPayload, null, 2),
    "```",
  ].join("\n");
}

export async function copyGptAnalysisPrompt(report, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard || typeof clipboard.writeText !== "function") {
    throw new Error("此瀏覽器不支援剪貼簿功能。");
  }

  await clipboard.writeText(buildGptAnalysisPrompt(report));
  return true;
}

async function parseAiReportResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `AI report request failed with ${response.status}.`);
  }

  if (typeof payload?.markdown !== "string" || !payload.markdown.trim()) {
    throw new Error("AI 報告回應格式不正確。");
  }

  return {
    markdown: payload.markdown,
    generatedAt: payload.generatedAt ?? new Date().toISOString(),
    model: payload.model ?? "",
  };
}

export function buildAiNarrativeReportPayload(report) {
  return buildAiReadyReportInput(report);
}

export function getAiNarrativeReportFileName(report) {
  const date = String(report?.generatedAt || new Date().toISOString()).slice(0, 10);
  return `asset-agent-ai-report-${date}.md`;
}

export async function requestAiNarrativeReport({
  report,
  fetcher = globalThis.fetch,
  endpoint = DEFAULT_AI_REPORT_ENDPOINT,
} = {}) {
  if (typeof fetcher !== "function") {
    throw new Error("AI report fetch API is unavailable.");
  }

  const aiReadyPayload = buildAiNarrativeReportPayload(report);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(aiReadyPayload),
  });

  return parseAiReportResponse(response);
}

export async function copyAiReportMarkdown(markdown, clipboard = globalThis.navigator?.clipboard) {
  if (!markdown) {
    throw new Error("尚無 AI 報告可複製。");
  }

  if (!clipboard || typeof clipboard.writeText !== "function") {
    throw new Error("此瀏覽器不支援剪貼簿功能。");
  }

  await clipboard.writeText(markdown);
  return true;
}
