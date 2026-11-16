import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { isolatedDatabase } from "@/test/isolatedDb";

const BEFORE_TAG = "0029_payments_and_debts";
const MIGRATION_TAG = "0030_segment_loop_eligibility";
const HOUR = 3_600_000;

type Journal = { entries: { tag: string }[] };

async function migrateThrough(url: string, tag: string) {
  const folder = mkdtempSync(join(tmpdir(), "vf-0030-drizzle-"));
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    cpSync(resolve("drizzle"), folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const cut = journal.entries.findIndex((entry) => entry.tag === tag);
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));
    await migrate(drizzle({ client }), { migrationsFolder: folder });
  } finally {
    await client.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

const database = isolatedDatabase("vf_migration_0030");

describe.skipIf(!database.url)("0030 segment loop eligibility migration", () => {
  let sql: postgres.Sql;
  const ids: Record<string, number> = {};
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * HOUR);

  beforeAll(async () => {
    await database.create();
    await migrateThrough(database.url!, BEFORE_TAG);
    sql = postgres(database.url!, { max: 1, onnotice: () => {} });

    const [user] = await sql`insert into users (telegram_id, registered_at) values (777, ${ago(100)}) returning id`;
    const userId = Number(user.id);
    const [grant] = await sql`
      insert into link_grants (user_id, attempt, day, kind, given_at, expires_at)
      values (${userId}, 1, 1, 'initial', ${ago(30)}, ${ago(6)}) returning id`;
    const [endedRun] = await sql`
      insert into segment_runs (user_id, segment, entered_at, ended_at, end_reason)
      values (${userId}, 'C', ${ago(100)}, ${ago(40)}, 'advanced') returning id`;
    const [run] = await sql`
      insert into segment_runs (user_id, segment, entered_at) values (${userId}, 'A', ${ago(40)}) returning id`;
    ids.endedRun = Number(endedRun.id);
    ids.run = Number(run.id);
    const [plain] = await sql`
      insert into message_templates (segment, day, position, text, timing_value, auto_delete_minutes)
      values ('A', 1, 0, 'x', 60, 1440) returning id`;
    const [permanent] = await sql`
      insert into message_templates (segment, day, position, text, timing_value, is_permanent)
      values ('A', 1, 1, 'y', 60, true) returning id`;
    await sql`insert into bot_texts (key, keep_forever) values ('remindNow', true)`;

    const sent = async (
      key: string,
      values: { sentAt: Date; templateId?: number; botTextKey?: string; deleteAt?: Date; deleteError?: string },
    ) => {
      const [row] = await sql`
        insert into sent_messages (user_id, template_id, bot_text_key, link_id, segment_run_id, slot, due_at, sent_at,
          telegram_message_id, delete_at, delete_error)
        values (${userId}, ${values.templateId ?? null}, ${values.botTextKey ?? null}, ${Number(grant.id)}, ${ids.run},
          ${key}, ${values.sentAt}, ${values.sentAt}, ${100 + Object.keys(ids).length}, ${values.deleteAt ?? null},
          ${values.deleteError ?? null})
        returning id`;
      ids[key] = Number(row.id);
    };
    await sent("beforeExpiry", { sentAt: ago(10), templateId: Number(plain.id) });
    await sent("afterExpiry", { sentAt: ago(2), templateId: Number(plain.id) });
    await sent("botText", { sentAt: ago(3), botTextKey: "reopenNow" });
    await sent("permanent", { sentAt: ago(3), templateId: Number(permanent.id) });
    await sent("keepForever", { sentAt: ago(3), botTextKey: "remindNow" });
    await sent("tooOld", { sentAt: ago(49), templateId: Number(plain.id) });
    await sent("failed", { sentAt: ago(3), templateId: Number(plain.id), deleteError: "boom" });
    await sent("scheduled", { sentAt: ago(1), templateId: Number(plain.id), deleteAt: ago(-5) });

    await migrateThrough(database.url!, MIGRATION_TAG);
  });

  afterAll(async () => {
    await sql?.end();
    await database.drop();
  });

  it("marks existing runs ineligible and new runs eligible", async () => {
    const runs = await sql`select id, loop_eligible from segment_runs order by id`;
    expect(runs.map((row) => row.loop_eligible)).toEqual([false, false]);
    const [userRow] = await sql`select id from users limit 1`;
    await sql`update segment_runs set ended_at = now(), end_reason = 'advanced' where id = ${ids.run}`;
    const [fresh] = await sql`
      insert into segment_runs (user_id, segment) values (${userRow.id}, 'B') returning loop_eligible`;
    expect(fresh.loop_eligible).toBe(true);
  });

  it("schedules deletion of recent non-permanent messages like the old sweep did", async () => {
    const rows = await sql`select id, delete_at from sent_messages`;
    const deleteAt = (key: string) => {
      const value = rows.find((row) => Number(row.id) === ids[key])!.delete_at as Date | null;
      return value === null ? null : value.getTime();
    };
    expect(deleteAt("beforeExpiry")).toBe(ago(6).getTime());
    expect(deleteAt("afterExpiry")).toBe(ago(2).getTime() + 47 * HOUR);
    expect(deleteAt("botText")).toBe(ago(3).getTime() + 47 * HOUR);
    expect(deleteAt("permanent")).toBeNull();
    expect(deleteAt("keepForever")).toBeNull();
    expect(deleteAt("tooOld")).toBeNull();
    expect(deleteAt("failed")).toBeNull();
    expect(deleteAt("scheduled")).toBe(ago(-5).getTime());
  });
});
