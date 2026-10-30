const OWN_MARKERS = ["fly work ventures", "flywork ventures"];

export function foldCompanyName(value) {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isOwnCompanyName(value) {
  if (typeof value !== "string" || value.trim().length < 8) {
    return false;
  }
  const folded = foldCompanyName(value);
  return OWN_MARKERS.some((marker) => folded.includes(marker));
}
