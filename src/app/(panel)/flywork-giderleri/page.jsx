import { redirect } from "next/navigation";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
export const instant = false;

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : undefined;
}

export default async function FlyworkFaturalariPage({
  searchParams,
}

) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Flywork faturaları yalnızca yöneticilere açıktır.</p>;
  }
  const query = await searchParams;
  const month = one(query.ay);
  const target = new URLSearchParams({ sekme: "flywork" });
  if (month) target.set("ay", month);
  redirect(`/harcama?${target.toString()}`);
}
