const HELD = /"status"\s*:\s*"needs_approval"|NO MESSAGE WAS SENT/;
const DONE = /"executed"\s*:\s*true|DONE — this really happened/;
function stepsOf(canonical) {
    const at = canonical.indexOf("{");
    if (at < 0)
        return [];
    try {
        const p = JSON.parse(canonical.slice(at));
        const inner = p.args ?? p;
        return inner.steps ?? inner.graph?.steps ?? [];
    }
    catch {
        return [];
    }
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
    const held = [...tools].reverse().find((t) => HELD.test(t.stdout) && !DONE.test(t.stdout));
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
