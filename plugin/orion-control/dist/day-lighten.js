import { notBooked, refused, sideNotes, wrote } from "./scheduler-out.js";
const LEAD = String.raw `(?:i'?m|im|i am|feel(?:ing)?|i feel|so|really|super|very|kinda|pretty|totally|completely|absolutely|literally)`;
const TIRED = new RegExp(String.raw `\b${LEAD}\s+(?:so\s+|really\s+|super\s+|very\s+|kinda\s+|pretty\s+|totally\s+|completely\s+|absolutely\s+|literally\s+)*(?:tired|exhausted|knackered|wrecked|shattered|drained|wiped(?: out)?|fried|zonked|sleepy|burnt out|burned out|running on empty)\b(?!\s+of\b)|\bcan(?:'?t|not)?\s+barely (?:think|function|keep my eyes open|stay awake|focus)\b|\brunning on (?:empty|fumes|no sleep)\b|\bno energy\b`, "i");
const SICK = new RegExp(String.raw `\b(?:i'?m|im|i am|feel(?:ing)?|think i'?m|i think i'?m)\s+(?:\w+\s+)?(?:sick|ill|unwell|poorly|feverish|nauseous|coming down with)\b(?!\s+of\b)|\bfeel(?:ing)?\s+(?:like\s+)?(?:crap|shit|garbage|trash|death|awful|terrible|horrible|rubbish)\b|\b(?:getting|got|have|caught)\s+(?:a\s+|the\s+)?(?:cold|flu|fever|bug|migraine|stomach bug|covid)\b`, "i");
const SLEPT = /\bslept (?:like (?:garbage|crap|shit|trash|rubbish|hell)|(?:so )?(?:badly|terribly|awfully|horribly|poorly|bad|awful|terrible)|(?:so )?little)\b|\b(?:only|barely|hardly) (?:slept|got)\b[^.,]*\b(?:\d|one|two|three|four|five|hours?|sleep)|\b(?:only |barely |hardly )slept\b|\b(?:didn'?t|did not|couldn'?t|could not|barely) (?:get any |get much |)sleep\b|\bno sleep\b|\b(?:bad|rough|terrible|awful|crap|shit) (?:night|sleep)\b|\bup all night\b/i;
const HOURS_OF_SLEEP = /\b(?:only |like |maybe |about |barely |got )*(?:[1-5](?:\.5)?|one|two|three|four|five)(?: and a half)? ?(?:h|hrs?|hours?) (?:of )?sleep\b/i;
const SLEPT_HOURS = /\bslept (?:only |like |maybe |about |around )*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine)(?: and a half)? ?(?:h|hrs?|hours?)\b/i;
const WORK_NOUN = String.raw `(?:homework|assignment|essay|exam|midterm|final|problem set|pset|project|lab report|revision|coursework|deadline|studying|reading|paper|quiz|econ|maths?|calc|chem|bio)`;
// Hyperbole about work or the day ("im dying from this econ homework lol", "ugh what a rough day"): a rough moment, not a crisis (distress.ts keeps the real wording).
const ROUGH = new RegExp([
    String.raw `\bdying (?:from|of|because of|over|with) [\w' ]{0,25}?\b${WORK_NOUN}\b`,
    String.raw `\b${WORK_NOUN}s? (?:is|are)?\s*(?:literally |actually |really )?(?:killing|destroying|murdering|crushing) me\b`,
    String.raw `\bwhat an? (?:\w+ )?(?:rough|bad|long|hard|brutal|terrible|awful|shit|crappy|horrible) day\b`,
    String.raw `\b(?:having|had|been having) an? (?:so |really |super )?(?:rough|bad|brutal|terrible|awful|shit|crappy|horrible) (?:day|week)\b`,
    String.raw `^(?:ugh+\s+|man\s+)?(?:rough|brutal|long|bad) day[.!\s]*$`,
].join("|"), "i");
// First person only: "my mom is so stressed" is not his.
const STRESSED_BASE = /(?:^|\b(?:i'?m|im|i am|i feel|feel(?:ing)?|getting|i'?ve been|ive been)\s+)(?:so\s+|really\s+|super\s+|kinda\s+|pretty\s+|completely\s+)*(?:stressed|overwhelm\w*|swamped|drowning|freaking out|panicking|anxious)\b|\btoo much (?:to do|on my plate)\b|\bso much to do\b/i;
const STRESSED = { test: (m) => STRESSED_BASE.test(m) || ROUGH.test(m) };
const RANK = /\b(?:rank|prioriti[sz]e|triage)\b|\bwhat (?:should i|do i) (?:do|focus on|start with|tackle) first\b|\bwhat matters most\b|\bin order of (?:importance|priority)\b/i;
const DO_IT = /\b(?:fix|sort(?: out)?|lighten|ease|redo|rework|adjust|rejig|clear|make)\s+(?:up\s+)?(?:my |the |today'?s? |tonight'?s? |this )?(?:day|schedule|plan|calendar|evening|afternoon|tonight|today)\b|\b(?:do it|go ahead|just do it|make it lighter|make (?:it|today|my day) easier|lighten (?:it|things) up)\b|\b(?:add|book|put|give me|schedule|slot)\s+(?:me\s+)?(?:in\s+)?(?:a |an )?(?:\d+\s*(?:-\s*)?(?:min(?:ute)?s?|m)?\s*)?nap\b|\b(?:cut|drop|cancel|scrap|ditch|remove|get rid of|bin)\s+(?!it\b)\w/i;
/** Another change in the same breath is the schedule flow's ("im tired, move gym to 8"), as is a reminder. */
const OTHER_CHANGE = /\b(?:move|push|pull|swap|resize|extend|shorten|reschedule|remind|alarm|timer|log|start (?:a|an|my|the)|session|text|email)\b|\?|\b(?:what'?s|whats|what is|when is|how (?:long|much|many))\b/i;
/** Taking a named block or class off ("no gym for me, i'm sick", "not going to the lecture") is the gym guard's or the schedule flow's. */
const SKIPS_A_BLOCK = /\bno (?:gym|class|lecture|lab|seminar|study)\b|\bskip(?:ping)?\b|\bnot (?:going|gonna go|coming)\b|\bcan'?t (?:go|make it|do (?:gym|class))\b|\bcall(?:ing)? in\b|\binstead of\b/i;
// REV2 finding 9: "cancel gym and side project" is two cuts (it stopped at "and" and the side project was silently ignored).
const CUT = /\b(?:cut|drop|cancel|scrap|ditch|skip|remove|get rid of|bin)\s+(?:the\s+|my\s+|today'?s\s+|tonight'?s\s+)?([a-z][a-z' &-]{1,70}?)(?=\s+(?:tonight|today|this evening|then|so|cause|because|im|i'm|for)\b|\s*[.,!;]|$)/gi;
const cutNames = (t) => t.split(/\s*(?:\band\b|&)\s*/).map((n) => n.replace(/^(?:the|my)\s+/i, "").trim()).filter(Boolean);
const WORD_HOURS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const slept = (m) => {
    if (SLEPT.test(m) || HOURS_OF_SLEEP.test(m))
        return true;
    const h = SLEPT_HOURS.exec(m)?.[1];
    if (!h)
        return false;
    const hours = WORD_HOURS[h.toLowerCase()] ?? Number(h);
    return hours < 6;
};
function readNap(m) {
    if (!/\bnap\b/i.test(m))
        return undefined;
    const len = /(\d+)\s*(?:-\s*)?(?:min(?:ute)?s?|m)\s+nap\b|\bnap\s+(?:for\s+)?(\d+)\s*(?:min|m)\b/i.exec(m);
    const at = /\bnap\b[^.,;]*?\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(m);
    const minutes = Math.min(90, Math.max(10, Number(len?.[1] ?? len?.[2] ?? 30)));
    const hour = at ? Number(at[1]) % 12 + ((at[3]?.toLowerCase() === "pm" || (!at[3] && Number(at[1]) < 9)) ? 12 : 0) : undefined;
    return { minutes, ...(at ? { at: `${String(hour).padStart(2, "0")}:${at[2] ?? "00"}` } : {}), ...(/\bnap\b[^.,;]*\bafter (?:my |the )?(?:class|lecture|lab|seminar)/i.test(m) ? { afterClass: true } : {}) };
}
/** A statement of being tired, sick, short of sleep or stressed, and what (if anything) he asked to be done about it. */
export function readLighten(message) {
    const m = message.trim();
    const kind = slept(m) ? "slept" : SICK.test(m) ? "sick" : TIRED.test(m) ? "tired" : STRESSED.test(m) ? "stressed" : null;
    if (!kind)
        return null;
    const rank = RANK.test(m);
    if (!rank && (OTHER_CHANGE.test(m) || SKIPS_A_BLOCK.test(m)))
        return null;
    const cut = [...m.matchAll(CUT)].flatMap((x) => cutNames(x[1])).filter((t) => !/^(?:it|that|this|everything|all|me|back|down|out|stuff|things|some|a bit|it back)$/i.test(t));
    const nap = readNap(m);
    return { kind, doIt: DO_IT.test(m), rank, cut, ...(nap ? { nap } : {}) };
}
/** His go-ahead to what was just proposed ("yes", "yeah go", "ok start it", "book it"). */
const YES = /^(?:(?:yeah|yea|ya|yes|yep|yup|ok(?:ay)?|k|sure|alright|fine|please|pls)[,.!\s]*)+(?:(?:go|let'?s go|lets go|go for it|go ahead|do it|do that|start it|book it|please|pls|thanks|ty)[,.!\s]*)*$|^(?:go|let'?s go|lets go|go for it|go ahead|do it|do that|start it|book it|please do)[.!\s]*$/i;
export const saysYes = (message) => YES.test(message.trim());
// ---- the day ----
const toMin = (t) => { const [h, mm] = t.split(":").map(Number); return (h ?? 0) * 60 + (mm ?? 0); };
const hhmm = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const ampm = (t) => { const n = toMin(t); const h = Math.floor(n / 60) % 24; return `${(h + 11) % 12 + 1}:${String(n % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const kindOf = (b) => b.kind ?? (/\b(lecture|seminar|lab|class|tutorial)\b|\b[a-z]{2,4}\d{3,4}\b/i.test(b.title) ? "class" : /\bgym|workout/i.test(b.title) ? "gym" : /\b(?:youtube|side project|channel)\b/i.test(b.title) ? "side_project" : /\bstudy|revis|homework|problem set/i.test(b.title) ? "study" : /\bnap|rest|break/i.test(b.title) ? "rest" : /\bbreakfast|lunch|dinner|meal/i.test(b.title) ? "meal" : "other");
const isClass = (b) => kindOf(b) === "class";
const isGym = (b) => kindOf(b) === "gym";
const KEEP = new Set(["class", "gym", "study", "deadline", "meal", "rest", "sleep", "commute", "nap"]);
/** "Other" he can safely lose today: chores and leisure. An unknown task ("AE1 Marketing Presentation", "finish resume") may be
 *  deadline work, so it is never the one taken off (found replaying his real 10-31 day). */
const LOW_OTHER = /\b(?:laundry|groceries|grocery|shopping|errands?|clean(?:ing)?|tidy(?:ing)?|chores?|games?|gaming|tv|netflix|admin|inbox|emails?|organi[sz]e|declutter)\b/i;
/** Removal order, lowest priority first: chores/leisure, then side project. Never fixed, never already started. */
// REV2 finding 13: a plan with people reads as one by "with", "w/", "meet", or a name's place ("Game night at Sam's").
const WITH_PEOPLE = /\b(?:with|meet(?:ing|up)?|commute|travel|home)\b|\bw\//i;
const NAMES_PLACE = /\b[A-Z][a-z]+'s\b/;
const withPeople = (b) => WITH_PEOPLE.test(b.title) || NAMES_PLACE.test(b.title);
/** A block that is coursework for a deadline he has ("Edit AE1 video" for "AE1 Marketing Presentation"), or carries a course code. */
const deadlineWork = (b, deadlines) => /\b[A-Z]{2,5}\d{1,5}\b/.test(b.title)
    || deadlines.some((d) => d.split(/[^A-Za-z0-9]+/).some((w) => w.length >= 3 && /\d/.test(w) && new RegExp(`\\b${w}\\b`, "i").test(b.title)));
function lowestBlock(day, nowMin, deadlines = []) {
    const movable = day.blocks.filter((b) => !b.fixed && toMin(b.start) >= nowMin && !KEEP.has(kindOf(b)) && !withPeople(b) && !deadlineWork(b, deadlines));
    return movable.find((b) => kindOf(b) === "other" && LOW_OTHER.test(b.title)) ?? movable.find((b) => kindOf(b) === "side_project");
}
const nextClass = (day, nowMin) => day.blocks.filter(isClass).find((b) => toMin(b.end) > nowMin);
const gymAhead = (day, nowMin) => day.blocks.find((b) => isGym(b) && toMin(b.end) > nowMin);
/** Where a nap goes: right after the class he is in or the next one (when that ends before 6 PM), else in five minutes; none in the evening. */
function napSlot(day, nowMin, nap) {
    if (nap.at)
        return { args: ["--at", nap.at], at: nap.at };
    const cls = day ? nextClass(day, nowMin) : undefined;
    if (cls && (nap.afterClass || toMin(cls.end) <= 18 * 60))
        return { args: ["--after", cls.title], at: cls.end, after: cls.title };
    if (nap.afterClass || nowMin >= 18 * 60)
        return null;
    const start = Math.ceil((nowMin + 5) / 5) * 5;
    return { args: ["--at", hhmm(start)], at: hhmm(start) };
}
// REV2 finding 13: whole words only ("drop me" is not Homework, "cut back" is not Back workout).
const fuzzy = (day, said) => {
    const s = said.toLowerCase().replace(/\s+(?:block|session|time)$/, "").trim();
    const side = /\b(?:side project|youtube|editing|content)\b/.test(s);
    const ws = s.split(/[^a-z0-9']+/).filter(Boolean);
    const whole = (title) => ws.length > 0 && ws.every((w) => new RegExp(`\\b${w.replace(/'/g, "'?")}\\b`, "i").test(title));
    return day.blocks.find((b) => !b.fixed && !isClass(b) && whole(b.title)) ?? (side ? day.blocks.find((b) => !b.fixed && kindOf(b) === "side_project") : undefined);
};
// ---- deadlines ----
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** The next deadlines in seven days, soonest first, as "the CS Midterm Thursday". */
export function soonDeadlines(read, now, max = 2) {
    if (!read)
        return [];
    const rows = [...read.events.filter((e) => e.isDeadline !== false).map((e) => ({ title: e.title, at: new Date(e.start) })), ...read.tasks.map((t) => ({ title: t.title, at: new Date(t.due) }))]
        .filter((r) => !Number.isNaN(r.at.getTime()) && r.at.getTime() >= dayStart(now) && r.at.getTime() - now.getTime() <= 7 * 86400_000)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
    const seen = new Set();
    return rows.filter((r) => { const k = r.title.toLowerCase(); if (seen.has(k))
        return false; seen.add(k); return true; }).slice(0, max).map((r) => {
        const days = Math.round((dayStart(r.at) - dayStart(now)) / 86400_000);
        return { title: r.title.replace(/^due:?\s*/i, ""), when: days === 0 ? "today" : days === 1 ? "tomorrow" : WEEKDAY[r.at.getDay()] };
    });
}
const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
/** One sentence of his real day: the next class and the nearest deadlines. Empty when nothing is known. */
function realDay(day, deadlines, nowMin) {
    // The next class, or with none left today the next study block (what the day actually asks of him).
    const cls = day ? nextClass(day, nowMin) ?? day.blocks.find((b) => kindOf(b) === "study" && toMin(b.start) >= nowMin) : undefined;
    const parts = [...(cls ? [`${cls.title} at ${ampm(cls.start)}${toMin(cls.start) <= nowMin ? " (now)" : ""}`] : []), ...deadlines.filter((d) => !cls || !cls.title.toLowerCase().includes(d.title.toLowerCase())).map((d) => `${d.title} ${d.when}`)];
    return parts.length ? `You've still got ${listed(parts)}.` : "";
}
/** "rank what i need to do this week": his priority order with his real deadlines in it. */
function rankReply(day, deadlines) {
    const classes = day?.blocks.filter(isClass).map((b) => b.title) ?? [];
    const lines = [
        `1. Classes${classes.length ? ` (${listed([...new Set(classes)])})` : ""}: fixed, you go.`,
        "2. Gym, 90 minutes every day.",
        ...deadlines.map((d, i) => `${i + 3}. ${d.title}, due ${d.when}.`),
        `${deadlines.length + 3}. An hour on the side project.`,
        `${deadlines.length + 4}. Everything else, then rest.`,
    ];
    return `In order:\n${lines.join("\n")}\n${deadlines[0] ? `Start with ${deadlines[0].title}: want 25 minutes on it now?` : "Want me to start 25 minutes on the first thing now?"}`;
}
/** What to do (steps) or propose (pending), and what to say. Pure. */
export function planLighten(read, ctx) {
    const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const soon = soonDeadlines(ctx.deadlines, ctx.now);
    const context = realDay(ctx.day, soon, nowMin);
    const first = soon[0]?.title ?? (ctx.day ? ctx.day.blocks.find((b) => kindOf(b) === "study" && toMin(b.end) > nowMin)?.title : undefined);
    if (read.rank)
        return { text: rankReply(ctx.day, soon), steps: [], ...(first ? { pending: { session: `start a 25 min focus session on ${first}` } } : {}) };
    // REV2 finding 12: stressed with an explicit cut ("im stressed, cancel study tonight") is done as he said, not a study suggestion.
    if (read.kind === "stressed" && !(read.doIt && read.cut.length)) {
        const step = first ? `Smallest step: 25 minutes on ${first}, right now. Want me to start that?` : "Smallest step: pick the one thing due first and give it 25 minutes. Want me to start a focus session?";
        return { text: [`That's a lot at once.`, context, step].filter(Boolean).join(" "), steps: [], pending: { session: `start a 25 min focus session${first ? ` on ${first}` : ""}` } };
    }
    const day = ctx.day;
    const steps = [];
    const nap = read.nap ?? (read.doIt && !read.cut.length ? { minutes: 30 } : undefined);
    const slot = nap ? napSlot(day, nowMin, nap) : null;
    const napStep = (n, s) => ({ args: ["add", "Nap", String(n.minutes), ...s.args], said: `${n.minutes}-minute nap at ${ampm(s.at)}${s.after ? ` after ${s.after}` : ""}` });
    const low = day ? lowestBlock(day, nowMin, soon.map((d) => d.title)) : undefined;
    const gym = day ? gymAhead(day, nowMin) : undefined;
    const easyGym = gym && !/\(easy\)/i.test(gym.title) ? { args: ["rename", gym.title, `${gym.title} (easy)`], said: `${gym.title} stays at ${ampm(gym.start)}, as an easy session` } : undefined;
    if (read.doIt) {
        if (nap && slot)
            steps.push(napStep(nap, slot));
        // Gym is never dropped for tiredness (only real illness): it stays, with pushback and a shorter version (Nick's rule).
        const gymCut = read.kind !== "sick" ? read.cut.filter((c) => /\bgym\b/i.test(c)) : [];
        const wanted = read.cut.filter((c) => !gymCut.includes(c));
        const found = day ? wanted.map((c) => [c, fuzzy(day, c)]) : wanted.map((c) => [c, undefined]);
        const named = found.flatMap(([, b]) => (b ? [b] : []));
        const unmatched = found.filter(([, b]) => !b).map(([c]) => c);
        const cuts = read.cut.length ? named : low ? [low] : [];
        for (const b of [...new Set(cuts)])
            steps.push({ args: ["drop", b.title], said: `${b.title} off today` });
        const notes = [...(unmatched.length ? [`${listed(unmatched.map((u) => u.replace(/^./, (c) => c.toUpperCase())))} ${unmatched.length > 1 ? "aren't" : "isn't"} on today's calendar, so there was nothing to cut there.`] : []),
            ...(gymCut.length ? [`Gym stays${gym ? ` at ${ampm(gym.start)}` : ""}: tired isn't a reason to drop it. Want 30 minutes instead of 90? Say "shorten gym to 30".`] : [])];
        // The default lightening (no specifics) makes gym an easy session; a named gym cut was his explicit choice.
        if (!read.cut.length && !read.nap && easyGym)
            steps.push(easyGym);
        if (!steps.length && notes.length)
            return { text: notes.join(" "), steps: [] };
        if (!steps.length)
            return { text: [context, nowMin >= 18 * 60 ? "Too late in the day for a nap, and there's nothing light enough to take off tonight. Want an early night instead?" : "There's nothing I can take off today without touching a class, gym or study."].filter(Boolean).join(" "), steps: [] };
        return { text: notes.join(" "), steps };
    }
    // No explicit go-ahead: ONE concrete change, yes or no.
    const lead = read.kind === "sick" ? "That sucks." : read.kind === "slept" ? "Rough night." : "Rough.";
    const offerSlot = slot ?? napSlot(day, nowMin, { minutes: 30 });
    const napNow = offerSlot && nowMin < 18 * 60 ? napStep({ minutes: 30 }, offerSlot) : undefined;
    const proposal = read.kind === "sick" && low ? { args: ["rename", low.title, "Rest"], said: `rest instead of ${low.title}` }
        : napNow ?? (low ? { args: ["drop", low.title], said: `${low.title} off tonight` } : easyGym);
    if (!proposal)
        return { text: [lead, context, "Want me to keep today as it is and check in with you after class?"].filter(Boolean).join(" "), steps: [] };
    const ask = proposal.args[0] === "add" ? `Want a ${proposal.said}?` : proposal.args[0] === "drop" ? `Want me to take ${proposal.said.replace(/ off tonight$/, "")} off tonight?` : proposal.args[0] === "rename" && proposal.args[2] === "Rest" ? `Want ${proposal.said}?` : `Want gym as an easy session tonight?`;
    return { text: [lead, context, `${ask} Yes or no.`].filter(Boolean).join(" "), steps: [], pending: { steps: [proposal] } };
}
/** Runs the steps in order and says what worked and everything else the scheduler changed to make it fit (REV2 finding 1). A failed step
 *  stops the rest. A step that wrote is one undo entry; an add whose own block did not fit is undone at once. */
export async function runLighten(steps, run, context = "") {
    const calls = [];
    const outputs = [];
    const said = [];
    let failed;
    let writes = 0;
    for (const step of steps) {
        const out = await run("orion-reschedule", step.args).catch(() => ({ stdout: "", code: 1 }));
        calls.push(`exec orion-reschedule ${step.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
        outputs.push(out.stdout);
        const own = step.args[0] === "add" && notBooked(out.stdout, step.args[1] ?? "");
        if (own && wrote(out)) {
            outputs[outputs.length - 1] = out.stdout.split("\n").map((l) => `undone: ${l}`).join("\n");
            const back = await run("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 }));
            calls.push("exec orion-reschedule undo");
            outputs.push(back.stdout);
            if (back.code !== 0)
                writes += 1;
        }
        if (refused(out) || own) {
            failed = step;
            break;
        }
        if (wrote(out))
            writes += 1;
        said.push(step.said);
    }
    const reply0 = `${said.length ? `Done: ${listed(said)}.` : ""}`;
    const also = sideNotes(`${reply0} ${said.join(" ")} ${steps.map((s) => s.args[1] ?? "").join(" ")}`, outputs);
    const keep = said.length || writes ? ` Classes untouched. Say "undo" to put it back.` : "";
    const miss = failed ? ` I couldn't do the ${failed.said.replace(/ off (?:today|tonight)$/, " change")}${said.length || writes ? "" : ", so nothing changed"}.` : "";
    const text = `${reply0}${also.length ? ` Also: ${also.join("; ")}.` : ""}${miss}${keep}${context && said.length ? ` ${context}` : ""}`.trim();
    return { flow: said.length ? { outcome: "done", calls, outputs, reply: text } : { outcome: "say", kind: "plain", text: text || "I couldn't change your day just now, so nothing changed.", calls, outputs }, writes };
}
