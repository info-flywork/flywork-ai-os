function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function numberList(value: unknown): number[] {
  return asArray(value).filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

export function stringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}
