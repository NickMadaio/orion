const TASK_RUN = /(?:^|:)orion_task_run$/;
function callOf(canonical) {
    const at = canonical.indexOf("{");
    if (at < 0)
        return undefined;
    try {
        return JSON.parse(canonical.slice(at));
    }
    catch {
        return undefined;
    }
}
/** An orion_task_run call: named so as the tool, or so in a tool_call's id. Never any other tool whose output mentions it. */
function isTaskRun(canonical) {
    const head = canonical.trim().split(/[\s{]/, 1)[0] ?? "";
    if (TASK_RUN.test(head))
        return true;
    const c = callOf(canonical);
    return [c?.id, c?.name].some((v) => typeof v === "string" && TASK_RUN.test(v));
}
/** Wave 4 review finding 4: held only by a structured "status": "needs_approval" in the run's JSON result, never by its wording. */
function heldResult(stdout) {
    const text = stdout.trim();
    const body = text.startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let o;
    try {
        o = JSON.parse(body);
    }
    catch {
        return false;
    }
    if (!o || typeof o !== "object")
        return false;
    const layers = [o, o.result, o.details].filter((x) => !!x && typeof x === "object");
    return layers.some((l) => l.status === "needs_approval") && !layers.some((l) => l.executed === true);
}
function stepsOf(canonical) {
    const p = callOf(canonical);
    const inner = p?.args ?? p;
    return inner?.steps ?? inner?.graph?.steps ?? [];
}
const field = (s, ...keys) => {
    for (const k of keys) {
        const v = s.arguments?.[k] ?? s[k];
        if (typeof v === "string" && v.trim())
            return v.trim();
    }
    return undefined;
};
const name = (s) => (/^[a-z][a-z' -]*$/.test(s) ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
/** The reply for a task run held for approval this turn (the draft and a question), or undefined. */
export function approvalAsk(tools) {
    const held = [...tools].reverse().find((t) => isTaskRun(t.canonical) && heldResult(t.stdout));
    if (!held)
        return undefined;
    const send = stepsOf(held.canonical).find((s) => s.action === "messages_send");
    if (!send)
        return "I haven't done that yet: it needs your OK first. Want me to go ahead?";
    const who = field(send, "recipient", "to");
    const body = field(send, "body", "text");
    if (!body)
        return `I haven't sent anything${who ? ` to ${name(who)}` : ""} yet. What should it say?`;
    return `Here's the draft${who ? ` to ${name(who)}` : ""}: "${body}". I haven't sent it. Want me to send it?`;
}
