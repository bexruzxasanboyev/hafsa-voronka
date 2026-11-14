import { Hono } from "hono";
import { campaignLinkCreateSchema } from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { createCampaignLink, deleteCampaignLink, listCampaignLinks } from "@/links/campaignLinks";

export const adminLinkRoutes = new Hono();

adminLinkRoutes.use("*", requireAdminAuth);

adminLinkRoutes.get("/", async (c) => {
  return c.json({ items: await listCampaignLinks() });
});

adminLinkRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = campaignLinkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const res = await createCampaignLink(parsed.data);
  if (!res.ok) {
    return c.json({ error: res.error }, 409);
  }

  return c.json({ item: res.item }, 201);
});

adminLinkRoutes.delete("/:code", async (c) => {
  const code = c.req.param("code");
  if (!/^[A-Za-z0-9_-]{1,62}$/.test(code)) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const deleted = await deleteCampaignLink(code);
  if (!deleted) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({ ok: true });
});
