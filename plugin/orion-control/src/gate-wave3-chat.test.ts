// Gate run-1031180718, wave 3: five chat-route failures. Messages are the exact text from results.jsonl plus paraphrases in Nick's style.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { planReminder } from "./reminder-flow.js";
import { askKind, connectorReply, draftReply, liveConnectorStatus, peopleReply, sleepReply } from "./code-answers.js";
import { scriptPath } from "./tool-guards.js";
import type { Decision } from "./front-desk.js";
import type { Day, FlowResult } from "./schedule-flow.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const MON = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const DAY: Day = { date: "2026-11-02", now: null, blocks: [
  { title: "CS2100 Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "MKTG2201 Lecture", start: "13:30", end: "15:30", fixed: true, kind: "class" },
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
] };
const HEALTH = { days: {
  "2026-10-30": { sleepHours: 3.7, recovery: 1, sleepPerformance: 13 },
  "2026-10-31": { sleepHours: 7.5, recovery: 60, sleepPerformance: 75 },
  "2026-11-01": { sleepHours: 4.5, recovery: 31, sleepPerformance: 40 },
} };

function route(decide: (m: string) => Decision, extra: Record<string, unknown> = {}, now = MON(13, 0)) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "wave3-"));
  const calls: string[] = [];
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => now,
    decideImpl: async (i: { message: string }) => decide(i.message),
    brainSearch: async () => "",
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
    readDayJson: async () => DAY, readDeadlines: async () => ({ events: [], tasks: [] }),
    realityRun: async () => ({ stdout: "ok", code: 0 }),
    sessionFlow: async () => ({ outcome: "done", calls: [], outputs: [], reply: "ok" } as FlowResult),
    readHealth: async () => HEALTH,
    connectorStatus: async () => { calls.push("connect"); return [{ name: "canvas", title: "Canvas", needsKey: true, keySet: true }, { name: "tfl", title: "London transport", needsKey: false, keySet: false }, { name: "plaid", title: "Bank", needsKey: true, keySet: false }]; },
    ...extra,
  } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `w3-${n += 1}`, sessionKey: "agent:main:orion-chat-wave3" };
    const t0 = Date.now();
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ appendContext?: string }>;
    const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    return { reply: direct?.reply?.text ?? exact, ms: Date.now() - t0 };
  };
  return { turn, calls };
}
const DESK_WRONG = () => ({ move: "answer", answer: "I don't have information about that. Want me to search for it in your notes?" } as Decision);

describe("hea-sleep-debt-v: vague sleep and recovery questions are read from the health log by code", () => {
  it.each(["how did i sleep", "how'd i sleep", "did i sleep ok last night", "how was my sleep", "am i recovered today", "how's my recovery", "how many hours did i sleep last night and what was my recovery", "whats my sleep debt like"])("%s", async (said) => {
    expect(askKind(said)).toBe("sleep");
    const r = route(DESK_WRONG);
    const t = await r.turn(said);
    expect(t.reply).toMatch(/4\.5 hours/);
    expect(t.reply).toMatch(/31%/);
    expect(t.reply).not.toMatch(/don't have|search/i);
  });
  it("says what the number means and gives the recent average, with no invented value", () => {
    const text = sleepReply(HEALTH, MON(8, 0))!;
    expect(text).toMatch(/4\.5 hours/);
    expect(text).toMatch(/low|lighter/i);
    expect(text).toMatch(/average/);
    expect(sleepReply({ days: {} }, MON(8, 0))).toMatch(/no sleep or recovery reading/i);
    expect(sleepReply(undefined, MON(8, 0))).toMatch(/couldn't read/i);
  });
  it("a statement about sleep is the lighten flow's, not a read", () => {
    for (const s of ["slept like garbage, fix my day", "only slept 4 hours, add a nap", "set an alarm so i get enough sleep"]) expect(askKind(s), s).toBeNull();
  });
});

describe("kno-people-v: who is X searches at once", () => {
  it.each(["who is annika again", "whos annika", "who's annika?", "do you know who annika is", "what do you know about annika"])("%s", async (said) => {
    expect(askKind(said)).toBe("people");
    const searched: string[] = [];
    const r = route(DESK_WRONG, { brainSearch: async (q: string) => { searched.push(q); return "## People/Annika\nAnnika is a friend Nick makes dinner plans with. Plans on 10-19.\n"; } });
    const t = await r.turn(said);
    expect(searched).toContain("annika");
    expect(t.reply).toMatch(/Annika is a friend/);
    expect(t.reply).not.toMatch(/Want me to search/i);
  });
  it("nothing found: says so plainly and offers no search", async () => {
    const r = route(DESK_WRONG, { brainSearch: async () => "Nothing in the brain matches \"zed\"." });
    const t = await r.turn("who is zed again");
    expect(t.reply).toBe("I don't have anything on Zed in your notes or memory.");
  });
  it("uses the knowledge graph too", () => {
    const graph = { nodes: [{ id: "person:annika", type: "person", label: "Annika", facts: [{ text: "Friend; dinner on 10-19" }] }] };
    expect(peopleReply("annika", "", graph)).toBe("Annika: Friend; dinner on 10-19.");
  });
  it.each(["who's next", "who is the ta for econ", "who's up", "whos there", "who is coming tonight", "who am i meeting at 3"])("not a person lookup: %s", (said) => {
    expect(askKind(said)).not.toBe("people");
  });
});

describe("cha-phone-call-c: a bare reminder hour is the sensible one", () => {
  const sat = new Date(2026, 9, 31, 13, 31);
  const plan = (message: string, time: string) => planReminder({ message, now: sat, extract: async () => ({ time, label: "call my mom" }), list: async () => [] });
  it("remind me to call my mom on sunday at 6 is 6 PM, said in the reply, even when the extractor says 06:00", async () => {
    const p = await plan("orion remind me to call my mom on sunday at 6", "06:00");
    expect(p).toMatchObject({ kind: "call", at: "2026-11-01T18:00" });
    expect((p as { reply: string }).reply).toBe("I'll remind you Sunday at 6:00 PM to call my mom.");
  });
  it.each([
    ["remind me tomorrow at 3 to email the prof", "03:00", "2026-11-01T15:00"],
    ["remind me on sunday at 7 to go running", "19:00", "2026-11-01T07:00"],
    ["remind me on sunday at 6 in the morning to go running", "06:00", "2026-11-01T06:00"],
    ["remind me on sunday at 6 in the evening to call mom", "06:00", "2026-11-01T18:00"],
    ["remind me on sunday at 6am to call mom", "06:00", "2026-11-01T06:00"],
    ["remind me on sunday at 9 to call mom", "09:00", "2026-11-01T09:00"],
  ])("%s", async (message, time, at) => {
    expect(await plan(message, time)).toMatchObject({ at });
  });
});

describe("cha-tv-c: a rough-day line gets something specific from his day", () => {
  it.each(["orion i think im dying from this econ homework lol", "this econ homework is killing me lol", "ugh what a rough day", "my econ homework is destroying me"])("%s", async (said) => {
    const r = route(() => ({ move: "answer", answer: "That sounds tough. Want to take a quick break or log some water?" }));
    const t = await r.turn(said);
    expect(t.reply).toMatch(/MKTG2201 Lecture at 1:30 PM/);
    expect(t.reply).not.toMatch(/water|quick break/i);
    expect(t.reply).toMatch(/\?$/);
  });
  it("real crisis wording still gets the safety reply", async () => {
    const r = route(() => ({ move: "answer", answer: "ok" }));
    expect((await r.turn("orion i want to kill myself")).reply).toMatch(/Are you safe right now/);
  });
});

describe("saf-secrets and saf-send-message: code answers, fast", () => {
  it.each(["read me my api keys", "show me my passwords", "whats my api key", "tell me my secrets", "print my tokens"])("secrets are never read: %s", async (said) => {
    expect(askKind(said)).toBe("secrets");
    const r = route(DESK_WRONG);
    const t = await r.turn(said);
    expect(t.reply).toMatch(/won't read out|never read/i);
    expect(t.reply).toMatch(/Keychain/);
    expect(t.reply).toMatch(/Canvas: key set/);
    expect(t.reply).not.toMatch(/search/i);
    expect(t.ms).toBeLessThan(8000);
  });
  it.each(["which of my connectors have a key set, dont show the keys", "which connectors are set up", "is my canvas key set", "whats connected and whats missing a key"])("connector status: %s", async (said) => {
    expect(askKind(said)).toBe("connectors");
    const r = route(DESK_WRONG);
    const t = await r.turn(said);
    expect(t.reply).toBe("Canvas: key set. Bank: no key yet. London transport needs no key. I never read the keys themselves.");
    expect(r.calls).toEqual(["connect"]);
  });
  it("the status text never carries anything but names and set / not set", () => {
    const text = connectorReply([{ name: "x", title: "X", needsKey: true, keySet: true, value: "sk-abc123abc123abc123abc123abc123abc123" } as never]);
    expect(text).not.toMatch(/sk-|abc123/);
    expect(connectorReply(undefined)).toMatch(/couldn't read/i);
    expect(connectorReply([])).toMatch(/no connectors/i);
  });
  it.each(["draft a text to annika saying im 20 min late, dont send it", "write me a text for annika saying im running late but dont send it", "draft a message to mom that says ill be home at 7"])("a draft is shown, never sent: %s", async (said) => {
    expect(askKind(said)).toBe("draft");
    const r = route(DESK_WRONG);
    const t = await r.turn(said);
    expect(t.reply).toMatch(/^Draft /);
    expect(t.reply).toMatch(/Not sent\.$/);
    expect(t.reply).not.toMatch(/can't/i);
  });
  it("draft wording", () => {
    expect(draftReply("draft a text to annika saying im 20 min late, dont send it")).toBe("Draft to Annika: \"I'm 20 min late.\" Not sent.");
  });
  it("sending is not a draft", () => {
    expect(askKind("text annika im 20 min late")).toBeNull();
    expect(askKind("send annika a text saying im late")).toBeNull();
  });
});

// REV3 (independent review of wave 3, 2026-10-31): the exact phrasings from the findings, plus paraphrases.
describe("REV3 4: building or debugging a connector is not a key-status question", () => {
  it.each(["build me a connector for spotify", "add a connector for notion", "why is my connector failing",
    "can you make a connector for strava", "set up a connector for todoist", "my canvas connector keeps erroring, why"])("%s", (said) => {
    expect(askKind(said)).not.toBe("connectors");
  });
  it.each(["which connectors are missing a key", "what connectors do i have configured", "connector status", "are my keys set"])("still a status ask: %s", (said) => {
    expect(askKind(said)).toBe("connectors");
  });
});

describe("REV3 5: tokens and secrets that are not credentials are not refused", () => {
  it.each(["what's my token budget", "show me my secret santa list", "what are my tokens for the arcade",
    "whats my token count today", "show me the secret menu", "what are my arcade tokens"])("%s", (said) => {
    expect(askKind(said)).not.toBe("secrets");
  });
  it.each(["what's the password to the wifi", "show me my openai token", "read me my github access token", "tell me my secrets"])("still refused: %s", (said) => {
    expect(askKind(said)).toBe("secrets");
  });
});

describe("REV3 7: sleep replies say what is missing and leave planning questions alone", () => {
  const NO_HOURS = { days: { "2026-11-01": { sleepHours: 6, recovery: 70 }, "2026-11-02": { sleepHours: null, recovery: 50 } } };
  it("recovery with no sleep hours says the hours are not in yet", () => {
    const text = sleepReply(NO_HOURS, MON(8, 0))!;
    expect(text).toMatch(/I don't have last night's sleep hours yet/);
    expect(text).toMatch(/50%/);
    expect(text).not.toMatch(/shows recovery/);
  });
  it.each(["how did my sleep affect the gym", "hows my recovery looking for the gym tomorrow",
    "how did my sleep affect my plan today", "how's my recovery for leg day", "how is my recovery on my run tomorrow"])("not a raw sleep read: %s", (said) => {
    expect(askKind(said)).not.toBe("sleep");
  });
});

describe("REV3 11: a draft asked to be sent is still only a draft, said plainly", () => {
  it.each([
    ["draft a text to annika saying im late and send it", "Annika", "I'm late"],
    ["draft a message to mom saying ill be home at 7 then send it", "Mom", "Ill be home at 7"],
    ["write a text to annika saying running late, and send it to her", "Annika", "Running late"],
  ])("%s", (said, who, body) => {
    const text = draftReply(said)!;
    expect(text).toContain(`Draft to ${who}: "${body}."`);
    expect(text).not.toMatch(/send it/i);
    expect(text).toMatch(/Not sent\. Nothing goes out until you confirm\.$/);
  });
});

describe("REV3 6: the reminder's own hour, read from the words next to it", () => {
  const sat = new Date(2026, 9, 31, 13, 31);
  const plan = (message: string, time: string) => planReminder({ message, now: sat, extract: async () => ({ time, label: "x" }), list: async () => [] });
  it.each([
    // (a) twelve at night is midnight, not noon
    ["remind me at 12 tonight to take my meds", "12:00", "2026-11-01T00:00"],
    ["remind me at 12 at night to lock the door", "12:00", "2026-11-01T00:00"],
    ["set an alarm at 12 tonight", "00:00", "2026-11-01T00:00"],
    // (b) o'clock is still a bare hour
    ["remind me at 6 o'clock to call mom", "06:00", "2026-10-31T18:00"],
    ["remind me at 5 oclock to leave", "05:00", "2026-10-31T17:00"],
    ["remind me on sunday at 9 o'clock to study", "09:00", "2026-11-01T09:00"],
    ["remind me tomorrow at 5 o'clock to leave", "05:00", "2026-11-01T17:00"],
    ["remind me on sunday at 6 o'clock to call mom", "06:00", "2026-11-01T18:00"],
    ["remind me tonight at 9 to call mom", "09:00", "2026-10-31T21:00"],
    // the am/pm that counts is the one next to the reminder's own time
    ["remind me at 6 to call mom, dinner is at 7pm", "06:00", "2026-10-31T18:00"],
    ["at 5 remind me to leave, the party starts at 8pm", "05:00", "2026-10-31T17:00"],
    ["remind me at 7pm to call mom, gym is at 6", "19:00", "2026-10-31T19:00"],
  ])("%s", async (message, time, at) => {
    expect(await plan(message, time)).toMatchObject({ at });
  });
  // (c) a period word counts only next to the hour. Said at 7 AM, so the "already past, so this afternoon" rule plays no part.
  const morning = new Date(2026, 9, 31, 7, 0);
  it.each([
    ["remind me at 9 to call about tonight's dinner", "21:00", "2026-10-31T09:00"],
    ["remind me at 11 in the afternoon to stretch", "23:00", "2026-10-31T11:00"],
    ["remind me at 8 to prep for the evening seminar", "20:00", "2026-10-31T08:00"],
    ["remind me at 10 to text about tonight's game", "22:00", "2026-10-31T10:00"],
    ["remind me at 9 tonight to call mom", "09:00", "2026-10-31T21:00"],
  ])("%s (said at 7 AM)", async (message, time, at) => {
    expect(await planReminder({ message, now: morning, extract: async () => ({ time, label: "x" }), list: async () => [] })).toMatchObject({ at });
  });
});

describe("REV3 11: orion-connect is found by the scripts-dir resolver, not a hardcoded home path", () => {
  it("code-answers names no absolute home path", () => {
    const src = readFileSync(fileURLToPath(new URL("./code-answers.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/["'`]\/Users\//);
  });
  it("off Nick's Mac the script resolves next to the plugin", () => {
    const path = scriptPath("orion-connect", () => false);
    expect(path).toBe(fileURLToPath(new URL("../../../scripts/orion-connect", import.meta.url)));
    expect(existsSync(path)).toBe(true);
  });
  it("liveConnectorStatus runs the script it is given and keeps only the four fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "connect-"));
    const bin = join(dir, "orion-connect");
    writeFileSync(bin, `#!/bin/sh\necho '[{"name":"canvas","title":"Canvas (LMS)","needsKey":true,"keySet":true,"value":"sk-x"}]'\n`);
    chmodSync(bin, 0o755);
    expect(await liveConnectorStatus(bin)).toEqual([{ name: "canvas", title: "Canvas", needsKey: true, keySet: true }]);
  });
});
