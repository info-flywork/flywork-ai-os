import "server-only";

import { buildWorkPulse } from "@/lib/workPulse";
import { getWorkBoard } from "@/server/services/work";

export async function getWorkPulse(actor, now = new Date()) {
  const board = await getWorkBoard(actor);
  const pulse = buildWorkPulse(actor, board, now);
  return actor.role === "ADMIN" ? { ...pulse, timeLog: board.timeLog ?? [] } : pulse;
}
