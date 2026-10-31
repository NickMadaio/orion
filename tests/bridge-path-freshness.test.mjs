// REV4 item 5: the scripts and the plugin share one rule. The sandbox is active only while the eval marker is live
// AND eval-calendar.json is under two hours old (plugin: src/plugin-clock.ts sandboxNowMs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MOD = fileURLToPath(new URL("../scripts/lib/life/bridge-path.mjs", import.meta.url));
const H = 3600_000;

function sandboxWith({ markerAgeMs, calendarAgeMs }) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-fresh-"));
  const put = (name, ageMs) => {
    if (ageMs === null) return;
    const f = join(dir, name);
    writeFileSync(f, name === "eval-calendar.json" ? JSON.stringify({ now: "2026-11-02T10:00:00.000Z", events: [] }) : "gate\n");
    const t = new Date(Date.now() - ageMs); utimesSync(f, t, t);
  };
  put("eval-mode", markerAgeMs); put("eval-calendar.json", calendarAgeMs);
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_BRIDGE_BIN", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const code = `import { sandbox } from ${JSON.stringify(MOD)}; console.log(JSON.stringify(sandbox()));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { env }).toString().trim());
}

test("sandbox: live marker + fresh calendar is active", () => {
  assert.equal(sandboxWith({ markerAgeMs: 105 * 60_000, calendarAgeMs: 60_000 })?.now, "2026-11-02T10:00:00.000Z");
});
test("sandbox: a leftover calendar older than 2 h is ignored even under a live marker", () => {
  assert.equal(sandboxWith({ markerAgeMs: 105 * 60_000, calendarAgeMs: 2 * H + 1000 }), null);
});
test("sandbox: a stale marker, no marker or no calendar is never active", () => {
  assert.equal(sandboxWith({ markerAgeMs: 2 * H + 1000, calendarAgeMs: 60_000 }), null);
  assert.equal(sandboxWith({ markerAgeMs: null, calendarAgeMs: 60_000 }), null);
  assert.equal(sandboxWith({ markerAgeMs: 60_000, calendarAgeMs: null }), null);
});
