// Shared fixtures for the delivery tests: a temp HOME, a literal awareness.json (contract C1), fake bins.
// Never touches ~/.openclaw; the fake `open` records instead of launching the app.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const SCRIPTS = join(import.meta.dirname, "../scripts");
export const NOW = new Date(2026, 9, 16, 14, 0);
const iso = (d) => d.toISOString();

/** A C1 snapshot as a literal object. Facets default to fresh at `now`; pass overrides per facet. */
export function awareness(now = NOW, over = {}) {
  const at = iso(now);
  return { schema: "orion.awareness.v1", at,
    session: { state: "none", at, source: "phase-hook" },
    calendar: { state: "ok", now: null, next: null, at },
    location: { state: "unknown", placeId: null, since: null, at, source: null },
    mac: { state: "active", idleSeconds: 5, at },
    audio: { mac: { route: "speakers", headphones: false, at }, phone: { route: "unknown", headphones: null, at } },
    sleep: { state: "awake", inWindow: false, at },
    ...over };
}

export function harness({ now = NOW, facts = { idleSeconds: 5, locked: false, headphones: false } } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-delivery-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  const bin = (name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  const open = bin("fake-open", `echo "$@" >> "${home}/open.log"`);
  const reach = bin("fake-reach", `echo "$@" >> "${home}/reach.log"; echo "Sent - fake"`);
  const reschedule = bin("fake-reschedule", `echo "$@" >> "${home}/reschedule.log"`);
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  writeFileSync(join(home, "cal.json"), "[]");
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_REACH_FACTS: JSON.stringify(facts), ORION_REACH_OPEN_BIN: open, ORION_REACH_NOW: iso(now), ORION_AWARENESS_NO_REFRESH: "1",
    ORION_SESSION_SOCKET: join(home, "no-such.sock"), ORION_BRIDGE_BIN: join(SCRIPTS, "../tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
    ORION_CHECKIN_FILE: join(home, "checkins.json"), ORION_REACH_BIN: reach, ORION_RESCHEDULE_BIN: reschedule };
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const lines = (f) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8").trim().split("\n").filter(Boolean) : []);
  return { home, dir, env, read, lines,
    setAwareness: (over, at = now) => writeFileSync(join(dir, "awareness.json"), JSON.stringify(awareness(at, over))),
    run: (name, args, extra = {}) => spawnSync(process.execPath, [join(SCRIPTS, name), ...args], { encoding: "utf8", env: { ...env, ...extra } }) };
}
