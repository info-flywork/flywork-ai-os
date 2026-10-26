export const KIND_LABELS = {
  SOFTWARE: "Yazılım",
  API: "API servisi",
  DOMAIN: "Alan adı",
  HOSTING: "Hosting",
  SSL: "SSL sertifikası",
  OTHER: "Diğer",
} as const;

export const CYCLE_LABELS = {
  MONTHLY: "Aylık",
  YEARLY: "Yıllık",
  CUSTOM: "Özel",
} as const;

export const SERVICE_STATUS_LABELS = {
  ACTIVE: "Aktif",
  INACTIVE: "Pasif",
  CANCELLED: "İptal edildi",
} as const;

export const NOTICE_SUBJECT_LABELS = {
  BILLING: "Ödeme",
  DOMAIN: "Alan adı",
  SSL: "SSL",
} as const;

export type KindCode = keyof typeof KIND_LABELS;
export type CycleCode = keyof typeof CYCLE_LABELS;
export type ServiceStatusCode = keyof typeof SERVICE_STATUS_LABELS;
export type NoticeSubjectCode = keyof typeof NOTICE_SUBJECT_LABELS;
