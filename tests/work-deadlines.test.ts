import { describe, expect, it } from "vitest";
import { formatWorkDeadlineReminder, reminderKind, taskDeadline } from "@/lib/workDeadline";
import { workCardNotice, workCommentNotice, workNoticeRecipients } from "@/server/work/notify";

const task = {
  dueOn: "2026-10-26",
  startsOn: "2026-10-25",
  endsAt: "09:38",
  startsAt: "08:00",
};

describe("görev bitiş hatırlatması", () => {
  it("bitişi bitiş tarihi ve bitiş saatinden kurar", () => {
    expect(taskDeadline(task)).toBe("2026-10-26T09:38:00+03:00");
    expect(taskDeadline({ ...task, endsAt: null })).toBe("2026-10-26T08:00:00+03:00");
    expect(taskDeadline({ dueOn: null, startsOn: null, endsAt: null, startsAt: null })).toBeNull();
  });

  it("1 gün ile 6 saat arasını ve son 6 saati ayrı sayar", () => {
    const deadline = "2026-10-26T09:38:00+03:00";
    expect(reminderKind(deadline, new Date("2026-10-25T09:37:00+03:00"))).toBeNull();
    expect(reminderKind(deadline, new Date("2026-10-25T09:38:00+03:00"))).toBe("day");
    expect(reminderKind(deadline, new Date("2026-10-26T03:37:00+03:00"))).toBe("day");
    expect(reminderKind(deadline, new Date("2026-10-26T03:38:00+03:00"))).toBe("soon");
    expect(reminderKind(deadline, new Date("2026-10-26T09:37:00+03:00"))).toBe("soon");
    expect(reminderKind(deadline, new Date("2026-10-26T09:38:00+03:00"))).toBeNull();
  });

  it("mesajı atanan kişiye gidecek şekilde yazar", () => {
    expect(formatWorkDeadlineReminder({
      title: "deneme 2",
      deadline: "2026-10-26T09:38:00+03:00",
      kind: "day",
    })).toBe("Görev yaklaşıyor\ndeneme 2\nBitiş: 26.10.2026 09:38\n1 gün kaldı");
    expect(formatWorkDeadlineReminder({
      title: "deneme 2",
      deadline: "2026-10-26T09:38:00+03:00",
      kind: "soon",
    })).toContain("6 saat kaldı");
  });

  it("kart, yorum ve etiket mesajını işlemi yapan kişiye yazmaz", () => {
    expect(workNoticeRecipients(["a", "b", "a"], "a")).toEqual(["b"]);
    expect(workCardNotice("Tunahan Avşar", "deneme")).toBe("Tunahan Avşar bir iş kartı açtı\ndeneme");
    expect(workCommentNotice({
      actor: "Sena Özyiğit",
      title: "deneme",
      body: "buna bakar mısın",
      mentioned: false,
    })).toBe("Sena Özyiğit bir yorum yazdı\ndeneme\nbuna bakar mısın");
    expect(workCommentNotice({
      actor: "Sena Özyiğit",
      title: "deneme",
      body: "@Emrah Doğan",
      mentioned: true,
    })).toContain("seni etiketledi");
  });
});
