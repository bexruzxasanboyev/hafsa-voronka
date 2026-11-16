import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

function parseHash(storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return null;
  const salt = Buffer.from(parts[1], "base64");
  const key = Buffer.from(parts[2], "base64");
  if (salt.length !== 16 || key.length !== 64) return null;
  return { salt, key };
}

export function isValidPasswordHash(storedHash: string): boolean {
  return parseHash(storedHash) !== null;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parseHash(storedHash);
  if (!parsed) return false;
  const derivedKey = (await scryptAsync(password, parsed.salt, 64)) as Buffer;
  return timingSafeEqual(derivedKey, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/** Burns the same scrypt cost as a real check so unknown usernames are not distinguishable by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}
