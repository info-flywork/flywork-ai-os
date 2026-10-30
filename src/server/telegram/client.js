 

export async function postTelegram(
  method,
  body,
  options,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${options.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, error: "Telegram isteği tamamlanamadı." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Telegram erişilemedi." };
  }
}

export async function downloadTelegramFile(fileId, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof fileId !== "string" || fileId.length === 0 || fileId.length > 256) {
    return { ok: false, error: "Telegram görseli alınamadı." };
  }
  try {
    const meta = await fetchImpl(`https://api.telegram.org/bot${options.token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!meta.ok) return { ok: false, error: "Telegram görseli alınamadı." };
    const payload = await meta.json();
    const filePath = payload && typeof payload === "object" && payload.result && typeof payload.result.file_path === "string"
      ? payload.result.file_path
      : "";
    if (!payload?.ok || !filePath || filePath.includes("..") || filePath.startsWith("/") || filePath.includes("\\")) {
      return { ok: false, error: "Telegram görseli alınamadı." };
    }
    const safePath = filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const file = await fetchImpl(`https://api.telegram.org/file/bot${options.token}/${safePath}`);
    if (!file.ok) return { ok: false, error: "Telegram görseli indirilemedi." };
    return { ok: true, bytes: Buffer.from(await file.arrayBuffer()) };
  } catch {
    return { ok: false, error: "Telegram erişilemedi." };
  }
}
