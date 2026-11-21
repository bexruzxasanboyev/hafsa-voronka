"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AttributionModel,
  EnrollmentStudentRow,
  PaymentReceiptItem,
  PaymentReceiptsResponse,
  PaymentsCatalogResponse,
  PaymentsOverviewResponse,
  ReceiptStatus,
} from "@funnel/shared";
import { CatalogSheet } from "@/components/admin/payments/CatalogSheet";
import { EnrollmentPaymentSheet } from "@/components/admin/payments/EnrollmentPaymentSheet";
import { GroupBreakdownTable } from "@/components/admin/payments/GroupBreakdownTable";
import { HermesPaymentsSection } from "@/components/admin/payments/HermesPaymentsSection";
import { MasterPaymentsTable } from "@/components/admin/payments/MasterPaymentsTable";
import { PaymentsKpiCards } from "@/components/admin/payments/PaymentsKpiCards";
import { PendingReceiptsSection } from "@/components/admin/payments/PendingReceiptsSection";
import { ReceiptConfirmSheet } from "@/components/admin/payments/ReceiptConfirmSheet";
import { StudentDetailSheet } from "@/components/admin/payments/StudentDetailSheet";
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog } from "@/components/admin/ui/Dialog";
import { Notice } from "@/components/admin/ui/Notice";
import { Page, PageHeader } from "@/components/admin/ui/Page";
import { Segmented } from "@/components/admin/ui/Segmented";
import { ErrorState, LoadingState } from "@/components/admin/ui/States";
import { PlusIcon, SettingsIcon, UploadIcon } from "@/components/icons";
import {
  fetchPaymentReceipts,
  fetchPaymentsCatalog,
  fetchPaymentsOverview,
  FILTER_ALL,
  FILTER_UNASSIGNED,
  paymentErrorMessage,
  rejectPaymentReceipt,
  retryReceiptOcr,
  uploadPaymentReceipt,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments;

type ViewTab = "master" | "groups";

function AdminPaymentsContent() {
  const router = useRouter();
  const quickUploadInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<ViewTab>("master");
  const [attributionModel, setAttributionModel] =
    useState<AttributionModel>("last");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<string>(FILTER_ALL);
  const [courseFilter, setCourseFilter] = useState<string>(FILTER_ALL);
  const [groupFilter, setGroupFilter] = useState<string>(FILTER_ALL);
  const [debtStatusFilter, setDebtStatusFilter] = useState<string>(FILTER_ALL);

  const [overview, setOverview] = useState<PaymentsOverviewResponse | null>(null);
  const [catalog, setCatalog] = useState<PaymentsCatalogResponse | null>(null);
  const [receiptsData, setReceiptsData] =
    useState<PaymentReceiptsResponse | null>(null);
  const [receiptStatusFilter, setReceiptStatusFilter] =
    useState<ReceiptStatus>("pending");

  const [loading, setLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [receiptsAttempt, setReceiptsAttempt] = useState(0);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSession, setEnrollSession] = useState(0);
  const [activeReceipt, setActiveReceipt] = useState<PaymentReceiptItem | null>(
    null,
  );
  const [selectedStudent, setSelectedStudent] =
    useState<EnrollmentStudentRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentReceiptItem | null>(
    null,
  );
  const [busyReceiptId, setBusyReceiptId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [uploadingQuickReceipt, setUploadingQuickReceipt] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    fetchPaymentsOverview({
      attributionModel,
      search: debouncedSearch,
      network: networkFilter,
      courseId: courseFilter,
      studyGroupId: groupFilter,
      debtStatus: debtStatusFilter,
    })
      .then((data) => {
        if (!active) return;
        setOverview(data);
        setSelectedStudent((prev) =>
          prev
            ? data.students.find((item) => item.id === prev.id) ?? prev
            : null,
        );
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setError(adminUz.common.error);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    attributionModel,
    debouncedSearch,
    networkFilter,
    courseFilter,
    groupFilter,
    debtStatusFilter,
    attempt,
    router,
  ]);

  useEffect(() => {
    let active = true;
    fetchPaymentsCatalog()
      .then((data) => {
        if (!active) return;
        setCatalog(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setActionError(adminUz.common.error);
      });
    return () => {
      active = false;
    };
  }, [catalogAttempt, router]);

  useEffect(() => {
    let active = true;
    fetchPaymentReceipts(receiptStatusFilter)
      .then((data) => {
        if (!active) return;
        setReceiptsData(data);
        setReceiptsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setReceiptsLoading(false);
        setActionError(adminUz.common.error);
      });
    return () => {
      active = false;
    };
  }, [receiptStatusFilter, receiptsAttempt, router]);

  const refreshAll = useCallback(() => {
    setAttempt((v) => v + 1);
    setReceiptsAttempt((v) => v + 1);
    setCatalogAttempt((v) => v + 1);
  }, []);

  async function handleQuickReceiptUpload(file: File) {
    setUploadingQuickReceipt(true);
    setActionError(null);
    try {
      const res = await uploadPaymentReceipt(file);
      if (!res.ok) {
        setActionError(paymentErrorMessage(res.error));
        return;
      }
      setReceiptsAttempt((v) => v + 1);
      setActiveReceipt(res.data);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setActionError(copy.errors.generic);
    } finally {
      setUploadingQuickReceipt(false);
    }
  }

  async function handleRetryOcr(receipt: PaymentReceiptItem) {
    setBusyReceiptId(receipt.id);
    setActionError(null);
    try {
      const res = await retryReceiptOcr(receipt.id);
      if (!res.ok) {
        setActionError(paymentErrorMessage(res.error));
        return;
      }
      setReceiptsData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id === res.data.id ? res.data : item,
              ),
            }
          : prev,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setActionError(copy.errors.generic);
    } finally {
      setBusyReceiptId(null);
    }
  }

  async function handleConfirmReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    setActionError(null);
    try {
      const res = await rejectPaymentReceipt(rejectTarget.id);
      setRejectTarget(null);
      if (!res.ok) {
        setActionError(paymentErrorMessage(res.error));
        return;
      }
      if (activeReceipt?.id === res.data.id) {
        setActiveReceipt(null);
      }
      setReceiptsAttempt((v) => v + 1);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setActionError(copy.errors.generic);
    } finally {
      setRejecting(false);
    }
  }

  async function handleOpenReceiptById(receiptId: number) {
    const existing = receiptsData?.items.find((item) => item.id === receiptId);
    if (existing) {
      setActiveReceipt(existing);
      return;
    }
    try {
      const all = await fetchPaymentReceipts("all");
      const found = all.items.find((item) => item.id === receiptId);
      if (found) {
        setActiveReceipt(found);
      } else {
        setActionError(copy.errors.not_found);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setActionError(copy.errors.generic);
    }
  }

  const hasActiveFilters =
    Boolean(search.trim()) ||
    networkFilter !== FILTER_ALL ||
    courseFilter !== FILTER_ALL ||
    groupFilter !== FILTER_ALL ||
    debtStatusFilter !== FILTER_ALL;

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setNetworkFilter(FILTER_ALL);
    setCourseFilter(FILTER_ALL);
    setGroupFilter(FILTER_ALL);
    setDebtStatusFilter(FILTER_ALL);
  }

  const emptyCatalog: PaymentsCatalogResponse = catalog ?? {
    courses: [],
    tariffs: [],
    groups: [],
  };

  return (
    <Page>
      <input
        ref={quickUploadInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleQuickReceiptUpload(file);
        }}
      />

      <PageHeader
        title={adminUz.pages.payments.title}
        description={adminUz.pages.payments.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<SettingsIcon className="h-4 w-4" />}
              onClick={() => setCatalogOpen(true)}
            >
              {copy.actions.catalogAndGroups}
            </Button>
            <Button
              variant="secondary"
              loading={uploadingQuickReceipt}
              loadingLabel={copy.actions.uploadingReceipt}
              icon={<UploadIcon className="h-4 w-4" />}
              onClick={() => quickUploadInputRef.current?.click()}
            >
              {copy.actions.uploadReceipt}
            </Button>
            <Button
              variant="primary"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEnrollSession((v) => v + 1);
                setEnrollOpen(true);
              }}
            >
              {copy.actions.newPayment}
            </Button>
          </div>
        }
      />

      {actionError && (
        <Notice tone="danger" onDismiss={() => setActionError(null)}>
          {actionError}
        </Notice>
      )}

      <HermesPaymentsSection />

      <PendingReceiptsSection
        receipts={receiptsData?.items ?? []}
        ocrConfigured={receiptsData?.ocrConfigured ?? false}
        filter={receiptStatusFilter}
        onFilterChange={(next) => {
          setReceiptsLoading(true);
          setReceiptStatusFilter(next);
        }}
        loading={receiptsLoading}
        busyReceiptId={busyReceiptId}
        onOpenConfirm={(receipt) => setActiveReceipt(receipt)}
        onRetryOcr={(receipt) => void handleRetryOcr(receipt)}
        onReject={(receipt) => setRejectTarget(receipt)}
      />

      {error && (
        <ErrorState
          onRetry={() => {
            setLoading(true);
            setError(null);
            setAttempt((v) => v + 1);
          }}
        />
      )}

      {loading && !overview && <LoadingState variant="list" rows={3} />}

      {overview && (
        <>
          <PaymentsKpiCards kpis={overview.kpis} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={copy.tabs.label}
              role="tablist"
              value={tab}
              onChange={setTab}
              items={[
                {
                  value: "master",
                  label: copy.tabs.master,
                  sub: overview.students.length,
                },
                {
                  value: "groups",
                  label: copy.tabs.groups,
                  sub: overview.groups.length,
                },
              ]}
            />
          </div>

          {tab === "master" ? (
            <MasterPaymentsTable
              students={overview.students}
              courses={emptyCatalog.courses}
              groups={emptyCatalog.groups}
              attributionModel={attributionModel}
              onAttributionModelChange={setAttributionModel}
              search={search}
              onSearchChange={setSearch}
              networkFilter={networkFilter}
              onNetworkFilterChange={setNetworkFilter}
              courseFilter={courseFilter}
              onCourseFilterChange={setCourseFilter}
              groupFilter={groupFilter}
              onGroupFilterChange={setGroupFilter}
              debtStatusFilter={debtStatusFilter}
              onDebtStatusFilterChange={setDebtStatusFilter}
              hasActiveFilters={hasActiveFilters}
              onResetFilters={resetFilters}
              onSelectStudent={(student) => setSelectedStudent(student)}
            />
          ) : (
            <GroupBreakdownTable
              rows={overview.groups}
              onSelectGroup={(groupId) => {
                setGroupFilter(
                  groupId === null ? FILTER_UNASSIGNED : String(groupId),
                );
                setTab("master");
              }}
            />
          )}
        </>
      )}

      {catalogOpen && (
        <CatalogSheet
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          catalog={emptyCatalog}
          onChanged={refreshAll}
        />
      )}

      {enrollOpen && (
        <EnrollmentPaymentSheet
          key={enrollSession}
          open={enrollOpen}
          onClose={() => setEnrollOpen(false)}
          catalog={emptyCatalog}
          onEnrolled={() => {
            setEnrollOpen(false);
            refreshAll();
          }}
          onReceiptUploaded={(receipt) => {
            setEnrollOpen(false);
            setReceiptsAttempt((v) => v + 1);
            setActiveReceipt(receipt);
          }}
        />
      )}

      {activeReceipt && (
        <ReceiptConfirmSheet
          key={activeReceipt.id}
          open={Boolean(activeReceipt)}
          onClose={() => setActiveReceipt(null)}
          receipt={activeReceipt}
          students={overview?.students ?? []}
          catalog={emptyCatalog}
          ocrConfigured={receiptsData?.ocrConfigured ?? false}
          onReceiptUpdated={(updated) => {
            setActiveReceipt(updated);
            setReceiptsAttempt((v) => v + 1);
          }}
          onConfirmed={() => {
            setActiveReceipt(null);
            refreshAll();
          }}
          onRequestReject={(receipt) => setRejectTarget(receipt)}
        />
      )}

      {selectedStudent && (
        <StudentDetailSheet
          key={`${selectedStudent.id}-${selectedStudent.updatedAt}`}
          open={Boolean(selectedStudent)}
          onClose={() => setSelectedStudent(null)}
          student={selectedStudent}
          catalog={emptyCatalog}
          onUpdated={refreshAll}
          onOpenReceipt={(receiptId) => void handleOpenReceiptById(receiptId)}
        />
      )}

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title={copy.receipts.rejectConfirmTitle}
        description={copy.receipts.rejectConfirmDescription}
        confirmLabel={copy.receipts.rejectButton}
        busy={rejecting}
        onCancel={() => {
          if (!rejecting) setRejectTarget(null);
        }}
        onConfirm={handleConfirmReject}
      />
    </Page>
  );
}

export default function AdminPaymentsPage() {
  return (
    <Suspense fallback={<LoadingState variant="page" />}>
      <AdminPaymentsContent />
    </Suspense>
  );
}
