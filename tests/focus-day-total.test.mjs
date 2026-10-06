import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { focusToday, formatFocusToday } from "../scripts/lib/focus/day-total.mjs";

const rec = (dayKey, served, endedAt, rest = 0) => ({ dayKey, servedFocusSeconds: served, servedRestSeconds: rest, endedAt, reason: "early" });
const day = "2026-10-06";

test("sums every session of the day, not just the latest", () => {
  const total = focusToday([rec(day, 3600, "2026-10-06T10:00Z"), rec(day, 2400, "2026-10-06T12:00Z", 300), rec(day, 960, "2026-10-06T15:00Z")], { dayKey: day });
  assert.equal(total.focusSeconds, 6960);
  assert.equal(total.sessions, 3);
  assert.equal(total.latestSessionSeconds, 960);
  assert.equal(total.restSeconds, 300);
  assert.equal(total.longestSessionSeconds, 3600);
});

test("other days are ignored", () => {
  assert.equal(focusToday([rec("2026-10-05", 3600, "x"), rec(day, 600, "y")], { dayKey: day }).focusSeconds, 600);
});

test("a live session is added and counts as latest", () => {
  const total = focusToday([rec(day, 600, "2026-10-06T10:00Z")], { dayKey: day, live: { servedFocusSeconds: 300 } });
  assert.equal(total.focusSeconds, 900);
  assert.equal(total.sessions, 2);
  assert.equal(total.latestSessionSeconds, 300);
});

test("short blips under a minute add time but not sessions", () => {
  const total = focusToday([rec(day, 30, "a"), rec(day, 600, "b")], { dayKey: day });
  assert.equal(total.focusSeconds, 630);
  assert.equal(total.sessions, 1);
});

test("formats hours, minutes and the empty day", () => {
  assert.equal(formatFocusToday({ focusSeconds: 6720, sessions: 4, latestSessionSeconds: 960 }), "Focused today: 1h 52m across 4 sessions (latest 16m).");
  assert.equal(formatFocusToday({ focusSeconds: 600, sessions: 1, latestSessionSeconds: 600 }), "Focused today: 10m across 1 session (latest 10m).");
  assert.equal(formatFocusToday({ focusSeconds: 0, sessions: 0, latestSessionSeconds: 0 }), "No focus time yet today.");
});

test("the today command reads the history file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orion-backlog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = join(dir, "focus-history.jsonl");
  await writeFile(history, [rec(day, 3600, "a"), rec(day, 1200, "b")].map(r => JSON.stringify(r)).join("\n") + "\nnot json\n");
  const out = execFileSync(process.execPath, ["scripts/orion-session", "today", "--day", day], { encoding: "utf8", env: { ...process.env, ORION_FOCUS_HISTORY: history } });
  assert.equal(out.trim(), "Focused today: 1h 20m across 2 sessions (latest 20m).");
});
