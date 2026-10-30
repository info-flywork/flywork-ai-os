const DEFAULT_TIMEOUT_MS = 8000;

async function probeHttpUrl(url, options = {}) {
  const { expectJson = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

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

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: expectJson ? "application/json" : "*/*",
        ...(options.headers || {})
      }
    });

    const statusCode = response.status;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const bodySnippet = text.slice(0, 2000);

    let bodyJson = null;
    if (expectJson || contentType.includes("application/json")) {
      try {
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        bodyJson = null;
      }
    }

    const ok = response.ok;

    return {
      ok,
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

module.exports = {
  probeHttpUrl
};
