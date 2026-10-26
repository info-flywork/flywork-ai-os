export type RevisionItem = {
  id: string;
  dishId: string | null;
  name: string;
};

export type RevisionChoice = {
  slotLabel: string;
  itemId: string | null;
};

export type RevisionOrder = {
  id: string;
  employeeName: string;
  absent: boolean;
  choices: RevisionChoice[];
};

export type MenuConflict = {
  orderId: string;
  employeeName: string;
  itemName: string;
  slotLabel: string;
};

export type MenuRevision = {
  updates: { itemId: string; sortOrder: number }[];
  creates: { dishId: string; sortOrder: number }[];
  deleteIds: string[];
  unavailableIds: string[];
  conflicts: MenuConflict[];
};

export function planMenuRevision(items: RevisionItem[], dishIds: string[], orders: RevisionOrder[]): MenuRevision {
  const wanted = [...new Set(dishIds)];
  const byDish = new Map<string, RevisionItem>();
  for (const item of items) {
    if (item.dishId && !byDish.has(item.dishId)) {
      byDish.set(item.dishId, item);
    }
  }

  const usedItemIds = new Set<string>();
  const updates: MenuRevision["updates"] = [];
  const creates: MenuRevision["creates"] = [];
  wanted.forEach((dishId, sortOrder) => {
    const item = byDish.get(dishId);
    if (item) {
      usedItemIds.add(item.id);
      updates.push({ itemId: item.id, sortOrder });
      return;
    }
    creates.push({ dishId, sortOrder });
  });

  const leftover = items.filter((item) => !usedItemIds.has(item.id));
  const referenced = new Set<string>();
  const conflicts: MenuConflict[] = [];
  for (const order of orders) {
    if (order.absent) {
      continue;
    }
    for (const choice of order.choices) {
      if (!choice.itemId) {
        continue;
      }
      const item = leftover.find((entry) => entry.id === choice.itemId);
      if (!item) {
        continue;
      }
      referenced.add(item.id);
      conflicts.push({
        orderId: order.id,
        employeeName: order.employeeName,
        itemName: item.name,
        slotLabel: choice.slotLabel,
      });
    }
  }

  return {
    updates,
    creates,
    deleteIds: leftover.filter((item) => !referenced.has(item.id)).map((item) => item.id),
    unavailableIds: leftover.filter((item) => referenced.has(item.id)).map((item) => item.id),
    conflicts,
  };
}
