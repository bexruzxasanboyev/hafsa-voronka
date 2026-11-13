"use client";

import { useEffect, useState } from "react";
import type { CampaignLinkItem } from "@funnel/shared";
import { Button } from "@/components/admin/ui/Button";
import { Dialog } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { createCampaignLink, deleteCampaignLink, fetchCampaignLinks } from "@/lib/admin/api";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "hafsaustozabot";

export function TelegramAdsLinkDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState("tg");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [links, setLinks] = useState<CampaignLinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchCampaignLinks()
      .then(setLinks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://hafsaustoza.vercel.app";
  const landingParams = new URLSearchParams();
  if (source.trim()) landingParams.set("utm_source", source.trim());
  if (campaign.trim()) landingParams.set("utm_campaign", campaign.trim());
  if (content.trim()) landingParams.set("utm_content", content.trim());
  const landingUrl = `${origin}/?${landingParams.toString()}`;

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
  };

  const handleSaveDirectLink = async () => {
    if (!source.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const item = await createCampaignLink({
        utm_source: source.trim(),
        utm_campaign: campaign.trim() || undefined,
        utm_content: content.trim() || undefined,
      });
      setLinks((prev) => [item, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code: string) => {
    await deleteCampaignLink(code);
    setLinks((prev) => prev.filter((item) => item.code !== code));
  };

  return (
    <Dialog open={open} onClose={onClose} title="Telegram Ads va UTM havolalar">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Manba (utm_source)">
            {({ id }) => (
              <Input
                id={id}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="tg"
              />
            )}
          </Field>
          <Field label="Kampaniya (utm_campaign)">
            {({ id }) => (
              <Input
                id={id}
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="kanal_1"
              />
            )}
          </Field>
          <Field label="Content (utm_content)">
            {({ id }) => (
              <Input
                id={id}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="post_1"
              />
            )}
          </Field>
        </div>

        <div className="rounded-xl border border-chiziq bg-qumloq/40 p-3 space-y-2">
          <div className="text-xs font-medium text-qalam">Sayt orqali kirish havolasi (Landing + Pixel/Voronka)</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-2.5 py-1.5 text-xs text-siyoh border border-chiziq">
              {landingUrl}
            </code>
            <Button size="sm" variant="secondary" onClick={() => copy("landing", landingUrl)}>
              {copiedKey === "landing" ? "Nusxalandi" : "Nusxalash"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-qalam">
            Yoki to‘g‘ridan-to‘g‘ri botga olib kiruvchi qisqa havola yarating (`t.me/{BOT_USERNAME}?start=c_...`):
          </p>
          <Button size="sm" onClick={handleSaveDirectLink} disabled={saving || !source.trim()}>
            {saving ? "Yaratilmoqda..." : "Bot havola yaratish"}
          </Button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="max-h-56 overflow-y-auto divide-y divide-chiziq rounded-xl border border-chiziq">
          {loading ? (
            <div className="p-3 text-xs text-qalam">Yuklanmoqda...</div>
          ) : links.length === 0 ? (
            <div className="p-3 text-xs text-qalam">Hozircha saqlangan bot havolalar yo‘q.</div>
          ) : (
            links.map((item) => {
              const botUrl = `https://t.me/${BOT_USERNAME}?start=c_${item.code}`;
              return (
                <div key={item.code} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-siyoh truncate">
                      {[item.utmSource, item.utmCampaign, item.utmContent].filter(Boolean).join(" / ")}
                    </div>
                    <div className="text-qalam truncate">{botUrl}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => copy(item.code, botUrl)}>
                      {copiedKey === item.code ? "Nusxalandi" : "Nusxa"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(item.code)}>
                      O‘chirish
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
