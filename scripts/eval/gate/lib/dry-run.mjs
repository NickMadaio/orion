// --dry-run: what every item's setup WOULD do, read-only. No marker, no file written, no gateway call, no spawn.
import { basename } from "node:path";
import { planSetup, renderTokens } from "./setup.mjs";
import { trackedFiles } from "./state.mjs";

/** "now:2026-…" -> "now"; "calendar (sandbox: …)" -> "calendar"; "sleep_last_night_h -> health-log.json" -> "sleep_last_night_h". */
export const keyOf = (entry) => entry.split(/[:\s(]/)[0];

const tally = (rows, field) => rows.flatMap((r) => r[field].map(keyOf)).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

export async function dryRun({ items, p, realNow = Date.now(), hostZone, log = () => {} }) {
  const writable = new Map(trackedFiles(p).map((f) => [basename(f), f]));
  const rows = [];
  for (const item of items) {
    const plan = await planSetup(p, item.setup, { writable, realNow, hostZone });
    const clock = plan.now ? Date.parse(plan.now) : realNow;
    const row = {
      id: item.id, tier: plan.live ? "live" : "sandbox", sandbox: Boolean(plan.sandbox), now: plan.now,
      events: plan.sandbox?.events.length ?? 0, todos: plan.sandbox?.reminders.length ?? 0,
      files: [...plan.writes.map((w) => w.file), ...plan.appends.map((a) => `+${a.file}`)], applied: plan.applied, unmet: plan.unmet,
      turns: item.turns.map((t) => renderTokens(t.text, clock)),
    };
    rows.push(row);
    log(`${row.id.padEnd(34)} ${row.tier.padEnd(7)} ${row.now ?? "real time".padEnd(20)} applied=[${row.applied.join("; ")}]${row.unmet.length ? ` UNMET=[${row.unmet.join("; ")}]` : ""}${item.turns.some((t, i) => t.text !== row.turns[i]) ? ` turns=${JSON.stringify(row.turns)}` : ""}`);
  }
  const summary = {
    items: rows.length, sandboxed: rows.filter((r) => r.sandbox).length, live: rows.filter((r) => r.tier === "live").length,
    realTimeNoFixture: rows.filter((r) => !r.sandbox && r.tier !== "live").length,
    itemsWithUnmet: rows.filter((r) => r.unmet.length).length,
    appliedByKey: tally(rows, "applied"), unmetByKey: tally(rows, "unmet"),
  };
  return { rows, summary };
}
