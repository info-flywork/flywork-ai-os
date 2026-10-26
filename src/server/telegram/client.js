 

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
