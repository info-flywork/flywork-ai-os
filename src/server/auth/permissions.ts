import { AppError } from "@/server/errors";

export const ROLES = ["ADMIN", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "user:read:self"
  | "user:read:all"
  | "user:create"
  | "user:update"
  | "mealMenu:read"
  | "mealMenu:write"
  | "mealOrder:read:own"
  | "mealOrder:read:all"
  | "mealOrder:create:own"
  | "mealOrder:updateStatus"
  | "mealSpend:read"
  | "leaveRequest:read:own"
  | "leaveRequest:read:all"
  | "leaveRequest:create:own"
  | "leaveRequest:review"
  | "leaveBalance:read:own"
  | "leaveBalance:read:all"
  | "leaveBalance:write"
  | "expense:read:own"
  | "expense:read:all"
  | "expense:create:own"
  | "expense:create:company"
  | "expense:review"
  | "invoice:read"
  | "invoice:write"
  | "subscription:read"
  | "subscription:write"
  | "automation:read"
  | "automation:write"
  | "telegram:link"
  | "dashboard:company"
  | "dashboard:self"
  | "bonus:read"
  | "bonus:write"
  | "task:read"
  | "task:write"
  | "feedback:create"
  | "feedback:read"
  | "feedback:review";

const RULES: Record<Action, readonly Role[]> = {
  "user:read:self": ["ADMIN", "EMPLOYEE"],
  "user:read:all": ["ADMIN"],
  "user:create": ["ADMIN"],
  "user:update": ["ADMIN"],
  "mealMenu:read": ["ADMIN", "EMPLOYEE"],
  "mealMenu:write": ["ADMIN"],
  "mealOrder:read:own": ["ADMIN", "EMPLOYEE"],
  "mealOrder:read:all": ["ADMIN"],
  "mealOrder:create:own": ["ADMIN", "EMPLOYEE"],
  "mealOrder:updateStatus": ["ADMIN"],
  "mealSpend:read": ["ADMIN"],
  "leaveRequest:read:own": ["ADMIN", "EMPLOYEE"],
  "leaveRequest:read:all": ["ADMIN"],
  "leaveRequest:create:own": ["ADMIN", "EMPLOYEE"],
  "leaveRequest:review": ["ADMIN"],
  "leaveBalance:read:own": ["ADMIN", "EMPLOYEE"],
  "leaveBalance:read:all": ["ADMIN"],
  "leaveBalance:write": ["ADMIN"],
  "expense:read:own": ["ADMIN", "EMPLOYEE"],
  "expense:read:all": ["ADMIN"],
  "expense:create:own": ["ADMIN", "EMPLOYEE"],
  "expense:create:company": ["ADMIN"],
  "expense:review": ["ADMIN"],
  "invoice:read": ["ADMIN"],
  "invoice:write": ["ADMIN"],
  "subscription:read": ["ADMIN"],
  "subscription:write": ["ADMIN"],
  "automation:read": ["ADMIN"],
  "automation:write": ["ADMIN"],
  "telegram:link": ["ADMIN", "EMPLOYEE"],
  "dashboard:company": ["ADMIN"],
  "dashboard:self": ["ADMIN", "EMPLOYEE"],
  "bonus:read": ["ADMIN"],
  "bonus:write": ["ADMIN"],
  "task:read": ["ADMIN", "EMPLOYEE"],
  "task:write": ["ADMIN", "EMPLOYEE"],
  "feedback:create": ["ADMIN", "EMPLOYEE"],
  "feedback:read": ["ADMIN"],
  "feedback:review": ["ADMIN"],
};

export type Actor = {
  id: string;
  role: Role;
  email: string;
  name: string;
  mealOnly?: boolean;
  approver?: boolean;
};

const VIEWER_BLOCKED: ReadonlySet<Action> = new Set([
  "user:create",
  "user:update",
  "mealMenu:write",
  "mealOrder:updateStatus",
  "leaveRequest:create:own",
  "leaveRequest:review",
  "leaveBalance:write",
  "expense:create:own",
  "expense:create:company",
  "expense:review",
  "invoice:write",
  "subscription:write",
  "automation:write",
  "bonus:write",
  "feedback:review",
]);

export function can(role: Role, action: Action): boolean {
  return RULES[action].includes(role);
}

export function assertCan(actor: Pick<Actor, "role" | "approver">, action: Action): void {
  if (!can(actor.role, action) || (actor.role === "ADMIN" && actor.approver === false && VIEWER_BLOCKED.has(action))) {
    throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
  }
}

export function assertSelfOr(
  actor: Pick<Actor, "id" | "role">,
  userId: string,
  allAction: Action,
): void {
  if (actor.id === userId) {
    return;
  }
  assertCan(actor, allAction);
}
