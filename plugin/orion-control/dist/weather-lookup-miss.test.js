// w20 R3 (gate #41): "whats the weather" answered, then "One part didn't work... (tool openclaw:weather unknown)".
import { describe, expect, it } from "vitest";
import { finalizeReply } from "./reply-sanitize.js";
import { failedTools } from "./tool-failure.js";
const MISS = { canonical: 'tool_call {"id":"openclaw:weather","args":{"days":1,"location":"London"}}', exit: 0,
    stdout: '{"status":"error","tool":"tool_call","error":"Unknown tool id: openclaw:weather. Did you mean: orion_task_run, apply_patch? Use tool_search to find a tool."}' };
const SEARCH = { canonical: 'tool_search {"query":"weather","limit":5}', exit: 0, stdout: '[{"id":"openclaw:orion-control:orion_task_run","name":"orion_task_run"}]' };
const GOOD = { canonical: 'tool_call {"id":"openclaw:orion-control:orion_task_run","args":{"steps":[{"action":"weather_now","days":1,"location":"London"}]}}', exit: 0,
    stdout: '{"ok":true,"executed":true,"summary":"overcast, 10C, high 11C, low 8C, no rain"}' };
describe("a guessed tool id the worker recovered from", () => {
    it("is not a failed part when the real call worked", () => {
        expect(failedTools([MISS, SEARCH, GOOD])).toEqual([]);
        const out = finalizeReply("London is overcast, 10 degrees Celsius now. No rain expected.", [MISS, SEARCH, GOOD], { hostTools: 3 });
        expect(out).not.toMatch(/One part didn't work|couldn't run/);
    });
    it("still counts when nothing worked after it", () => {
        expect(failedTools([MISS])).toHaveLength(1);
    });
    it.each(["openclaw:forecast", "openclaw:weather_now", "weather"])("any guessed id (%s) recovered from", (id) => {
        const miss = { ...MISS, canonical: `tool_call {"id":"${id}"}`, stdout: `{"status":"error","error":"Unknown tool id: ${id}."}` };
        expect(failedTools([miss, GOOD])).toEqual([]);
    });
});
