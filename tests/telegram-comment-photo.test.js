import { describe, expect, it } from "vitest";
import { readTelegramUpdate } from "@/server/telegram/commands";
import { formatChatTelegramText } from "@/server/telegram/chatBridge";

const from = { id: 42 };
const chat = { id: 42 };

describe("telegram yorum görseli", () => {
  it("yalnız görseli yorum olarak kabul eder", () => {
    const update = readTelegramUpdate({
      message: { from, chat, photo: [{ file_id: "small" }, { file_id: "large" }] },
    });
    expect(update).toMatchObject({ telegramUserId: "42", text: "", photoFileId: "large" });
  });

  it("görsel açıklamasını yorum metni yapar", () => {
    const update = readTelegramUpdate({
      message: { from, chat, caption: "Hazır", photo: [{ file_id: "shot" }] },
    });
    expect(update).toMatchObject({ text: "Hazır", photoFileId: "shot" });
  });

  it("sohbet cevabının yanıtladığı mesajı taşır", () => {
    const update = readTelegramUpdate({
      message: { from, chat, message_id: 9, text: "tamam", reply_to_message: { message_id: 4 } },
    });
    expect(update).toMatchObject({ text: "tamam", telegramMessageId: "9", replyToTelegramMessageId: "4" });
  });

  it("grup mesajını telegram metnine çevirir", () => {
    const text = formatChatTelegramText({
      kind: "GROUP",
      title: "Fly-work I Team",
      authorName: "Tunahan Avşar",
      body: "selam",
      files: [],
    });
    expect(text).toBe("Flywork Chat · Fly-work I Team\nTunahan Avşar:\nselam");
  });

  it("jpeg belgeyi görsel sayar", () => {
    const update = readTelegramUpdate({
      message: { from, chat, document: { file_id: "doc", mime_type: "image/jpeg" } },
    });
    expect(update?.photoFileId).toBe("doc");
  });
});
