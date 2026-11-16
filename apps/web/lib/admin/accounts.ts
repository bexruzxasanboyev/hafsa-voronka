import { ADMIN_PASSWORD_MIN_LENGTH } from "@funnel/shared";
import { adminUz } from "../i18n/admin";

const loginCopy = adminUz.login.errors;
const passwordCopy = adminUz.settings.account.errors;
const adminsCopy = adminUz.settings.admins.errors;

const withMin = (text: string) => text.replace("{min}", String(ADMIN_PASSWORD_MIN_LENGTH));

export function loginErrorMessage(result: { status: number; error?: string }): string {
  if (result.error === "invalid_credentials" || (!result.error && result.status === 401)) return loginCopy.wrongCredentials;
  if (result.error === "rate_limited" || result.status === 429) return loginCopy.rateLimited;
  return loginCopy.generic;
}

export type PasswordFormError = "tooShort" | "mismatch" | "same";

export function validatePasswordChange(current: string, next: string, repeat: string): PasswordFormError | null {
  if (next.length < ADMIN_PASSWORD_MIN_LENGTH) return "tooShort";
  if (next !== repeat) return "mismatch";
  if (next === current) return "same";
  return null;
}

export function passwordFormErrorMessage(error: PasswordFormError): string {
  return withMin(passwordCopy[error]);
}

export function passwordChangeErrorMessage(error: string | undefined): string {
  switch (error) {
    case "wrong_password":
    case "weak_password":
    case "rate_limited":
      return withMin(passwordCopy[error]);
    default:
      return passwordCopy.generic;
  }
}

export function adminCreateFormError(username: string, password: string): string | null {
  if (!/^[a-z0-9._-]{3,32}$/.test(username.trim().toLowerCase())) return adminsCopy.invalid_username;
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) return withMin(adminsCopy.weak_password);
  return null;
}

export function adminsErrorMessage(error: string | undefined): string {
  switch (error) {
    case "invalid_username":
    case "weak_password":
    case "username_taken":
    case "last_admin":
    case "cannot_delete_self":
    case "not_found":
      return withMin(adminsCopy[error]);
    case "rate_limited":
      return passwordCopy.rate_limited;
    default:
      return adminsCopy.generic;
  }
}

export function formatAdminDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function formatAdminDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatAdminDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
