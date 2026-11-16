import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH, adminNewPasswordSchema, adminUsernameSchema } from "@funnel/shared";
import { resetAdminPassword } from "../src/admin/accounts";
import * as schema from "../src/db/schema";
import { promptHidden } from "./prompt";

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

async function readNewPassword() {
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf-8").split(/\r?\n/)[0] ?? "";
  }
  const password = await promptHidden("New password: ");
  const confirmation = await promptHidden("Repeat new password: ");
  if (password !== confirmation) fail("passwords do not match");
  return password;
}

async function main() {
  const username = adminUsernameSchema.safeParse(process.argv[2] ?? "");
  if (!username.success) {
    fail("usage: admin-reset-password <username> (3-32 chars: a-z 0-9 . _ -)");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set");

  const password = await readNewPassword();
  if (!adminNewPasswordSchema.safeParse(password).success) {
    fail(`password must be ${ADMIN_PASSWORD_MIN_LENGTH}-${ADMIN_PASSWORD_MAX_LENGTH} characters`);
  }

  const client = postgres(databaseUrl, { max: 1 });
  try {
    const result = await resetAdminPassword(drizzle({ client, schema }), username.data, password);
    process.stdout.write(
      `${result.created ? "Created admin" : "Reset password for admin"} "${result.username}"; ` +
        `revoked ${result.revokedSessions} active session(s).\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
