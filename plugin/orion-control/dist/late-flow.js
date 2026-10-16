/*
 "I'm running late" (sweep r8, q029, 2026-10-16).

 Three turns in one chat: "im running late" (no minutes), "like 15 min", "yeah push everything after it".
 The front desk answered the first two ("Got it. Hope you make it safely.", "No problem, I'll wait.") and
 the 9B ran `orion-reschedule late 15` on the third, whose output began "NOTHING WAS BOOKED on Friday …
 Do not tell him anything was added or moved." It replied "Your schedule has been adjusted … pushed forward."
 So code now owns the whole thing: it asks "how late?" itself, remembers the question, stitches the short
 answer to it, runs `orion-reschedule late N`, and dictates a reply built from the scheduler's own words.
*/
import { execFile } from "node:child_process";
import { spokenTime } from "./day-read-answers.js";
import { RESCHEDULE, spokenFailure, spokenReply, summarize } from "./schedule-flow.js";
export const LATE_ASK = "How late — about how many minutes?";
export const LATE_TOO_SMALL = "I can only move things for 5 minutes or more — how late are you running?";
// "im running late", "gonna be a bit late", "im late": HIS OWN lateness with no number (a number goes to the form as before).
// H2 (r8 review 1, 2026-10-16): a first-person subject at the start, nothing about texting/reminding someone, no other day, no question,
// and nothing after "late" but a filler ("text mom I'm late", "sam is running late", "I'm late on rent" are not him moving his day).
const LATE_NO_MINUTES = /^(?:(?:hey|ok|okay|so|yeah|um+|uh+)[,\s]+)?(?:(?:(?:i'?m|im|i am|i'?ll be|ill be|i will be|gonna be|going to be)\s+(?:running\s+)?|running\s+)(?:(?:a\s+)?(?:bit|little|tad|few\s+min\w*)\s+)?late|(?:i'?m|im|i am)\s+behind schedule)(?<tail>.*)$/i;
const LATE_TAIL = /^[\s,.!]*(?:(?:today|now|again|rn|right now|sorry|for (?:class|lecture|lab|work|section|the \w+|my \w+))[\s,.!]*)?$/i;
const NOT_NOW = /\b(?:tomorrow|tmrw|tonight|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b|\b(?:text|tell|message|msg|email|call|remind|dm|ping|let)\b/i;
/** "im running late" with no minutes named: a short statement, never a question or a longer plan. */
export function isLateWithoutMinutes(message) {
    const m = message.trim();
    const hit = LATE_NO_MINUTES.exec(m);
    return !!hit && LATE_TAIL.test(hit.groups?.tail ?? "") && !NOT_NOW.test(m) && !/\d/.test(m) && !/\?\s*$/.test(m) && m.split(/\s+/).length <= 7;
}
const WORDS = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, "forty-five": 45, fortyfive: 45, sixty: 60 };
const LEAD = /^(?:(?:like|about|around|maybe|roughly|probably|prob|just|yeah|yea|yes|um+|uh+|so|ok|okay|it'?s|its|it will be|another)[,\s]+)+/;
/** His short answer to "how late?": "like 15 min", "15", "about 20 minutes", "an hour", "half an hour". Null if it is not one. */
export function lateMinutesAnswer(message) {
    const m = message.trim().toLowerCase().replace(/[.!]+$/, "").replace(LEAD, "").trim();
    if (/^(?:an|1|one) hour(?: or so)?$/.test(m))
        return 60;
    if (/^(?:half an hour|half hour|a half hour|30 ?min\w*)$/.test(m))
        return 30;
    const q = /^(\d{1,3}(?:\.\d+)?|[a-z -]+?)\s*(hours?|hrs?|h|min(?:ute)?s?|m)?(?:\s+(?:late|or so|ish|please|pls))?$/.exec(m.replace(/ish$/, ""));
    if (!q)
        return null;
    const n = /^\d/.test(q[1]) ? Number(q[1]) : WORDS[q[1].trim()];
    if (n === undefined || !Number.isFinite(n))
        return null;
    return Math.round(/^h/.test(q[2] ?? "") ? n * 60 : n);
}
/** "yeah push everything after it": the go-ahead for the late move, not a new request. */
const PUSH = /^(?:(?:yeah|yea|yes|yep|yup|ok(?:ay)?|sure|please|pls|go ahead|and)[,\s]+)*(?:push|move|shift|slide|bump)\s+(?:everything|it all|all of it|the rest|everything else|all)(?:\s+(?:after(?:wards)?(?:\s+(?:it|that|now))?|back|later|along|forward|down))?(?:\s+(?:please|pls))?[.!]*$/i;
const YES = /^(?:yeah|yea|yes|yep|yup|ok(?:ay)?|sure|please|do it|go ahead)[.!\s]*$/i;
export const isLateConfirm = (message) => PUSH.test(message.trim());
export const isBareYes = (message) => YES.test(message.trim());
const failureLine = (lines) => lines.find((l) => /NOT BOOKED|did not fit|is already over|no block called|usage:|Error/i.test(l) && !/^NOTHING WAS BOOKED on /i.test(l));
/** "Nothing was moved — why." from the scheduler's own output (NOTHING WAS BOOKED / NOT BOOKED / NOTHING WAS CHANGED), or null if it wrote something. */
export function nothingMovedReply(outputs, lead = "Nothing was changed on your calendar") {
    const out = outputs.join("\n");
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!/NOTHING WAS (?:BOOKED|CHANGED)|NOT BOOKED|^Nothing needed to move/im.test(out) || summarize([out], []).changed)
        return null;
    const fail = failureLine(lines);
    const why = fail ? spokenFailure(fail.replace(/^.*(?=\bNOT BOOKED:)/, ""))
        : /^Nothing needed to move/im.test(out) ? "nothing after now needs to slide"
            : /fixed commitments|rebuilt the remaining day/i.test(out) ? "what's left today is classes and plans with fixed times, which don't slide"
                : "";
    return `${lead}${why ? ` — ${why}` : ""}.`;
}
const say = (text, outputs = [], calls = []) => ({ outcome: "say", kind: "plain", text, ...(calls.length ? { calls, outputs } : {}) });
/** `orion-reschedule late N`, and a reply from its own lines: what moved, or plainly that nothing did, and why. */
export async function runLateFlow({ minutes, exec, undoTop = () => null }) {
    const n = Math.round(minutes);
    if (!Number.isFinite(n) || n < 5)
        return say(LATE_TOO_SMALL);
    if (n > 600)
        return say("That's more than I can move in one go — how late are you running, in minutes?");
    const args = ["late", String(n)];
    const before = undoTop();
    const { stdout, code } = await exec(args);
    const calls = [`exec orion-reschedule ${args.join(" ")}`];
    const out = String(stdout ?? "");
    const after = undoTop();
    const marks = after && after !== before ? [after] : [];
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    const nothing = /NOTHING WAS (?:BOOKED|CHANGED)|^Nothing needed to move/im.test(out);
    const failLine = failureLine(lines);
    if (code !== 0 && !summarize([out], []).changed)
        return say(`I couldn't move your day — ${failLine ? spokenFailure(failLine) : "the scheduler refused"}. Nothing was changed.`, [out], calls);
    if (nothing && !marks.length && !summarize([out], []).changed)
        return say(nothingMovedReply([out], "Nothing was moved") ?? "Nothing was moved.", [out], calls);
    // The scheduler can print 24:05 for a block pushed past midnight: wrap the hour (r8 review 1 LOW, 2026-10-16).
    const ampm = (t) => { const [h, m] = t.split(":").map(Number); return spokenTime((h ?? 0) % 24, m ?? 0); };
    const moved = lines.flatMap((l) => { const m = /^moved (.+?): \d{2}:\d{2} → (\d{2}:\d{2})$/.exec(l); return m ? [`${m[1]} now ${ampm(m[2])}`] : []; });
    const spoken = spokenReply([out]);
    const reply = moved.length ? `Done, pushed back ${n} min: ${(moved.length > 4 ? [`${moved.length} blocks moved, ${moved.slice(0, 3).join("; ")}`] : moved).join("; ")}.`
        : /^Done/.test(spoken) ? spoken : `Done — pushed the rest of your day back ${n} minutes.`;
    return { outcome: "done", calls, outputs: [out], marks, reply };
}
const run = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: `${String(stdout ?? "")}${error ? String(stderr ?? "") : ""}`, code: error ? 1 : 0
})));
/** The real late flow: scripts/orion-reschedule late N. Wired in by index.ts only. */
export const liveLateFlow = (minutes, undoTop) => runLateFlow({ minutes, undoTop, exec: (args) => run(RESCHEDULE, args, 60000) });
