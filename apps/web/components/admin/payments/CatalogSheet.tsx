"use client";

import { useState, type FormEvent } from "react";
import type {
  CourseItem,
  PaymentsCatalogResponse,
  StudyGroupItem,
  TariffItem,
} from "@funnel/shared";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { DatePicker } from "@/components/admin/ui/DatePicker";
import { ConfirmDialog, Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input, Textarea } from "@/components/admin/ui/Field";
import { IconButton } from "@/components/admin/ui/IconButton";
import { Notice } from "@/components/admin/ui/Notice";
import { Segmented } from "@/components/admin/ui/Segmented";
import { Select } from "@/components/admin/ui/Select";
import { Switch } from "@/components/admin/ui/Switch";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { formatDate } from "@/lib/admin/dates";
import {
  createCourse,
  createStudyGroup,
  createTariff,
  deleteCourse,
  deleteStudyGroup,
  deleteTariff,
  FILTER_NONE,
  formatUzs,
  parseUzsInput,
  paymentErrorMessage,
  updateCourse,
  updateStudyGroup,
  updateTariff,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.catalog;
const actions = adminUz.payments.actions;

type CatalogTab = "courses" | "tariffs" | "groups";

type DeleteTarget =
  | { kind: "course"; item: CourseItem }
  | { kind: "tariff"; item: TariffItem }
  | { kind: "group"; item: StudyGroupItem };

type CatalogSheetProps = {
  open: boolean;
  onClose: () => void;
  catalog: PaymentsCatalogResponse;
  onChanged: () => void;
};

export function CatalogSheet({
  open,
  onClose,
  catalog,
  onChanged,
}: CatalogSheetProps) {
  const [tab, setTab] = useState<CatalogTab>("courses");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingCourseId, setEditingCourseId] = useState<number | null>(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDesc, setCourseDesc] = useState("");
  const [courseActive, setCourseActive] = useState(true);

  const [editingTariffId, setEditingTariffId] = useState<number | null>(null);
  const [tariffCourseId, setTariffCourseId] = useState<string>(
    catalog.courses[0] ? String(catalog.courses[0].id) : FILTER_NONE,
  );
  const [tariffName, setTariffName] = useState("");
  const [tariffPrice, setTariffPrice] = useState("1000000");
  const [tariffAllowsInstallments, setTariffAllowsInstallments] = useState(true);
  const [tariffDefaultMonths, setTariffDefaultMonths] = useState("3");
  const [tariffActive, setTariffActive] = useState(true);

  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupCourseId, setGroupCourseId] = useState<string>(FILTER_NONE);
  const [groupStartsAt, setGroupStartsAt] = useState("");
  const [groupCapacity, setGroupCapacity] = useState("");
  const [groupActive, setGroupActive] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  function resetCourseForm() {
    setEditingCourseId(null);
    setCourseTitle("");
    setCourseDesc("");
    setCourseActive(true);
  }

  function resetTariffForm() {
    setEditingTariffId(null);
    setTariffCourseId(catalog.courses[0] ? String(catalog.courses[0].id) : FILTER_NONE);
    setTariffName("");
    setTariffPrice("1000000");
    setTariffAllowsInstallments(true);
    setTariffDefaultMonths("3");
    setTariffActive(true);
  }

  function resetGroupForm() {
    setEditingGroupId(null);
    setGroupName("");
    setGroupCourseId(FILTER_NONE);
    setGroupStartsAt("");
    setGroupCapacity("");
    setGroupActive(true);
  }

  async function handleCourseSubmit(event: FormEvent) {
    event.preventDefault();
    const title = courseTitle.trim();
    if (!title) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      title,
      description: courseDesc.trim() || null,
      isActive: courseActive,
    };
    const res =
      editingCourseId !== null
        ? await updateCourse(editingCourseId, payload)
        : await createCourse(payload);
    setBusy(false);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    resetCourseForm();
    onChanged();
  }

  async function handleTariffSubmit(event: FormEvent) {
    event.preventDefault();
    const courseIdNum = Number(tariffCourseId);
    const name = tariffName.trim();
    const priceUzs = parseUzsInput(tariffPrice);
    const months = Number(tariffDefaultMonths);
    if (
      !Number.isInteger(courseIdNum) ||
      courseIdNum <= 0 ||
      !name ||
      priceUzs === null ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > 36
    ) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      courseId: courseIdNum,
      name,
      priceUzs,
      allowsInstallments: tariffAllowsInstallments,
      defaultInstallmentMonths: tariffAllowsInstallments ? months : 1,
      isActive: tariffActive,
    };
    const res =
      editingTariffId !== null
        ? await updateTariff(editingTariffId, payload)
        : await createTariff(payload);
    setBusy(false);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    resetTariffForm();
    onChanged();
  }

  async function handleGroupSubmit(event: FormEvent) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setError(adminUz.payments.errors.required_fields);
      return;
    }
    const courseIdNum =
      groupCourseId === FILTER_NONE ? null : Number(groupCourseId);
    const capNum = groupCapacity.trim() ? Number(groupCapacity.trim()) : null;
    if (capNum !== null && (!Number.isInteger(capNum) || capNum <= 0)) {
      setError(adminUz.payments.errors.invalid_request);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name,
      courseId:
        courseIdNum !== null && Number.isInteger(courseIdNum) && courseIdNum > 0
          ? courseIdNum
          : null,
      startsAt: groupStartsAt || null,
      capacity: capNum,
      isActive: groupActive,
    };
    const res =
      editingGroupId !== null
        ? await updateStudyGroup(editingGroupId, payload)
        : await createStudyGroup(payload);
    setBusy(false);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    resetGroupForm();
    onChanged();
  }

  async function handleToggleCourseActive(item: CourseItem, next: boolean) {
    setError(null);
    const res = await updateCourse(item.id, {
      title: item.title,
      description: item.description,
      isActive: next,
    });
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    onChanged();
  }

  async function handleToggleTariffActive(item: TariffItem, next: boolean) {
    setError(null);
    const res = await updateTariff(item.id, {
      courseId: item.courseId,
      name: item.name,
      priceUzs: item.priceUzs,
      allowsInstallments: item.allowsInstallments,
      defaultInstallmentMonths: item.defaultInstallmentMonths,
      isActive: next,
    });
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    onChanged();
  }

  async function handleToggleGroupActive(item: StudyGroupItem, next: boolean) {
    setError(null);
    const res = await updateStudyGroup(item.id, {
      name: item.name,
      courseId: item.courseId,
      startsAt: item.startsAt,
      capacity: item.capacity,
      isActive: next,
    });
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    onChanged();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    const res =
      deleteTarget.kind === "course"
        ? await deleteCourse(deleteTarget.item.id)
        : deleteTarget.kind === "tariff"
          ? await deleteTariff(deleteTarget.item.id)
          : await deleteStudyGroup(deleteTarget.item.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (!res.ok) {
      setError(paymentErrorMessage(res.error));
      return;
    }
    if (deleteTarget.kind === "course" && editingCourseId === deleteTarget.item.id) {
      resetCourseForm();
    }
    if (deleteTarget.kind === "tariff" && editingTariffId === deleteTarget.item.id) {
      resetTariffForm();
    }
    if (deleteTarget.kind === "group" && editingGroupId === deleteTarget.item.id) {
      resetGroupForm();
    }
    onChanged();
  }

  const courseSelectOptions =
    catalog.courses.length > 0
      ? catalog.courses.map((course) => ({
          value: String(course.id),
          label: course.title,
        }))
      : [{ value: FILTER_NONE, label: copy.emptyCourses, disabled: true }];

  const groupCourseOptions = [
    { value: FILTER_NONE, label: copy.groupNoCourse },
    ...catalog.courses.map((course) => ({
      value: String(course.id),
      label: course.title,
    })),
  ];

  const deleteTitle =
    deleteTarget?.kind === "course"
      ? copy.deleteCourseTitle
      : deleteTarget?.kind === "tariff"
        ? copy.deleteTariffTitle
        : copy.deleteGroupTitle;

  const deleteDesc =
    deleteTarget?.kind === "course"
      ? copy.deleteCourseDesc.replace("{name}", deleteTarget.item.title)
      : deleteTarget?.kind === "tariff"
        ? copy.deleteTariffDesc.replace("{name}", deleteTarget.item.name)
        : deleteTarget?.kind === "group"
          ? copy.deleteGroupDesc.replace("{name}", deleteTarget.item.name)
          : undefined;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={copy.title} size="wide">
        <div className="flex flex-col gap-5">
          <Segmented
            label={copy.tabsLabel}
            role="tablist"
            fill
            value={tab}
            onChange={(next) => {
              setTab(next);
              setError(null);
            }}
            items={[
              { value: "courses", label: copy.tabs.courses, sub: catalog.courses.length },
              { value: "tariffs", label: copy.tabs.tariffs, sub: catalog.tariffs.length },
              { value: "groups", label: copy.tabs.groups, sub: catalog.groups.length },
            ]}
          />

          {error && (
            <Notice tone="danger" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          )}

          {tab === "courses" && (
            <div className="flex flex-col gap-5">
              <form
                onSubmit={handleCourseSubmit}
                className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq p-4"
              >
                <h3 className="m-0 text-[15px] font-semibold text-siyoh">
                  {editingCourseId !== null ? copy.editCourse : copy.addCourse}
                </h3>
                <Field label={copy.courseTitle}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={courseTitle}
                      onChange={(event) => setCourseTitle(event.target.value)}
                      placeholder={copy.courseTitlePlaceholder}
                      maxLength={160}
                    />
                  )}
                </Field>
                <Field label={copy.courseDescription}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={2}
                      value={courseDesc}
                      onChange={(event) => setCourseDesc(event.target.value)}
                      placeholder={copy.courseDescriptionPlaceholder}
                      maxLength={1000}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Switch
                    checked={courseActive}
                    onChange={setCourseActive}
                    label={copy.isActive}
                    showLabel
                  />
                  <div className="flex items-center gap-2">
                    {editingCourseId !== null && (
                      <Button variant="ghost" onClick={resetCourseForm}>
                        {actions.cancel}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      loading={busy}
                      loadingLabel={actions.saving}
                    >
                      {editingCourseId !== null ? actions.save : actions.create}
                    </Button>
                  </div>
                </div>
              </form>

              <div className="flex flex-col gap-2.5">
                {catalog.courses.length === 0 ? (
                  <p className="m-0 rounded-[12px] bg-varaq px-4 py-6 text-center text-sm text-qalam">
                    {copy.emptyCourses}
                  </p>
                ) : (
                  catalog.courses.map((course) => (
                    <article
                      key={course.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-chiziq bg-white p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-siyoh">
                            {course.title}
                          </span>
                          <Badge tone={course.isActive ? "success" : "neutral"}>
                            {course.isActive ? copy.activeBadge : copy.inactiveBadge}
                          </Badge>
                        </div>
                        {course.description && (
                          <p className="m-0 mt-1 text-xs text-qalam">{course.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={course.isActive}
                          onChange={(next) => void handleToggleCourseActive(course, next)}
                          label={copy.isActive}
                        />
                        <IconButton
                          label={actions.edit}
                          icon={<PencilIcon className="h-4 w-4 text-qalam" />}
                          size="sm"
                          onClick={() => {
                            setEditingCourseId(course.id);
                            setCourseTitle(course.title);
                            setCourseDesc(course.description ?? "");
                            setCourseActive(course.isActive);
                            setError(null);
                          }}
                        />
                        <IconButton
                          label={actions.delete}
                          icon={<TrashIcon className="h-4 w-4 text-anor" />}
                          size="sm"
                          onClick={() => setDeleteTarget({ kind: "course", item: course })}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "tariffs" && (
            <div className="flex flex-col gap-5">
              <form
                onSubmit={handleTariffSubmit}
                className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq p-4"
              >
                <h3 className="m-0 text-[15px] font-semibold text-siyoh">
                  {editingTariffId !== null ? copy.editTariff : copy.addTariff}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={copy.tariffCourse}>
                    {({ id }) => (
                      <Select
                        id={id}
                        value={tariffCourseId}
                        onValueChange={setTariffCourseId}
                        options={courseSelectOptions}
                      />
                    )}
                  </Field>
                  <Field label={copy.tariffName}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        value={tariffName}
                        onChange={(event) => setTariffName(event.target.value)}
                        placeholder={copy.tariffNamePlaceholder}
                        maxLength={160}
                      />
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={copy.tariffPrice}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        inputMode="numeric"
                        value={tariffPrice}
                        onChange={(event) => setTariffPrice(event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={copy.tariffDefaultMonths}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        type="number"
                        min={1}
                        max={36}
                        disabled={!tariffAllowsInstallments}
                        value={tariffAllowsInstallments ? tariffDefaultMonths : "1"}
                        onChange={(event) => setTariffDefaultMonths(event.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <Switch
                      checked={tariffAllowsInstallments}
                      onChange={setTariffAllowsInstallments}
                      label={copy.tariffAllowsInstallments}
                      showLabel
                    />
                    <Switch
                      checked={tariffActive}
                      onChange={setTariffActive}
                      label={copy.isActive}
                      showLabel
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {editingTariffId !== null && (
                      <Button variant="ghost" onClick={resetTariffForm}>
                        {actions.cancel}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={catalog.courses.length === 0}
                      loading={busy}
                      loadingLabel={actions.saving}
                    >
                      {editingTariffId !== null ? actions.save : actions.create}
                    </Button>
                  </div>
                </div>
              </form>

              <div className="flex flex-col gap-2.5">
                {catalog.tariffs.length === 0 ? (
                  <p className="m-0 rounded-[12px] bg-varaq px-4 py-6 text-center text-sm text-qalam">
                    {copy.emptyTariffs}
                  </p>
                ) : (
                  catalog.tariffs.map((tariff) => (
                    <article
                      key={tariff.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-chiziq bg-white p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-siyoh">
                            {tariff.name}
                          </span>
                          <Badge tone="neutral">{tariff.courseTitle}</Badge>
                          <Badge tone={tariff.isActive ? "success" : "neutral"}>
                            {tariff.isActive ? copy.activeBadge : copy.inactiveBadge}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-qalam tabular-nums">
                          <span className="font-semibold text-siyoh">
                            {formatUzs(tariff.priceUzs)}
                          </span>
                          <span>
                            {tariff.allowsInstallments
                              ? `${tariff.defaultInstallmentMonths} oygacha bo‘lib to‘lash`
                              : "Faqat to‘liq to‘lov"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={tariff.isActive}
                          onChange={(next) => void handleToggleTariffActive(tariff, next)}
                          label={copy.isActive}
                        />
                        <IconButton
                          label={actions.edit}
                          icon={<PencilIcon className="h-4 w-4 text-qalam" />}
                          size="sm"
                          onClick={() => {
                            setEditingTariffId(tariff.id);
                            setTariffCourseId(String(tariff.courseId));
                            setTariffName(tariff.name);
                            setTariffPrice(String(tariff.priceUzs));
                            setTariffAllowsInstallments(tariff.allowsInstallments);
                            setTariffDefaultMonths(String(tariff.defaultInstallmentMonths));
                            setTariffActive(tariff.isActive);
                            setError(null);
                          }}
                        />
                        <IconButton
                          label={actions.delete}
                          icon={<TrashIcon className="h-4 w-4 text-anor" />}
                          size="sm"
                          onClick={() => setDeleteTarget({ kind: "tariff", item: tariff })}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "groups" && (
            <div className="flex flex-col gap-5">
              <form
                onSubmit={handleGroupSubmit}
                className="flex flex-col gap-3 rounded-[14px] border border-chiziq bg-varaq p-4"
              >
                <h3 className="m-0 text-[15px] font-semibold text-siyoh">
                  {editingGroupId !== null ? copy.editGroup : copy.addGroup}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={copy.groupName}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder={copy.groupNamePlaceholder}
                        maxLength={160}
                      />
                    )}
                  </Field>
                  <Field label={copy.groupCourse}>
                    {({ id }) => (
                      <Select
                        id={id}
                        value={groupCourseId}
                        onValueChange={setGroupCourseId}
                        options={groupCourseOptions}
                      />
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={copy.groupStartsAt}>
                    {({ id }) => (
                      <DatePicker
                        id={id}
                        value={groupStartsAt}
                        onChange={setGroupStartsAt}
                      />
                    )}
                  </Field>
                  <Field label={copy.groupCapacity}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        type="number"
                        min={1}
                        value={groupCapacity}
                        onChange={(event) => setGroupCapacity(event.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Switch
                    checked={groupActive}
                    onChange={setGroupActive}
                    label={copy.isActive}
                    showLabel
                  />
                  <div className="flex items-center gap-2">
                    {editingGroupId !== null && (
                      <Button variant="ghost" onClick={resetGroupForm}>
                        {actions.cancel}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      loading={busy}
                      loadingLabel={actions.saving}
                    >
                      {editingGroupId !== null ? actions.save : actions.create}
                    </Button>
                  </div>
                </div>
              </form>

              <div className="flex flex-col gap-2.5">
                {catalog.groups.length === 0 ? (
                  <p className="m-0 rounded-[12px] bg-varaq px-4 py-6 text-center text-sm text-qalam">
                    {copy.emptyGroups}
                  </p>
                ) : (
                  catalog.groups.map((group) => (
                    <article
                      key={group.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-chiziq bg-white p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-siyoh">
                            {group.name}
                          </span>
                          {group.courseTitle && (
                            <Badge tone="neutral">{group.courseTitle}</Badge>
                          )}
                          <Badge tone={group.isActive ? "success" : "neutral"}>
                            {group.isActive ? copy.activeBadge : copy.inactiveBadge}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-qalam tabular-nums">
                          {group.startsAt && (
                            <span>Boshlanishi: {formatDate(group.startsAt)}</span>
                          )}
                          {group.capacity !== null && (
                            <span>Sig‘im: {group.capacity} kishi</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={group.isActive}
                          onChange={(next) => void handleToggleGroupActive(group, next)}
                          label={copy.isActive}
                        />
                        <IconButton
                          label={actions.edit}
                          icon={<PencilIcon className="h-4 w-4 text-qalam" />}
                          size="sm"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setGroupName(group.name);
                            setGroupCourseId(
                              group.courseId ? String(group.courseId) : FILTER_NONE,
                            );
                            setGroupStartsAt(group.startsAt ?? "");
                            setGroupCapacity(
                              group.capacity !== null ? String(group.capacity) : "",
                            );
                            setGroupActive(group.isActive);
                            setError(null);
                          }}
                        />
                        <IconButton
                          label={actions.delete}
                          icon={<TrashIcon className="h-4 w-4 text-anor" />}
                          size="sm"
                          onClick={() => setDeleteTarget({ kind: "group", item: group })}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTitle}
        description={deleteDesc}
        confirmLabel={actions.delete}
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
