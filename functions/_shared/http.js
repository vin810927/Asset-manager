export function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function createHttpError(message, status = 500, code = "") {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = error?.message || "Internal server error.";

  return jsonResponse({ ok: false, error: message, code: error?.code }, { status });
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw createHttpError("Request body must be valid JSON.", 400);
  }
}
