"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_PASSWORD_MIN_LENGTH, type AdminUser } from "@funnel/shared";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Section } from "@/components/admin/ui/Section";
import { createAdmin, deleteAdmin, listAdmins } from "@/lib/admin/api";
import { adminCreateFormError, adminsErrorMessage, formatAdminDate, formatAdminDateTime } from "@/lib/admin/accounts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.settings.admins;

export function AdminUsersCard() {
  const [admins, setAdmins] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const result = await listAdmins();
    if (result.ok) {
      setAdmins(result.data);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listAdmins().then((result) => {
      if (!active) return;
      if (result.ok) setAdmins(result.data);
      else setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding) return;
    const problem = adminCreateFormError(username, password);
    if (problem) {
      setFormError(problem);
      return;
    }
    setAdding(true);
    setFormError(null);
    setNotice(null);
    const result = await createAdmin(username, password);
    if (result.ok) {
      setUsername("");
      setPassword("");
      setNotice({ tone: "success", text: copy.added });
      await refresh();
    } else {
      setFormError(adminsErrorMessage(result.error));
    }
    setAdding(false);
  };

  const remove = async (id: number) => {
    setRemovingId(id);
    setNotice(null);
    const result = await deleteAdmin(id);
    setRemovingId(null);
    setConfirmId(null);
    if (result.ok) {
      setNotice({ tone: "success", text: copy.removed });
    } else {
      setNotice({ tone: "danger", text: adminsErrorMessage(result.error) });
    }
    await refresh();
  };

  return (
    <Section title={copy.title} description={copy.description}>
      {loadError && <Notice tone="danger">{copy.loadError}</Notice>}
      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      {admins !== null && admins.length === 0 && !loadError && (
        <p className="m-0 rounded-[12px] bg-varaq px-3.5 py-4 text-center text-sm text-qalam">{copy.empty}</p>
      )}

      {admins !== null && admins.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {admins.map((admin) => {
            const confirming = confirmId === admin.id;
            const removing = removingId === admin.id;
            return (
              <li
                key={admin.id}
                className="flex flex-col gap-3 rounded-[12px] bg-varaq p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-siyoh">{admin.username}</span>
                    {admin.isSelf && <Badge tone="success">{copy.you}</Badge>}
                  </div>
                  <span className="text-xs text-qalam">
                    {copy.created}: {formatAdminDate(admin.createdAt)} · {copy.lastLogin}:{" "}
                    {admin.lastLoginAt ? formatAdminDateTime(admin.lastLoginAt) : copy.never}
                  </span>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {confirming ? (
                    <>
                      <span className="text-[13px] text-qalam">{copy.confirmPrompt}</span>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={removing}
                        loadingLabel={copy.removing}
                        onClick={() => void remove(admin.id)}
                      >
                        {copy.confirmYes}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={removing} onClick={() => setConfirmId(null)}>
                        {copy.confirmNo}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="dangerGhost"
                      size="sm"
                      disabled={admin.isSelf || removingId !== null}
                      title={admin.isSelf ? copy.removeSelfHint : undefined}
                      onClick={() => {
                        setNotice(null);
                        setConfirmId(admin.id);
                      }}
                    >
                      {copy.remove}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-3 border-t border-chiziq pt-4">
        <h3 className="m-0 text-sm font-semibold text-siyoh">{copy.addTitle}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={copy.usernameLabel} hint={copy.usernameHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                disabled={adding}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFormError(null);
                }}
              />
            )}
          </Field>
          <Field
            label={copy.passwordLabel}
            hint={copy.passwordHint.replace("{min}", String(ADMIN_PASSWORD_MIN_LENGTH))}
            error={formError}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={adding}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFormError(null);
                }}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!username.trim() || !password} loading={adding} loadingLabel={copy.adding}>
            {copy.add}
          </Button>
        </div>
      </form>
    </Section>
  );
}
