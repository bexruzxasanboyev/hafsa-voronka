"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  buildDefaultInstallmentSchedule,
  paymentMethods,
  type InstallmentInput,
  type PaymentMethod,
  type PaymentReceiptItem,
  type PaymentsCatalogResponse,
  type PaymentUserLookupItem,
  RECEIPT_MAX_BYTES,
} from "@funnel/shared";
import { InstallmentScheduleEditor } from "@/components/admin/payments/InstallmentScheduleEditor";
import { UserSearchPicker } from "@/components/admin/payments/UserSearchPicker";
import { Button } from "@/components/admin/ui/Button";
import { DatePicker } from "@/components/admin/ui/DatePicker";
import { Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input, Textarea } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Segmented } from "@/components/admin/ui/Segmented";
import { Select } from "@/components/admin/ui/Select";
import { Switch } from "@/components/admin/ui/Switch";
import { UploadIcon } from "@/components/icons";
import { getTashkentToday } from "@/lib/admin/dates";
import {
  createEnrollment,
  FILTER_NONE,
  parseUzsInput,
  paymentErrorMessage,
  paymentMethodLabel,
  uploadPaymentReceipt,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.enrollment;
const actions = adminUz.payments.actions;

type SheetMode = "enroll" | "receipt";

type EnrollmentPaymentSheetProps = {
  open: boolean;
  onClose: () => void;
  catalog: PaymentsCatalogResponse;
  onEnrolled: () => void;
  onReceiptUploaded: (receipt: PaymentReceiptItem) => void;
};

export function EnrollmentPaymentSheet({
  open,
  onClose,
  catalog,
  onEnrolled,
  onReceiptUploaded,
}: EnrollmentPaymentSheetProps) {
  const today = getTashkentToday();
  const activeCourses = catalog.courses.filter((course) => course.isActive);
  const initialCourse = activeCourses[0] ?? catalog.courses[0] ?? null;
  const initialTariff = initialCourse
    ? catalog.tariffs.find((tariff) => tariff.courseId === initialCourse.id && tariff.isActive) ??
      catalog.tariffs.find((tariff) => tariff.courseId === initialCourse.id) ??
      null
    : null;
  const initialContract = initialTariff ? initialTariff.priceUzs : 1000000;
  const initialMonths =
    initialTariff && initialTariff.allowsInstallments
      ? initialTariff.defaultInstallmentMonths
      : 1;

  const [mode, setMode] = useState<SheetMode>("enroll");
  const [selectedUser, setSelectedUser] = useState<PaymentUserLookupItem | null>(null);
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
  const [note, setNote] = useState("");

  const [includeInitialPayment, setIncludeInitialPayment] = useState(true);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>(
    String(
      buildDefaultInstallmentSchedule(initialContract, initialMonths, today)[0]?.amountUzs ??
        initialContract,
    ),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("click");
  const [paidDate, setPaidDate] = useState<string>(today);
  const [reference, setReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [receiptUser, setReceiptUser] = useState<PaymentUserLookupItem | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const courseNum = Number(courseId);
  const availableTariffs = catalog.tariffs.filter(
    (tariff) => tariff.courseId === courseNum,
  );
  const selectedTariff =
    availableTariffs.find((tariff) => String(tariff.id) === tariffId) ?? null;
  const availableGroups = catalog.groups.filter(
    (group) => group.isActive && (group.courseId === null || group.courseId === courseNum),
  );

  function applyTariffDefaults(
    nextTariffId: string,
    nextCourseNum: number,
  ) {
    const match = catalog.tariffs.find(
      (tariff) => tariff.courseId === nextCourseNum && String(tariff.id) === nextTariffId,
    );
    if (!match) return;
    const months = match.allowsInstallments ? match.defaultInstallmentMonths : 1;
    const schedule = buildDefaultInstallmentSchedule(match.priceUzs, months, firstDueDate);
    setContractInput(String(match.priceUzs));
    setInstallmentMonths(months);
    setInstallments(schedule);
    setPaymentAmountInput(String(schedule[0]?.amountUzs ?? match.priceUzs));
  }

  function handleCourseChange(nextCourseId: string) {
    setCourseId(nextCourseId);
    const nextCourseNum = Number(nextCourseId);
    const nextTariffs = catalog.tariffs.filter((t) => t.courseId === nextCourseNum);
    const preferred =
      nextTariffs.find((t) => t.isActive) ?? nextTariffs[0] ?? null;
    const nextTariffId = preferred ? String(preferred.id) : FILTER_NONE;
    setTariffId(nextTariffId);
    if (preferred) {
      applyTariffDefaults(nextTariffId, nextCourseNum);
    }
    const currentGroup = catalog.groups.find((g) => String(g.id) === studyGroupId);
    if (currentGroup && currentGroup.courseId !== null && currentGroup.courseId !== nextCourseNum) {
      setStudyGroupId(FILTER_NONE);
    }
  }

  function handleContractChange(raw: string) {
    setContractInput(raw);
    const parsed = parseUzsInput(raw);
    if (parsed !== null && parsed > 0) {
      const schedule = buildDefaultInstallmentSchedule(parsed, installmentMonths, firstDueDate);
      setInstallments(schedule);
    }
  }

  async function handleEnrollSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
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

    const scheduleSum = installments.reduce((acc, row) => acc + row.amountUzs, 0);
    if (scheduleSum !== contractAmountUzs) {
      setError(adminUz.payments.errors.installments_sum_mismatch);
      return;
    }

    let initialPayment:
      | {
          amountUzs: number;
          paymentMethod: PaymentMethod;
          paidDate: string;
          reference: string | null;
          note: string | null;
        }
      | null = null;

    if (includeInitialPayment) {
      const payAmt = parseUzsInput(paymentAmountInput);
      if (payAmt === null || payAmt <= 0) {
        setError(adminUz.payments.errors.required_fields);
        return;
      }
      initialPayment = {
        amountUzs: payAmt,
        paymentMethod,
        paidDate,
        reference: reference.trim() || null,
        note: paymentNote.trim() || null,
      };
    }

    const groupNum = studyGroupId === FILTER_NONE ? null : Number(studyGroupId);

    setSubmitting(true);
    const res = await createEnrollment({
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
      note: note.trim() || null,
      initialPayment,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }

    onEnrolled();
  }

  async function handleReceiptSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!receiptFile) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }
    if (receiptFile.size > RECEIPT_MAX_BYTES) {
      setError(adminUz.payments.errors.too_large);
      return;
    }

    setSubmitting(true);
    const res = await uploadPaymentReceipt(receiptFile, {
      userId: receiptUser?.id ?? null,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }

    onReceiptUploaded(res.data);
  }

  const courseOptions =
    catalog.courses.length > 0
      ? catalog.courses.map((course) => ({
          value: String(course.id),
          label: course.title,
        }))
      : [{ value: FILTER_NONE, label: copy.coursePlaceholder, disabled: true }];

  const tariffOptions =
    availableTariffs.length > 0
      ? availableTariffs.map((tariff) => ({
          value: String(tariff.id),
          label: tariff.name,
        }))
      : [{ value: FILTER_NONE, label: copy.tariffPlaceholder, disabled: true }];

  const groupOptions = [
    { value: FILTER_NONE, label: copy.noGroup },
    ...availableGroups.map((group) => ({
      value: String(group.id),
      label: group.name,
    })),
  ];

  const methodOptions = paymentMethods.map((method) => ({
    value: method,
    label: paymentMethodLabel(method),
  }));

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={copy.sheetTitle}
      size="wide"
    >
      <div className="flex flex-col gap-5">
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
            { value: "enroll", label: copy.modeEnroll },
            { value: "receipt", label: copy.modeReceipt },
          ]}
        />

        {error && (
          <Notice tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}

        {mode === "enroll" ? (
          <form onSubmit={handleEnrollSubmit} className="flex flex-col gap-4">
            <UserSearchPicker
              selectedUser={selectedUser}
              onSelect={setSelectedUser}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={copy.courseLabel}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={courseId}
                    onValueChange={handleCourseChange}
                    options={courseOptions}
                  />
                )}
              </Field>
              <Field label={copy.tariffLabel}>
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
              <Field label={copy.groupLabel}>
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

            <Field label={copy.contractAmountLabel}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={contractInput}
                  onChange={(event) => handleContractChange(event.target.value)}
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
              allowsInstallments={selectedTariff ? selectedTariff.allowsInstallments : true}
            />

            <Field label={copy.noteLabel}>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={copy.notePlaceholder}
                  maxLength={1000}
                />
              )}
            </Field>

            <div className="flex flex-col gap-3 rounded-[12px] border border-chiziq p-3.5">
              <Switch
                checked={includeInitialPayment}
                onChange={setIncludeInitialPayment}
                label={copy.initialPaymentToggle}
                showLabel
              />

              {includeInitialPayment && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={copy.amountLabel}>
                      {({ id, describedBy }) => (
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          inputMode="numeric"
                          value={paymentAmountInput}
                          onChange={(event) => setPaymentAmountInput(event.target.value)}
                        />
                      )}
                    </Field>
                    <Field label={copy.methodLabel}>
                      {({ id }) => (
                        <Select
                          id={id}
                          value={paymentMethod}
                          onValueChange={(next) => setPaymentMethod(next as PaymentMethod)}
                          options={methodOptions}
                        />
                      )}
                    </Field>
                    <Field label={copy.paidDateLabel}>
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
                    <Field label={copy.referenceLabel}>
                      {({ id, describedBy }) => (
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          value={reference}
                          onChange={(event) => setReference(event.target.value)}
                          placeholder={copy.referencePlaceholder}
                          maxLength={160}
                        />
                      )}
                    </Field>
                    <Field label={copy.paymentNoteLabel}>
                      {({ id, describedBy }) => (
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          value={paymentNote}
                          onChange={(event) => setPaymentNote(event.target.value)}
                          maxLength={500}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button variant="ghost" disabled={submitting} onClick={onClose}>
                {actions.cancel}
              </Button>
              <Button
                type="submit"
                loading={submitting}
                loadingLabel={actions.saving}
              >
                {copy.submitCreate}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleReceiptSubmit} className="flex flex-col gap-4">
            <UserSearchPicker
              selectedUser={receiptUser}
              onSelect={setReceiptUser}
              label={copy.receiptUserOptional}
            />

            <div className="flex flex-col gap-2 rounded-[12px] border border-chiziq bg-varaq/50 p-4">
              <span className="text-sm font-medium text-siyoh">
                {copy.receiptFileLabel}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  setReceiptFile(file);
                  setError(null);
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  icon={<UploadIcon className="h-4 w-4" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {copy.receiptPickFile}
                </Button>
                <span className="min-w-0 truncate text-sm text-qalam">
                  {receiptFile ? receiptFile.name : "Fayl tanlanmagan"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button variant="ghost" disabled={submitting} onClick={onClose}>
                {actions.cancel}
              </Button>
              <Button
                type="submit"
                loading={submitting}
                loadingLabel={actions.uploadingReceipt}
              >
                {copy.receiptUploadSubmit}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
