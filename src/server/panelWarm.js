import "server-only";
import { getEmployeeMealView } from "@/server/services/meals";
import { getAdminLeaveView, getEmployeeLeaveView } from "@/server/services/leave";
import { getWorkBoard } from "@/server/services/work";

const ADMIN_LEAVE_FILTERS = {
  report: "year",
  period: "2026",
  from: "2025-01-01",
  to: "2027-12-31",
};

export function warmPanelReads(user) {
  const jobs = [getEmployeeMealView(user)];
  if (!user.mealOnly) {
    jobs.push(getEmployeeLeaveView(user), getWorkBoard(user));
    if (user.role === "ADMIN") {
      jobs.push(getAdminLeaveView(user, ADMIN_LEAVE_FILTERS));
    }
  }
  return Promise.all(jobs.map((job) => Promise.resolve(job).catch(() => undefined)));
}
