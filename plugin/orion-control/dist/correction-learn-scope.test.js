// Wave 12 fixer (2026-11-02): three review findings on corrections-become-rules.
//  4. A reply that refuses the action ORION just proposed ("no dont move my study block" after "want me to move your study block
//     to 4?") is a one-off decision, not a standing rule. Only general or explicit wording is kept.
//  5. USER.md grew without limit: saved rules are capped (oldest auto-captured rule goes first, near-identical ones are merged), logged.
//  6. Sessions that are not Nick (missions, claude checks, sweeps, probes, benches, pipelines) are never captured.
// Phrasings marked "held out" appear nowhere in the implementation. No real paths.
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_RULES, capRules, isNickSession, learnCorrection, readCorrection } from "./correction-learn.js";
const MOVE_OFFER = "Want me to move your study block to 4 PM?";
const BOOK_OFFER = "Should I book gym at 6am tomorrow?";
describe("finding 4: a refusal of the pending offer is one-off; general or explicit wording is a rule", () => {
    // Held out: one-off refusals of what ORION just proposed.
    it.each([
        ["no dont move my study block", MOVE_OFFER],
        ["nah dont move the study block", MOVE_OFFER],
        ["dont move my study block pls", MOVE_OFFER],
        ["no dont book gym at 6am", BOOK_OFFER],
        ["dont book anything at 6am", BOOK_OFFER],
    ])("held out: one-off after the offer: %s", (said, offered) => {
        expect(readCorrection(said, { offered })).toBeUndefined();
    });
    // Held out: a bare "dont <verb> <thing>" with nothing general about it is one-off even with no offer on record.
    it.each(["dont move my study block", "do not cancel my reading session"])("held out: one-off with no general wording: %s", (said) => {
        expect(readCorrection(said)).toBeUndefined();
    });
    // Held out: explicit or general wording is a standing rule, even right after the offer.
    it.each([
        ["from now on dont move my study blocks", MOVE_OFFER, /not to move his study blocks/i],
        ["dont ever move my study block", MOVE_OFFER, /never to move his study block/i],
        ["never move my study block", MOVE_OFFER, /never to move his study block/i],
        ["stop moving my study blocks around", MOVE_OFFER, /to stop moving his study blocks around/i],
        ["dont move my study blocks anymore", MOVE_OFFER, /not to move his study blocks/i],
        ["dont schedule anything before 10am", MOVE_OFFER, /not to schedule anything before 10am/i], // generic, not the offer's verb
    ])("held out: rule after the offer: %s", (said, offered, fact) => {
        expect(readCorrection(said, { offered })?.fact).toMatch(fact);
    });
    it("a generic statement with no offer on record is still a rule", () => {
        expect(readCorrection("dont book stuff on sundays")?.fact).toMatch(/not to book stuff on sundays/i);
    });
});
describe("finding 6: only Nick's sessions are captured", () => {
    it.each([
        "agent:main:mission-a1b2c3", "agent:main:claude-check-1", "agent:main:orion-chat-sweep-12", "agent:main:orion-eval-sched-3",
        "agent:main:orion-probe-plugin", "agent:main:orion-bench-2", "agent:main:orion-v3-pipe-7", "agent:main:cron:daily",
        "agent:main:heartbeat", "agent:main:orion-gate-selftest", "agent:main:gate31", "agent:main:subagent:x", "agent:main:orion-chat-test",
        "agent:main:standing-morning",
    ])("not Nick: %s", (key) => {
        expect(isNickSession(key)).toBe(false);
    });
    it.each(["agent:main:orion-chat-8f3e2a10-4b7c-4d1e-9a2b-0c1d2e3f4a5b", "agent:main:orion-app-v2", "agent:main:phone-thread", "agent:main:orion-chat-voice", ""])("Nick: %s", (key) => {
        expect(isNickSession(key)).toBe(true);
    });
    it("learnCorrection skips a mission and a claude check", async () => {
        const calls = [];
        const run = async (args) => { calls.push(args); return { stdout: "remembered", code: 0 }; };
        expect(await learnCorrection("its called macro not econ", { run, sessionKey: "agent:main:mission-77" })).toBe("skipped");
        expect(await learnCorrection("its called macro not econ", { run, sessionKey: "agent:main:claude-check-2" })).toBe("skipped");
        expect(calls).toEqual([]);
    });
});
const rule = (day, text) => `- ${day} — Rule: ${text}.`;
const userWith = (rules) => `# Nick\n\n- 2026-09-29 — **Times are 12-hour, never "20:11", and never both in\n  one answer.**\n- 2026-10-01 — Preference: Nick likes gym in the evening.\n${rules.join("\n")}\n`;
describe("finding 5: saved rules are capped", () => {
    it("capRules keeps the newest MAX_RULES rules, drops the oldest, leaves preferences and the template alone", () => {
        const rules = Array.from({ length: MAX_RULES + 3 }, (_, i) => rule(`2026-10-${String((i % 28) + 1).padStart(2, "0")}`, `Nick wants ORION not to do thing number ${i}`));
        const out = capRules(userWith(rules));
        expect(out.dropped).toHaveLength(3);
        expect(out.dropped[0]).toMatch(/thing number 0\.$/);
        expect(out.text.match(/Rule:/g)).toHaveLength(MAX_RULES);
        expect(out.text).toMatch(/Times are 12-hour[^\n]*\n  one answer/);
        expect(out.text).toMatch(/Preference: Nick likes gym in the evening/);
        expect(out.text).toMatch(/thing number 32\./);
    });
    it("capRules merges near-identical rules, keeping the newer", () => {
        const out = capRules(userWith([rule("2026-10-01", 'Nick calls it "macro", not "econ"'), rule("2026-10-05", 'Nick calls it "Macro" not "econ"')]));
        expect(out.dropped).toEqual(['- 2026-10-01 — Rule: Nick calls it "macro", not "econ".']);
        expect(out.text).toMatch(/2026-10-05 — Rule: Nick calls it "Macro"/);
    });
    it("capRules changes nothing under the cap", () => {
        const text = userWith([rule("2026-10-01", "Nick wants ORION not to schedule anything before 10am")]);
        expect(capRules(text)).toEqual({ text, dropped: [] });
    });
    it("learnCorrection: a near-identical rule is not saved again; a full USER.md drops its oldest rule and logs it", async () => {
        const dir = mkdtempSync(join(tmpdir(), "cl-cap-"));
        const userMd = join(dir, "USER.md");
        const rules = Array.from({ length: MAX_RULES - 1 }, (_, i) => rule("2026-10-01", `Nick wants ORION not to do thing number ${i}`));
        writeFileSync(userMd, userWith([rule("2026-09-30", 'Nick calls it "macro", not "econ"'), ...rules]));
        const calls = [];
        const run = async (args) => { calls.push(args); appendFileSync(userMd, `- 2026-11-02 — ${args[1]}\n`); return { stdout: "remembered -> USER.md", code: 0 }; };
        expect(await learnCorrection("ugh its called Macro not econ", { run, stateDir: dir, userMdPath: userMd })).toBe("already");
        expect(calls).toEqual([]);
        expect(await learnCorrection("never move my classes to fit gym", { run, stateDir: dir, userMdPath: userMd })).toBe("saved");
        const after = readFileSync(userMd, "utf8");
        expect(after.match(/Rule:/g)).toHaveLength(MAX_RULES);
        expect(after).toMatch(/never to move his classes to fit gym/);
        expect(after).not.toMatch(/calls it "macro"/); // the oldest went
        const log = readFileSync(join(dir, "learned-rules.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(log).toEqual([expect.objectContaining({ action: "drop-over-cap", text: '- 2026-09-30 — Rule: Nick calls it "macro", not "econ".' })]);
    });
});
