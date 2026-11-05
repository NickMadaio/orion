import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TurnProgress, progressFileName } from "./turn-progress.js";
// w20 phonelink: the front desk's one-line "say" ("on it, one moment") has no delivery stage on the agent CLI, so it rides in the
// progress file for the phone link to carry. It is NOT a stage: the Mac app speaks stage labels aloud.
const tmp = () => mkdtempSync(join(tmpdir(), "tp-say-"));
const read = (dir, key) => JSON.parse(readFileSync(join(dir, progressFileName(key)), "utf8"));
describe("front desk say in the progress file", () => {
    it("is written as a top-level line, never as a spoken stage", () => {
        const dir = tmp();
        const p = new TurnProgress(dir);
        p.begin("orion-chat-x", "run-1");
        p.say("orion-chat-x", "  Rebuilding the evening, one moment.  ");
        const doc = read(dir, "orion-chat-x");
        expect(doc.say).toBe("Rebuilding the evening, one moment.");
        expect(doc.stages.map((s) => s.stage)).toEqual(["understanding"]);
    });
    it("ignores empty text, a missing session and a turn that has not begun", () => {
        const dir = tmp();
        const p = new TurnProgress(dir);
        p.say("orion-chat-x", "hello");
        p.begin("orion-chat-x", null);
        p.say("orion-chat-x", "   ");
        p.say(undefined, "hello");
        expect(read(dir, "orion-chat-x").say).toBeUndefined();
    });
    it("caps a long line and keeps one line", () => {
        const dir = tmp();
        const p = new TurnProgress(dir);
        p.begin("k", null);
        p.say("k", `one\ntwo ${"x".repeat(400)}`);
        const say = read(dir, "k").say ?? "";
        expect(say.includes("\n")).toBe(false);
        expect(say.length).toBeLessThanOrEqual(140);
    });
});
