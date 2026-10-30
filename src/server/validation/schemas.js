import { z } from "zod";
import { COMMENT_EMOJIS } from "@/lib/commentReactions";
import { AppError } from "@/server/errors";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG formatında olmalı.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Geçerli bir tarih girin.",
  });

const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Tutar geçersiz.");

export const passwordSchema = z
  .string()
  .min(8, "En az 8 karakter olmalı.")
  .regex(/[A-Za-z]/, "En az bir harf içermeli.")
  .regex(/[0-9]/, "En az bir rakam içermeli.")
  .regex(/[^A-Za-z0-9]/, "En az bir özel karakter içermeli.");

export const loginSchema = z.object({
  email: z.email("Geçerli bir e-posta girin.").trim().toLowerCase(),
  password: z.string().min(1, "Şifre gerekli."),
});

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut şifre gerekli."),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Yeni şifre tekrarı gerekli."),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        message: "Yeni şifre tekrarı uyuşmuyor.",
        path: ["confirmPassword"],
      });
    }
  });

const startedOnField = z.union([isoDate, z.literal("")]).optional();

export const createUserSchema = z.object({
  email: z.email("Geçerli bir e-posta girin.").trim().toLowerCase(),
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı.").max(120),
  password: passwordSchema,
  role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
  mealOnly: z.boolean().optional().default(false),
  startedOn: startedOnField,
});

export const announcementSchema = z.object({
  body: z.string().trim().min(1, "Duyuru boş olamaz.").max(280),
});

export const updateUserSchema = z
  .object({
    userId: z.string().min(1),
    name: z.string().trim().min(2, "Ad en az 2 karakter olmalı.").max(120),
    email: z.email("Geçerli bir e-posta girin.").trim().toLowerCase().optional(),
    role: z.enum(["ADMIN", "EMPLOYEE"]),
    mealOnly: z.boolean().optional().default(false),
    password: z.string().optional(),
    startedOn: startedOnField,
  })
  .superRefine((value, context) => {
    if (!value.password) {
      return;
    }
    const parsed = passwordSchema.safeParse(value.password);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: parsed.error.issues[0]?.message ?? "Şifre geçersiz.",
        path: ["password"],
      });
    }
  });

export const mealMenuSchema = z.object({
  date: isoDate,
  note: z.string().trim().max(500).optional(),
  published: z.boolean(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Yemek adı gerekli.").max(120),
      }),
    )
    .min(1, "Menüde en az bir yemek olmalı.")
    .max(30),
});

const optionalId = z.string().trim().min(1).optional().or(z.literal("")).transform((value) => value || undefined);

export const mealOrderSchema = z.object({
  menuId: z.string().min(1),
  itemId: optionalId,
  mainItemId: optionalId,
  soupItemId: optionalId,
  sideItemId: optionalId,
  dessertItemId: optionalId,
  absent: z.boolean().optional(),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export const managedMealOrderSchema = mealOrderSchema.extend({
  userId: z.string().trim().min(1),
});

export const guestMealOrderSchema = mealOrderSchema.extend({
  guestName: z.string().trim().min(2, "Misafir adı gerekli.").max(80),
  guestOrderId: optionalId,
});

export const mealReminderSchema = z.object({
  menuId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
});

export const mealDishSchema = z.object({
  id: z.string().trim().min(1).optional().or(z.literal("")),
  name: z.string().trim().min(2, "Yemek adı gerekli.").max(120),
  categoryId: z.string().trim().min(1, "Kategori gerekli."),
  slot: z.enum(["MAIN", "SOUP", "SIDE", "DESSERT"]),
  active: z.boolean(),
  price: z.string().trim().max(20).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const mealCategorySchema = z.object({
  name: z.string().trim().min(2, "Kategori adı gerekli.").max(80),
});

export const catalogMenuSchema = z.object({
  date: isoDate,
  note: z.string().trim().max(500).optional(),
  published: z.boolean(),
  dishIds: z.array(z.string().trim().min(1)).min(1, "Menüye en az bir yemek ekleyin.").max(80),
});

export const mealOrderStatusSchema = z.object({
  status: z.enum(["RECEIVED", "PREPARING", "DELIVERED", "CANCELLED"]),
});

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD formatında olmalı.");

const dayAmount = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Gün sayısı geçersiz.");

export const leaveRequestSchema = z
  .object({
    type: z.enum(["ANNUAL", "SICK", "EXCUSE", "UNPAID"]),
    duration: z.enum(["FULL_DAY", "MULTI_DAY", "HOURLY"]),
    startDate: isoDate,
    endDate: isoDate,
    startTime: clockTime.optional(),
    endTime: clockTime.optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "Bitiş tarihi başlangıçtan önce olamaz.",
    path: ["endDate"],
  })
  .refine((value) => value.duration !== "FULL_DAY" || value.startDate === value.endDate, {
    message: "Tam gün izin aynı günde olmalı.",
    path: ["endDate"],
  })
  .refine((value) => value.duration !== "MULTI_DAY" || value.endDate > value.startDate, {
    message: "Çok günlü izinde bitiş tarihi başlangıçtan sonra olmalı.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.duration !== "HOURLY" ||
      (value.startDate === value.endDate &&
        Boolean(value.startTime) &&
        Boolean(value.endTime) &&
        value.endTime > value.startTime),
    {
      message: "Saatlik izin aynı günde, bitiş saati başlangıçtan sonra olacak şekilde girilmeli.",
      path: ["endTime"],
    },
  );

export const leaveReviewSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewNote: z.string().trim().max(1000).optional(),
    balanceException: z.boolean(),
  })
  .refine(
    (value) => value.decision !== "REJECTED" || (value.reviewNote?.length ?? 0) >= 2,
    {
      message: "Ret gerekçesi en az 2 karakter olmalı.",
      path: ["reviewNote"],
    },
  );

export const leaveBalanceSchema = z.object({
  userId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  allocatedDays: dayAmount,
  allowBelowUsed: z.boolean(),
});

export const leaveCalendarSchema = z.object({
  hoursPerDay: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "İş günü süresi geçersiz.")
    .refine((value) => {
      const hours = Number(value);
      return hours >= 1 && hours <= 24;
    }, "İş günü 1 ile 24 saat arasında olmalı."),
  weekendDays: z.array(z.number().int().min(1).max(7)).max(7),
});

export const leaveHolidaySchema = z.object({
  date: isoDate,
  name: z.string().trim().min(2, "Tatil adı en az 2 karakter olmalı.").max(120),
});

export const expenseSchema = z.object({
  scope: z.enum(["EMPLOYEE", "COMPANY", "OFFICE"]),
  category: z.enum([
    "TRANSPORT",
    "MEAL",
    "LODGING",
    "SUPPLIES",
    "SOFTWARE",
    "SERVICE",
    "SUBSCRIPTION",
    "OPERATIONS",
    "CLEANING",
    "RENT",
    "ELECTRICITY",
    "INTERNET",
    "EQUIPMENT",
    "MARKET",
    "WATER",
    "OTHER",
  ]),
  title: z.string().trim().min(2, "Açıklama en az 2 karakter olmalı.").max(160),
  vendor: z.string().trim().max(160).optional(),
  amount: money,
  currency: z.enum(["TRY", "USD", "EUR"]),
  paymentMethod: z.enum(["CARD", "TRANSFER", "CASH", "OTHER"]),
  accountLabel: z.string().trim().max(80).optional(),
  spentOn: isoDate,
  note: z.string().trim().max(1000).optional(),
  reimbursement: z.enum(["NOT_REQUIRED", "PENDING", "PAID"]).optional(),
  userId: z.string().min(1).optional(),
  invoiceId: z.string().min(1).optional(),
  acceptAmountDifference: z.boolean().optional(),
});

export const expenseUpdateSchema = expenseSchema.omit({ scope: true }).extend({
  invoiceId: z.string().min(1).nullable().optional(),
});

export const expenseReviewSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewNote: z.string().trim().max(1000).optional(),
  })
  .refine(
    (value) => value.decision !== "REJECTED" || (value.reviewNote?.length ?? 0) >= 2,
    { message: "Ret gerekçesi en az 2 karakter olmalı.", path: ["reviewNote"] },
  );

export const expenseFilterSchema = z.object({
  userId: z.string().min(1).optional(),
  category: expenseSchema.shape.category.optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "PAID"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  currency: z.enum(["TRY", "USD", "EUR"]).optional(),
  expenseId: z.string().min(1).optional(),
});

export const invoiceSchema = z
  .object({
    number: z.string().trim().min(1, "Fatura numarası gerekli.").max(60),
    vendor: z.string().trim().min(2, "Tedarikçi adı gerekli.").max(160),
    scope: z.enum(["COMPANY", "OFFICE"]),
    category: expenseSchema.shape.category,
    amount: money,
    currency: z.enum(["TRY", "USD", "EUR"]),
    paymentMethod: z.enum(["CARD", "TRANSFER", "CASH", "OTHER"]),
    accountLabel: z.string().trim().max(80).optional(),
    issuedOn: isoDate,
    dueOn: isoDate.optional(),
    note: z.string().trim().max(1000).optional(),
    spenderName: z.string().trim().max(80).optional(),
    expenseId: z.string().min(1).optional(),
    createExpense: z.boolean(),
  })
  .refine((value) => !value.dueOn || value.dueOn >= value.issuedOn, {
    message: "Vade tarihi fatura tarihinden önce olamaz.",
    path: ["dueOn"],
  });

export const invoiceLineSchema = z.object({
  invoiceId: z.string().min(1).optional(),
  expenseId: z.string().min(1).optional(),
  vendor: z.string().trim().min(2, "Tedarikçi adı gerekli.").max(160),
  description: z.string().trim().min(2, "Açıklama en az 2 karakter olmalı.").max(160),
  quantity: z.coerce.number().int().min(1, "Adet en az 1 olmalı.").max(9999),
  amount: money,
  currency: z.enum(["TRY", "USD", "EUR"]),
  paymentMethod: z.enum(["CARD", "TRANSFER", "CASH", "OTHER"]),
  accountLabel: z.string().trim().max(80).optional(),
  issuedOn: isoDate,
  person: z.string().trim().min(1, "Harcamayı yapan kişiyi seçin.").max(80),
});

export const subscriptionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  vendor: z.string().trim().min(2).max(160),
  kind: z.enum(["DOMAIN", "SOFTWARE", "HOSTING", "OTHER"]),
  amount: money,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  renewsOn: isoDate,
  note: z.string().trim().max(1000).optional(),
});

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .refine((value) => !value || /^https?:\/\/\S+$/.test(value), "Bağlantı http veya https olmalı.");

export const paidSubscriptionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Abonelik adı en az 2 karakter olmalı.").max(160),
  cycle: z.enum(["MONTHLY", "YEARLY", "USAGE"]),
  amount: money.optional(),
  currency: z.enum(["TRY", "USD", "EUR"]).optional(),
  startedOn: isoDate.optional(),
  lastPaidOn: isoDate.optional(),
});

export const technologySchema = z
  .object({
    name: z.string().trim().min(2, "Hizmet adı en az 2 karakter olmalı.").max(160),
    vendor: z.string().trim().min(2, "Sağlayıcı en az 2 karakter olmalı.").max(160),
    kind: z.enum(["DOMAIN", "SOFTWARE", "HOSTING", "API", "SSL", "OTHER"]),
    description: z.string().trim().max(1000).optional(),
    project: z.string().trim().max(160).optional(),
    ownerId: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "CANCELLED"]),
    websiteUrl: optionalUrl,
    panelUrl: optionalUrl,
    amount: money,
    currency: z.enum(["TRY", "USD", "EUR"]),
    billingCycle: z.enum(["MONTHLY", "YEARLY", "CUSTOM"]),
    customIntervalDays: z.number().int().min(1).max(3650).optional(),
    renewsOn: isoDate,
    lastPaidOn: isoDate.optional(),
    paymentMethod: z.enum(["CARD", "TRANSFER", "CASH", "OTHER"]),
    cardLast4: z
      .string()
      .trim()
      .max(32)
      .optional()
      .refine(
        (value) => !value || /^\d{4}$/.test(value),
        "Kart numarasının tamamı saklanmaz. Yalnızca son dört hane girin.",
      ),
    autoRenew: z.boolean(),
    domainName: z.string().trim().max(253).optional(),
    registrar: z.string().trim().max(160).optional(),
    domainExpiresOn: isoDate.optional(),
    dnsProvider: z.string().trim().max(160).optional(),
    sslIssuer: z.string().trim().max(160).optional(),
    sslExpiresOn: isoDate.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.billingCycle !== "CUSTOM" || Boolean(value.customIntervalDays), {
    message: "Özel periyot için gün sayısı gerekli.",
    path: ["customIntervalDays"],
  })
  .refine((value) => value.kind !== "DOMAIN" || (value.domainName?.length ?? 0) >= 3, {
    message: "Alan adı gerekli.",
    path: ["domainName"],
  })
  .refine((value) => value.kind !== "DOMAIN" || Boolean(value.domainExpiresOn), {
    message: "Alan adı bitiş tarihi gerekli.",
    path: ["domainExpiresOn"],
  })
  .refine((value) => value.kind !== "SSL" || Boolean(value.sslExpiresOn), {
    message: "SSL geçerlilik tarihi gerekli.",
    path: ["sslExpiresOn"],
  })
  .refine((value) => value.kind !== "HOSTING" || (value.dnsProvider?.length ?? 0) >= 2, {
    message: "Hosting sağlayıcısı gerekli.",
    path: ["dnsProvider"],
  });

export const technologyStatusSchema = z.object({
  subscriptionId: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "CANCELLED"]),
});

export const technologyFilterSchema = z.object({
  query: z.string().trim().max(80).optional(),
  kind: z.enum(["DOMAIN", "SOFTWARE", "HOSTING", "API", "SSL", "OTHER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "CANCELLED"]).optional(),
  currency: z.enum(["TRY", "USD", "EUR"]).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const renewalPaymentSchema = z.object({
  subscriptionId: z.string().min(1),
  periodEnd: isoDate,
  paidOn: isoDate,
  amount: money,
  currency: z.enum(["TRY", "USD", "EUR"]),
  note: z.string().trim().max(1000).optional(),
  createExpense: z.boolean(),
  expenseId: z.string().min(1).optional(),
});

export const bonusCriterionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Kriter adı en az 2 karakter olmalı.").max(80),
  defaultAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Ücret geçersiz."),
});

export const bonusAwardSchema = z.object({
  id: z.string().min(1).optional(),
  criterionId: z.string().min(1, "Kriter seçin."),
  title: z.string().trim().min(2, "Başlık en az 2 karakter olmalı.").max(160),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Ay seçin."),
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Ücret geçersiz."),
  paid: z.boolean(),
  days: z.number().int().min(1).max(366).optional(),
  note: z.string().trim().max(500).optional(),
  userIds: z.array(z.string().min(1)).min(1, "En az bir kişi seçin."),
});

const workColumn = z.enum(["POOL", "DOING", "REVIEW", "REVISION", "DONE"]);
const workPriority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

const clock = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat 00:00 ile 23:59 arasında olmalı.");

export const workSpaceSchema = z.object({
  name: z.string().trim().min(2, "Alan adı en az 2 karakter olmalı.").max(40, "Alan adı en fazla 40 karakter olabilir."),
});

export const workTaskSchema = z.object({
  id: z.string().min(1).optional(),
  spaceId: z.string().min(1).optional(),
  title: z.string().trim().min(2, "Kart başlığı en az 2 karakter olmalı.").max(160),
  detail: z.string().trim().max(2000).optional(),
  column: workColumn,
  priority: workPriority,
  startsOn: isoDate.nullable().optional(),
  startsAt: clock.nullable().optional(),
  endsAt: clock.nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  assigneeIds: z.array(z.string().min(1)).max(12),
  items: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
}).superRefine((value, context) => {
  if (value.startsOn && value.dueOn && value.startsOn > value.dueOn) {
    context.addIssue({ code: "custom", message: "Başlangıç tarihi bitiş tarihinden sonra olamaz.", path: ["startsOn"] });
  }
  const sameDay = !value.startsOn || !value.dueOn || value.startsOn === value.dueOn;
  if (sameDay && value.startsAt && value.endsAt && value.endsAt < value.startsAt) {
    context.addIssue({ code: "custom", message: "Bitiş saati başlangıç saatinden önce olamaz.", path: ["endsAt"] });
  }
});

export const workCommentSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().trim().max(2000),
});

export const workCommentUpdateSchema = z.object({
  id: z.string().min(1),
  body: z.string().trim().min(1, "Yorum boş olamaz.").max(2000),
});

export const workCommentReactionSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.string().refine((emoji) => COMMENT_EMOJIS.includes(emoji), { message: "Bu emoji kullanılamaz." }),
});

export const workLinkSchema = z.object({
  taskId: z.string().min(1),
  url: z.string().trim().max(500).regex(/^https?:\/\/\S+$/, "Link http veya https olmalı."),
  label: z.string().trim().max(80).optional(),
});

export const workCompletedSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean(),
});

export const feedbackSchema = z.object({
  kind: z.enum(["SUGGESTION", "COMPLAINT"]),
  body: z.string().trim().min(5, "En az 5 karakter yazın.").max(2000, "En fazla 2000 karakter."),
});

export const feedbackReviewSchema = z.object({
  id: z.string().min(1),
});

export const moveWorkTaskSchema = z.object({
  taskId: z.string().min(1),
  column: workColumn,
  orderedIds: z.array(z.string().min(1)).min(1).max(300),
  items: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
});

export const workRevisionSchema = z.object({
  id: z.string().min(1),
  done: z.boolean(),
});

export function parseInput(schema, input) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw new AppError(
    parsed.error.issues[0]?.message ?? "Gönderilen bilgiler geçersiz.",
    "VALIDATION",
    400,
  );
}
