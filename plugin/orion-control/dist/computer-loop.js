/**
 * Computer use from the local chat route (2026-10-30): observe -> act -> verify on the real screen.
 *
 * Before this, every computer-use turn on the local route got "I can't click buttons / can't see your screen":
 * the 9B's slim prompt never offered the tools, and the catalog's screen_click/type/key need a human-approved
 * exact-args hash per action. This is a code-built flow like the route's others. It claims a turn only when
 * computer-intent.ts reads a computer task in Nick's own words, runs the deterministic recipes in
 * computer-recipes.ts against OrionMacBridge (AX actions first), and replies with what really happened.
 *
 * Authorization: computer-auth.ts (his explicit request is the permission for its reversible steps; irreversible
 * and unnamed stops and asks; his "yes" to that question resumes from that step). Taint: screen text is matched
 * against his words and never adds a step.
 *
 * Wiring (orchestrator): call `maybeRunComputerTask({ message: run.message, sessionKey }, deps)` with
 * `enabled.control` = the `computer_control` tier being on (enableComputerControlActions + external_connected),
 * and use `reply` as the turn's reply when it returns non-null.
 */
import { BridgeFailure } from "./computer-bridge.js";
import { isNo, isYes } from "./computer-auth.js";
import { detectComputerIntent } from "./computer-intent.js";
import { failureReply, plainScreenReply, readScreen, screenPrompt } from "./computer-read.js";
import { StepCap, closeTabs, closeWindow, focusWindow, frontFor, menu, newDoc, openApp, press, readBack, scroll, typeText, } from "./computer-recipes.js";
export const MAX_STEPS = 12;
const PENDING_MS = 5 * 60_000;
const PENDING = new Map();
export function resetComputerPending() { PENDING.clear(); }
const CONTROL_OFF = "I'm not allowed to control the screen yet: screen control is switched off in my settings.";
const OBSERVE_OFF = "I'm not allowed to read the screen yet: screen reading is switched off in my settings.";
function list(items) {
    if (items.length <= 1)
        return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function compose(done, end) {
    if (!end || end.status === "ok")
        return `Done: ${list(done)}.`;
    if (end.status === "ask")
        return done.length ? `I ${list(done)}. ${end.ask}` : end.ask;
    if (end.status === "stopped")
        return `${done.length ? `I ${list(done)}, then ` : "I "}stopped after ${end.max} steps, which is my limit for one request. Tell me to carry on if you want the rest.`;
    return done.length ? `I ${list(done)}, but I ${end.why}.` : `I ${end.why}.`;
}
async function runClause(ctx, intent, index) {
    const clause = intent.clauses[index];
    if (clause.kind === "open")
        return openApp(ctx, clause.app);
    const front = await frontFor(ctx);
    if ("status" in front)
        return front;
    switch (clause.kind) {
        case "new_doc": return newDoc(ctx, clause, front);
        case "type": return typeText(ctx, clause, front);
        case "click": return press(ctx, clause, front, index);
        case "menu": return menu(ctx, clause, front, index);
        case "close_tabs": return closeTabs(ctx, clause, front, index);
        case "close_window": return closeWindow(ctx, clause, front, index);
        case "focus": return focusWindow(ctx, clause, front);
        case "scroll": return scroll(ctx, clause, front);
        case "read_back": return readBack(ctx, front);
    }
}
async function runAct(intent, deps, from, confirmed, sessionKey) {
    const maxSteps = deps.maxSteps ?? MAX_STEPS;
    const ctx = {
        bridge: deps.bridge, words: intent.text, ...(intent.app ? { app: intent.app } : {}), maxSteps,
        sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        progress: (line) => { try {
            deps.progress?.(line);
        }
        catch { /* progress is a courtesy */ } },
        ...(deps.pick ? { pick: deps.pick } : {}),
        confirmed, state: { used: 0, log: [] },
    };
    const done = [];
    const finish = (end) => ({ handled: true, reply: compose(done, end), steps: ctx.state.log });
    for (let i = from; i < intent.clauses.length; i += 1) {
        let outcome;
        try {
            outcome = await runClause(ctx, intent, i);
        }
        catch (error) {
            if (error instanceof StepCap) {
                if (error.partial)
                    done.push(error.partial);
                return finish({ status: "stopped", max: maxSteps });
            }
            if (error instanceof BridgeFailure)
                return { handled: true, reply: (done.length ? `I ${list(done)}, then stopped. ` : "") + failureReply(error, "control"), steps: ctx.state.log };
            throw error;
        }
        if (outcome.status === "ok") {
            done.push(outcome.said);
            continue;
        }
        if (outcome.status === "ask" && outcome.confirmKey && sessionKey) {
            (deps.pending ?? PENDING).set(sessionKey, { intent, clauseIndex: i, confirmKey: outcome.confirmKey, at: deps.now?.() ?? Date.now() });
        }
        return finish(outcome);
    }
    return finish(null);
}
async function runRead(intent, deps) {
    if (!deps.enabled.observe)
        return { handled: true, reply: OBSERVE_OFF, steps: [] };
    try {
        deps.progress?.("looking at your screen");
        const observation = await deps.bridge.observe();
        const data = await readScreen(deps.bridge, observation);
        const steps = [{ n: 1, action: "observe", target: observation.appName, via: "observe", ok: true, verified: true, note: `${data.lines.length} lines via ${data.source}` }];
        if (deps.summarize && data.lines.length > 0) {
            const answer = (await deps.summarize(screenPrompt(intent.question, data)).catch(() => "")).trim();
            if (answer)
                return { handled: true, reply: answer, steps };
        }
        return { handled: true, reply: plainScreenReply(data), steps };
    }
    catch (error) {
        return { handled: true, reply: failureReply(error, "see"), steps: [] };
    }
}
/**
 * The one entry point. Null means "not a computer task": the route carries on as before. `turn.message` must be
 * Nick's own live turn; it is the only text that can authorise anything.
 */
export async function maybeRunComputerTask(turn, deps) {
    const store = deps.pending ?? PENDING;
    const key = turn.sessionKey;
    const pending = key ? store.get(key) : undefined;
    if (key && pending) {
        store.delete(key);
        const fresh = (deps.now?.() ?? Date.now()) - pending.at < PENDING_MS;
        if (fresh && isYes(turn.message)) {
            if (!deps.enabled.control)
                return { handled: true, reply: CONTROL_OFF, steps: [] };
            return runAct(pending.intent, deps, pending.clauseIndex, new Set([pending.confirmKey]), key);
        }
        if (fresh && isNo(turn.message))
            return { handled: true, reply: "Okay, I left it as it is.", steps: [] };
    }
    const intent = detectComputerIntent(turn.message);
    if (!intent)
        return null;
    if (intent.kind === "read")
        return runRead(intent, deps);
    if (!deps.enabled.control)
        return { handled: true, reply: CONTROL_OFF, steps: [] };
    return runAct(intent, deps, 0, new Set(), key);
}
