const { Agent } = require("undici");

const DEFAULT_TIMEOUT_MS = 8000;
const MULTIPART_TIMEOUT_MS = 180000;

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false }
});

function insecureTlsHosts() {
  return String(process.env.PANEL_INSECURE_TLS_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function shouldUseInsecureTls(parsedUrl) {
  if (parsedUrl.protocol !== "https:") return false;
  const host = String(parsedUrl.hostname || "").toLowerCase();
  return insecureTlsHosts().includes(host);
}

async function requestExternalUrl(url, options = {}) {
  const { method = "GET", body, expectJson = true, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = options;

  if (!url || typeof url !== "string") {
    return { ok: false, error: "URL bos." };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Gecersiz URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Sadece http veya https desteklenir." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    Accept: expectJson ? "application/json" : "*/*",
    ...headers
  };

  let requestBody;
  if (body != null && method !== "GET" && method !== "HEAD") {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: requestHeaders,
      body: requestBody,
      dispatcher: shouldUseInsecureTls(parsed) ? insecureDispatcher : undefined
    });

    const statusCode = response.status;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const bodySnippet = text.slice(0, 4000);

    let bodyJson = null;
    if (expectJson || contentType.includes("application/json")) {
      try {
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        bodyJson = null;
      }
    }

    return {
      ok: response.ok,
      statusCode,
      contentType,
      bodyJson,
      bodySnippet: bodySnippet || undefined
    };
  } catch (error) {
    const message = error?.name === "AbortError" ? "Zaman asimi." : error?.message || "Istek basarisiz.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function requestExternalFormData(url, options = {}) {
  const {
    method = "POST",
    formData,
    expectJson = true,
    timeoutMs = MULTIPART_TIMEOUT_MS,
    headers = {}
  } = options;

  if (!url || typeof url !== "string") {
    return { ok: false, error: "URL bos." };
  }
  if (!formData) {
    return { ok: false, error: "FormData bos." };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Gecersiz URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Sadece http veya https desteklenir." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    Accept: expectJson ? "application/json" : "*/*",
    ...headers
  };

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: requestHeaders,
      body: formData,
      dispatcher: shouldUseInsecureTls(parsed) ? insecureDispatcher : undefined
    });

    const statusCode = response.status;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const bodySnippet = text.slice(0, 4000);

    let bodyJson = null;
    if (expectJson || contentType.includes("application/json")) {
      try {
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        bodyJson = null;
      }
    }

    return {
      ok: response.ok,
      statusCode,
      contentType,
      bodyJson,
      bodySnippet: bodySnippet || undefined
    };
  } catch (error) {
    const message = error?.name === "AbortError" ? "Yukleme zaman asimi." : error?.message || "Istek basarisiz.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  requestExternalUrl,
  requestExternalFormData,
  MULTIPART_TIMEOUT_MS
};
