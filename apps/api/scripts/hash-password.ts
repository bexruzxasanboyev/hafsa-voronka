import { readFileSync } from "node:fs";
import { promptHidden } from "./prompt";
import { hashPassword } from "../src/admin/password";

async function readPassword() {
  if (process.argv[2]) return process.argv[2];
  if (process.stdin.isTTY) return promptHidden("Admin password: ");
  return readFileSync(0, "utf-8").trim();
}

async function main() {
  const password = await readPassword();
  if (!password) {
    process.stderr.write("Error: password is required\n");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  process.stdout.write(`${hash}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
