 









export class AppError extends Error {
   code;
   status;

  constructor(message, code, status) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

 





export function toPublicError(error) {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message };
  }

  return {
    status: 500,
    code: "INTERNAL",
    message: "İşlem tamamlanamadı.",
  };
}
