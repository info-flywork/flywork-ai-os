

 







export const JOB_DEFINITIONS = [
  {
    key: "gmail.morning",
    name: "Gmail sabah analizi",
    agent: "gmail",
    weekdays: [],
    hour: 8,
    minute: 30,
    initialState: "WAITING_CONNECTION",
    paused: true,
  },
  {
    key: "gmail.evening",
    name: "Gmail akşam analizi",
    agent: "gmail",
    weekdays: [],
    hour: 18,
    minute: 0,
    initialState: "WAITING_CONNECTION",
    paused: true,
  },
  {
    key: "invoice.morning",
    name: "Fatura sabah taraması",
    agent: "invoice",
    weekdays: [],
    hour: 9,
    minute: 0,
    initialState: "WAITING_CONNECTION",
  },
  {
    key: "invoice.evening",
    name: "Fatura akşam taraması",
    agent: "invoice",
    weekdays: [],
    hour: 18,
    minute: 30,
    initialState: "WAITING_CONNECTION",
  },
  {
    key: "ops.meal-close",
    name: "Yemek siparişi kapanışı",
    agent: "operations",
    weekdays: [1, 2, 4],
    hour: 11,
    minute: 0,
    initialState: "ACTIVE",
  },
  {
    key: "ops.meal-roster",
    name: "Yemekçi listesi",
    agent: "operations",
    weekdays: [1, 2, 4],
    hour: 11,
    minute: 5,
    initialState: "ACTIVE",
  },
  {
    key: "ops.leave-pending",
    name: "Bekleyen izin talepleri",
    agent: "operations",
    weekdays: [1, 2, 3, 4, 5],
    hour: 9,
    minute: 0,
    initialState: "ACTIVE",
  },
  {
    key: "ops.renewals",
    name: "Teknoloji yenileme kontrolü",
    agent: "operations",
    weekdays: [],
    hour: 8,
    minute: 0,
    initialState: "ACTIVE",
  },
];
