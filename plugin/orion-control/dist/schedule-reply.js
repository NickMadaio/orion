/*
 What Nick hears after a scheduler run, built only from the scheduler's own lines (moved out of schedule-flow.ts, 2026-10-20).
 A run headed "NOTHING WAS CHANGED/BOOKED" wrote nothing: the plan it lists is never said as done.
*/
const ampm = (t) => { const [h, m] = t.split(":").map(Number); const hh = ((h ?? 0) + 11) % 12 + 1; return `${hh}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
export const FAILED = /NOT BOOKED|NOTHING WAS|did not fit|usage:|not a real block|is in the past|no block called|Error/i;
/** One scheduler failure line → one short spoken clause. The raw line was spoken word for word (sweep
 *  2026-10-16): usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added". */
export function spokenFailure(line) {
    const l = line.trim().replace(/^orion-reschedule:\s*/, "")
        .replace(/^(?:MUST-HAVE )?(?:NOTHING WAS|NOT) (?:CHANGED|BOOKED|DROPPED)\b(?: on \w+day)?(?: \(\d{4}-\d{2}-\d{2}\))?[:.]?\s*/i, "")
        // Notes to the operator, and lists of his whole day, are not for Nick.
        .replace(/(?:[.;]\s+|\s+—\s+|^)(?:Tell him|Do not|Don't|If he|ask whether|Run |Use |To set|See the header|Options:|Blocks today|Fixed today|Movable blocks|Classes today|Never |swap only|skip is only)[\s\S]*$/i, "")
        .replace(/ \((?:\w+day )?\d{4}-\d{2}-\d{2}\)/g, "").trim();
    if (/^usage:|^Error\b|has no .* option|one command per call|does not take/i.test(l))
        return "I couldn't make that change";
    if (!l)
        return "nothing could be booked";
    const rules = [
        [/^(.+?) (is|are) already over today/i, (_, what, verb) => `${what} ${verb === "is" ? "has" : "have"} already ended today`],
        [/^no block called "?(.+?)"? on /i, (_, what) => `there's no block called ${what}`],
        [/^no class or fixed plan called "?(.+?)"? left/i, (_, what) => `there's no class called ${what} left today`],
        [/^no "(.+?)" on .* to put it after/i, (_, what) => `there's no ${what} to put it after`],
        [/^"?(.+?)"? is one of his own calendar events/i, (_, what) => `${what} is a class or a plan with people, so it doesn't move`],
        [/^(.+?) \(\d+ min\) (?:no longer fits|did not fit)/i, (_, what) => `${what} didn't fit`],
        [/^must-haves could not fit: (.+?)\.?$/i, (_, what) => `${what} didn't fit`],
        [/^no movable block matches/i, () => "there's no movable block by that name"],
        [/^(.+?) is on \d{4}-\d{2}-\d{2}/i, (_, what) => `${what} is on another day`],
        [/is in the past/i, () => "that day is already over"],
    ];
    const hit = rules.map(([re, say]) => { const m = l.match(re); return m ? say(...m) : null; }).find((t) => t !== null);
    const said = hit ?? l;
    return said.replace(/\b(\d{2}:\d{2})\b/g, (t) => ampm(t)).replace(/\.$/, "");
}
/** What to tell Nick, from the scheduler's own output only. */
export function summarize(outputs, said) {
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
    const changes = lines.filter((l) => /moved|planned|added|cleared|is now|skipped|resized|extended|swapped|separated|booked|logged/i.test(l) && !FAILED.test(l) && !/^Changed|^Would change|^Written/.test(l));
    const failed = lines.filter((l) => FAILED.test(l));
    const parts = [];
    if (changes.length)
        parts.push(changes.slice(0, 4).join("; "));
    if (failed.length)
        parts.push(`Not done: ${spokenFailure(failed[0])}`);
    parts.push(...said.filter(Boolean));
    return { reply: parts.join(". ").replace(/^(Not done: .*[^.])$/, "$1.") || "Nothing changed.", changed: changes.length > 0 };
}
/** A scheduler run that says it wrote nothing (its first line is "NOTHING WAS CHANGED/BOOKED"). */
export const nothingWritten = (out) => /^\s*(?:MUST-HAVE )?NOTHING WAS (?:CHANGED|BOOKED)\b/.test(out);
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export function spokenReply(outputs, when) {
    // The plan a refused run lists is not what happened: only its failure lines are read.
    const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()).filter((l) => !nothingWritten(o) || FAILED.test(l)));
    const said = [];
    const cut = [];
    const followed = [];
    let logged = "";
    for (const l of lines) {
        // The block he was in, cut short for a time he stated; the blocks that slid after a change.
        let c = l.match(/^(.+?) now ends at (\d{2}:\d{2})$/);
        if (c) {
            cut.push(`${c[1]} ends at ${ampm(c[2])}`);
            continue;
        }
        c = l.match(/^moved (.+?): \d{2}:\d{2} → (\d{2}:\d{2})$/);
        if (c) {
            followed.push(`${c[1]} now ${ampm(c[2])}`);
            continue;
        }
        let m = l.match(/^planned (.+?): (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} ${ampm(m[2])}–${ampm(m[3])}`);
            continue;
        }
        m = l.match(/^(.+?) moved: \d{2}:\d{2} → (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} now ${ampm(m[2])}–${ampm(m[3])}`);
            continue;
        }
        m = l.match(/^(.+?) is now (\d+) min: (\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (m) {
            said.push(`${m[1]} is now ${m[2]} minutes, ${ampm(m[3])}–${ampm(m[4])}`);
            continue;
        }
        m = l.match(/^cleared \d+ prior schedule blocks?: (.+)$/i) ?? l.match(/^removed (.+)$/i);
        if (m) {
            said.push(`cleared ${m[1]}`);
            continue;
        }
        if (/^Logged .+/.test(l)) {
            logged = l;
            continue;
        }
        m = l.match(/^(?:Undone: )?skipped (.+?)(?: today|$)/i);
        if (m) {
            said.push(`${m[1]} is off today`);
            continue;
        }
    }
    // The header "NOTHING WAS BOOKED …" says nothing by itself; the NOT BOOKED line under it says what (review 3, 2026-10-16).
    const failures = lines.filter((l) => FAILED.test(l));
    const failed = failures.find((l) => spokenFailure(l) !== "nothing could be booked") ?? failures[0];
    // Spoken: three moved blocks can be named; more is a count ("4 other blocks moved to follow it").
    const rest = followed.length > 3 ? [`${followed.length} other blocks moved to follow it`] : followed;
    const all = said.length ? [...said, ...cut, ...rest] : [];
    // when: the day it was for ("Done: resume work 5:50 PM" for tomorrow sounded like today, q020).
    const parts = [all.length ? `Done${when ? ` for ${when}` : ""}: ${all.slice(0, 6).join("; ")}.` : "", failed ? `Not done: ${spokenFailure(failed)}.` : ""].filter(Boolean);
    // A log carries its own one-line summary (what was logged, what moved, what is off today).
    if (logged)
        return [logged, failed ? `Not done: ${spokenFailure(failed)}.` : ""].filter(Boolean).join(" ");
    return parts.join(" ") || "Nothing on your day changed.";
}
