import { randomBytes } from "node:crypto";
import { resetAdminPassword } from "@/admin/accounts";
import { db } from "@/db";

/** Creates a uniquely named admin, so test files sharing one database never collide on accounts or login rate limits. */
export async function seedTestAdmin(password: string): Promise<string> {
  const username = `test-${process.pid}-${randomBytes(3).toString("hex")}`;
  await resetAdminPassword(db(), username, password);
  return username;
}
