import { AppError } from "@/server/errors";

export const ROLES = ["ADMIN", "EMPLOYEE"] ;
 










































const RULES = {
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

 








const VIEWER_BLOCKED = new Set([
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

export function can(role, action) {
  return RULES[action].includes(role);
}

export function assertCan(actor, action) {
  if (!can(actor.role, action) || (actor.role === "ADMIN" && actor.approver === false && VIEWER_BLOCKED.has(action))) {
    throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
  }
}

export function assertSelfOr(
  actor,
  userId,
  allAction,
) {
  if (actor.id === userId) {
    return;
  }
  assertCan(actor, allAction);
}
