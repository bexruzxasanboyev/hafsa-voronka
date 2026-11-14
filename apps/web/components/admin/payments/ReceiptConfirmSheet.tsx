"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  buildDefaultInstallmentSchedule,
  paymentMethods,
  type EnrollmentStudentRow,
  type InstallmentInput,
  type PaymentMethod,
  type PaymentReceiptItem,
  type PaymentsCatalogResponse,
  type PaymentUserLookupItem,
} from "@funnel/shared";
import { InstallmentScheduleEditor } from "@/components/admin/payments/InstallmentScheduleEditor";
import { UserSearchPicker } from "@/components/admin/payments/UserSearchPicker";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { DatePicker } from "@/components/admin/ui/DatePicker";
import { Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input, Textarea } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Segmented } from "@/components/admin/ui/Segmented";
import { Select } from "@/components/admin/ui/Select";
import { RestartIcon } from "@/components/icons";
import { formatDate, getTashkentToday } from "@/lib/admin/dates";
import {
  confirmPaymentReceipt,
  fetchReceiptFileBlobUrl,
  FILTER_NONE,
  formatStudentDisplayName,
  formatUzs,
  parseUzsInput,
  paymentErrorMessage,
  paymentMethodLabel,
  retryReceiptOcr,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.receipts;
const enrollCopy = adminUz.payments.enrollment;
const actions = adminUz.payments.actions;

type ConfirmMode = "existing" | "new_enrollment";

type ReceiptConfirmSheetProps = {
  open: boolean;
  onClose: () => void;
  receipt: PaymentReceiptItem;
  students: EnrollmentStudentRow[];
  catalog: PaymentsCatalogResponse;
  ocrConfigured: boolean;
  onReceiptUpdated: (receipt: PaymentReceiptItem) => void;
  onConfirmed: () => void;
  onRequestReject: (receipt: PaymentReceiptItem) => void;
};

export function ReceiptConfirmSheet({
  open,
  onClose,
  receipt,
  students,
  catalog,
  ocrConfigured,
  onReceiptUpdated,
  onConfirmed,
  onRequestReject,
}: ReceiptConfirmSheetProps) {
  const router = useRouter();
  const today = getTashkentToday();

  const activeStudents = students.filter((s) => s.status !== "cancelled");
  const matchedEnrollment =
    (receipt.enrollmentId
      ? activeStudents.find((s) => s.id === receipt.enrollmentId)
      : undefined) ??
    (receipt.userId
      ? activeStudents.find((s) => s.userId === receipt.userId)
      : undefined) ??
    null;

  const initialCourse =
    catalog.courses.find((c) => c.isActive) ?? catalog.courses[0] ?? null;
  const initialTariff = initialCourse
    ? catalog.tariffs.find((t) => t.courseId === initialCourse.id && t.isActive) ??
      catalog.tariffs.find((t) => t.courseId === initialCourse.id) ??
      null
    : null;
  const initialContract = initialTariff ? initialTariff.priceUzs : 1000000;
  const initialMonths =
    initialTariff && initialTariff.allowsInstallments
      ? initialTariff.defaultInstallmentMonths
      : 1;

  const [mode, setMode] = useState<ConfirmMode>(
    matchedEnrollment ? "existing" : "new_enrollment",
  );
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>(
    matchedEnrollment
      ? String(matchedEnrollment.id)
      : activeStudents[0]
        ? String(activeStudents[0].id)
        : FILTER_NONE,
  );

  const [selectedUser, setSelectedUser] = useState<PaymentUserLookupItem | null>(() =>
    receipt.userId
      ? {
          id: receipt.userId,
          telegramId: 0,
          name: receipt.userName,
          firstName: receipt.userFirstName,
          username: receipt.userUsername,
          phone: receipt.userPhone,
          wroteAdminAt: null,
          paidAt: null,
          activeEnrollmentCount: 0,
        }
      : null,
  );
  const [courseId, setCourseId] = useState<string>(
    initialCourse ? String(initialCourse.id) : FILTER_NONE,
  );
  const [tariffId, setTariffId] = useState<string>(
    initialTariff ? String(initialTariff.id) : FILTER_NONE,
  );
  const [studyGroupId, setStudyGroupId] = useState<string>(FILTER_NONE);
  const [contractInput, setContractInput] = useState<string>(String(initialContract));
  const [installmentMonths, setInstallmentMonths] = useState<number>(initialMonths);
  const [firstDueDate, setFirstDueDate] = useState<string>(today);
  const [installments, setInstallments] = useState<InstallmentInput[]>(() =>
    buildDefaultInstallmentSchedule(initialContract, initialMonths, today),
  );
  const [enrollmentNote, setEnrollmentNote] = useState("");

  const [amountInput, setAmountInput] = useState<string>(
    receipt.ocrResult?.amountUzs ? String(receipt.ocrResult.amountUzs) : "",
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    receipt.ocrResult?.paymentMethod ?? "click",
  );
  const [paidDate, setPaidDate] = useState<string>(
    receipt.ocrResult?.paidDate ?? today,
  );
  const [reference, setReference] = useState<string>(
    receipt.ocrResult?.reference ?? "",
  );
  const [note, setNote] = useState("");

  const [blobPreview, setBlobPreview] = useState<{
    url: string;
    mimeType: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const [previewReloadTick, setPreviewReloadTick] = useState(0);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let cleanup: (() => void) | null = null;
    let active = true;

    fetchReceiptFileBlobUrl(receipt.id, controller.signal)
      .then((res) => {
        if (!active) {
          res.revoke();
          return;
        }
        cleanup = res.revoke;
        setBlobPreview({ url: res.url, mimeType: res.mimeType });
        setPreviewError(false);
        setPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setPreviewError(true);
        setPreviewLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
      if (cleanup) cleanup();
    };
  }, [open, receipt.id, previewReloadTick, router]);

  function applyOcrToFields(updated: PaymentReceiptItem) {
    if (!updated.ocrResult) return;
    if (updated.ocrResult.amountUzs !== null && updated.ocrResult.amountUzs > 0) {
      setAmountInput(String(updated.ocrResult.amountUzs));
    }
    if (updated.ocrResult.paymentMethod) {
      setPaymentMethod(updated.ocrResult.paymentMethod);
    }
    if (updated.ocrResult.paidDate) {
      setPaidDate(updated.ocrResult.paidDate);
    }
    if (updated.ocrResult.reference) {
      setReference(updated.ocrResult.reference);
    }
  }

  async function handleRetryOcr() {
    setOcrBusy(true);
    setError(null);
    const res = await retryReceiptOcr(receipt.id);
    setOcrBusy(false);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    onReceiptUpdated(res.data);
    applyOcrToFields(res.data);
  }

  const courseNum = Number(courseId);
  const availableTariffs = catalog.tariffs.filter((t) => t.courseId === courseNum);
  const selectedTariff =
    availableTariffs.find((t) => String(t.id) === tariffId) ?? null;
  const availableGroups = catalog.groups.filter(
    (g) => g.isActive && (g.courseId === null || g.courseId === courseNum),
  );

  function applyTariffDefaults(nextTariffId: string, nextCourseNum: number) {
    const match = catalog.tariffs.find(
      (t) => t.courseId === nextCourseNum && String(t.id) === nextTariffId,
    );
    if (!match) return;
    const months = match.allowsInstallments ? match.defaultInstallmentMonths : 1;
    setContractInput(String(match.priceUzs));
    setInstallmentMonths(months);
    setInstallments(buildDefaultInstallmentSchedule(match.priceUzs, months, firstDueDate));
  }

  function handleCourseChange(nextCourseId: string) {
    setCourseId(nextCourseId);
    const nextNum = Number(nextCourseId);
    const list = catalog.tariffs.filter((t) => t.courseId === nextNum);
    const preferred = list.find((t) => t.isActive) ?? list[0] ?? null;
    const nextTariffId = preferred ? String(preferred.id) : FILTER_NONE;
    setTariffId(nextTariffId);
    if (preferred) {
      applyTariffDefaults(nextTariffId, nextNum);
    }
    const grp = catalog.groups.find((g) => String(g.id) === studyGroupId);
    if (grp && grp.courseId !== null && grp.courseId !== nextNum) {
      setStudyGroupId(FILTER_NONE);
    }
  }

  async function handleConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amountUzs = parseUzsInput(amountInput);
    if (amountUzs === null || amountUzs <= 0) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }

    if (mode === "existing") {
      const eId = Number(selectedEnrollmentId);
      if (!Number.isInteger(eId) || eId <= 0) {
        setError(adminUz.payments.errors.required_fields);
        return;
      }
      setSubmitting(true);
      const res = await confirmPaymentReceipt(receipt.id, {
        mode: "existing",
        enrollmentId: eId,
        amountUzs,
        paymentMethod,
        paidDate,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      setSubmitting(false);
      if (!res.ok) {
        setError(paymentErrorMessage(res.error));
        return;
      }
      onConfirmed();
      return;
    }

    const contractAmountUzs = parseUzsInput(contractInput);
    const cId = Number(courseId);
    const tId = Number(tariffId);
    if (
      !selectedUser ||
      !Number.isInteger(cId) ||
      cId <= 0 ||
      !Number.isInteger(tId) ||
      tId <= 0 ||
      contractAmountUzs === null ||
      contractAmountUzs <= 0
    ) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }

    const sum = installments.reduce((acc, row) => acc + row.amountUzs, 0);
    if (sum !== contractAmountUzs) {
      setError(adminUz.payments.errors.installments_sum_mismatch);
      return;
    }

    const groupNum = studyGroupId === FILTER_NONE ? null : Number(studyGroupId);

    setSubmitting(true);
    const res = await confirmPaymentReceipt(receipt.id, {
      mode: "new_enrollment",
      userId: selectedUser.id,
      courseId: cId,
      tariffId: tId,
      studyGroupId:
        groupNum !== null && Number.isInteger(groupNum) && groupNum > 0
          ? groupNum
          : null,
      contractAmountUzs,
      installmentMonths: installments.length,
      firstDueDate,
      installments,
      enrollmentNote: enrollmentNote.trim() || null,
      amountUzs,
      paymentMethod,
      paidDate,
      reference: reference.trim() || null,
      note: note.trim() || null,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }

    onConfirmed();
  }

  const isPdf =
    receipt.mediaType === "pdf" ||
    blobPreview?.mimeType.includes("pdf") ||
    receipt.mimeType?.includes("pdf");

  const enrollmentOptions =
    activeStudents.length > 0
      ? activeStudents.map((s) => ({
          value: String(s.id),
          label: `${formatStudentDisplayName(s)} — ${s.courseTitle} (${formatUzs(s.totalRemainingUzs)})`,
        }))
      : [{ value: FILTER_NONE, label: copy.noExistingEnrollments, disabled: true }];

  const courseOptions =
    catalog.courses.length > 0
      ? catalog.courses.map((c) => ({ value: String(c.id), label: c.title }))
      : [{ value: FILTER_NONE, label: enrollCopy.coursePlaceholder, disabled: true }];

  const tariffOptions =
    availableTariffs.length > 0
      ? availableTariffs.map((t) => ({ value: String(t.id), label: t.name }))
      : [{ value: FILTER_NONE, label: enrollCopy.tariffPlaceholder, disabled: true }];

  const groupOptions = [
    { value: FILTER_NONE, label: enrollCopy.noGroup },
    ...availableGroups.map((g) => ({ value: String(g.id), label: g.name })),
  ];

  const methodOptions = paymentMethods.map((m) => ({
    value: m,
    label: paymentMethodLabel(m),
  }));

  const ocr = receipt.ocrResult;

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={copy.sheetTitle}
      size="wide"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-[15px] font-semibold text-siyoh">
              {copy.previewTitle}
            </h3>
            <div className="flex items-center gap-1.5">
              <Badge tone="neutral">{copy.sources[receipt.source]}</Badge>
              <Badge tone="neutral">{copy.mediaTypes[receipt.mediaType]}</Badge>
            </div>
          </div>

          <div className="flex min-h-[260px] items-center justify-center overflow-hidden rounded-[12px] border border-chiziq bg-varaq p-2">
            {previewLoading ? (
              <p className="m-0 text-sm text-qalam">{copy.previewLoading}</p>
            ) : previewError || !blobPreview ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="m-0 text-sm text-anor">{copy.previewError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPreviewLoading(true);
                    setPreviewError(false);
                    setPreviewReloadTick((v) => v + 1);
                  }}
                >
                  {copy.retryPreview}
                </Button>
              </div>
            ) : isPdf ? (
              <iframe
                title="Chek"
                src={blobPreview.url}
                className="h-[460px] w-full rounded-[8px] border-0 bg-white"
              />
            ) : (
              <Image
                src={blobPreview.url}
                alt={receipt.fileName ?? "Chek"}
                width={900}
                height={1200}
                unoptimized
                className="max-h-[460px] w-full rounded-[8px] object-contain"
              />
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-[12px] border border-chiziq bg-varaq/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-siyoh">
                {copy.ocrSectionTitle}
              </span>
              {receipt.status === "pending" && ocrConfigured && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={ocrBusy}
                  icon={<RestartIcon className="h-3.5 w-3.5" />}
                  onClick={() => void handleRetryOcr()}
                >
                  {copy.retryOcrShort}
                </Button>
              )}
            </div>

            {ocr ? (
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-qalam">{copy.ocrAmount}</dt>
                  <dd className="m-0 font-semibold text-siyoh tabular-nums">
                    {ocr.amountUzs !== null ? formatUzs(ocr.amountUzs) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-qalam">{copy.ocrMethod}</dt>
                  <dd className="m-0 font-semibold text-siyoh">
                    {ocr.paymentMethod ? paymentMethodLabel(ocr.paymentMethod) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-qalam">{copy.ocrDate}</dt>
                  <dd className="m-0 font-semibold text-siyoh tabular-nums">
                    {ocr.paidDate ? formatDate(ocr.paidDate) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-qalam">{copy.ocrConfidence}</dt>
                  <dd className="m-0 font-semibold text-siyoh tabular-nums">
                    {ocr.confidence !== null
                      ? `${Math.round(ocr.confidence * 100)}%`
                      : "—"}
                  </dd>
                </div>
                {ocr.reference && (
                  <div className="col-span-2">
                    <dt className="text-qalam">{copy.ocrReference}</dt>
                    <dd className="m-0 font-mono font-semibold text-siyoh">
                      {ocr.reference}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="m-0 text-xs text-qalam">
                {receipt.ocrError ?? copy.ocrStatuses[receipt.ocrStatus]}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {receipt.status !== "pending" ? (
            <Notice tone={receipt.status === "confirmed" ? "success" : "danger"}>
              {copy.tabs[receipt.status]}
            </Notice>
          ) : (
            <form onSubmit={handleConfirmSubmit} className="flex flex-col gap-4">
              {error && (
                <Notice tone="danger" onDismiss={() => setError(null)}>
                  {error}
                </Notice>
              )}

              <Segmented
                label={copy.modeLabel}
                role="tablist"
                fill
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setError(null);
                }}
                items={[
                  { value: "existing", label: copy.modeExisting },
                  { value: "new_enrollment", label: copy.modeNewEnrollment },
                ]}
              />

              {mode === "existing" ? (
                <Field label={copy.existingEnrollmentLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={selectedEnrollmentId}
                      onValueChange={setSelectedEnrollmentId}
                      options={enrollmentOptions}
                    />
                  )}
                </Field>
              ) : (
                <div className="flex flex-col gap-3">
                  <UserSearchPicker
                    selectedUser={selectedUser}
                    onSelect={setSelectedUser}
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={enrollCopy.courseLabel}>
                      {({ id }) => (
                        <Select
                          id={id}
                          value={courseId}
                          onValueChange={handleCourseChange}
                          options={courseOptions}
                        />
                      )}
                    </Field>
                    <Field label={enrollCopy.tariffLabel}>
                      {({ id }) => (
                        <Select
                          id={id}
                          value={tariffId}
                          onValueChange={(next) => {
                            setTariffId(next);
                            applyTariffDefaults(next, courseNum);
                          }}
                          options={tariffOptions}
                        />
                      )}
                    </Field>
                    <Field label={enrollCopy.groupLabel}>
                      {({ id }) => (
                        <Select
                          id={id}
                          value={studyGroupId}
                          onValueChange={setStudyGroupId}
                          options={groupOptions}
                        />
                      )}
                    </Field>
                  </div>

                  <Field label={enrollCopy.contractAmountLabel}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        inputMode="numeric"
                        value={contractInput}
                        onChange={(event) => {
                          setContractInput(event.target.value);
                          const parsed = parseUzsInput(event.target.value);
                          if (parsed !== null && parsed > 0) {
                            setInstallments(
                              buildDefaultInstallmentSchedule(
                                parsed,
                                installmentMonths,
                                firstDueDate,
                              ),
                            );
                          }
                        }}
                      />
                    )}
                  </Field>

                  <InstallmentScheduleEditor
                    contractAmountUzs={parseUzsInput(contractInput) ?? 0}
                    installmentMonths={installmentMonths}
                    onInstallmentMonthsChange={setInstallmentMonths}
                    firstDueDate={firstDueDate}
                    onFirstDueDateChange={setFirstDueDate}
                    installments={installments}
                    onInstallmentsChange={setInstallments}
                    allowsInstallments={
                      selectedTariff ? selectedTariff.allowsInstallments : true
                    }
                  />

                  <Field label={enrollCopy.noteLabel}>
                    {({ id, describedBy }) => (
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        rows={2}
                        value={enrollmentNote}
                        onChange={(event) => setEnrollmentNote(event.target.value)}
                        maxLength={1000}
                      />
                    )}
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={enrollCopy.amountLabel}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      inputMode="numeric"
                      value={amountInput}
                      onChange={(event) => setAmountInput(event.target.value)}
                    />
                  )}
                </Field>
                <Field label={enrollCopy.methodLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={paymentMethod}
                      onValueChange={(next) => setPaymentMethod(next as PaymentMethod)}
                      options={methodOptions}
                    />
                  )}
                </Field>
                <Field label={enrollCopy.paidDateLabel}>
                  {({ id }) => (
                    <DatePicker
                      id={id}
                      value={paidDate}
                      onChange={setPaidDate}
                    />
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={enrollCopy.referenceLabel}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      maxLength={160}
                    />
                  )}
                </Field>
                <Field label={enrollCopy.paymentNoteLabel}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={500}
                    />
                  )}
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  variant="dangerGhost"
                  disabled={submitting}
                  onClick={() => onRequestReject(receipt)}
                >
                  {copy.rejectButton}
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" disabled={submitting} onClick={onClose}>
                    {actions.cancel}
                  </Button>
                  <Button
                    type="submit"
                    loading={submitting}
                    loadingLabel={copy.confirming}
                  >
                    {copy.confirmSubmit}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </Sheet>
  );
}
