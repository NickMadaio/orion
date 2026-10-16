const NONE_CLAIM = /\b(no one|nobody|no[- ]one|none of your contacts)\s+(has\s+|have\s+)?(texted|messaged|emailed|written|sent)\b|\bno\s+(new\s+|recent\s+|unread\s+)+(texts?|messages?|emails?)\b|\bnothing new\b|\b(haven'?t|have not) (got|gotten|received) any\b/i;
// The reply itself reports messages: "your last messages were from Gia", "Gia texted at 9".
const REPORTS_SOME = /\b(last|latest|most recent|recent|newest) (messages?|texts?|emails?)\b[^.]*\b(from|were|was)\b|\b(texted|messaged|emailed) you (at|about|on)\b|\bmost recent being\b/i;
// A line of the messages read: "2026-10-16 14:02  Gia: running late" (scripts/orion-messages render()), or with a weekday.
const MESSAGE_LINE = /\d{1,2}:\d{2}\s+[^\n:]{1,40}:\s+\S/;
const ROW = /^\s*(?:(\d{4}-\d{2}-\d{2})|(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*)?\s*(\d{1,2}):(\d{2})\s+([^\n:]{1,40}):\s+\S/gm;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A denial limited to new, unread, today, tonight, this morning or "since …" is right beside older messages
// ("No new texts. Your last text was from Gia at 9:02 last night."); review, 2026-10-16.
const SCOPED = /\b(new|unread|today|tonight|this (morning|afternoon|evening)|since|yet)\b/i;
const SINCE_TIME = /\bsince\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
/** Incoming message lines inside the denial's scope: from today, and after a "since 3pm" time. A scoped denial
 *  is wrong only when one of these exists (review, 2026-10-16: "No one has texted you today" beside today's text). */
function rowsInScope(results, denial, now) {
    const today = now.toLocaleDateString("en-CA");
    const since = denial.match(SINCE_TIME);
    const from = since && (since[3] || since[2]) ? ((Number(since[1]) % 12) + (/pm/i.test(since[3] ?? "") ? 12 : 0)) * 60 + Number(since[2] ?? 0) : 0;
    let n = 0;
    for (const r of results) {
        for (const m of String(r.stdout).matchAll(ROW)) {
            if (/^me$/i.test((m[5] ?? "").trim()))
                continue;
            const isToday = m[1] ? m[1] === today : m[2] ? m[2] === WEEKDAYS[now.getDay()] : true;
            if (isToday && Number(m[3]) * 60 + Number(m[4]) >= from)
                n += 1;
        }
    }
    return n;
}
/** True when the reply denies messages yet reports some, or the messages read this turn returned some. */
export function denialContradictsMessages(reply, turnResults, now = new Date()) {
    const text = String(reply ?? "").replace(/[’‘]/g, "'");
    const denial = text.split(/(?<=[.!?;])\s+|\s[—–]\s/).find((c) => NONE_CLAIM.test(c));
    if (!denial)
        return false;
    if (SCOPED.test(denial))
        return rowsInScope(turnResults, denial, now) > 0;
    if (REPORTS_SOME.test(text))
        return true;
    return turnResults.some((r) => MESSAGE_LINE.test(String(r.stdout)) && !/No messages matched/.test(String(r.stdout)));
}
