import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/errors";
import { createUserSchema, parseInput } from "@/server/validation/schemas";
















export async function createInitialAdmin(
  db,
  input,
) {
  const data = parseInput(createUserSchema, {
    name: input.name,
    email: input.email,
    password: input.password,
    role: "ADMIN",
  });
  const existing = await db.user.count({ where: { role: "ADMIN" } });
  if (existing > 0) {
    throw new AppError(
      "Yönetici hesabı zaten var. Yeni hesap mevcut yöneticinin kullanıcı ekranından açılmalı.",
      "CONFLICT",
      409,
    );
  }

  const passwordHash = await hashPassword(data.password);
  return db.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: "ADMIN",
      passwordHash,
    },
    select: { email: true },
  });
}
