import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { messageTemplates } from "@/db/schema";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";

const isolated = isolatedDatabase("vf_seed");

describe.skipIf(!isolated.url)("Template seed", () => {
  let seedStartingTemplates: typeof import("./seed").seedStartingTemplates;
  let seedInputs: typeof import("./seed").seedInputs;

  beforeAll(async () => {
    await isolated.create();
    setTestEnv({ DATABASE_URL: isolated.url! });
    await runMigrations(isolated.url!);
    ({ seedStartingTemplates, seedInputs } = await import("./seed"));
  });

  afterAll(async () => {
    await closeDb();
    await isolated.drop();
  });

  it("inserts once and skips on the second run", async () => {
    const first = await seedStartingTemplates();
    expect(first).toEqual({ A: seedInputs("A").length, B: seedInputs("B").length, C: seedInputs("C").length, E: 0 });
    const second = await seedStartingTemplates();
    expect(second).toEqual({ A: 0, B: 0, C: 0, E: 0 });
    const rows = await db().select().from(messageTemplates);
    expect(rows).toHaveLength(first.A + first.B + first.C + first.E);
  });

  it("stores segment B statuses and sequential positions per day", async () => {
    const rows = await db()
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.segment, "B"))
      .orderBy(asc(messageTemplates.day), asc(messageTemplates.position));
    expect(rows.filter((row) => row.statuses !== null)).toHaveLength(3);
    const dayOne = rows.filter((row) => row.day === 1).map((row) => row.position);
    expect(dayOne).toEqual(dayOne.map((_, index) => index));
  });

  it("seeds explicit timing modes and 1440m auto-delete", async () => {
    const rows = await db().select().from(messageTemplates);
    expect(rows.every((row) => row.autoDeleteMinutes === 1440 && !row.isPermanent)).toBe(true);
    expect(rows.filter((row) => row.segment === "A").every((row) => row.timingMode === "relative")).toBe(true);
    expect(rows.find((row) => row.segment === "B" && row.kind === "trigger")?.timingMode).toBe("clock");
    expect(rows.filter((row) => row.segment === "C" && row.day === 1).every((row) => row.timingMode === "relative")).toBe(
      true,
    );
    expect(rows.filter((row) => row.segment === "C" && row.day >= 2).every((row) => row.timingMode === "clock")).toBe(
      true,
    );
  });
});
