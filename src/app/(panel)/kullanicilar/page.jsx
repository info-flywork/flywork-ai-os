import UserAdmin from "@/components/users/UserAdmin";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { toIsoDate } from "@/server/dates";
import { requireUser } from "@/server/auth/session";
import { listUsers } from "@/server/services/users";
export const instant = false;

export default async function KullanicilarPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return (
      <div>
        <h1 className="page-title mb-3">Kullanıcılar</h1>
        <p>Bu sayfa yalnızca yöneticilere açık.</p>
      </div>
    );
  }

  const users = await listUsers(user);
  return (
    <UserAdmin
      currentUserId={user.id}
      users={users.map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
        mealOnly: account.mealOnly,
        approver: account.approver,
        active: account.active,
        startedOn: account.startedOn ? toIsoDate(account.startedOn) : null,
      }))}
      canManage={user.approver !== false}
    />
  );
}
