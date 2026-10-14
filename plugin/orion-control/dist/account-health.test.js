import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alertText, classifyAccountError, registerAccountHealth } from "./account-health.js";
function fakeApi() {
    const handlers = new Map();
    return {
        api: { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
        fire: async (name, event, ctx = {}) => {
            const out = [];
            for (const fn of handlers.get(name) ?? [])
                out.push(await fn(event, ctx));
            return out;
        },
        names: () => [...handlers.keys()],
    };
}
const lines = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
// The exact bodies Anthropic returned on 2026-10-10/11 (from the session transcripts).
const CREDIT = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CftnhxC2wxgGKhig4z29t"}';
const LIMIT = '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."}}';
const BAD_KEY = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
const failed = (errorMessage, provider = "anthropic") => ({
    runId: "r1",
    sessionId: "s1",
    provider,
    model: "claude-sonnet-5",
    assistantTexts: [],
    lastAssistant: { role: "assistant", content: [], provider, stopReason: "error", errorMessage },
});
const succeeded = (provider = "anthropic") => ({
    runId: "r2",
    sessionId: "s1",
    provider,
    model: "m",
    assistantTexts: ["hi"],
    lastAssistant: { role: "assistant", content: [{ type: "text", text: "hi" }], provider, stopReason: "stop" },
});
function setup(options = {}) {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const statePath = join(dir, "account-health.json");
    const outboxPath = join(dir, "alerts-outbox.jsonl");
    const f = fakeApi();
    registerAccountHealth(f.api, { statePath, outboxPath, ...options });
    return { ...f, dir, statePath, outboxPath };
}
describe("classifyAccountError", () => {
    it("recognises an empty credit balance", () => {
        expect(classifyAccountError(CREDIT, "anthropic")).toMatchObject({ provider: "anthropic", kind: "credit" });
    });
    it("recognises a reached usage limit and keeps the date access comes back", () => {
        expect(classifyAccountError(LIMIT, "anthropic")).toMatchObject({ kind: "usage_limit", regainOn: "2026-11-01" });
    });
    it("recognises a rejected API key", () => {
        expect(classifyAccountError(BAD_KEY, "anthropic")).toMatchObject({ kind: "auth" });
        expect(classifyAccountError("401 Invalid API key provided", "openai")).toMatchObject({ kind: "auth", provider: "openai" });
        // the July 2026 body, verbatim
        expect(classifyAccountError('{"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}')).toMatchObject({ kind: "auth" });
    });
    it("does not call an expired login token a dead key: the host refreshes those", () => {
        expect(classifyAccountError('{"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}')).toBeUndefined();
        expect(classifyAccountError('{"type":"error","error":{"type":"authentication_error","message":"invalid bearer"}}')).toBeUndefined();
        expect(classifyAccountError("401 invalid x-api-key (OAuth token has expired)")).toBeUndefined();
    });
    it("leaves transient failures alone: rate limits, overload, timeouts", () => {
        expect(classifyAccountError('{"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}')).toBeUndefined();
        expect(classifyAccountError('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')).toBeUndefined();
        expect(classifyAccountError("request timed out after 60000ms")).toBeUndefined();
        expect(classifyAccountError(undefined)).toBeUndefined();
        expect(classifyAccountError({ not: "text" })).toBeUndefined();
    });
});
describe("alertText", () => {
    it("says what is wrong and exactly where to fix it, within the phone's 240 characters", () => {
        const credit = alertText({ provider: "anthropic", kind: "credit", detail: "" });
        expect(credit).toMatch(/credit/i);
        expect(credit).toContain("console.anthropic.com");
        expect(credit).toContain("Plans & Billing");
        const limit = alertText({ provider: "anthropic", kind: "usage_limit", detail: "", regainOn: "2026-11-01" });
        expect(limit).toContain("Limits");
        expect(limit).toContain("2026-11-01");
        const key = alertText({ provider: "anthropic", kind: "auth", detail: "" });
        expect(key).toContain("API Keys");
        for (const text of [credit, limit, key, alertText({ provider: "openai", kind: "credit", detail: "" })]) {
            expect(text.length).toBeLessThanOrEqual(240);
        }
    });
});
describe("registerAccountHealth — detection and one notification", () => {
    it("tells Nick once through the phone outbox, not on every failing turn", async () => {
        const t = setup({ now: () => Date.parse("2026-10-11T19:23:00Z") });
        await t.fire("llm_output", failed(CREDIT));
        await t.fire("llm_output", failed(CREDIT));
        await t.fire("agent_end", { success: false, error: CREDIT, messages: [] });
        const sent = lines(t.outboxPath);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ id: "account-anthropic-credit", kind: "checkin", level: 1 });
        expect(sent[0].text).toContain("Plans & Billing");
        expect(JSON.parse(readFileSync(t.statePath, "utf8"))).toMatchObject({ active: { provider: "anthropic", kind: "credit" } });
    });
    it("counts agent_end's own error when it names the provider", async () => {
        const t = setup();
        await t.fire("agent_end", { success: false, error: CREDIT, messages: [] });
        expect(lines(t.outboxPath)).toHaveLength(1);
        // an unattributable run error is not pinned on anyone
        const u = setup();
        await u.fire("agent_end", { success: false, error: LIMIT, messages: [] });
        expect(lines(u.outboxPath)).toEqual([]);
    });
    it("never reads old failures out of agent_end's session history (review finding, 2026-10-12)", async () => {
        const t = setup();
        await t.fire("llm_output", failed(CREDIT));
        await t.fire("llm_output", succeeded("anthropic"));
        // the same turn's agent_end: messages are the WHOLE session, yesterday's failures included
        await t.fire("agent_end", { success: true, messages: [failed(CREDIT).lastAssistant, succeeded().lastAssistant] });
        expect(lines(t.outboxPath).map((l) => l.id)).toEqual(["account-anthropic-credit", "account-anthropic-ok"]);
    });
    it("ignores a lastAssistant that belongs to an earlier turn or another provider", async () => {
        const clock = Date.parse("2026-10-12T10:00:00Z");
        const t = setup({ now: () => clock });
        const stale = (e) => ({ ...e, lastAssistant: { ...e.lastAssistant, timestamp: clock - 2 * 86_400_000 } });
        await t.fire("llm_output", stale(failed(CREDIT)));
        expect(lines(t.outboxPath)).toEqual([]);
        await t.fire("llm_output", failed(CREDIT));
        // an attempt that threw before writing anything: lastAssistant is last week's good reply
        await t.fire("llm_output", { ...stale(succeeded()), assistantTexts: [] });
        await t.fire("llm_output", stale(succeeded()));
        // the ollama fallback's event with Claude's old message attached
        await t.fire("llm_output", { ...succeeded("anthropic"), provider: "ollama" });
        expect(lines(t.outboxPath)).toHaveLength(1);
        // and Claude's old failure attached to the fallback's event is not an ollama account problem
        const u = setup({ now: () => clock });
        await u.fire("llm_output", { ...failed(CREDIT), provider: "ollama" });
        expect(lines(u.outboxPath)).toEqual([]);
    });
    it("does not notify again after a gateway restart while the same problem persists", async () => {
        const t = setup();
        await t.fire("llm_output", failed(CREDIT));
        const again = fakeApi();
        registerAccountHealth(again.api, { statePath: t.statePath, outboxPath: t.outboxPath });
        await again.fire("llm_output", failed(CREDIT));
        expect(lines(t.outboxPath)).toHaveLength(1);
    });
    it("notifies again when the problem changes kind (credit bought, then the monthly cap hit)", async () => {
        const t = setup();
        await t.fire("llm_output", failed(CREDIT));
        await t.fire("llm_output", failed(LIMIT));
        expect(lines(t.outboxPath).map((l) => l.id)).toEqual(["account-anthropic-credit", "account-anthropic-usage_limit"]);
    });
    it("does not re-alert while Anthropic alternates between the credit and limit messages", async () => {
        const t = setup();
        for (const body of [CREDIT, LIMIT, CREDIT, LIMIT, CREDIT])
            await t.fire("llm_output", failed(body));
        expect(lines(t.outboxPath)).toHaveLength(2);
    });
    it("treats a failure after a quiet day as news again", async () => {
        let clock = Date.parse("2026-10-11T19:23:00Z");
        const t = setup({ now: () => clock });
        await t.fire("llm_output", failed(CREDIT));
        clock += 25 * 60 * 60_000;
        await t.fire("llm_output", failed(CREDIT));
        expect(lines(t.outboxPath)).toHaveLength(2);
    });
    it("clears on a successful call from the same provider and says so once", async () => {
        const t = setup();
        await t.fire("llm_output", failed(CREDIT));
        await t.fire("llm_output", succeeded("ollama")); // a fallback answering is not recovery
        expect(lines(t.outboxPath)).toHaveLength(1);
        await t.fire("llm_output", succeeded("anthropic"));
        await t.fire("llm_output", succeeded("anthropic"));
        const sent = lines(t.outboxPath);
        expect(sent).toHaveLength(2);
        expect(sent[1].id).toBe("account-anthropic-ok");
        expect(JSON.parse(readFileSync(t.statePath, "utf8")).active).toBeUndefined();
        // and a later failure is a new episode
        await t.fire("llm_output", failed(CREDIT));
        expect(lines(t.outboxPath)).toHaveLength(3);
    });
    it("ignores ordinary failures and successes when nothing is wrong", async () => {
        const t = setup();
        await t.fire("llm_output", failed('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'));
        await t.fire("llm_output", succeeded());
        await t.fire("agent_end", { success: false, error: "run timed out", messages: [] });
        expect(lines(t.outboxPath)).toEqual([]);
        expect(existsSync(t.statePath)).toBe(false);
    });
    it("survives a corrupt state file instead of breaking every turn", async () => {
        const t = setup();
        const { writeFileSync } = await import("node:fs");
        writeFileSync(t.statePath, "{not json");
        await t.fire("llm_output", failed(CREDIT));
        expect(lines(t.outboxPath)).toHaveLength(1);
    });
});
describe("registerAccountHealth — fail fast", () => {
    it("is not registered unless asked for, or when the primary model's provider is unknown", () => {
        expect(setup().names()).not.toContain("before_agent_reply");
        expect(setup({ failFast: true }).names()).not.toContain("before_agent_reply");
    });
    it("answers a real turn at once with the problem and the fix instead of falling back to a slow local model", async () => {
        let clock = Date.parse("2026-10-11T19:23:00Z");
        const t = setup({ failFast: true, primaryProvider: "anthropic", now: () => clock });
        const ctx = { runId: "r9", sessionKey: "agent:main:orion-chat-1" };
        expect(await t.fire("before_agent_reply", { cleanedBody: "hi" }, ctx)).toEqual([undefined]);
        await t.fire("llm_output", failed(CREDIT));
        clock += 60_000;
        const [reply] = (await t.fire("before_agent_reply", { cleanedBody: "what's on today?" }, ctx));
        expect(reply.handled).toBe(true);
        expect(reply.reply.text).toContain("Plans & Billing");
    });
    it("on routes without the reply hook, keeps Claude's attempt whole and gives only the fallbacks a tiny prompt", async () => {
        const t = setup({ failFast: true, primaryProvider: "anthropic" });
        await t.fire("llm_output", failed(CREDIT));
        const ctx = { runId: "r9", sessionKey: "agent:main:orion-chat-1" };
        // Claude's own attempt: full prompt, so a recovered account answers normally
        expect(await t.fire("before_prompt_build", { prompt: "x", messages: [] }, { ...ctx, modelProviderId: "anthropic" })).toEqual([undefined]);
        const [built] = (await t.fire("before_prompt_build", { prompt: "x", messages: [] }, { ...ctx, modelProviderId: "ollama" }));
        expect(built.systemPrompt).toContain("Plans & Billing");
        expect(built.systemPrompt.length).toBeLessThan(1000);
    });
    it("leaves cron, heartbeat and eval runs alone", async () => {
        const t = setup({ failFast: true, primaryProvider: "anthropic" });
        await t.fire("llm_output", failed(CREDIT));
        expect(await t.fire("before_agent_reply", { cleanedBody: "x" }, { sessionKey: "agent:main:cron:morning" })).toEqual([undefined]);
        expect(await t.fire("before_prompt_build", { prompt: "x" }, { sessionKey: "agent:main:heartbeat", modelProviderId: "ollama" })).toEqual([undefined]);
    });
    it("lets one real turn through after the recheck window so recovery is noticed", async () => {
        let clock = Date.parse("2026-10-11T19:23:00Z");
        const t = setup({ failFast: true, primaryProvider: "anthropic", recheckMs: 10 * 60_000, now: () => clock });
        await t.fire("llm_output", failed(CREDIT));
        clock += 11 * 60_000;
        expect(await t.fire("before_agent_reply", { cleanedBody: "hi" }, { sessionKey: "agent:main:orion-chat-1" })).toEqual([undefined]);
    });
    it("does not fail fast when the turn's model is on a different provider", async () => {
        const t = setup({ failFast: true, primaryProvider: "ollama" });
        await t.fire("llm_output", failed(CREDIT));
        expect(await t.fire("before_agent_reply", { cleanedBody: "hi" }, { sessionKey: "agent:main:orion-chat-1" })).toEqual([undefined]);
    });
});
