"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CampaignLinkItem } from "@funnel/shared";
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog, Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { IconButton } from "@/components/admin/ui/IconButton";
import { Segmented } from "@/components/admin/ui/Segmented";
import { CheckIcon, TrashIcon } from "@/components/icons";
import { createCampaignLink, deleteCampaignLink, fetchCampaignLinks } from "@/lib/admin/links";
import { adminUz } from "@/lib/i18n/admin";

type SourcePreset = "tg" | "ig" | "fb" | "custom";

type CampaignLinksSheetProps = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
};

const copy = adminUz.links;

const sourceItems: { value: SourcePreset; label: string }[] = [
  { value: "tg", label: copy.sourcePresets.tg },
  { value: "ig", label: copy.sourcePresets.ig },
  { value: "fb", label: copy.sourcePresets.fb },
  { value: "custom", label: copy.sourcePresets.custom },
];

export function CampaignLinksSheet({ open, onClose, onChanged }: CampaignLinksSheetProps) {
  const router = useRouter();
  const [items, setItems] = useState<CampaignLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [sourcePreset, setSourcePreset] = useState<SourcePreset>("tg");
  const [customSource, setCustomSource] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignLinkItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchCampaignLinks()
      .then((data) => {
        if (!active) return;
        setItems(data);
        setLoadError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setLoadError(copy.errors.generic);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, reloadTick, router]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function handleCopy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      setFormError(copy.errors.generic);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolvedSource = (sourcePreset === "custom" ? customSource : sourcePreset).trim();
    const resolvedCampaign = utmCampaign.trim();
    const resolvedContent = utmContent.trim();
    const resolvedCode = code.trim();

    if (!resolvedSource || !resolvedCampaign) {
      setFormError(copy.errors.required);
      return;
    }

    if (resolvedCode && !/^[A-Za-z0-9_-]{1,62}$/.test(resolvedCode)) {
      setFormError(copy.errors.invalid);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createCampaignLink({
        utmSource: resolvedSource,
        utmCampaign: resolvedCampaign,
        ...(resolvedContent ? { utmContent: resolvedContent } : {}),
        ...(resolvedCode ? { code: resolvedCode } : {}),
      });
      if (!result.ok) {
        if (result.error === "code_taken") {
          setFormError(copy.errors.codeTaken);
        } else if (result.error === "invalid_request") {
          setFormError(copy.errors.invalid);
        } else {
          setFormError(copy.errors.generic);
        }
        return;
      }

      setItems((prev) => [result.item, ...prev]);
      setUtmCampaign("");
      setUtmContent("");
      setCode("");
      if (sourcePreset === "custom") {
        setCustomSource("");
      }
      onChanged();
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setFormError(copy.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const ok = await deleteCampaignLink(deleteTarget.code);
      if (!ok) {
        setLoadError(copy.errors.generic);
        setDeleteTarget(null);
        return;
      }
      setItems((prev) => prev.filter((item) => item.code !== deleteTarget.code));
      setDeleteTarget(null);
      onChanged();
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setLoadError(copy.errors.generic);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={copy.sheetTitle}>
        <div className="flex flex-col gap-5">
          <p className="m-0 text-sm text-qalam">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-siyoh">{copy.sourceLabel}</span>
              <Segmented
                label={copy.sourceLabel}
                items={sourceItems}
                value={sourcePreset}
                onChange={(value) => {
                  setSourcePreset(value);
                  setFormError(null);
                }}
                fill
              />
            </div>

            {sourcePreset === "custom" && (
              <Field label={copy.sourceLabel} hideLabel>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={customSource}
                    onChange={(event) => {
                      setCustomSource(event.target.value);
                      setFormError(null);
                    }}
                    placeholder={copy.customSourcePlaceholder}
                    maxLength={100}
                  />
                )}
              </Field>
            )}

            <Field label={copy.campaignLabel}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={utmCampaign}
                  onChange={(event) => {
                    setUtmCampaign(event.target.value);
                    setFormError(null);
                  }}
                  placeholder={copy.campaignPlaceholder}
                  maxLength={100}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={copy.contentLabel}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={utmContent}
                    onChange={(event) => setUtmContent(event.target.value)}
                    placeholder={copy.contentPlaceholder}
                    maxLength={100}
                  />
                )}
              </Field>

              <Field label={copy.codeLabel}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value);
                      setFormError(null);
                    }}
                    placeholder={copy.codePlaceholder}
                    maxLength={62}
                  />
                )}
              </Field>
            </div>

            {formError && (
              <p role="alert" className="m-0 text-sm text-anor">
                {formError}
              </p>
            )}

            <Button type="submit" loading={submitting} loadingLabel={copy.creating} block>
              {copy.createButton}
            </Button>
          </form>

          <div className="flex flex-col gap-3">
            <h3 className="m-0 text-[15px] font-semibold text-siyoh">{copy.listTitle}</h3>

            {loading ? (
              <div role="status" aria-busy="true" className="flex flex-col gap-2.5">
                <span className="sr-only">{adminUz.common.loading}</span>
                <div className="h-28 rounded-[12px] bg-varaq motion-safe:animate-pulse" />
                <div className="h-28 rounded-[12px] bg-varaq motion-safe:animate-pulse" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-start gap-2 rounded-[12px] border border-chiziq bg-white p-4">
                <p role="alert" className="m-0 text-sm text-anor">
                  {loadError}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    setLoadError(null);
                    setReloadTick((value) => value + 1);
                  }}
                >
                  {adminUz.common.retry}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <p className="m-0 rounded-[12px] bg-varaq px-4 py-6 text-center text-sm text-qalam">{copy.empty}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item) => {
                  const botCopyKey = `${item.code}:bot`;
                  const landingCopyKey = `${item.code}:landing`;
                  const botCopied = copiedKey === botCopyKey;
                  const landingCopied = copiedKey === landingCopyKey;
                  const summary = copy.statsSummary
                    .replace("{starts}", String(item.botStarts))
                    .replace("{regs}", String(item.registrations));

                  return (
                    <article key={item.code} className="flex flex-col gap-3 rounded-[12px] border border-chiziq bg-white p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded-full bg-varaq px-2.5 py-0.5 text-xs font-semibold text-siyoh">
                              {item.utmSource}
                            </span>
                            <span className="truncate text-sm font-semibold text-siyoh">{item.utmCampaign}</span>
                            {item.utmContent && <span className="truncate text-xs text-qalam">· {item.utmContent}</span>}
                          </div>
                          <span className="text-xs tabular-nums text-qalam">{summary}</span>
                        </div>

                        <IconButton
                          label={copy.delete}
                          icon={<TrashIcon className="h-4 w-4 text-anor" />}
                          size="sm"
                          onClick={() => setDeleteTarget(item)}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-qalam">{copy.botUrlLabel}</span>
                          <div className="flex items-center gap-2">
                            <span
                              title={item.botUrl}
                              className="min-w-0 flex-1 truncate rounded-[8px] bg-varaq px-2.5 py-1.5 font-mono text-xs text-siyoh"
                            >
                              {item.botUrl}
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={botCopied ? <CheckIcon className="h-3.5 w-3.5 text-zumrad" /> : undefined}
                              onClick={() => handleCopy(botCopyKey, item.botUrl)}
                            >
                              {botCopied ? copy.copied : copy.copy}
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-qalam">{copy.landingUrlLabel}</span>
                          <div className="flex items-center gap-2">
                            <span
                              title={item.landingUrl}
                              className="min-w-0 flex-1 truncate rounded-[8px] bg-varaq px-2.5 py-1.5 font-mono text-xs text-siyoh"
                            >
                              {item.landingUrl}
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={landingCopied ? <CheckIcon className="h-3.5 w-3.5 text-zumrad" /> : undefined}
                              onClick={() => handleCopy(landingCopyKey, item.landingUrl)}
                            >
                              {landingCopied ? copy.copied : copy.copy}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={copy.deleteConfirmTitle}
        description={deleteTarget ? copy.deleteConfirm.replace("{campaign}", deleteTarget.utmCampaign) : undefined}
        confirmLabel={copy.delete}
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
      />
    </>
  );
}
