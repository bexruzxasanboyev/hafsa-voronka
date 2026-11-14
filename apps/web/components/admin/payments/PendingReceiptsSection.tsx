"use client";

import type { PaymentReceiptItem, ReceiptStatus } from "@funnel/shared";
import { Badge, type BadgeTone } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { Section } from "@/components/admin/ui/Section";
import { Segmented } from "@/components/admin/ui/Segmented";
import { ReceiptIcon, RestartIcon } from "@/components/icons";
import { formatDate } from "@/lib/admin/dates";
import {
  formatStudentDisplayName,
  formatUzs,
  paymentMethodLabel,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.receipts;

type PendingReceiptsSectionProps = {
  receipts: PaymentReceiptItem[];
  ocrConfigured: boolean;
  filter: ReceiptStatus;
  onFilterChange: (status: ReceiptStatus) => void;
  loading: boolean;
  busyReceiptId: number | null;
  onOpenConfirm: (receipt: PaymentReceiptItem) => void;
  onRetryOcr: (receipt: PaymentReceiptItem) => void;
  onReject: (receipt: PaymentReceiptItem) => void;
};

function ocrBadgeTone(status: PaymentReceiptItem["ocrStatus"]): BadgeTone {
  if (status === "ok") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

function formatCreatedAt(iso: string): string {
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && /^\d{2}:\d{2}$/.test(timePart)) {
    return `${formatDate(datePart)} ${timePart}`;
  }
  return iso;
}

export function PendingReceiptsSection({
  receipts,
  ocrConfigured,
  filter,
  onFilterChange,
  loading,
  busyReceiptId,
  onOpenConfirm,
  onRetryOcr,
  onReject,
}: PendingReceiptsSectionProps) {
  const statusItems: { value: ReceiptStatus; label: string }[] = [
    { value: "pending", label: copy.tabs.pending },
    { value: "confirmed", label: copy.tabs.confirmed },
    { value: "rejected", label: copy.tabs.rejected },
  ];

  return (
    <Section
      title={copy.title}
      description={copy.description}
      actions={
        <Segmented
          label={copy.tabsLabel}
          role="tablist"
          value={filter}
          onChange={onFilterChange}
          items={statusItems}
        />
      }
    >
      {loading && receipts.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="h-28 rounded-[12px] bg-varaq motion-safe:animate-pulse" />
          <div className="h-28 rounded-[12px] bg-varaq motion-safe:animate-pulse" />
        </div>
      ) : receipts.length === 0 ? (
        <p className="m-0 rounded-[12px] bg-varaq px-4 py-5 text-center text-sm text-qalam">
          {filter === "pending" ? copy.emptyPending : copy.emptyHistory}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {receipts.map((receipt) => {
            const busy = busyReceiptId === receipt.id;
            const sender = formatStudentDisplayName({
              name: receipt.userName,
              firstName: receipt.userFirstName,
              username: receipt.userUsername,
            });
            const ocr = receipt.ocrResult;

            return (
              <article
                key={receipt.id}
                className="flex flex-col justify-between gap-3 rounded-[14px] border border-chiziq bg-varaq/50 p-3.5"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ReceiptIcon className="h-4 w-4 shrink-0 text-qalam" />
                        <span className="truncate text-sm font-semibold text-siyoh">{sender}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-qalam tabular-nums">
                        {receipt.userPhone && <span>{receipt.userPhone}</span>}
                        {receipt.userUsername && <span>@{receipt.userUsername}</span>}
                        <span>{formatCreatedAt(receipt.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">{copy.sources[receipt.source]}</Badge>
                      <Badge tone="neutral">{copy.mediaTypes[receipt.mediaType]}</Badge>
                      <Badge tone={ocrBadgeTone(receipt.ocrStatus)}>
                        {copy.ocrStatuses[receipt.ocrStatus]}
                      </Badge>
                    </div>
                  </div>

                  {ocr && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!ocr.isReceipt && (
                        <Badge tone="attention">{copy.notReceiptWarning}</Badge>
                      )}
                      {ocr.amountUzs !== null && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-siyoh tabular-nums">
                          {formatUzs(ocr.amountUzs)}
                        </span>
                      )}
                      {ocr.paymentMethod && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-qalam">
                          {paymentMethodLabel(ocr.paymentMethod)}
                        </span>
                      )}
                      {ocr.paidDate && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-qalam tabular-nums">
                          {formatDate(ocr.paidDate)}
                        </span>
                      )}
                      {ocr.confidence !== null && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-qalam tabular-nums">
                          {copy.confidenceLabel.replace(
                            "{pct}",
                            String(Math.round(ocr.confidence * 100)),
                          )}
                        </span>
                      )}
                      {ocr.reference && (
                        <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-xs text-qalam">
                          #{ocr.reference}
                        </span>
                      )}
                    </div>
                  )}

                  {receipt.ocrStatus === "failed" && receipt.ocrError && (
                    <p className="m-0 text-xs text-anor">{receipt.ocrError}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {receipt.status === "pending" ? (
                    <>
                      <Button
                        variant="dangerGhost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onReject(receipt)}
                      >
                        {copy.rejectButton}
                      </Button>
                      {ocrConfigured && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          icon={<RestartIcon className="h-3.5 w-3.5" />}
                          onClick={() => onRetryOcr(receipt)}
                        >
                          {copy.retryOcrButton}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => onOpenConfirm(receipt)}
                      >
                        {copy.confirmButton}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenConfirm(receipt)}
                    >
                      {copy.viewButton}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
