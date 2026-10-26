export function landingPath(
  user: { role: string; mealOnly?: boolean } | null | undefined,
  next?: string | null,
): string {
  if (!user || user.role === "ADMIN") {
    return safeNextPath(next);
  }
  const path = safeNextPath(next);
  const feedback =
    path === "/oneri" || path.startsWith("/oneri/") || path.startsWith("/oneri?");
  if (user.mealOnly) {
    return "/yemek-yonetimi";
  }
  if (
    path === "/izin" ||
    path.startsWith("/izin/") ||
    path.startsWith("/izin?") ||
    path === "/yemek-yonetimi" ||
    path.startsWith("/yemek-yonetimi/") ||
    path.startsWith("/yemek-yonetimi?") ||
    path === "/is-takibi" ||
    path.startsWith("/is-takibi/") ||
    path.startsWith("/is-takibi?") ||
    feedback
  ) {
    return path;
  }
  return "/yemek-yonetimi";
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  if (value.startsWith("/giris") || value.includes("://")) {
    return "/";
  }
  return value;
}
