// Shared fixtures for the 2026-10-19 incident regression tests: a temp HOME, a fake calendar, a literal awareness.json,
// the real orion-reach / orion-checkin / orion-proactive writing into temp dirs. Nothing real is read, written or sent.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { aw } from "./fixtures/curiosity-aw.mjs";

export const W = join(import.meta.dirname, "..");
export const rows = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A local time on 2026-10-`day`. */
export const at = (day, h, mi = 0) => new Date(2026, 9, day, h, mi);

export function world({ day = 19, cal = () => [], cfg = {}, awOver = {}, checkins = null, morning = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-incident-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (h, mi) => at(day, h, mi).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify(cal(iso)));
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:45", usualWake: "07:45", ...cfg }));
  const open = join(home, "fake-open"); writeFileSync(open, `#!/bin/sh\necho "$@" >> "${home}/open.log"\n`); chmodSync(open, 0o755);
  if (morning) writeFileSync(join(dir, "morning-sent.json"), JSON.stringify(morning));
  if (checkins) writeFileSync(join(home, "checkins.json"), JSON.stringify({ checkins }));
  const bin = (name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  const put = (h, mi, over = awOver, d = day) => writeFileSync(join(dir, "awareness.json"), JSON.stringify(aw(at(d, h, mi), over)));
  const env = (h, mi, d = day, extra = {}) => ({ PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_CHECKIN_FILE: join(home, "checkins.json"),
    ORION_REACH_NOW: at(d, h, mi).toISOString(), ORION_CHECKIN_NOW: at(d, h, mi).toISOString(), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }), ORION_REACH_OPEN_BIN: open,
    ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock"),
    ORION_AWARENESS_NO_REFRESH: "1", ...extra });
  const run = (script, args, h, mi, { d = day, over, extra } = {}) => { put(h, mi, over ?? awOver, d); return spawnSync(process.execPath, [join(W, "scripts", script), ...args], { encoding: "utf8", env: env(h, mi, d, extra), timeout: 120000 }); };
  const tick = (h, mi, over, extraArgs = [], d = day) => run("orion-proactive", ["tick", ...extraArgs], h, mi, { d, over });
  const appendOutreach = (list) => { for (const r of list) appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify(r)}\n`); };
  return { home, dir, bin, put, env, run, tick, appendOutreach, outreach: () => rows(join(dir, "outreach.jsonl")),
    checkins: () => JSON.parse(readFileSync(join(home, "checkins.json"), "utf8")).checkins, lines: (f) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8").trim().split("\n").filter(Boolean) : []),
    ledger: () => JSON.parse(readFileSync(join(dir, "curiosity.json"), "utf8")) };
}

/** A plan check-in loop for a block, due now. */
export const planCheckin = (id, what, block, { createdAt, blockWindow, tier, level = 0, nextCheckAt, by = "orion", alerts = 0, phase = "waiting" } = {}) => ({
  id, what, by, block, dueAt: Math.floor(new Date(createdAt).getTime() / 60000), createdAt, alerts, returning: null,
  ...(blockWindow ? { blockWindow } : {}), ...(tier ? { tier } : {}),
  loop: { blockId: id, phase, level, nextCheckAt, deferrals: 0, history: [] } });
