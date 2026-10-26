const FIXED_HOLIDAYS = {
  "01-01": "Yılbaşı",
  "04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
  "05-01": "Emek ve Dayanışma Günü",
  "05-19": "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
  "07-15": "Demokrasi ve Milli Birlik Günü",
  "08-30": "Zafer Bayramı",
  "10-29": "Cumhuriyet Bayramı",
};

const FULL_HOLIDAYS = {
  "2026-03-20": "Ramazan Bayramı",
  "2026-03-21": "Ramazan Bayramı",
  "2026-03-22": "Ramazan Bayramı",
  "2026-05-27": "Kurban Bayramı",
  "2026-05-28": "Kurban Bayramı",
  "2026-05-29": "Kurban Bayramı",
  "2026-05-30": "Kurban Bayramı",
  "2027-03-09": "Ramazan Bayramı",
  "2027-03-10": "Ramazan Bayramı",
  "2027-03-11": "Ramazan Bayramı",
  "2027-05-16": "Kurban Bayramı",
  "2027-05-17": "Kurban Bayramı",
  "2027-05-18": "Kurban Bayramı",
  "2027-05-19": "Kurban Bayramı",
};

export function publicHoliday(date) {
  return FULL_HOLIDAYS[date] ?? FIXED_HOLIDAYS[date.slice(5)] ?? null;
}
