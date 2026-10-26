import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/telegram/webhook/route";
import { postTelegram } from "@/server/telegram/client";
import { telegramStatus } from "@/server/telegram/config";
import {
  formatMailSummary,
  formatMealReminder,
  formatMealCloseMessage,
  formatPendingLeaveApprovals,
  leaveApprovalButtons,
  leaveCallback,
  parseLeaveCallback,
  parseTelegramCommand,
} from "@/server/telegram/messages";
import { webhookAuthorized } from "@/server/telegram/webhookAuth";
import { localTelegramPollEnabled } from "@/server/telegram/poll";
import { registerTelegramWebhook, webhookSetupPlan } from "@/server/telegram/webhookSetup";

const sampleToken = "123456789:AAHexampletokenvalue1234567890";

describe("telegram kuralları", () => {
  it("gönderimi token olsa bile live olmadan kapalı tutar ve tokenı dışarı vermez", () => {
    expect(telegramStatus({}).delivery).toBe("off");
    expect(telegramStatus({ TELEGRAM_BOT_TOKEN: sampleToken }).delivery).toBe("off");
    expect(telegramStatus({ TELEGRAM_BOT_TOKEN: sampleToken, TELEGRAM_DELIVERY: "live" }).delivery).toBe("live");
    expect(localTelegramPollEnabled({
      TELEGRAM_BOT_TOKEN: sampleToken,
      TELEGRAM_WEBHOOK_SECRET: "x".repeat(32),
      TELEGRAM_DELIVERY: "live",
    })).toBe(true);
    expect(localTelegramPollEnabled({
      TELEGRAM_BOT_TOKEN: sampleToken,
      TELEGRAM_WEBHOOK_SECRET: "x".repeat(32),
      TELEGRAM_WEBHOOK_URL: "https://panel.example.com/api/telegram/webhook",
      TELEGRAM_DELIVERY: "live",
    })).toBe(false);
    expect(JSON.stringify(telegramStatus({ TELEGRAM_BOT_TOKEN: sampleToken }))).not.toContain(sampleToken);
  });

  it("komut, izin kararı ve yemek özetini ayrıştırır", () => {
    expect(parseTelegramCommand("/start ABCD234567")).toEqual({ name: "start", argument: "ABCD234567" });
    expect(parseTelegramCommand("/izin@flywork_bot")).toEqual({ name: "izin", argument: "" });
    expect(parseTelegramCommand("/yemek")).toEqual({ name: "yemek", argument: "" });
    const callback = leaveCallback("REJECTED", "cm1234567890abcd");
    expect(parseLeaveCallback(callback)).toEqual({ decision: "REJECTED", requestId: "cm1234567890abcd" });
    expect(parseLeaveCallback("sil:1")).toBeNull();
    const text = formatMealCloseMessage("2098-06-02", [{ name: "Tabak", count: 2 }]);
    expect(text).toContain("Toplam: 2");
    expect(text).not.toMatch(/gönderildi|token/i);
    const away = formatMealCloseMessage("2098-06-02", [{ name: "Tabak", count: 2 }], 1);
    expect(away).toContain("Ofiste olmayan: 1");
    expect(away).not.toMatch(/gönderildi|token/i);
    const pending = formatPendingLeaveApprovals([
      { id: "cm1234567890abcd", employeeName: "Emrah Doğan", type: "ANNUAL", startDate: "2099-08-21", endDate: "2099-08-30", dayCount: "10,00" },
    ]);
    expect(pending).toContain("Bekleyen izin onayları");
    expect(pending).toContain("Emrah Doğan · Yıllık izin · 21.08.2099 – 30.08.2099 · 10,00 gün");
    const buttons = leaveApprovalButtons([
      { id: "cm1234567890abcd", employeeName: "Emrah Doğan", type: "ANNUAL", startDate: "2099-08-21", endDate: "2099-08-30", dayCount: "10,00" },
    ]);
    expect(parseLeaveCallback(buttons[0][0].data)).toEqual({ decision: "APPROVED", requestId: "cm1234567890abcd" });
    expect(buttons[0][0].text).toContain("Emrah Doğan");
    const summary = formatMailSummary("Akşam", {
      important: [],
      pendingReplies: [{ from: "Ada <ada@example.com>", subject: "Teklif" }],
      tasks: [],
    });
    expect(summary).toBe("Akşam posta özeti\nYanıt bekleyen\nAda · Teklif\nPosta değiştirilmedi.");
    expect(summary).not.toContain("@");
    expect(formatMailSummary("Sabah", { important: [], pendingReplies: [], tasks: [] })).toContain("Yeni posta yok.");
    const reminder = formatMealReminder("Tunahan Avşar", "Pazartesi 26.10.2026", "11:00");
    expect(reminder).toContain("Pazartesi 26.10.2026");
    expect(reminder).toContain("Yemek siparişinizi verin ve seçiminizi tamamlayın.");
    expect(reminder).toContain("11:00");
  });

  it("webhook sırrı eşleşmezse ve ağ hatasında token sızdırmaz", async () => {
    expect(webhookAuthorized(null, "ornek-gizli")).toBe(false);
    expect(webhookAuthorized("ornek-gizli", "ornek-gizli")).toBe(true);
    expect(webhookAuthorized("yanlis-gizli", "ornek-gizli")).toBe(false);
    const response = await POST(new Request("http://127.0.0.1/api/telegram/webhook", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    const result = await postTelegram("sendMessage", { chat_id: "1", text: "deneme" }, {
      token: sampleToken,
      fetchImpl: async (url) => {
        throw new Error(String(url));
      },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sampleToken);
    expect(JSON.stringify(result)).toContain("Telegram erişilemedi.");
  });

  it("webhook kaydını apply olmadan çağırmaz", async () => {
    const env = {
      TELEGRAM_BOT_TOKEN: sampleToken,
      TELEGRAM_WEBHOOK_SECRET: "x".repeat(32),
      TELEGRAM_WEBHOOK_URL: "https://panel.example.com/api/telegram/webhook",
      TELEGRAM_DELIVERY: "off",
    };
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const address = String(input);
      calls.push(address.endsWith("/setWebhook") ? "setWebhook" : "baska");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const preview = await registerTelegramWebhook(env, [], fetchImpl);
    expect(preview.registered).toBe(false);
    expect(preview.mode).toBe("deneme");
    expect(calls).toEqual([]);
    expect(webhookSetupPlan({ ...env, TELEGRAM_WEBHOOK_URL: "http://panel.example.com/api/telegram/webhook" }, ["--apply"]).canApply).toBe(false);
    const applied = await registerTelegramWebhook(env, ["--apply"], fetchImpl);
    expect(applied.registered).toBe(true);
    expect(calls).toEqual(["setWebhook"]);
    expect(JSON.stringify({ preview, applied })).not.toContain(sampleToken);
    expect(JSON.stringify({ preview, applied })).not.toContain("x".repeat(32));
  });
});
