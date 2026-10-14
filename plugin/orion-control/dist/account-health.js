/*
 Account health: notice when a model provider's ACCOUNT is unusable, tell Nick once, and
 (optionally) stop pretending otherwise.

 On 2026-10-11 ~19:23 BST the Anthropic API began answering every call with HTTP 400
 invalid_request_error: "Your credit balance is too low…", then "You have reached your
 specified API usage limits. You will regain access on 2026-11-01". The gateway treated that
 like any failed call and fell back to ollama/qwen3.5:9b and llama3.2:3b with the full ~17k-token
 workspace prompt, which took 60-300 s and timed out. Nothing told Nick the account was the
 problem; it looked like ORION had become slow and broken.

 Detection: `llm_output` fires once per model attempt with the session's last assistant message,
 whose `errorMessage` carries the provider's error body; `agent_end` carries the run's error.
 Both events also carry OLD material — `lastAssistant` can be a previous turn's message and
 `agent_end.messages` is the whole session — so only a fresh message from the attempt's own
 provider counts, and the history is never scanned. Only errors that mean the ACCOUNT is
 unusable count (credit, usage cap, rejected API key); rate limits, overload, timeouts and
 expired login tokens are transient and ignored.

 Notification: one line in ~/.openclaw/orion-controlled/alerts-outbox.jsonl, which the Mac app's
 LinkEngine sends to his phone. One episode per provider: each kind (credit, limit, key) is
 alerted at most once in it, remembered across gateway restarts in account-health.json, plus one
 line when that provider answers again. An episode with no failure for 24 h has expired.

 Fail fast (`accountFailFast`, opt-in, only when the configured primary model is on the broken
 provider): while the problem is fresh (`recheckMs`), a real turn is answered at once with the
 problem and the fix (before_agent_reply). On routes where that hook does not fire, the primary
 attempt still runs with the full prompt — so a recovered account answers normally — and only the
 FALLBACK attempts get a tiny prompt telling Nick what is wrong (before_prompt_build), instead of
 the 17k-token workspace prompt that took 60-300 s on the local models.
 (Written by Claude on 2026-10-12.)
*/
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
const DEFAULT_RECHECK_MS = 10 * 60_000;
/** An episode with no failure for this long has expired: the next failure is news again. */
const EPISODE_TTL_MS = 24 * 60 * 60_000;
/** A message older than this is from an earlier turn, not this attempt. */
const FRESH_MS = 10 * 60_000;
const PHONE_LIMIT = 240;
const PATTERNS = [
    { kind: "credit", re: /credit balance is too low|insufficient (?:credits?|balance|funds)|purchase credits/i },
    { kind: "usage_limit", re: /(?:reached|exceeded) your (?:specified )?(?:api )?usage limits?/i },
    { kind: "auth", re: /invalid x-api-key|invalid api key|api key (?:is )?(?:invalid|revoked|disabled)/i },
];
// A login (OAuth) token that expired is refreshed by the host; it is not a dead account.
const TRANSIENT_AUTH = /oauth|token (?:has )?expired|refresh token/i;
function text(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function record(value) {
    return value !== null && typeof value === "object" ? value : undefined;
}
/** The provider's own message from a JSON error body, or the raw text. */
function errorDetail(raw) {
    try {
        const message = record(record(JSON.parse(raw))?.error)?.message;
        if (typeof message === "string")
            return message;
    }
    catch {
        // not JSON; the raw text is the detail
    }
    return raw.slice(0, 300);
}
export function classifyAccountError(value, provider = "unknown") {
    const raw = text(value);
    if (!raw)
        return undefined;
    const match = PATTERNS.find((p) => p.re.test(raw));
    if (!match || (match.kind === "auth" && TRANSIENT_AUTH.test(raw)))
        return undefined;
    const regainOn = /regain access on (\d{4}-\d{2}-\d{2})/i.exec(raw)?.[1];
    // agent_end carries no provider; Anthropic's own bodies name it ("…the Anthropic API").
    const named = provider === "unknown" && /anthropic/i.test(raw) ? "anthropic" : provider;
    return { provider: named, kind: match.kind, detail: errorDetail(raw), ...(regainOn ? { regainOn } : {}) };
}
const ANTHROPIC_FIX = {
    credit: () => "ORION can't use Claude: the Anthropic account is out of credit, so replies fall back to slow local models. Fix: console.anthropic.com → Plans & Billing → buy credits.",
    usage_limit: (p) => `ORION can't use Claude: the Anthropic account hit its monthly usage limit${p.regainOn ? ` (back ${p.regainOn})` : ""}. Fix: console.anthropic.com → Limits → raise the monthly cap; check Plans & Billing has credit.`,
    auth: () => "ORION can't use Claude: the Anthropic API key was rejected. Fix: console.anthropic.com → API Keys → make a new key and give it to ORION.",
};
const GENERIC_PROBLEM = {
    credit: "is out of credit",
    usage_limit: "hit its usage limit",
    auth: "rejected the API key",
};
export function alertText(problem) {
    const message = problem.provider === "anthropic"
        ? ANTHROPIC_FIX[problem.kind](problem)
        : `ORION can't use ${problem.provider}: the account ${GENERIC_PROBLEM[problem.kind]}${problem.regainOn ? ` (back ${problem.regainOn})` : ""}. Fix it in that provider's console; until then replies fall back to slow local models.`;
    return message.slice(0, PHONE_LIMIT);
}
function recoveredText(provider) {
    const name = provider === "anthropic" ? "Claude" : provider;
    return `${name} is answering again — ORION is back on its normal model.`;
}
/** llm_output: only the attempt's own, fresh message counts — `lastAssistant` may be an older turn's. */
function inspectAttempt(event, now) {
    const last = record(event.lastAssistant);
    const provider = text(event.provider) ?? text(last?.provider);
    if (!last || !provider)
        return {};
    if (text(last.provider) && last.provider !== provider)
        return {};
    if (typeof last.timestamp === "number" && now - last.timestamp > FRESH_MS)
        return {};
    const problem = classifyAccountError(last.errorMessage, provider);
    if (problem)
        return { problem };
    const answered = Array.isArray(event.assistantTexts) && event.assistantTexts.some((t) => text(t));
    return answered && last.stopReason !== "error" && !text(last.errorMessage) ? { okProvider: provider } : {};
}
/** agent_end: the run's own error only. Its `messages` are the whole session, old failures included. */
function inspectRun(event) {
    const problem = classifyAccountError(event.error);
    return problem && problem.provider !== "unknown" ? { problem } : {};
}
function readState(path) {
    try {
        const parsed = record(JSON.parse(readFileSync(path, "utf8")));
        return parsed ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeState(path, state) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
}
function sendToPhone(outboxPath, id, message, at) {
    mkdirSync(dirname(outboxPath), { recursive: true });
    appendFileSync(outboxPath, `${JSON.stringify({ id, at, kind: "checkin", level: 1, text: message })}\n`);
}
export function registerAccountHealth(api, options) {
    const now = options.now ?? Date.now;
    const recheckMs = options.recheckMs ?? DEFAULT_RECHECK_MS;
    const warn = (message) => api.logger?.warn?.(`[orion-control] ${message}`);
    // Read on every hook: the agent CLI can run this plugin in its own process, and a recovery
    // or failure it records must reach the gateway's next turn. The file is a few hundred bytes.
    const activeProblem = () => {
        const state = readState(options.statePath);
        const active = state.active;
        const live = active && Array.isArray(active.alerted) && now() - Date.parse(active.lastSeen) < EPISODE_TTL_MS;
        return { state, ...(live ? { active } : {}) };
    };
    const save = (next) => {
        try {
            writeState(options.statePath, next);
        }
        catch (error) {
            warn(`account health state not saved: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const notify = (id, message, at) => {
        try {
            sendToPhone(options.outboxPath, id, message, at);
        }
        catch (error) {
            warn(`account alert not queued: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const observe = ({ problem, okProvider }) => {
        if (!problem && !okProvider)
            return;
        const at = new Date(now()).toISOString();
        const { state, active } = activeProblem();
        if (problem) {
            const ongoing = active?.provider === problem.provider ? active : undefined;
            const news = !ongoing?.alerted.includes(problem.kind);
            const alerted = news ? [...(ongoing?.alerted ?? []), problem.kind] : (ongoing?.alerted ?? []);
            save({ ...state, active: { ...problem, since: ongoing?.since ?? at, lastSeen: at, alerted } });
            if (news) {
                warn(`model account unusable (${problem.provider}, ${problem.kind}): ${problem.detail}`);
                notify(`account-${problem.provider}-${problem.kind}`, alertText(problem), at);
            }
            return;
        }
        if (active && okProvider === active.provider) {
            save({ clearedAt: at });
            notify(`account-${active.provider}-ok`, recoveredText(active.provider), at);
        }
    };
    api.on("llm_output", (event) => observe(inspectAttempt(event, now())));
    api.on("agent_end", (event) => observe(inspectRun(event)));
    if (!options.failFast || !options.primaryProvider)
        return;
    const primary = options.primaryProvider;
    const onPrimary = (ctx) => {
        const { active } = activeProblem();
        if (!active || active.provider !== primary)
            return undefined;
        if (INTERNAL.test(String(ctx.sessionKey ?? "")) || INTERNAL.test(String(ctx.trigger ?? "")))
            return undefined;
        return active;
    };
    api.on("before_agent_reply", (_event, ctx) => {
        const active = onPrimary(ctx);
        if (!active || now() - Date.parse(active.lastSeen) >= recheckMs)
            return undefined;
        return { handled: true, reply: { text: alertText(active) }, reason: "model account unusable" };
    });
    api.on("before_prompt_build", (_event, ctx) => {
        const active = onPrimary(ctx);
        const attempt = text(ctx.modelProviderId);
        if (!active || !attempt || attempt === active.provider)
            return undefined;
        return { systemPrompt: `Reply to Nick with exactly the text below and nothing else. Do not call any tool.\n\n${alertText(active)}` };
    });
}
