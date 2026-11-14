"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentUserLookupItem } from "@funnel/shared";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { formatStudentDisplayName, searchPaymentUsers } from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.enrollment;

type UserSearchPickerProps = {
  selectedUser: PaymentUserLookupItem | null;
  onSelect: (user: PaymentUserLookupItem | null) => void;
  label?: string;
};

export function UserSearchPicker({
  selectedUser,
  onSelect,
  label = copy.userSearchLabel,
}: UserSearchPickerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaymentUserLookupItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedUser) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      searchPaymentUsers(query, controller.signal)
        .then((items) => {
          setResults(items);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof Error && err.message === "UNAUTHORIZED") {
            router.replace("/admin/login");
            return;
          }
          setResults([]);
          setLoading(false);
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedUser, router]);

  if (selectedUser) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[12px] border border-chiziq bg-varaq p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-siyoh">
            {formatStudentDisplayName(selectedUser)}
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-qalam tabular-nums">
            {selectedUser.phone && <span>{selectedUser.phone}</span>}
            {selectedUser.username && <span>@{selectedUser.username}</span>}
            <span>ID {selectedUser.telegramId}</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onSelect(null)}>
          {copy.changeUser}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.userSearchPlaceholder}
          />
        )}
      </Field>

      <div className="max-h-52 overflow-y-auto rounded-[12px] border border-chiziq bg-white">
        {loading ? (
          <p className="m-0 px-3 py-3 text-xs text-qalam">{copy.userSearching}</p>
        ) : results.length === 0 ? (
          <p className="m-0 px-3 py-3 text-xs text-qalam">{copy.userNoResults}</p>
        ) : (
          <div className="divide-y divide-chiziq">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-varaq focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-siyoh"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-siyoh">
                    {formatStudentDisplayName(item)}
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-xs text-qalam tabular-nums">
                    {item.phone && <span>{item.phone}</span>}
                    {item.username && <span>@{item.username}</span>}
                    <span>ID {item.telegramId}</span>
                  </div>
                </div>
                {item.activeEnrollmentCount > 0 && (
                  <span className="shrink-0 rounded-full bg-varaq px-2 py-0.5 text-xs font-medium text-qalam tabular-nums">
                    {item.activeEnrollmentCount} ta faol
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
