import { describe, expect, it } from "vitest";
import { guardToolCall, hasShellOperator, ToolBudget, TOOL_BUDGET } from "./tool-guards.js";
const SCRIPTS = "/Users/nickmadaio/Desktop/ORION/scripts";
const names = ["orion-agenda", "orion-agenda-change", "orion-brain", "orion-reschedule", "orion-recall", "orion-session"];
const deps = { scriptNames: () => names };
const exec = (command) => guardToolCall("exec", { command }, deps);
describe("hasShellOperator is quote-aware", () => {
    it("allows & inside quotes (the real 'Design & Implementation' title)", () => {
        expect(hasShellOperator(`orion-x add "Design & Implementation" 60`)).toBe(false);
        expect(hasShellOperator(`orion-x add 'a | b ; c > d' 60`)).toBe(false);
    });
    it("still blocks real operators outside quotes", () => {
        for (const c of ["a && b", "a & b", "a; b", "a | b", "a > f", "a < f", "a `b`", "a $(b)", "a \; b", "a\nb", "a\r\nb"]) {
            expect(hasShellOperator(c), c).toBe(true);
        }
    });
    it("blocks command substitution inside double quotes but not single", () => {
        expect(hasShellOperator(`echo "$(rm -rf x)"`)).toBe(true);
        expect(hasShellOperator('echo "`id`"')).toBe(true);
        expect(hasShellOperator(`echo '$(id)'`)).toBe(false);
    });
    it("blocks a quote that closes and reopens around an operator", () => {
        expect(hasShellOperator(`echo "a" ; "b"`)).toBe(true);
        expect(hasShellOperator(`echo 'a'&'b'`)).toBe(true);
        expect(hasShellOperator(`echo "a"&&"b"`)).toBe(true);
    });
    it("treats an escaped quote as literal, so the quote stays open", () => {
        expect(hasShellOperator(`echo "a \\" ; b"`)).toBe(false); // ; is inside the still-open string
        expect(hasShellOperator(`echo "a \\" ; b`)).toBe(true); // never closes: refuse
        expect(hasShellOperator(`echo \\" ; "`)).toBe(true); // escaped quote outside, ; is live
    });
    it("blocks an unterminated quote", () => {
        expect(hasShellOperator(`echo "abc`)).toBe(true);
        expect(hasShellOperator(`echo 'abc`)).toBe(true);
    });
});
describe("bare orion-* exec is rewritten to the absolute path", () => {
    it("orion-agenda tomorrow", () => {
        expect(exec("orion-agenda tomorrow")).toEqual({ params: { command: `${SCRIPTS}/orion-agenda tomorrow` } });
    });
    it("orion-brain search with a quoted argument keeps it verbatim", () => {
        expect(exec(`orion-brain search "x & y"`)).toEqual({ params: { command: `${SCRIPTS}/orion-brain search "x & y"` } });
    });
    it("keeps other params and the key that carried the command", () => {
        expect(guardToolCall("exec", { cmd: "orion-recall foo", timeout: 5 }, deps)).toEqual({ params: { cmd: `${SCRIPTS}/orion-recall foo`, timeout: 5 } });
    });
    it("does not rewrite when the rest has a real operator", () => {
        const r = exec("orion-brain search x; rm -rf ~");
        expect(r.block).toBe(true);
    });
    it("blocks an unknown name and lists close real names", () => {
        const r = exec("orion-agend today");
        expect(r.block).toBe(true);
        expect(r.blockReason).toContain("orion-agenda");
    });
    it("never lets a name escape the scripts folder", () => {
        expect(exec("orion-../../etc/passwd")).toBeUndefined();
    });
    it("leaves absolute paths and other programs alone", () => {
        expect(exec(`${SCRIPTS}/orion-agenda today`)).toBeUndefined();
        expect(exec("ls /tmp")).toBeUndefined();
    });
});
describe("orion-reschedule by bare name", () => {
    it("clear is blocked with 'describe it in words' (the schedule flow owns changes)", () => {
        const r = exec("orion-reschedule clear");
        expect(r.block).toBe(true);
        expect(r.blockReason).toMatch(/in words/i);
    });
    it("show is a read and is rewritten", () => {
        expect(exec("orion-reschedule show --json")).toEqual({ params: { command: `${SCRIPTS}/orion-reschedule show --json` } });
    });
});
describe("orion-agenda wrapper misuse", () => {
    const abs = `${SCRIPTS}/orion-agenda`;
    it("events -> day today", () => {
        expect(exec(`${abs} events`)).toEqual({ params: { command: `${abs} day today` } });
    });
    it("--date X and day --date X -> day X", () => {
        expect(exec(`${abs} --date 2026-10-17`)).toEqual({ params: { command: `${abs} day 2026-10-17` } });
        expect(exec(`${abs} day --date friday`)).toEqual({ params: { command: `${abs} day friday` } });
    });
    it("--help is blocked with usage", () => {
        const r = exec(`${abs} --help`);
        expect(r.blockReason).toContain("day <when>");
    });
    it("valid calls are untouched", () => {
        expect(exec(`${abs} tasks`)).toBeUndefined();
        expect(exec(`${abs} day tomorrow`)).toBeUndefined();
    });
    it("odd arguments are not rewritten", () => {
        expect(exec(`${abs} --date "x y"`)).toBeUndefined();
    });
});
describe("orion-agenda fixes (review 5 LOW)", () => {
    it("--date=friday and ~/ paths are repaired", () => {
        const a = guardToolCall("exec", { command: "orion-agenda day --date=friday" }, deps);
        expect(a.params.command).toBe(`${SCRIPTS}/orion-agenda day friday`);
        const b = guardToolCall("exec", { command: "~/Desktop/ORION/scripts/orion-agenda --date=2026-10-17" }, deps);
        expect(b.params.command).toBe(`${SCRIPTS}/orion-agenda day 2026-10-17`);
    });
});
describe("invented ids through tool_call", () => {
    const TASK = "openclaw:orion-control:orion_task_run";
    it("a catalog action becomes an orion_task_run step, parsing string args", () => {
        const r = guardToolCall("tool_call", { id: "calendar_event_add", args: '{"title":"A & B","start":"2026-10-17T09:00"}' }, deps);
        expect(r.params.id).toBe(TASK);
        expect(r.params.args).toEqual({ steps: [{ action: "calendar_event_add", title: "A & B", start: "2026-10-17T09:00" }] });
    });
    it("object args and no args work", () => {
        const a = guardToolCall("tool_call", { id: "media_play_pause" }, deps);
        expect(a.params.args).toEqual({ steps: [{ action: "media_play_pause" }] });
        const b = guardToolCall("tool_call", { id: "media_play_pause", args: { x: 1 } }, deps);
        expect(b.params.args.steps[0]).toEqual({ action: "media_play_pause", x: 1 });
    });
    it("unparseable string args on a catalog action are blocked", () => {
        const r = guardToolCall("tool_call", { id: "calendar_event_add", args: "not json" }, deps);
        expect(r.block).toBe(true);
    });
    it("a bare orion-* id points to exec with the path", () => {
        const r = guardToolCall("tool_call", { id: "orion-agenda", args: {} }, deps);
        expect(r.block).toBe(true);
        expect(r.blockReason).toContain(`exec: ${SCRIPTS}/orion-agenda`);
    });
    // review 5 M2 (2026-10-16): only orion-* and catalog-shaped ids are rewritten or blocked; the host resolves the rest.
    it("host and MCP ids pass through; the host's own 'Unknown tool id' handles truly unknown ones", () => {
        for (const id of ["brain__search_notes", "brain__read_note", "code_execution", "x_search", "heartbeat_respond", "music_generate", "video_generate", "make_coffee", "mcp:bundle-mcp:brain__read_note"]) {
            expect(guardToolCall("tool_call", { id, args: {} }, deps), id).toBeUndefined();
        }
    });
    it("real ids are untouched; a JSON-string args on a real id is parsed", () => {
        expect(guardToolCall("tool_call", { id: TASK, args: { steps: [] } }, deps)).toBeUndefined();
        const r = guardToolCall("tool_call", { id: TASK, args: '{"steps":[{"action":"system_status"}]}' }, deps);
        expect(r.params.args).toEqual({ steps: [{ action: "system_status" }] });
        expect(guardToolCall("tool_call", { id: "orion_task_run", args: {} }, deps)).toBeUndefined();
        expect(guardToolCall("tool_call", { id: "web_fetch", args: {} }, deps)).toBeUndefined();
    });
    it("other tools are untouched", () => {
        expect(guardToolCall("read", { path: "/x" }, deps)).toBeUndefined();
    });
});
describe("hasShellOperator: bash $'…' quoting (review 5 M1)", () => {
    it("refuses $' and $\" outside quotes, including the review's injection", () => {
        expect(hasShellOperator(`orion-agenda $'\\'' ; ${SCRIPTS}/orion-notify hi ; ls '\\'`)).toBe(true);
        expect(hasShellOperator(`orion-agenda $'x'`)).toBe(true);
        expect(hasShellOperator(`orion-agenda $"x"`)).toBe(true);
        expect(hasShellOperator(`orion-agenda "cost $5" 'a$'`)).toBe(false);
    });
});
describe("ToolBudget", () => {
    it("allows TOOL_BUDGET calls then blocks, per run, and cleans up", () => {
        const b = new ToolBudget();
        for (let i = 0; i < TOOL_BUDGET; i++)
            expect(b.take("r1", `c${i}`)).toBeUndefined();
        const over = b.take("r1", "cX");
        expect(over?.block).toBe(true);
        expect(over?.blockReason).toContain("Tool budget reached");
        expect(b.take("r2", "c0")).toBeUndefined();
        b.end("r1");
        expect(b.take("r1", "again")).toBeUndefined();
    });
    it("does not count the same tool call id twice", () => {
        const b = new ToolBudget();
        for (let i = 0; i < TOOL_BUDGET * 2; i++)
            expect(b.take("r", "same")).toBeUndefined();
    });
    it("review 5 M3: a wrapped inner call (tool_search_code:…) is not charged", () => {
        const b = new ToolBudget();
        for (let i = 0; i < TOOL_BUDGET * 3; i++)
            expect(b.take("r", `tool_search_code:${i}`)).toBeUndefined();
        for (let i = 0; i < TOOL_BUDGET; i++)
            expect(b.take("r", `w${i}`)).toBeUndefined();
        expect(b.take("r", "over")?.block).toBe(true);
    });
    it("evicts old runs", () => {
        const b = new ToolBudget();
        for (let i = 0; i < 100; i++)
            b.take(`r${i}`, "c");
        expect(b.size()).toBeLessThanOrEqual(64);
    });
});
