"use client";

import { useEffect, useState } from "react";
import { ADMIN_PASSWORD_MIN_LENGTH } from "@funnel/shared";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Section } from "@/components/admin/ui/Section";
import { adminMe, changeAdminPassword } from "@/lib/admin/api";
import { passwordChangeErrorMessage, passwordFormErrorMessage, validatePasswordChange } from "@/lib/admin/accounts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.settings.account;

type Phase = "idle" | "saving" | "saved" | "error";

export function AccountPasswordCard() {
  const [username, setUsername] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void adminMe().then((result) => {
      if (!active) return;
      if (result.ok) setUsername(result.data.username);
      else setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const reset = () => {
    setPhase("idle");
    setFormError(null);
    setServerError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === "saving" || !current || !next || !repeat) return;
    const problem = validatePasswordChange(current, next, repeat);
    if (problem) {
      setFormError(passwordFormErrorMessage(problem));
      return;
    }
    setPhase("saving");
    setFormError(null);
    setServerError(null);
    const result = await changeAdminPassword(current, next);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setRepeat("");
      setPhase("saved");
    } else {
      setServerError(passwordChangeErrorMessage(result.error));
      setPhase("error");
    }
  };

  const busy = phase === "saving";

  return (
    <Section title={copy.title}>
      {username && (
        <p className="m-0 text-sm text-qalam">
          {copy.signedInAs} <span className="font-semibold text-siyoh">{username}</span>
        </p>
      )}
      {loadError && <Notice tone="danger">{copy.loadError}</Notice>}

      <form onSubmit={submit} className="flex flex-col gap-3 sm:max-w-sm">
        <h3 className="m-0 text-sm font-semibold text-siyoh">{copy.changePassword}</h3>
        <Field label={copy.currentLabel}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(e) => {
                setCurrent(e.target.value);
                reset();
              }}
            />
          )}
        </Field>
        <Field label={copy.newLabel} hint={copy.newHint.replace("{min}", String(ADMIN_PASSWORD_MIN_LENGTH))}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              value={next}
              disabled={busy}
              onChange={(e) => {
                setNext(e.target.value);
                reset();
              }}
            />
          )}
        </Field>
        <Field label={copy.repeatLabel} error={formError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              autoComplete="new-password"
              value={repeat}
              disabled={busy}
              onChange={(e) => {
                setRepeat(e.target.value);
                reset();
              }}
            />
          )}
        </Field>

        {phase === "error" && serverError && <Notice tone="danger">{serverError}</Notice>}
        {phase === "saved" && <Notice tone="success">{copy.success}</Notice>}

        <div className="flex justify-end">
          <Button type="submit" disabled={!current || !next || !repeat} loading={busy} loadingLabel={copy.submitting}>
            {copy.submit}
          </Button>
        </div>
      </form>
    </Section>
  );
}
