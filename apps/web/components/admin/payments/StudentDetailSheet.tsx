"use client";

import { useState, type FormEvent } from "react";
import {
  buildDefaultInstallmentSchedule,
  enrollmentStatuses,
  paymentMethods,
  type ComputedInstallment,
  type EnrollmentStatus,
  type EnrollmentStudentRow,
  type InstallmentInput,
  type PaymentMethod,
  type PaymentRecordItem,
  type PaymentsCatalogResponse,
} from "@funnel/shared";
import { InstallmentScheduleEditor } from "@/components/admin/payments/InstallmentScheduleEditor";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { DatePicker } from "@/components/admin/ui/DatePicker";
import { ConfirmDialog, Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input, Textarea } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Select } from "@/components/admin/ui/Select";
import { type StatColumn, StatTable } from "@/components/admin/ui/StatTable";
import { formatDate, getTashkentToday } from "@/lib/admin/dates";
import {
  addEnrollmentPayment,
  debtStatusLabel,
  debtStatusTone,
  enrollmentStatusLabel,
  FILTER_NONE,
  formatStudentDisplayName,
  formatUzs,
  installmentStateLabel,
  installmentStateTone,
  networkLabel,
  parseUzsInput,
  paymentErrorMessage,
  paymentMethodLabel,
  refundPaymentRecord,
  updateEnrollment,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.detail;
const enrollCopy = adminUz.payments.enrollment;
const actions = adminUz.payments.actions;

type StudentDetailSheetProps = {
  open: boolean;
  onClose: () => void;
  student: EnrollmentStudentRow;
  catalog: PaymentsCatalogResponse;
  onUpdated: () => void;
  onOpenReceipt: (receiptId: number) => void;
};

export function StudentDetailSheet({
  open,
  onClose,
  student,
  catalog,
  onUpdated,
  onOpenReceipt,
}: StudentDetailSheetProps) {
  const today = getTashkentToday();

  const [studyGroupId, setStudyGroupId] = useState<string>(
    student.studyGroupId !== null ? String(student.studyGroupId) : FILTER_NONE,
  );
  const [status, setStatus] = useState<EnrollmentStatus>(student.status);
  const [contractInput, setContractInput] = useState<string>(
    String(student.contractAmountUzs),
  );
  const [note, setNote] = useState<string>(student.note ?? "");
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [installmentMonths, setInstallmentMonths] = useState<number>(
    Math.max(1, student.installments.length),
  );
  const [firstDueDate, setFirstDueDate] = useState<string>(
    student.installments[0]?.dueDate ?? today,
  );
  const [installments, setInstallments] = useState<InstallmentInput[]>(() =>
    student.installments.map((item) => ({
      installmentNo: item.installmentNo,
      dueDate: item.dueDate,
      amountUzs: item.amountUzs,
    })),
  );

  const [paymentAmountInput, setPaymentAmountInput] = useState<string>(
    student.currentMonthDebtUzs > 0
      ? String(student.currentMonthDebtUzs)
      : student.totalRemainingUzs > 0
        ? String(student.totalRemainingUzs)
        : "",
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("click");
  const [paidDate, setPaidDate] = useState<string>(today);
  const [reference, setReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [savingEdit, setSavingEdit] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [refundTarget, setRefundTarget] = useState<PaymentRecordItem | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveChanges(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const contractAmountUzs = parseUzsInput(contractInput);
    if (contractAmountUzs === null || contractAmountUzs <= 0) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }

    const scheduleChanged =
      editScheduleOpen || contractAmountUzs !== student.contractAmountUzs;
    const effectiveInstallments =
      scheduleChanged
        ? installments
        : undefined;

    if (effectiveInstallments) {
      const sum = effectiveInstallments.reduce((acc, row) => acc + row.amountUzs, 0);
      if (sum !== contractAmountUzs) {
        setError(adminUz.payments.errors.installments_sum_mismatch);
        return;
      }
    }

    const groupNum = studyGroupId === FILTER_NONE ? null : Number(studyGroupId);

    setSavingEdit(true);
    const res = await updateEnrollment(student.id, {
      studyGroupId:
        groupNum !== null && Number.isInteger(groupNum) && groupNum > 0
          ? groupNum
          : null,
      status,
      contractAmountUzs,
      ...(effectiveInstallments ? { installments: effectiveInstallments } : {}),
      note: note.trim() || null,
    });
    setSavingEdit(false);

    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }

    onUpdated();
  }

  async function handleAddPayment(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amountUzs = parseUzsInput(paymentAmountInput);
    if (amountUzs === null || amountUzs <= 0) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }

    setSavingPayment(true);
    const res = await addEnrollmentPayment(student.id, {
      amountUzs,
      paymentMethod,
      paidDate,
      reference: reference.trim() || null,
      note: paymentNote.trim() || null,
    });
    setSavingPayment(false);

    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }

    setReference("");
    setPaymentNote("");
    onUpdated();
  }

  async function handleConfirmRefund() {
    if (!refundTarget) return;
    setRefunding(true);
    setError(null);
    const res = await refundPaymentRecord(refundTarget.id);
    setRefunding(false);
    setRefundTarget(null);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    onUpdated();
  }

  const groupOptions = [
    { value: FILTER_NONE, label: enrollCopy.noGroup },
    ...catalog.groups.map((g) => ({ value: String(g.id), label: g.name })),
  ];

  const statusOptions = enrollmentStatuses.map((s) => ({
    value: s,
    label: enrollmentStatusLabel(s),
  }));

  const methodOptions = paymentMethods.map((m) => ({
    value: m,
    label: paymentMethodLabel(m),
  }));

  const installmentColumns: StatColumn<ComputedInstallment>[] = [
    {
      key: "installmentNo",
      label: copy.installmentNo,
      mobile: "title",
      render: (row) => `${row.installmentNo}-oy`,
    },
    {
      key: "dueDate",
      label: copy.installmentDueDate,
      render: (row) => formatDate(row.dueDate),
    },
    {
      key: "amountUzs",
      label: copy.installmentPlanned,
      align: "right",
      render: (row) => formatUzs(row.amountUzs),
    },
    {
      key: "paidUzs",
      label: copy.installmentPaid,
      align: "right",
      render: (row) => (
        <span className="font-semibold text-zumrad">
          {formatUzs(row.paidUzs)}
        </span>
      ),
    },
    {
      key: "remainingUzs",
      label: copy.installmentRemaining,
      align: "right",
      render: (row) => (
        <span className={row.remainingUzs > 0 ? "font-semibold text-anor" : ""}>
          {formatUzs(row.remainingUzs)}
        </span>
      ),
    },
    {
      key: "state",
      label: copy.installmentState,
      render: (row) => (
        <Badge tone={installmentStateTone(row.state)}>
          {installmentStateLabel(row.state)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <Sheet open={open} onClose={onClose} title={copy.title} size="wide">
        <div className="flex flex-col gap-5">
          {error && (
            <Notice tone="danger" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          )}

          <div className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="m-0 text-lg font-bold text-siyoh">
                  {formatStudentDisplayName(student)}
                </h3>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-qalam tabular-nums">
                  {student.phone && <span>{student.phone}</span>}
                  {student.username && <span>@{student.username}</span>}
                  <span>ID {student.telegramId}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{enrollmentStatusLabel(student.status)}</Badge>
                <Badge tone={debtStatusTone(student.debtStatus)}>
                  {debtStatusLabel(student.debtStatus)}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-chiziq pt-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-qalam">Kurs / Tarif</div>
                <div className="text-sm font-semibold text-siyoh">
                  {student.courseTitle}
                </div>
                <div className="text-xs text-qalam">{student.tariffName}</div>
              </div>
              <div>
                <div className="text-xs text-qalam">Shartnoma</div>
                <div className="text-sm font-semibold text-siyoh tabular-nums">
                  {formatUzs(student.contractAmountUzs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-qalam">To‘langan</div>
                <div className="text-sm font-semibold text-zumrad tabular-nums">
                  {formatUzs(student.paidAmountUzs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-qalam">Qolgan qarz</div>
                <div
                  className={`text-sm font-semibold tabular-nums ${student.totalRemainingUzs > 0 ? "text-anor" : "text-siyoh"}`}
                >
                  {formatUzs(student.totalRemainingUzs)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-[14px] border border-chiziq bg-white p-4">
            <h4 className="m-0 text-sm font-semibold text-siyoh">
              {copy.attributionTitle}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-[10px] bg-varaq p-3">
                <span className="text-xs font-medium text-qalam">
                  {copy.firstTouch}
                </span>
                <div>
                  <Badge tone="neutral">{networkLabel(student.firstNetwork)}</Badge>
                </div>
                <span className="text-xs text-qalam">
                  {student.firstCampaign ?? copy.noCampaign}
                  {student.firstSource ? ` (${student.firstSource})` : ""}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-[10px] bg-varaq p-3">
                <span className="text-xs font-medium text-qalam">
                  {copy.lastTouch}
                </span>
                <div>
                  <Badge tone="neutral">{networkLabel(student.lastNetwork)}</Badge>
                </div>
                <span className="text-xs text-qalam">
                  {student.lastCampaign ?? copy.noCampaign}
                  {student.lastSource ? ` (${student.lastSource})` : ""}
                </span>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSaveChanges}
            className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-white p-4"
          >
            <h4 className="m-0 text-sm font-semibold text-siyoh">
              {copy.editSectionTitle}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <Field label={copy.statusLabel}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={status}
                    onValueChange={(next) => setStatus(next as EnrollmentStatus)}
                    options={statusOptions}
                  />
                )}
              </Field>
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
                        setEditScheduleOpen(true);
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
            </div>

            <Field label={enrollCopy.noteLabel}>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditScheduleOpen((prev) => !prev)}
              >
                {enrollCopy.scheduleTitle}
              </Button>
              <Button
                type="submit"
                size="sm"
                loading={savingEdit}
                loadingLabel={actions.saving}
              >
                {copy.saveChanges}
              </Button>
            </div>

            {editScheduleOpen && (
              <InstallmentScheduleEditor
                contractAmountUzs={parseUzsInput(contractInput) ?? 0}
                installmentMonths={installmentMonths}
                onInstallmentMonthsChange={setInstallmentMonths}
                firstDueDate={firstDueDate}
                onFirstDueDateChange={setFirstDueDate}
                installments={installments}
                onInstallmentsChange={setInstallments}
              />
            )}
          </form>

          <div className="flex flex-col gap-2 rounded-[14px] border border-chiziq bg-white p-4">
            <h4 className="m-0 text-sm font-semibold text-siyoh">
              {copy.scheduleSectionTitle}
            </h4>
            <StatTable
              columns={installmentColumns}
              rows={student.installments}
              rowKey={(row) => row.installmentNo}
              empty={adminUz.common.noData}
            />
          </div>

          {student.status !== "cancelled" && (
            <form
              onSubmit={handleAddPayment}
              className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq/60 p-4"
            >
              <h4 className="m-0 text-sm font-semibold text-siyoh">
                {copy.addPaymentTitle}
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={enrollCopy.amountLabel}>
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
                      value={paymentNote}
                      onChange={(event) => setPaymentNote(event.target.value)}
                      maxLength={500}
                    />
                  )}
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={savingPayment}
                  loadingLabel={actions.saving}
                >
                  {copy.addPaymentSubmit}
                </Button>
              </div>
            </form>
          )}

          <div className="flex flex-col gap-2.5 rounded-[14px] border border-chiziq bg-white p-4">
            <h4 className="m-0 text-sm font-semibold text-siyoh">
              {copy.paymentsHistoryTitle}
            </h4>
            {student.payments.length === 0 ? (
              <p className="m-0 rounded-[10px] bg-varaq px-3 py-4 text-center text-sm text-qalam">
                {copy.noPayments}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {student.payments.map((payment) => (
                  <article
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-chiziq bg-varaq/40 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-siyoh tabular-nums">
                          {formatUzs(payment.amountUzs)}
                        </span>
                        <Badge tone="neutral">
                          {paymentMethodLabel(payment.paymentMethod)}
                        </Badge>
                        <Badge
                          tone={payment.status === "verified" ? "success" : "danger"}
                        >
                          {adminUz.payments.paymentRecordStatuses[payment.status]}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-qalam tabular-nums">
                        <span>{formatDate(payment.paidDate)}</span>
                        {payment.reference && <span>#{payment.reference}</span>}
                        {payment.note && <span>{payment.note}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {payment.receiptId !== null && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (payment.receiptId !== null) {
                              onOpenReceipt(payment.receiptId);
                            }
                          }}
                        >
                          {copy.viewReceipt}
                        </Button>
                      )}
                      {payment.status === "verified" && (
                        <Button
                          variant="dangerGhost"
                          size="sm"
                          onClick={() => setRefundTarget(payment)}
                        >
                          {copy.refundButton}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(refundTarget)}
        title={copy.refundConfirmTitle}
        description={
          refundTarget
            ? copy.refundConfirmDesc.replace(
                "{amount}",
                formatUzs(refundTarget.amountUzs),
              )
            : undefined
        }
        confirmLabel={copy.refundButton}
        busy={refunding}
        onCancel={() => {
          if (!refunding) setRefundTarget(null);
        }}
        onConfirm={handleConfirmRefund}
      />
    </>
  );
}
