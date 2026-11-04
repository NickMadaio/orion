/*
 The state card (2026-10-30): what the local 9B knows about Nick on every turn.

 Until today the worker answered from one sentence of identity and the clock (R3 gap map §4): it did not know he had
 said "no classes today", that gym had slipped four times this week, or what ORION had just pinged him about. The card
 is built by code from the files that already hold those facts, and never recomputes a decision:

   now.json                the now record (docs/design/2026-10-30-now-record.md): shouldBe, is, mismatch, next,
                           strictness. Read, not recomputed. Missing, foreign or older than STALE_MS: "unknown".
   declared-facts.json     what he told ORION today (also read on its own, so a stale now.json still carries them)
   slips.jsonl             what slipped in the last 7 days, counted by kind ("the fourth gym skip this week")
   learned-routines.json   routines learned from his days (never hard-coded facts about him)
   outreach.jsonl          the last proactive message: what he may be answering
   USER.md                 3-5 essentials about him

 Budget: the card stays under ~600 tokens (CARD_MAX_CHARS). Every reader here is total: a missing or broken file is
 an absent line or "unknown", never an exception and never an invented value.
*/
import { SPEAK_AS_I } from "./self-voice.js";
import { nowLine, readActivity, readHistory } from "./activity-read.js";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
export const STALE_MS = 20 * 60_000; // orion-proactive rewrites now.json every 5 min; four missed ticks is stale
export const CARD_MAX_CHARS = 2400; // ~600 tokens at ~4 chars a token
const WEEK_MS = 7 * 86400_000;
const OUTREACH_TAIL_BYTES = 64 * 1024;
const two = (n) => String(n).padStart(2, "0");
/** "1:30 PM" in the machine's zone (Europe/London on his Mac). */
export function clockOf(at) {
    const d = at instanceof Date ? at : at === undefined ? null : new Date(at);
    if (!d || Number.isNaN(d.getTime()))
        return null;
    const h = d.getHours();
    return `${(h + 11) % 12 + 1}:${two(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}
const minuteClock = (m) => (typeof m === "number" ? clockOf(new Date(2000, 0, 1, 0, m % 1440)) : null);
const localDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
export const ordinal = (n) => ORDINAL[n] ?? `${n}th`;
const quote = (t, max = 110) => `"${t.replace(/\s+/g, " ").trim().slice(0, max)}${t.length > max ? "…" : ""}"`;
const readText = (path) => { try {
    return readFileSync(path, "utf8");
}
catch {
    return null;
} };
const readJson = (path) => { const t = readText(path); if (t === null)
    return null; try {
    return JSON.parse(t);
}
catch {
    return null;
} };
const jsonLines = (text) => (text ?? "").split("\n").flatMap((l) => { if (!l.trim())
    return []; try {
    return [JSON.parse(l)];
}
catch {
    return [];
} });
/** The last `bytes` of a file, so a long outreach log is not read whole on every turn. */
const tail = (path, bytes) => {
    const text = readText(path);
    if (text === null)
        return null;
    try {
        return statSync(path).size > bytes ? text.slice(-bytes) : text;
    }
    catch {
        return text;
    }
};
/** now.json when it is a schemaVersion 1 record computed within STALE_MS of `now`; otherwise null and why. */
export function readNowRecord(dir, now) {
    const raw = readJson(join(dir, "now.json"));
    if (!raw || typeof raw !== "object")
        return { record: null, gap: "no record" };
    if (raw.schemaVersion !== 1 || typeof raw.computedAt !== "string")
        return { record: null, gap: "unreadable record" };
    const age = now.getTime() - Date.parse(raw.computedAt);
    if (!(age <= STALE_MS))
        return { record: null, gap: Number.isFinite(age) ? `record ${Math.round(age / 60000)} min old` : "unreadable record" };
    return { record: raw };
}
/** He said these today (declared-facts.json, schemaVersion 1). */
export function readDeclared(dir, now) {
    const file = readJson(join(dir, "declared-facts.json"));
    if (!file || file.schemaVersion !== 1 || !Array.isArray(file.facts))
        return [];
    return file.facts.filter((f) => f && typeof f.text === "string" && f.date === localDay(now));
}
export function readSlipsWeek(dir, now) {
    return jsonLines(readText(join(dir, "slips.jsonl"))).filter((s) => {
        const t = Date.parse(s?.at ?? "");
        return s?.planned?.title && Number.isFinite(t) && now.getTime() - t <= WEEK_MS && t <= now.getTime();
    });
}
export function readRoutines(dir) {
    const file = readJson(join(dir, "learned-routines.json"));
    return (Array.isArray(file?.routines) ? file.routines : []).filter((r) => r && r.status !== "rejected" && r.label);
}
/** The last message ORION pushed to him (delivered, not held), within the last 6 hours. */
export function readLastOutreach(dir, now) {
    const rows = jsonLines(tail(join(dir, "outreach.jsonl"), OUTREACH_TAIL_BYTES));
    // Held or dropped rows (channel "hold", status "dropped") never reached him.
    const sent = rows.filter((r) => typeof r?.text === "string" && typeof r.at === "string" && r.channel !== "hold" && r.status !== "dropped"
        && now.getTime() - Date.parse(r.at) <= 6 * 3600_000 && Date.parse(r.at) <= now.getTime());
    const last = sent.at(-1);
    return last ? { text: last.text, at: last.at } : null;
}
/** 3-5 lines from USER.md that change how ORION talks to him: priorities, school, times, how to sound. */
export function userEssentials(text, max = 5) {
    if (!text)
        return [];
    const flat = text.replace(/\*\*/g, "").replace(/`/g, "");
    const paragraphs = flat.split(/\n\s*\n/).map((p) => p.replace(/^\s*-\s*(?:\d{4}-\d{2}-\d{2}\s*[—-]\s*)?/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const want = [
        [/^Planning priorities/i, (p) => (p.replace(/^Planning priorities,?\s*/i, "Priorities ").split(/(?<=\.)\s/)[0] ?? p).replace(/\s*\((?:fixed, never moved|protected, not leftovers)\)/g, "")],
        [/^School:/i, (p) => p.split(/(?<=\.)\s/)[0] ?? p],
        [/Times are 12-hour/i, () => "Times are 12-hour (\"8:11 PM\"), said once."],
        [/Talk like someone who knows him|never like a motivational chatbot/i, () => "Talk like someone who knows him, never like a motivational chatbot; name avoidance when it is avoidance."],
    ];
    const picked = want.flatMap(([test, shape]) => { const p = paragraphs.find((x) => test.test(x)); return p ? [shape(p).slice(0, 240)] : []; });
    return [...new Set(picked)].slice(0, max);
}
const SLIP_KIND = { gym: "gym", class: "class", study: "study", side_project: "side project", other: "", deadline: "deadline" };
/** "gym slipped 4 times in 7 days (today would be the fifth)" for every kind that slipped at least twice. */
function slipLines(slips) {
    const byKind = new Map();
    for (const s of slips) {
        const k = SLIP_KIND[s.planned?.kind ?? ""] || (s.planned?.title ?? "").toLowerCase();
        if (k)
            byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    return [...byKind].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, n]) => `${k} slipped ${n} times in 7 days (another skip would be the ${ordinal(n + 1)})`);
}
const FACT_SAID = {
    "no-classes": () => "no classes today",
    skip: (f) => `${f.title ?? "a block"} is off today`,
    ate: () => "he has eaten",
    place: (f) => `he is at ${f.place ?? "a place he named"}`,
    note: (f) => quote(f.text, 80),
};
function recordLines(r) {
    const s = r.shouldBe;
    const n = r.next;
    const m = r.mismatch;
    const is = r.is;
    const until = clockOf(s?.end);
    const should = !s?.kind || s.kind === "unknown" ? "unknown (calendar unreadable)"
        : `${s.title ?? s.kind}${until && s.kind !== "sleep" ? ` until ${until}` : ""}${s.why ? `. ${s.why}` : ""}`;
    const isLine = !is?.activity || is.activity === "unknown" ? "unknown"
        : `${is.activity}${is.focusSession?.task ? ` (focus session on ${is.focusSession.task})` : ""}${is.place ? `, at ${is.place}` : ""} (${is.confidence ?? "low"} confidence)`;
    const nextLine = n?.title ? `${n.title} at ${clockOf(n.start) ?? "?"}${n.leaveBy ? `, leave by ${clockOf(n.leaveBy)}` : ""}` : "unknown";
    return [
        `- Should be doing: ${should}`,
        `- Is doing: ${isLine}`,
        `- Off plan: ${m?.kind ? `${m.kind}${typeof m.minutes === "number" ? ` for ${m.minutes} min` : ""}` : "no"}`,
        `- Next: ${nextLine}`,
        `- Strictness: ${r.strictness === "firm" ? "firm" : "flexible"}`,
    ];
}
/** The card the worker reads, under CARD_MAX_CHARS. Pure. */
export function stateCard(i) {
    const lines = [
        "What you know about Nick right now (code read this from his state; \"unknown\" means nobody knows: never fill it in or guess):",
        ...(i.record ? recordLines(i.record) : [`- His plan and what he is doing: unknown (${i.recordGap ?? "no record"})`]),
    ];
    // What his Mac says he is on, ahead of the plan lines' guesses: "playing Minecraft" is not "at-mac".
    if (i.activityLine)
        lines.splice(1, 0, `- ${i.activityLine}`);
    if (i.declared.length)
        lines.push(`- He told you today: ${i.declared.slice(-4).map((f) => (FACT_SAID[f.kind] ?? FACT_SAID.note)(f)).join("; ")}`);
    const slips = slipLines(i.slipsWeek);
    if (slips.length)
        lines.push(`- This week: ${slips.join("; ")}`);
    if (i.routines.length)
        lines.push(`- Routines learned from his days: ${i.routines.slice(0, 3).map((r) => `${r.label}${r.weekdayName ? ` ${r.weekdayName}s` : ""}${minuteClock(r.start) ? ` ~${minuteClock(r.start)}` : ""}${r.status === "tentative" ? " (tentative)" : ""}`).join("; ")}`);
    if (i.lastOutreach)
        lines.push(`- Last thing you sent him (${clockOf(i.lastOutreach.at)}): ${quote(i.lastOutreach.text)} — he may be answering it.`);
    if (i.essentials.length)
        lines.push(`- About him: ${i.essentials.join(" ")}`);
    const card = lines.join("\n");
    return card.length > CARD_MAX_CHARS ? `${card.slice(0, CARD_MAX_CHARS - 1)}…` : card;
}
/** One line for the front desk (it decides the move, it does not need the whole card). Pure. */
export function deskLine(i) {
    const r = i.record;
    const parts = r
        ? [`should be ${r.shouldBe?.title ?? r.shouldBe?.kind ?? "unknown"}`, `next ${r.next?.title ?? "unknown"}${r.next?.start ? ` at ${clockOf(r.next.start)}` : ""}`, ...(r.mismatch?.kind ? [`off plan: ${r.mismatch.kind}`] : [])]
        : ["his plan right now is unknown"];
    if (i.activityLine)
        parts.unshift(i.activityLine.replace(/^Right now: /, "he is "));
    if (i.declared.length)
        parts.push(`he said today: ${i.declared.slice(-2).map((f) => (FACT_SAID[f.kind] ?? FACT_SAID.note)(f)).join(", ")}`);
    if (i.lastOutreach)
        parts.push(`You last sent ${quote(i.lastOutreach.text, 60)}`);
    return `Nick now: ${parts.join("; ")}.`;
}
/** How to sound. Short and specific on purpose: the 9B copies long style guides back as boilerplate. */
export const TONE_NOTE = [
    SPEAK_AS_I,
    "How to sound: like someone who has watched his week, not a productivity bot. When it matters, use one concrete fact from the card (\"that's the fourth gym skip this week\"); never invent one.",
    "Warm and plain, his register. No pep talk, no \"Great job!\", no \"I understand how you feel\".",
    "Strictness firm: say no once and give the smallest next step (\"No. Thirty minutes of gym, now.\"). Flexible: accept a real reason and say when you'll come back to it.",
].join("\n");
/** Reads every input from the state dir and USER.md. Never throws. */
export function loadCardInputs({ stateDir, userMdPath, now }) {
    const { record, gap } = readNowRecord(stateDir, now);
    return {
        now, record, ...(gap ? { recordGap: gap } : {}),
        declared: readDeclared(stateDir, now),
        slipsWeek: readSlipsWeek(stateDir, now),
        routines: readRoutines(stateDir),
        lastOutreach: readLastOutreach(stateDir, now),
        essentials: userEssentials(userMdPath ? readText(userMdPath) : null),
        activityLine: (() => { const a = readActivity(stateDir, now); return a ? nowLine(a, readHistory(stateDir, now), now) : null; })(),
    };
}
