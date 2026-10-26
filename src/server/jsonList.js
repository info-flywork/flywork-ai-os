function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) ;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function numberList(value) {
  return asArray(value).filter((item) => typeof item === "number" && Number.isFinite(item));
}

export function stringList(value) {
  return asArray(value).filter((item) => typeof item === "string");
}
