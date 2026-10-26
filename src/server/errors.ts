export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE"
  | "CONFIG"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(message: string, code: ErrorCode, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export type PublicError = {
  status: number;
  code: ErrorCode;
  message: string;
};

export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message };
  }

  return {
    status: 500,
    code: "INTERNAL",
    message: "İşlem tamamlanamadı.",
  };
}
