// Wave 14 (2026-11-02): the mail loop end to end. The REAL watcher (scripts/lib/mail/tick.mjs, with a fake inbox and a recording reach)
// sends an alert and writes mail-alerts.jsonl; Nick answers in chat through the real routing hooks; the real scripts/orion-mail-prefs
// saves the rule; and the watcher's next poll applies it. Temp state dir only; nothing live is read or written.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { MailPrefsRun } from "./mail-flow.js";

const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-mail-prefs", import.meta.url));
const TICK_URL = new URL("../../../scripts/lib/mail/tick.mjs", import.meta.url).href;
const NOW = new Date(2026, 10, 2, 15, 0);
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type Tick = (deps: Record<string, unknown>) => Promise<{ said: string | null; verdicts?: Array<{ by: string; level: string }> }>;

const mail = (n: number, over: Record<string, unknown> = {}) => ({ key: `k${n}`, threadId: `t${n}`, messageId: `m${n}`, fromName: "Prof. Jane Smith", fromAddress: "j.smith@northeastern.edu",
  domain: "northeastern.edu", subject: "CS2100 Midterm", snippet: "room change to West 110", labels: [], listUnsubscribe: false, precedenceBulk: false, nickInThread: false, fromNick: false, ...over });

function world() {
  const root = mkdtempSync(join(tmpdir(), "w14-mail-"));
  const dir = join(root, "ctl"); mkdirSync(dir);
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW.toISOString(), ORION_BRIDGE_BIN: "/nonexistent" };
  const run: MailPrefsRun = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 })));
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const desk: string[] = [];
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(root, "r.jsonl"), progressDir: join(root, "tp"), stateDir: dir, clock: () => "Mon 15:00", now: () => NOW,
    decideImpl: async (i: { message: string }) => { desk.push(i.message); return { move: "escalate" } as Decision; },
    brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), realityRun: async () => ({ stdout: "ok", code: 0 }),
    mailPrefsRun: run,
  } as never);
  let n = 0;
  const reply = async (prompt: string) => {
    const ctx = { runId: `w14-${n += 1}`, sessionKey: "agent:main:orion-chat-w14" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    return direct?.reply?.text;
  };
  // The watcher's reach, recording what orion-reach would log (outreach.jsonl is what the plugin reads as the last push).
  const reach = async (text: string) => { appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "r1", text, at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), channel: "phone", kind: "info", tier: "low" })}\n`); return { ok: true, id: "r1" }; };
  return { dir, reply, desk, reach };
}

describe("alert → his reply → a rule the next poll obeys", () => {
  it("'nah not important' to a professor's alert mutes that sender for the next mail", async () => {
    const w = world();
    const { mailTick } = (await import(TICK_URL)) as { mailTick: Tick };
    let inbox = [] as ReturnType<typeof mail>[];
    const at = (min: number) => new Date(NOW.getTime() - 60 * 60_000 + min * 60_000);
    const deps = { dir: w.dir, ctx: { people: [], courses: ["CS2100"] }, fetchInbox: async () => inbox, reach: w.reach };
    await mailTick({ ...deps, now: at(0) });
    inbox = [mail(1)];
    const first = await mailTick({ ...deps, now: at(11) });
    expect(first.said).toBe("Prof. Smith emailed about the CS2100 Midterm — 'room change to West 110'");

    expect(await w.reply("nah not important tbh")).toBe("Got it, I won't flag mail from Prof. Smith anymore.");
    expect(w.desk).toEqual([]);
    const prefs = JSON.parse(readFileSync(join(w.dir, "mail-prefs.json"), "utf8")) as { rules: Array<{ action: string; kind: string; value: string; via: string }> };
    expect(prefs.rules).toEqual([expect.objectContaining({ action: "mute", kind: "sender", value: "j.smith@northeastern.edu", via: "chat" })]);

    inbox = [mail(1), mail(2, { subject: "CS2100 reading" })];
    const next = await mailTick({ ...deps, now: at(50) });
    expect(next.said).toBeNull();
    expect(next.verdicts?.[0]).toMatchObject({ by: "his rule", level: "skip" });
  });

  it("'always tell me when X emails' boosts a sender the rules would drop", async () => {
    const w = world();
    expect(await w.reply("yo always lmk when my landlord emails")).toBe("Got it, I'll always tell you when your landlord emails.");
    const { mailTick } = (await import(TICK_URL)) as { mailTick: Tick };
    let inbox = [] as ReturnType<typeof mail>[];
    const deps = { dir: w.dir, ctx: {}, fetchInbox: async () => inbox, reach: w.reach };
    await mailTick({ ...deps, now: new Date(NOW.getTime() - 30 * 60_000) });
    inbox = [mail(1, { fromName: "Landlord Lettings", fromAddress: "no-reply@lettings.co.uk", domain: "lettings.co.uk", subject: "Rent statement", listUnsubscribe: true })];
    const r = await mailTick({ ...deps, now: NOW });
    expect(r.said).toMatch(/^Landlord Lettings emailed about rent statement/);
  });
});
