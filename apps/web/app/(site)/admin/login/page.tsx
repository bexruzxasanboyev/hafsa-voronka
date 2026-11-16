"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminLogin, adminMe } from "@/lib/admin/api";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { LoadingState } from "@/components/admin/ui/States";
import { loginErrorMessage } from "@/lib/admin/accounts";
import { adminUz } from "@/lib/i18n/admin";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void adminMe().then((session) => {
      if (!mounted) return;
      if (session.ok) {
        router.replace("/admin");
      } else {
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || loading) return;

    setLoading(true);
    setError(null);

    const result = await adminLogin(username, password);
    if (result.ok) {
      router.replace("/admin");
      return;
    }

    setError(loginErrorMessage(result));
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="px-4 py-6">
        <LoadingState variant="section" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-varaq text-siyoh">
      <div className="bg-siyoh-deep px-4 pb-24 pt-12 text-varaq sm:pt-16">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-1">
          <span className="text-2xl font-bold leading-tight">{adminUz.brand.name}</span>
          <span className="text-sm text-kumush">{adminUz.brand.sub}</span>
        </div>
      </div>

      <div className="-mt-16 px-4 pb-10">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-[20px] bg-white p-5 sm:p-6">
          <p className="m-0 text-sm text-qalam">{adminUz.login.subtitle}</p>

          <Field label={adminUz.login.usernameLabel}>
            {({ id }) => (
              <Input
                id={id}
                type="text"
                autoFocus
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                placeholder={adminUz.login.usernamePlaceholder}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>

          <Field label={adminUz.login.passwordLabel}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                placeholder={adminUz.login.passwordPlaceholder}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          {error && <Notice tone="danger">{error}</Notice>}

          <Button type="submit" block disabled={!username.trim() || !password} loading={loading} loadingLabel={adminUz.login.submitting}>
            {adminUz.login.submitButton}
          </Button>
        </form>
      </div>
    </div>
  );
}
