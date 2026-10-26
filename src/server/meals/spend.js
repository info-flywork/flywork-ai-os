 





























const PRICE = /^(\d+)(?:\.(\d{1,2}))?$/;

export function priceKurus(value) {
  if (!value) {
    return null;
  }
  const match = PRICE.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function formatKurus(value) {
  const whole = Math.floor(Math.abs(value) / 100);
  const fraction = String(Math.abs(value) % 100).padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${grouped},${fraction} TL`;
}

export function spendLabel(totalKurus, missing) {
  if (missing || totalKurus === null) {
    return "Toplam hesaplanamıyor";
  }
  return formatKurus(totalKurus);
}

export function personSpendLabel(person) {
  if (person.missing || person.totalKurus === null) {
    return "Fiyat bilgisi eksik";
  }
  return formatKurus(person.totalKurus);
}

export function daySpend(orders) {
  const active = orders.filter((order) => order.status !== "CANCELLED");
  const absent = active.filter((order) => order.absent).map((order) => order.personName);
  const eating = active.filter((order) => !order.absent);
  let missing = false;
  let total = 0;
  const people = eating.map((order) => {
    let personTotal = 0;
    let personMissing = order.choices.length === 0;
    for (const choice of order.choices) {
      const kurus = priceKurus(choice.price);
      if (kurus === null) {
        personMissing = true;
        missing = true;
        continue;
      }
      personTotal += kurus;
    }
    if (!personMissing) {
      total += personTotal;
    }
    return {
      personName: order.personName,
      kind: order.kind,
      choices: order.choices,
      totalKurus: personMissing ? null : personTotal,
      missing: personMissing,
    };
  });
  return {
    eaters: eating.length,
    absent,
    missing,
    totalKurus: missing ? null : total,
    people,
  };
}

export function pendingDiners(
  people,
  orders,
) {
  const active = orders.filter((order) => order.status !== "CANCELLED");
  const awayIds = new Set(active.filter((order) => order.absent).map((order) => order.userId));
  const eatingIds = new Set(active.filter((order) => !order.absent).map((order) => order.userId));
  return {
    pending: people.filter((person) => !awayIds.has(person.id) && !eatingIds.has(person.id)),
    away: people.filter((person) => awayIds.has(person.id)),
  };
}

export function monthSpend(days) {
  const missing = days.some((day) => day.missing);
  const total = days.reduce((sum, day) => sum + (day.totalKurus ?? 0), 0);
  return {
    missing,
    totalKurus: missing ? null : total,
    mealDays: days.length,
    eaters: days.reduce((sum, day) => sum + day.eaters, 0),
  };
}
