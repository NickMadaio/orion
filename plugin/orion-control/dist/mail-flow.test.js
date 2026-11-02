// Wave 14 (2026-11-02): Nick teaching ORION about his mail, in chat. The first block of each list is the brief's own wording; the rest
// are HELD OUT, written in his style (lowercase, no apostrophes, "u", "lmk", "lol") and not used to write the patterns' examples.
// The script runner is faked; replies are built from its JSON.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMailMove, runMailMove } from "./mail-flow.js";
import { currentMailAlert, mailAlertsFile, readMailAlerts } from "./mail-alerts.js";
const NOW = new Date("2026-11-02T15:00:00Z");
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const PROF_TEXT = "Prof. Smith emailed about the CS2100 Midterm — 'room change to West 110'";
const alert = (over = {}) => ({ id: "r1", at: ago(10), text: PROF_TEXT,
    items: [{ who: "Prof. Smith", fromAddress: "j.smith@northeastern.edu", domain: "northeastern.edu", topic: "the CS2100 Midterm", person: true }], ...over });
const BANK = alert({ text: "Barclays emailed about payment due", items: [{ who: "Barclays", fromAddress: "no-reply@barclays.co.uk", domain: "barclays.co.uk", topic: "payment due", person: false }] });
const DIGEST = alert({ text: "2 emails worth a look: Indeed about new jobs; LinkedIn about 9 searches.", items: [
        { who: "Indeed", fromAddress: "alert@indeed.com", domain: "indeed.com", topic: "new jobs", person: false },
        { who: "LinkedIn", fromAddress: "messages-noreply@linkedin.com", domain: "linkedin.com", topic: "9 searches", person: false }
    ] });
const REGISTRAR = alert({ text: "NU Registrar emailed about spring registration", items: [{ who: "NU Registrar", fromAddress: "registrar-noreply@northeastern.edu", domain: "northeastern.edu", topic: "spring registration", person: false }] });
const SCHOOL_DIGEST = alert({ text: "2 emails worth a look: NU Registrar about spring registration; Priya Kapoor about the lab.", items: [
        { who: "NU Registrar", fromAddress: "registrar-noreply@northeastern.edu", domain: "northeastern.edu", topic: "spring registration", person: false },
        { who: "Priya Kapoor", fromAddress: "p.kapoor@northeastern.edu", domain: "northeastern.edu", topic: "the lab", person: true }
    ] });
const rulesOf = (move) => (move?.kind === "rules" ? move.rules : undefined);
const actionOf = (move) => (move?.kind === "rules" ? move.action : undefined);
const askOf = (move) => (move?.kind === "ask" ? move.text : undefined);
const ctx = (alerts, over = {}) => ({ stateDir: "/nonexistent", now: NOW, alerts, lastPush: alerts.at(-1) ? { text: alerts.at(-1).text, at: alerts.at(-1).at } : null, ...over });
function fake(answer = () => ({ ok: true })) {
    const calls = [];
    const run = async (args) => { calls.push(args); const out = answer(args); return out === undefined ? { stdout: "", code: 1 } : { stdout: JSON.stringify(out), code: 0 }; };
    return { run, calls };
}
describe("a bare reply to a mail alert is about the one mail it named", () => {
    it.each([
        "not important",
        "dont care about these",
        // held out
        "nah thats not important",
        "meh these arent important lol",
        "not rly important tbh",
        "who cares",
        "i dont really care about these",
        "ugh spam",
        "thats not that important",
    ])("mutes the exact sender of a single-mail alert: %s", (m) => {
        const move = readMailMove(m, ctx([BANK]));
        expect(actionOf(move)).toBe("mute");
        expect(rulesOf(move)?.map((r) => `${r.kind}:${r.value}`)).toEqual(["sender:no-reply@barclays.co.uk"]);
    });
    it.each([
        "not important",
        "dont care about these",
        // held out
        "nah thats not important",
        "meh not rly important",
        "this matters",
        "good catch",
    ])("asks which one on a digest instead of ruling on every sender: %s", (m) => {
        const move = readMailMove(m, ctx([DIGEST]));
        expect(askOf(move)).toBe('Which one, the Indeed one or the LinkedIn one? Say something like "the Indeed one isn\'t important".');
    });
    it.each([
        ["the indeed one isnt important", "mute", "alert@indeed.com"],
        // held out
        ["linkedin one not important", "mute", "messages-noreply@linkedin.com"],
        ["nah the linkedin one is spam", "mute", "messages-noreply@linkedin.com"],
        ["idc about the indeed one", "mute", "alert@indeed.com"],
        ["the indeed one actually matters", "boost", "alert@indeed.com"],
        ["oh the linkedin one is important", "boost", "messages-noreply@linkedin.com"],
    ])("naming one item of a digest answers it: %s", (m, action, value) => {
        const move = readMailMove(m, ctx([DIGEST]));
        expect(actionOf(move)).toBe(action);
        expect(rulesOf(move)).toEqual([expect.objectContaining({ kind: "sender", value })]);
    });
    it("naming both items of a digest is still asked back, never two rules from one phrase", () => {
        expect(rulesOf(readMailMove("indeed and linkedin arent important", ctx([DIGEST])))).toBeUndefined();
    });
    it.each([
        "this matters",
        // held out
        "ok that one actually matters",
        "oh shit thats important ty",
        "good catch",
        "yeah keep em coming",
        "this is def important",
    ])("boosts: %s", (m) => {
        const move = readMailMove(m, ctx([alert()]));
        expect(actionOf(move)).toBe("boost");
        expect(rulesOf(move)).toEqual([{ action: "boost", kind: "sender", value: "j.smith@northeastern.edu", label: "Prof. Smith" }]);
    });
    it("an automated sender binds to its exact address, never its domain: the registrar never mutes the professors", () => {
        for (const m of ["not important", "dont care", "who cares", "stop telling me about the registrar", "ignore registrar emails"]) {
            const rules = rulesOf(readMailMove(m, ctx([REGISTRAR])));
            expect(rules, m).toEqual([expect.objectContaining({ action: "mute", kind: "sender", value: "registrar-noreply@northeastern.edu" })]);
        }
    });
    it("a school digest: the registrar one is muted alone, and a bare reply is asked back", () => {
        expect(askOf(readMailMove("not important", ctx([SCHOOL_DIGEST])))).toMatch(/^Which one, the NU Registrar one or the Priya Kapoor one\?/);
        expect(rulesOf(readMailMove("the registrar one isnt important", ctx([SCHOOL_DIGEST])))).toEqual([expect.objectContaining({ kind: "sender", value: "registrar-noreply@northeastern.edu" })]);
    });
    it.each([
        ["no alert at all", [], {}],
        ["the alert is over 3 hours old", [alert({ at: ago(200) })], {}],
        ["something else was sent after it", [alert()], { lastPush: { text: "Time to start: Gym.", at: ago(2) } }],
        ["the app's label names another message", [alert()], { label: "CS2101 Lab starts in 29 min - time to head out." }],
    ])("a bare reply binds to nothing when %s", (_why, alerts, over) => {
        expect(readMailMove("not important", ctx(alerts, over))).toBeUndefined();
        expect(readMailMove("this matters", ctx(alerts, over))).toBeUndefined();
    });
    it("the app's label naming the alert binds even when the card's last push is older", () => {
        expect(actionOf(readMailMove("not important", ctx([alert()], { lastPush: null, label: PROF_TEXT })))).toBe("mute");
    });
});
describe("a reply that names something becomes a sender, domain or topic rule", () => {
    it.each([
        ["stop telling me about linkedin emails", "mute", "topic", "linkedin"],
        ["always tell me when prof okafor emails", "boost", "sender", "prof okafor"],
        // held out
        ["pls stop pinging me about job alert emails", "mute", "topic", "job alert"],
        ["dont need emails from uber eats anymore", "mute", "sender", "uber eats"],
        ["ignore emails from noreply@duolingo.com", "mute", "sender", "noreply@duolingo.com"],
        ["ignore everything from substack.com", "mute", "domain", "substack.com"],
        ["can u stop flagging the deliveroo emails", "mute", "topic", "deliveroo"],
        ["yo always lmk when my landlord emails", "boost", "sender", "landlord"],
        ["make sure u tell me if sam emails me", "boost", "sender", "sam"],
        ["anything from lettings.co.uk is important", "boost", "domain", "lettings.co.uk"],
        ["internship emails are always important", "boost", "topic", "internship"],
        ["newsletter emails arent important", "mute", "topic", "newsletter"],
    ])("%s", (m, action, kind, value) => {
        const move = readMailMove(m, ctx([]));
        expect(actionOf(move)).toBe(action);
        expect(rulesOf(move)?.[0]).toMatchObject({ kind, value });
    });
    it("naming a sender from the current alert uses that sender's exact address, even without the word email", () => {
        expect(rulesOf(readMailMove("stop telling me about barclays", ctx([BANK])))?.[0]).toMatchObject({ action: "mute", kind: "sender", value: "no-reply@barclays.co.uk" });
        expect(rulesOf(readMailMove("dont tell me about linkedin anymore", ctx([DIGEST])))).toEqual([{ action: "mute", kind: "sender", value: "messages-noreply@linkedin.com", label: "LinkedIn" }]);
        expect(rulesOf(readMailMove("always tell me when smith emails", ctx([alert()])))?.[0]).toMatchObject({ kind: "sender", value: "j.smith@northeastern.edu" });
    });
    it.each([
        ["ignore everything from barclays", "barclays.co.uk"],
        // held out
        ["stop sending me all emails from barclays", "barclays.co.uk"],
        ["mute everything from barclays pls", "barclays.co.uk"],
    ])("'everything from' a sender in the alert is the one way to a domain rule: %s", (m, value) => {
        expect(rulesOf(readMailMove(m, ctx([BANK])))).toEqual([expect.objectContaining({ action: "mute", kind: "domain", value })]);
    });
    it.each([
        "mute substack.com",
        // held out
        "ignore emails from substack.com",
        "stop telling me about substack.com emails",
    ])("a bare domain without 'everything from' is asked back, not saved: %s", (m) => {
        expect(askOf(readMailMove(m, ctx([])))).toMatch(/^Everything from substack\.com\? Say "ignore everything from substack\.com"/);
    });
    it.each([
        ["ignore everything from northeastern.edu", []],
        ["anything from northeastern.edu is important", []],
        // held out
        ["mute all emails from gmail.com", []],
        ["stop telling me about outlook.com", []],
        ["ignore everything from the registrar", [REGISTRAR]],
        ["stop telling me about northeastern emails", []],
        ["dont need emails from icloud.com anymore", []],
    ])("his school and freemail domains are never ruled on as a whole: %s", (m, alerts) => {
        const move = readMailMove(m, ctx(alerts));
        expect(rulesOf(move)).toBeUndefined();
        expect(askOf(move)).toMatch(/I won't rule on everything from/);
    });
    it("a negated tell is a mute, never a boost", () => {
        expect(actionOf(readMailMove("dont tell me when barclays emails", ctx([BANK])))).toBe("mute");
    });
    it.each([
        "stop telling me about the gym",
        "dont tell me about my grades rn",
        "not important",
        "this matters a lot to me",
        "move gym to 7",
        "i care about my sleep",
        "ignore that",
    ])("not a mail rule without mail context: %s", (m) => {
        expect(readMailMove(m, ctx([]))).toBeUndefined();
    });
    it("with a mail alert current, naming something not in it is still not a mail rule", () => {
        expect(readMailMove("stop telling me about the gym", ctx([alert()]))).toBeUndefined();
    });
});
describe("runMailMove saves through orion-mail-prefs and says what it saved", () => {
    it("one call per rule, fixed arguments, reply from the saved rules", async () => {
        const { run, calls } = fake();
        const out = await runMailMove(readMailMove("dont care about these", ctx([BANK])), run);
        expect(calls).toEqual([["add", "mute", "sender", "no-reply@barclays.co.uk", "--via", "chat", "--json"]]);
        expect(out.text).toBe("Got it, I won't flag mail from Barclays anymore.");
        expect(out.calls[0]).toBe('exec orion-mail-prefs "add" "mute" "sender" "no-reply@barclays.co.uk" "--via" "chat" "--json"');
    });
    it("a question back saves nothing", async () => {
        const { run, calls } = fake();
        const out = await runMailMove(readMailMove("not important", ctx([DIGEST])), run);
        expect(calls).toEqual([]);
        expect(out.text).toMatch(/^Which one/);
    });
    it("a boost and a topic read naturally", async () => {
        expect((await runMailMove(readMailMove("this matters", ctx([alert()])), fake().run)).text).toBe("Got it, I'll always tell you when Prof. Smith emails.");
        expect((await runMailMove(readMailMove("stop telling me about job alert emails", ctx([])), fake().run)).text).toBe("Got it, I won't flag mail about job alert anymore.");
    });
    it("a failed save is said, never claimed", async () => {
        const out = await runMailMove(readMailMove("not important", ctx([BANK])), fake(() => undefined).run);
        expect(out.text).toMatch(/couldn't save that/);
        const two = { kind: "rules", action: "mute", rules: [{ action: "mute", kind: "sender", value: "alert@indeed.com", label: "Indeed" }, { action: "mute", kind: "sender", value: "messages-noreply@linkedin.com", label: "LinkedIn" }] };
        const partial = await runMailMove(two, fake((a) => (a[3] === "alert@indeed.com" ? { ok: true } : undefined)).run);
        expect(partial.text).toBe("Got it, I won't flag mail from Indeed anymore. (1 didn't save, so I may still flag that one.)");
    });
});
describe("mail-alerts.ts reads the watcher's file", () => {
    it("reads rows, skips broken lines, picks the eval file only in a sandbox", () => {
        const dir = mkdtempSync(join(tmpdir(), "mail-alerts-"));
        writeFileSync(join(dir, "mail-alerts.jsonl"), `${JSON.stringify(alert())}\nnot json\n${JSON.stringify(BANK)}\n`);
        const rows = readMailAlerts(mailAlertsFile(dir));
        expect(rows.map((r) => r.text)).toEqual([PROF_TEXT, BANK.text]);
        expect(currentMailAlert(rows, NOW, { lastPush: { text: BANK.text, at: BANK.at } })?.text).toBe(BANK.text);
        expect(readMailAlerts(join(dir, "missing.jsonl"))).toEqual([]);
        expect(mailAlertsFile(dir)).toBe(join(dir, "mail-alerts.jsonl"));
    });
});
describe("the worker knows the tool", () => {
    it("BRAIN instructions advertise list and add; remove only on his explicit request; domain only for 'everything from'", async () => {
        const { BRAIN_INSTRUCTIONS } = await import("./job-instructions.js");
        expect(BRAIN_INSTRUCTIONS).toMatch(/orion-mail-prefs list \| add mute\|boost sender\|topic "<value>"/);
        expect(BRAIN_INSTRUCTIONS).not.toMatch(/orion-mail-prefs list \|[^\n]*\| remove/);
        expect(BRAIN_INSTRUCTIONS).toMatch(/orion-mail-prefs remove <id>[^\n]*only when he explicitly asks/);
        expect(BRAIN_INSTRUCTIONS).toMatch(/domain[^\n]*only when he says "everything from <domain>"/);
    });
});
