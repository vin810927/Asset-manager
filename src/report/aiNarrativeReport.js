import { buildAiReadyReportInput } from "./buildAssetReport.js";

const DEFAULT_AI_REPORT_ENDPOINT = "/api/ai-report";

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
