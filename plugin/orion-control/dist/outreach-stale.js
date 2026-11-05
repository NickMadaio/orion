const MIN_MS = 60_000;
/** True once ORION has replied in this chat after the outreach was sent. The label's minutes are truncated, so the earliest send time is used. */
export function outreachStale(o, lastReplyAt, nowMs) {
    if (lastReplyAt === undefined)
        return false;
    if (o.kind === "question" && o.askId)
        return false; // an ask he is answering across several messages keeps its binding
    return lastReplyAt > nowMs - (o.minutes + 1) * MIN_MS;
}
/** The line the worker gets in place of "his message answers that": the old outreach is not part of this turn. */
export const staleOutreachNote = (o) => `[Context: earlier you messaged him "${o.text.slice(0, 200)}". He has not engaged with it and it is old. Do not repeat it, quote it, or act on it. Answer only his message below, against what you last said to him in this chat.]`;
const NAG_SHAPES = [
    /you'?ve been avoiding [^.]{1,60}? for \d+ min\.(?: no\.)?(?: that'?s an hour\.)?(?: get up\.)?(?: we'?re doing it now\.)?/gi,
    /it'?s been \d+ min\. [^.]{1,60}?, now\.(?: phone down[^.]*\.)?/gi,
    /time to start: [^.]{1,60}\./gi,
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A reply with any outreach text it echoes cut out (the exact lines, and the ladder's own shapes), whitespace tidied. */
export function stripOutreachEcho(reply, texts) {
    let out = reply;
    for (const t of texts)
        if (t.trim().length >= 12)
            out = out.replace(new RegExp(escape(t.trim()), "gi"), " ");
    if (texts.some((t) => NAG_SHAPES.some((re) => { re.lastIndex = 0; return re.test(t); })))
        for (const re of NAG_SHAPES)
            out = out.replace(re, " ");
    return out.replace(/\s+/g, " ").trim();
}
