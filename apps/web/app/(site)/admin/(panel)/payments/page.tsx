"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DebtStatus,
  EnrollmentItem,
  PaymentsDashboardResponse,
  SourceNetwork,
} from "@funnel/shared";
import { Badge, type BadgeTone } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { Dialog } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { Page, PageHeader } from "@/components/admin/ui/Page";
import { Section } from "@/components/admin/ui/Section";
import { Segmented } from "@/components/admin/ui/Segmented";
import { ErrorState, LoadingState } from "@/components/admin/ui/States";
import {
  addEnrollmentPayment,
  createEnrollment,
  createPaymentCatalogItem,
  deleteEnrollment,
  fetchPaymentsDashboard,
  lookupPaymentUsers,
  type LookupUserItem,
} from "@/lib/admin/api";

const NETWORK_LABELS: Record<SourceNetwork, string> = {
  ig: "Instagram (ig)",
  fb: "Facebook (fb)",
  tg: "Telegram Ads (tg)",
  organic: "Organik / Tavsiya",
};

const STATUS_LABELS: Record<DebtStatus, { label: string; tone: BadgeTone }> = {
  paid: { label: "To‘liq to‘langan", tone: "success" },
  installment: { label: "Bo‘lib to‘lash", tone: "attention" },
  overdue: { label: "Muddati o‘tgan qarzdor", tone: "danger" },
};

function formatUzs(value: number): string {
  return `${new Intl.NumberFormat("uz-UZ").format(value)} so‘m`;
}

export default function PaymentsPage() {
  const router = useRouter();
  const [data, setData] = useState<PaymentsDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"master" | "groups">("master");
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<"" | SourceNetwork>("");
  const [statusFilter, setStatusFilter] = useState<"" | DebtStatus>("");

  const [addOpen, setAddOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<EnrollmentItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPaymentsDashboard();
      setData(res);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setError("Ma’lumotlarni yuklab bo‘lmadi");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEnrollments = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.enrollments.filter((item) => {
      if (networkFilter && item.sourceNetwork !== networkFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        item.studentName.toLowerCase().includes(q) ||
        (item.phone ?? "").toLowerCase().includes(q) ||
        (item.username ?? "").toLowerCase().includes(q) ||
        (item.groupName ?? "").toLowerCase().includes(q) ||
        item.courseName.toLowerCase().includes(q)
      );
    });
  }, [data, search, networkFilter, statusFilter]);

  return (
    <Page>
      <PageHeader
        title="To‘lovlar va Qarzdorlik"
        description="O‘quvchilar to‘lovi, guruhlar bo‘yicha qarzdorlik va tarmoqlar kesimidagi sotuv atributsiyasi."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCatalogOpen(true)}>
              Kurs / Tarif / Guruh
            </Button>
            <Button onClick={() => setAddOpen(true)}>+ O‘quvchi / To‘lov qo‘shish</Button>
          </div>
        }
      />

      {error && <ErrorState onRetry={load} />}
      {loading && !data && <LoadingState variant="list" rows={4} />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-chiziq bg-white p-4">
              <div className="text-xs font-medium text-qalam">Jami to‘lov qilganlar</div>
              <div className="mt-1 text-2xl font-bold text-siyoh">{data.summary.totalPaidStudents} ta</div>
            </div>
            <div className="rounded-2xl border border-chiziq bg-white p-4">
              <div className="text-xs font-medium text-qalam">Jami tushgan pul</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">{formatUzs(data.summary.totalPaidAmount)}</div>
            </div>
            <div className="rounded-2xl border border-chiziq bg-white p-4">
              <div className="text-xs font-medium text-qalam">Joriy oyda kutilayotgan qarzlar</div>
              <div className="mt-1 text-2xl font-bold text-amber-700">{formatUzs(data.summary.totalCurrentMonthDebt)}</div>
            </div>
            <div className="rounded-2xl border border-chiziq bg-white p-4">
              <div className="text-xs font-medium text-qalam">Umumiy qolgan jami qarz</div>
              <div className="mt-1 text-2xl font-bold text-rose-700">{formatUzs(data.summary.totalRemainingDebt)}</div>
            </div>
          </div>

          <Section title="Tarmoqlar kesimida sotuvlar (End-to-End Atributsiya)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.networkAttribution.map((net) => (
                <div key={net.network} className="rounded-xl border border-chiziq bg-qumloq/30 p-3.5">
                  <div className="text-xs font-semibold text-siyoh">{NETWORK_LABELS[net.network]}</div>
                  <div className="mt-1 text-lg font-bold text-siyoh">{net.studentCount} ta xarid</div>
                  <div className="mt-0.5 text-xs text-qalam">Tushgan: {formatUzs(net.totalPaid)}</div>
                  <div className="text-xs text-qalam">Shartnoma: {formatUzs(net.totalContract)}</div>
                </div>
              ))}
            </div>
          </Section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Ko‘rinish rejimi"
              value={tab}
              onChange={(v) => setTab(v as "master" | "groups")}
              items={[
                { value: "master", label: `Umumiy yig‘ma jadval (${data.enrollments.length})` },
                { value: "groups", label: `Guruhlar kesimida (${data.groups.length})` },
              ]}
            />
          </div>

          {tab === "master" ? (
            <Section title="O‘quvchilar va to‘lovlar jadvali">
              <div className="mb-4 flex flex-wrap gap-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ism, telefon, @username, guruh..."
                  className="max-w-xs"
                />
                <select
                  value={networkFilter}
                  onChange={(e) => setNetworkFilter(e.target.value as "" | SourceNetwork)}
                  className="rounded-xl border border-chiziq bg-white px-3 py-2 text-sm text-siyoh"
                >
                  <option value="">Barcha tarmoqlar</option>
                  <option value="ig">Instagram (ig)</option>
                  <option value="fb">Facebook (fb)</option>
                  <option value="tg">Telegram Ads (tg)</option>
                  <option value="organic">Organik / Tavsiya</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "" | DebtStatus)}
                  className="rounded-xl border border-chiziq bg-white px-3 py-2 text-sm text-siyoh"
                >
                  <option value="">Barcha statuslar</option>
                  <option value="paid">To‘liq to‘langan</option>
                  <option value="installment">Bo‘lib to‘lash</option>
                  <option value="overdue">Muddati o‘tgan qarzdor</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-chiziq text-xs font-medium text-qalam">
                      <th className="py-2.5 pr-3">O‘quvchi</th>
                      <th className="py-2.5 pr-3">Manba</th>
                      <th className="py-2.5 pr-3">Kurs / Tarif / Guruh</th>
                      <th className="py-2.5 pr-3">Shartnoma</th>
                      <th className="py-2.5 pr-3">To‘langan</th>
                      <th className="py-2.5 pr-3">Joriy oy qarzi</th>
                      <th className="py-2.5 pr-3">Jami qoldiq qarz</th>
                      <th className="py-2.5 pr-3">Status</th>
                      <th className="py-2.5 text-right">Amal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chiziq">
                    {filteredEnrollments.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-sm text-qalam">
                          Hozircha yozuvlar topilmadi.
                        </td>
                      </tr>
                    ) : (
                      filteredEnrollments.map((item) => {
                        const st = STATUS_LABELS[item.status];
                        return (
                          <tr key={item.id} className="hover:bg-qumloq/20">
                            <td className="py-3 pr-3">
                              <div className="font-medium text-siyoh">{item.studentName}</div>
                              <div className="text-xs text-qalam">
                                {[item.phone, item.username ? `@${item.username.replace(/^@/, "")}` : null, item.telegramId ? `ID: ${item.telegramId}` : null]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-xs font-medium text-siyoh">
                              {NETWORK_LABELS[item.sourceNetwork]}
                            </td>
                            <td className="py-3 pr-3">
                              <div className="font-medium text-siyoh">{item.courseName}</div>
                              <div className="text-xs text-qalam">
                                {item.tariffName} • {item.groupName || "Guruhsiz"}
                              </div>
                            </td>
                            <td className="py-3 pr-3 font-medium text-siyoh">{formatUzs(item.totalPrice)}</td>
                            <td className="py-3 pr-3">
                              <div className="font-medium text-emerald-700">{formatUzs(item.paidAmount)}</div>
                              {item.firstPaidAt && (
                                <div className="text-xs text-qalam">{item.firstPaidAt.slice(0, 10)}</div>
                              )}
                            </td>
                            <td className="py-3 pr-3">
                              <div className="font-medium text-amber-700">
                                {formatUzs(Math.min(item.currentMonthDue, item.remainingBalance))}
                              </div>
                              {item.dueDate && <div className="text-xs text-qalam">Muddat: {item.dueDate}</div>}
                            </td>
                            <td className="py-3 pr-3 font-medium text-rose-700">
                              {formatUzs(item.remainingBalance)}
                            </td>
                            <td className="py-3 pr-3">
                              <Badge tone={st.tone}>{st.label}</Badge>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex justify-end gap-1.5">
                                {item.remainingBalance > 0 && (
                                  <Button size="sm" variant="secondary" onClick={() => setPayTarget(item)}>
                                    + To‘lov
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    if (!confirm("Bu yozuvni o‘chirasizmi?")) return;
                                    await deleteEnrollment(item.id);
                                    void load();
                                  }}
                                >
                                  O‘chirish
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : (
            <Section title="Guruhlar kesimida qarzdorlik jadvali">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-chiziq text-xs font-medium text-qalam">
                      <th className="py-2.5 pr-3">Guruh nomi</th>
                      <th className="py-2.5 pr-3">O‘quvchilar</th>
                      <th className="py-2.5 pr-3">Jami shartnoma</th>
                      <th className="py-2.5 pr-3">To‘langan summa</th>
                      <th className="py-2.5 pr-3">Joriy oydagi qarz</th>
                      <th className="py-2.5 pr-3">Umumiy qolgan qarz</th>
                      <th className="py-2.5 text-right">To‘lov intizomi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chiziq">
                    {data.groups.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-sm text-qalam">
                          Guruhlar bo‘yicha ma’lumot yo‘q.
                        </td>
                      </tr>
                    ) : (
                      data.groups.map((g) => (
                        <tr key={g.groupName} className="hover:bg-qumloq/20">
                          <td className="py-3 pr-3 font-semibold text-siyoh">{g.groupName}</td>
                          <td className="py-3 pr-3">{g.studentCount} ta</td>
                          <td className="py-3 pr-3">{formatUzs(g.totalContract)}</td>
                          <td className="py-3 pr-3 text-emerald-700 font-medium">{formatUzs(g.totalPaid)}</td>
                          <td className="py-3 pr-3 text-amber-700 font-medium">{formatUzs(g.currentMonthDebt)}</td>
                          <td className="py-3 pr-3 text-rose-700 font-medium">{formatUzs(g.totalRemainingDebt)}</td>
                          <td className="py-3 text-right font-semibold text-siyoh">{g.disciplinePercent}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}

      {data && (
        <AddEnrollmentDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          data={data}
          onSaved={() => {
            setAddOpen(false);
            void load();
          }}
        />
      )}

      {payTarget && (
        <AddPaymentDialog
          target={payTarget}
          onClose={() => setPayTarget(null)}
          onSaved={() => {
            setPayTarget(null);
            void load();
          }}
        />
      )}

      {data && (
        <CatalogDialog
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          data={data}
          onSaved={() => void load()}
        />
      )}
    </Page>
  );
}

function AddEnrollmentDialog({
  open,
  onClose,
  data,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  data: PaymentsDashboardResponse;
  onSaved: () => void;
}) {
  const [lookupQ, setLookupQ] = useState("");
  const [matches, setMatches] = useState<LookupUserItem[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [studentName, setStudentName] = useState("");
  const [phone, setPhone] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [username, setUsername] = useState("");
  const [sourceNetwork, setSourceNetwork] = useState<SourceNetwork>("organic");
  const [courseName, setCourseName] = useState(data.courses[0]?.name || "Noldan Qoriyalikgacha");
  const [tariffName, setTariffName] = useState(data.tariffs[0]?.name || "Natijagacha");
  const [groupName, setGroupName] = useState(data.studyGroups[0]?.name || "");
  const [totalPrice, setTotalPrice] = useState(String(data.tariffs[0]?.price ?? 1191000));
  const [initialPaidAmount, setInitialPaidAmount] = useState("");
  const [currentMonthDue, setCurrentMonthDue] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lookupQ.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void lookupPaymentUsers(lookupQ).then(setMatches);
    }, 250);
    return () => clearTimeout(timer);
  }, [lookupQ]);

  const handleSubmit = async () => {
    if (!studentName.trim() || !courseName.trim() || !tariffName.trim()) return;
    setSaving(true);
    try {
      await createEnrollment({
        userId,
        studentName: studentName.trim(),
        phone: phone.trim() || null,
        telegramId: telegramId.trim() ? Number(telegramId) : null,
        username: username.trim() || null,
        sourceNetwork,
        courseName: courseName.trim(),
        tariffName: tariffName.trim(),
        groupName: groupName.trim() || null,
        totalPrice: Number(totalPrice) || 0,
        initialPaidAmount: Number(initialPaidAmount) || 0,
        currentMonthDue: Number(currentMonthDue) || 0,
        dueDate: dueDate || null,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Yangi o‘quvchi va to‘lov qo‘shish">
      <div className="space-y-3">
        <Field label="Bot bazasidan qidirish (ism, telefon, @username, Telegram ID)">
          {({ id }) => (
            <Input
              id={id}
              value={lookupQ}
              onChange={(e) => setLookupQ(e.target.value)}
              placeholder="Qidirish..."
            />
          )}
        </Field>
        {matches.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded-xl border border-chiziq divide-y divide-chiziq">
            {matches.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => {
                  setUserId(m.userId);
                  setStudentName(m.studentName);
                  setPhone(m.phone ?? "");
                  setTelegramId(String(m.telegramId));
                  setUsername(m.username ?? "");
                  setSourceNetwork(m.sourceNetwork);
                  setLookupQ("");
                  setMatches([]);
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-qumloq/40 cursor-pointer"
              >
                <span className="font-semibold text-siyoh">{m.studentName}</span>{" "}
                <span className="text-qalam">
                  ({m.phone || "tel yo‘q"}, {NETWORK_LABELS[m.sourceNetwork]})
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="O‘quvchi F.I.Sh.">
            {({ id }) => <Input id={id} value={studentName} onChange={(e) => setStudentName(e.target.value)} />}
          </Field>
          <Field label="Telefon raqami">
            {({ id }) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." />}
          </Field>
          <Field label="Telegram ID">
            {({ id }) => <Input id={id} value={telegramId} onChange={(e) => setTelegramId(e.target.value)} />}
          </Field>
          <Field label="Kelgan manbasi (Tarmoq)">
            {({ id }) => (
              <select
                id={id}
                value={sourceNetwork}
                onChange={(e) => setSourceNetwork(e.target.value as SourceNetwork)}
                className="w-full rounded-xl border border-chiziq bg-white px-3 py-2 text-sm text-siyoh"
              >
                <option value="ig">Instagram (ig)</option>
                <option value="fb">Facebook (fb)</option>
                <option value="tg">Telegram Ads (tg)</option>
                <option value="organic">Organik / Tavsiya</option>
              </select>
            )}
          </Field>
          <Field label="Kurs nomi">
            {({ id }) => (
              <Input
                id={id}
                list="courses-list"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Tarif nomi">
            {({ id }) => (
              <Input
                id={id}
                list="tariffs-list"
                value={tariffName}
                onChange={(e) => {
                  setTariffName(e.target.value);
                  const found = data.tariffs.find((t) => t.name === e.target.value);
                  if (found) setTotalPrice(String(found.price));
                }}
              />
            )}
          </Field>
          <Field label="O‘quv guruhi">
            {({ id }) => (
              <Input
                id={id}
                list="groups-list"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="100-guruh"
              />
            )}
          </Field>
          <Field label="Kurs umumiy narxi (UZS)">
            {({ id }) => <Input id={id} type="number" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} />}
          </Field>
          <Field label="1-to‘lov summasi (UZS)">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                value={initialPaidAmount}
                onChange={(e) => setInitialPaidAmount(e.target.value)}
                placeholder="397000"
              />
            )}
          </Field>
          <Field label="Joriy oydagi qarz (UZS)">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                value={currentMonthDue}
                onChange={(e) => setCurrentMonthDue(e.target.value)}
              />
            )}
          </Field>
          <Field label="To‘lov muddati (Due Date)">
            {({ id }) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>

        <datalist id="courses-list">
          {data.courses.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <datalist id="tariffs-list">
          {data.tariffs.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        <datalist id="groups-list">
          {data.studyGroups.map((g) => (
            <option key={g.id} value={g.name} />
          ))}
        </datalist>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !studentName.trim()}>
            {saving ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddPaymentDialog({
  target,
  onClose,
  onSaved,
}: {
  target: EnrollmentItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(
    String(target.currentMonthDue > 0 ? target.currentMonthDue : target.remainingBalance),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) return;
    setSaving(true);
    try {
      await addEnrollmentPayment(target.id, { amount: val, note: note.trim() || null });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`To‘lov qo‘shish — ${target.studentName}`}>
      <div className="space-y-3">
        <p className="text-xs text-qalam">Qolgan jami qarz: {formatUzs(target.remainingBalance)}</p>
        <Field label="To‘lov summasi (UZS)">
          {({ id }) => <Input id={id} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Izoh (ixtiyoriy)">
          {({ id }) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="2-oy to‘lovi" />}
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saqlanmoqda..." : "Tasdiqlash"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CatalogDialog({
  open,
  onClose,
  data,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  data: PaymentsDashboardResponse;
  onSaved: () => void;
}) {
  const [courseName, setCourseName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [tariffCourseId, setTariffCourseId] = useState(String(data.courses[0]?.id ?? ""));
  const [tariffName, setTariffName] = useState("");
  const [tariffPrice, setTariffPrice] = useState("");

  return (
    <Dialog open={open} onClose={onClose} title="Kurslar, Tariflar va O‘quv guruhlari">
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-siyoh">Yangi kurs qo‘shish</div>
          <div className="flex gap-2">
            <Input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="Masalan: Noldan Qoriyalikgacha"
            />
            <Button
              size="sm"
              onClick={async () => {
                if (!courseName.trim()) return;
                await createPaymentCatalogItem({ kind: "course", name: courseName.trim() });
                setCourseName("");
                onSaved();
              }}
            >
              Qo‘shish
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-siyoh">Yangi tarif qo‘shish</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={tariffCourseId}
              onChange={(e) => setTariffCourseId(e.target.value)}
              className="rounded-xl border border-chiziq bg-white px-3 py-2 text-sm text-siyoh"
            >
              <option value="">Kurs tanlang</option>
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Input
              value={tariffName}
              onChange={(e) => setTariffName(e.target.value)}
              placeholder="Tarif nomi (Natijagacha)"
            />
            <div className="flex gap-2">
              <Input
                type="number"
                value={tariffPrice}
                onChange={(e) => setTariffPrice(e.target.value)}
                placeholder="Narxi (UZS)"
              />
              <Button
                size="sm"
                onClick={async () => {
                  if (!tariffCourseId || !tariffName.trim()) return;
                  await createPaymentCatalogItem({
                    kind: "tariff",
                    courseId: Number(tariffCourseId),
                    name: tariffName.trim(),
                    price: Number(tariffPrice) || 0,
                  });
                  setTariffName("");
                  setTariffPrice("");
                  onSaved();
                }}
              >
                Qo‘shish
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-siyoh">Yangi o‘quv guruhi qo‘shish</div>
          <div className="flex gap-2">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Masalan: 100-guruh"
            />
            <Button
              size="sm"
              onClick={async () => {
                if (!groupName.trim()) return;
                await createPaymentCatalogItem({ kind: "group", name: groupName.trim() });
                setGroupName("");
                onSaved();
              }}
            >
              Qo‘shish
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
