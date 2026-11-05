import "server-only";
import { io } from "next/cache";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createMysqlAdapter } from "@/server/mysql";
import { AppError } from "@/server/errors";
import { redact } from "@/server/runtime/redact";

const globalForPrisma = globalThis 

;

function clientKnowsCurrentUser(client) {
  const model = (client 

)._runtimeDataModel?.models?.User;
  const names = new Set(model?.fields?.map((field) => field.name) ?? []);
  const leave = (client 

)._runtimeDataModel?.models?.LeaveRequest;
  const leaveNames = new Set(leave?.fields?.map((field) => field.name) ?? []);
  return names.has("mealOnly") && names.has("approver") && names.has("hidden") && leaveNames.has("settlement");
}

function clientKnowsAlertDismiss(client) {
  const model = (client)._runtimeDataModel?.models?.PanelAlertRead;
  const names = new Set(model?.fields?.map((field) => field.name) ?? []);
  return names.has("dismissed") && names.has("signature");
}

function clientKnowsWorkPause(client) {
  const model = (client)._runtimeDataModel?.models?.WorkSession;
  const names = new Set(model?.fields?.map((field) => field.name) ?? []);
  return names.has("pausedAt") && names.has("pausedMs");
}

function clientKnowsWorkTaskArchived(client) {
  const model = client._runtimeDataModel?.models?.WorkTask;
  const names = new Set(model?.fields?.map((field) => field.name) ?? []);
  return names.has("archived");
}

function clientMatchesLoadedSchema(client) {
  return (
    typeof client?.user?.findMany === "function" &&
    clientKnowsCurrentUser(client) &&
    "invoiceReview" in client &&
    "expenseAudit" in client &&
    "panelAlertRead" in client &&
    clientKnowsAlertDismiss(client) &&
    "telegramLink" in client &&
    "telegramUpdateReceipt" in client &&
    "mealCategory" in client &&
    "mealDish" in client &&
    "mealPhotoBlob" in client &&
    "mealPhotoReview" in client &&
    "mealPhotoLink" in client &&
    "mealGuestOrder" in client &&
    "mealOrderAudit" in client &&
    "bonusAward" in client &&
    "paidSubscription" in client &&
    "workSpace" in client &&
    "workTask" in client &&
    "workTaskComment" in client &&
    "workSession" in client &&
    clientKnowsWorkPause(client) &&
    clientKnowsWorkTaskArchived(client) &&
    "feedbackNote" in client &&
    "telegramLinkRequest" in client &&
    "telegramWorkReply" in client &&
    "workCardSeen" in client &&
    "workCommentReaction" in client &&
    "workCommentImage" in client &&
    "announcement" in client &&
    "chatThread" in client &&
    clientKnowsChatProfile(client)
  );
}

function clientKnowsChatProfile(client) {
  const user = client._runtimeDataModel?.models?.User;
  const thread = client._runtimeDataModel?.models?.ChatThread;
  const userFields = new Set(user?.fields?.map((field) => field.name) ?? []);
  const threadFields = new Set(thread?.fields?.map((field) => field.name) ?? []);
  return userFields.has("bio") && userFields.has("photoKey") && threadFields.has("photoKey");
}

const POOL_VERSION = 17;

function hideTester(args) {
  return { ...args, where: { AND: [args.where ?? {}, { hidden: false }] } };
}

function withHiddenUsersExcluded(client) {
  const extended = client.$extends({
    query: {
      user: {
        findMany({ args, query }) {
          return query(hideTester(args));
        },
        count({ args, query }) {
          return query(hideTester(args));
        },
      },
    },
  });
  if (!extended._runtimeDataModel) {
    Object.defineProperty(extended, "_runtimeDataModel", {
      value: client._runtimeDataModel,
    });
  }
  return extended;
}

export function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new AppError(
      "Veritabanı bağlantısı yapılandırılmamış.",
      "DATABASE_UNAVAILABLE",
      503,
    );
  }

  const cached = globalForPrisma.flyworkPrisma;
  if (cached && globalForPrisma.flyworkPoolVersion === POOL_VERSION && clientMatchesLoadedSchema(cached)) {
    return cached;
  }
  if (cached) {
    void cached.$disconnect().catch(() => undefined);
  }
  const adapter = createMysqlAdapter();
  const client = withHiddenUsersExcluded(new PrismaClient({ adapter }));
  globalForPrisma.flyworkPrisma = client;
  globalForPrisma.flyworkPoolVersion = POOL_VERSION;
  return client;
}

const CONNECTION_ERROR_CODES = new Set([
  "P1000",
  "P1001",
  "P1017",
]);

export function normalizeDatabaseError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new AppError("Bu kayıt zaten var.", "CONFLICT", 409);
    }
    if (error.code === "P2025") {
      return new AppError("Kayıt bulunamadı.", "NOT_FOUND", 404);
    }
    if (error.code === "P2021" || error.code === "P2022") {
      return new AppError(
        "Veritabanı şeması uygulanmamış.",
        "DATABASE_UNAVAILABLE",
        503,
      );
    }
    if (CONNECTION_ERROR_CODES.has(error.code) || error.code === "P2039") {
      return new AppError(
        "Veritabanına bağlanılamadı.",
        "DATABASE_UNAVAILABLE",
        503,
      );
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new AppError(
      "Veritabanına bağlanılamadı.",
      "DATABASE_UNAVAILABLE",
      503,
    );
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error(redact(`Veritabanı doğrulama hatası. ${error.message}`));
    return new AppError(
      "Veritabanı şeması uygulaması eksik. Sunucuda prisma generate çalıştır.",
      "DATABASE_UNAVAILABLE",
      503,
    );
  }

  const name = error instanceof Error ? error.name : "Error";
  const code = error && typeof error === "object" && "code" in error
    ? String((error ).code ?? "")
    : "";
  const detail = error instanceof Error ? error.message : "";
  console.error(redact(`Veritabanı işlemi başarısız. ${name}${code ? ` ${code}` : ""}${detail ? ` ${detail}` : ""}`));
  return new AppError(
    "Veritabanı işlemi tamamlanamadı.",
    "DATABASE_UNAVAILABLE",
    503,
  );
}

export async function withDatabase(
  work,
) {
  await io();
  try {
    return await work(getPrisma());
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}
