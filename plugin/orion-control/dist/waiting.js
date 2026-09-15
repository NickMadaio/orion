import os from "node:os";
import path from "node:path";
/*
 PHASE 62 — the things Nick is waiting on, which nothing tracked.

 ## The inverse of what already existed

 `orion-remote` keeps a `pending` map: approvals ORION is waiting on from Nick.
 This is the other direction, and it is the one that actually costs him
 something — a reservation nobody confirmed, a professor who never replied, an
 email that went out three weeks ago. Those fail silently, which is exactly the
 class of thing an assistant is for.

 ## Why an item has to say what would END it

 Every entry carries `expect`: the observable event that resolves it. Not a
 note, an event. "Waiting on the professor" is a feeling; "waiting for a reply
 from prof@x.edu on the thesis extension" is a thing that either happened or
 did not, and only the second can ever be closed by anything but Nick
 remembering to close it.

 That field is also what makes `overdue` mean something. Without it the only
 available notion of overdue is "old", and old is not the same as stuck: a
 thing you asked for last week and expect in a month is not overdue, and a
 thing you asked for yesterday and needed the same day is.

 ## Silence is the default here too

 `overdue()` returns nothing until an item passes its own due date AND has not
 been snoozed past now. `orion-standing` is what surfaces them, and it says
 only what changed. An assistant that reads the whole list back every morning
 gets muted in a week -- that lesson is already written into orion-standing's
 header and this file does not get to relearn it.
*/
export const WAITING_STORE = path.join(os.homedir(), ".openclaw/orion-controlled/waiting.json");
export const EMPTY_STORE = { version: 1, items: [] };
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * How many times one item may be raised before it stops raising itself.
 *
 * A waiting item that is never resolved and never dismissed becomes a daily
 * reminder forever, and a daily reminder forever is one people learn to
 * ignore -- along with the ones that matter. After this it stays in the list
 * and stops speaking, which is a different thing from being deleted.
 */
export const MAX_SURFACES = 5;
export function validateItem(value) {
    const issues = [];
    const item = (value ?? {});
    if (typeof item.id !== "string" || !ID_RE.test(item.id)) {
        issues.push("id must be lower-case letters, digits and hyphens, 2-40 characters");
    }
    if (typeof item.what !== "string" || item.what.trim().length < 3) {
        issues.push("what must say what is being waited for");
    }
    else if (item.what.length > 200) {
        issues.push("what must be under 200 characters");
    }
    if (typeof item.who !== "string" || item.who.trim().length === 0) {
        issues.push("who must name whoever owes it — a person, a company, or 'nobody' for a process");
    }
    if (typeof item.expect !== "string" || item.expect.trim().length < 3) {
        issues.push("expect must name the observable event that ends this — 'a reply from X', " +
            "'a confirmation email', 'the grade posted'. Without one, nothing can ever close it but you remembering to.");
    }
    if (typeof item.dueBy !== "string" || !ISO_DATE.test(item.dueBy)) {
        issues.push("dueBy is required as YYYY-MM-DD — 'overdue' is meaningless without it");
    }
    return issues;
}
/** Local civil date. `toISOString` is UTC and rolls over mid-evening in New York. */
export const civilToday = (now = new Date()) => now.toLocaleDateString("en-CA");
/**
 * What is overdue, quiet, and worth saying out loud right now.
 *
 * Three separate conditions, and they are separate on purpose:
 *
 *   · past its due date          — the item's own promise, not a global age
 *   · not snoozed past now       — "remind me later" has to mean later
 *   · under the surfacing cap    — see MAX_SURFACES
 */
export function overdue(store, now = new Date()) {
    const today = civilToday(now);
    return store.items.filter((item) => {
        if (item.status !== "open")
            return false;
        if (item.dueBy >= today)
            return false;
        if (item.snoozedUntil && Date.parse(item.snoozedUntil) > now.getTime())
            return false;
        return item.surfaced < MAX_SURFACES;
    });
}
/** Open items that are not yet overdue — the honest "what's outstanding" answer. */
export function pending(store, now = new Date()) {
    const today = civilToday(now);
    return store.items.filter((item) => item.status === "open" && item.dueBy >= today);
}
/** Days late, for a sentence a person can act on. */
export const daysLate = (item, now = new Date()) => Math.max(0, Math.round((Date.parse(`${civilToday(now)}T00:00:00`) - Date.parse(`${item.dueBy}T00:00:00`)) / 86_400_000));
/**
 * A follow-up, written and NOT sent.
 *
 * The gate decision this phase needed, made explicitly: drafting is one step
 * from sending, and `messages_send` sits at the APPROVAL floor because a sent
 * message is on somebody else's device in a second with no unsend. So a draft
 * is text stored on the item. Nothing here can deliver it, and turning a draft
 * into a message goes through the ordinary outbound gate with an approval
 * ticket, exactly as if Orion had composed it fresh.
 *
 * Deliberately plain. A follow-up that sounds like it was generated is worse
 * than no follow-up, and the person receiving it is not the one being helped.
 */
export function draftFollowUp(item, now = new Date()) {
    const late = daysLate(item, now);
    const when = late === 0 ? "recently" : late === 1 ? "yesterday" : `${late} days ago`;
    return [
        `Hi ${item.who.split(/[\s@]/)[0] || "there"},`,
        "",
        `Following up on ${item.what}. I was expecting ${item.expect}, which was due ${when}.`,
        "",
        "Is there anything you need from me to move it along?",
        "",
        "Thanks,",
        "Nick",
    ].join("\n");
}
