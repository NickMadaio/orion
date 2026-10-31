/*
 The names he uses for blocks (2026-10-31 gate run-1031224700, wave 5).

 Nick says "marketing", "macro", "econ", "cs" and "side project tonight"; his calendar says MKTG2201, ECON1115, CS2100 and
 "Side project". ORION answered "I don't see marketing class on your day", "Marketing and Macro aren't on today's calendar" and
 "There's no side project block on your day" while all three were there: every path matched his words against the bare title.

 This module is the one place a spoken name meets a calendar title. A course code in a title brings its subject words with it:
   - from data: USER.md ("ECON1115 Macro, MKTG2201 Marketing"), his brain's course notes ("[name] Principles of Macroeconomics"),
     and an optional `courses` map in life-config.json. Parsed once and cached (re-read when a file changes).
   - from the code's letters (generic, not about Nick): MKTG → marketing; ECON → econ, economics, macro, micro; CS → computer
     science; DS → data science; and so on.
 Filler he says around a name ("my", "the", "block", "tonight", "today") is not part of it; "class"/"lecture" says which kind he means.
 A short qualifier he says ("cs", "ds") must be the title's own code letters, so "cs lab" is never "DS Lab 05" (wave 4).
 When one name fits a class and a study block ("econ": ECON1115 and "Econ problem set"), the verb decides: attend / skip / late /
 class → the class; study / work on → the study block; otherwise the caller asks a short question naming both (whichOne).
 scripts/lib/life/block-names.mjs is the same rules for the scheduler scripts; tests/fixtures/block-names-cases.json keeps them equal.
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// ---- generic rules (true of any student, not facts about Nick) ----
const PREFIX_WORDS = {
    mktg: ["marketing"], mkt: ["marketing"], mark: ["marketing"],
    econ: ["econ", "economics", "macro", "micro", "macroeconomics", "microeconomics"], eco: ["econ", "economics"],
    cs: ["computer", "science", "compsci", "programming"], ds: ["data", "science"],
    math: ["math", "maths", "mathematics"], mth: ["math", "maths"], stat: ["stats", "statistics"],
    phys: ["physics"], chem: ["chemistry"], biol: ["biology", "bio"], bio: ["biology"],
    psyc: ["psych", "psychology"], psy: ["psych", "psychology"], engl: ["english"], eng: ["english"], hist: ["history"],
    phil: ["philosophy"], acct: ["accounting"], fina: ["finance"], fin: ["finance"], mgmt: ["management"], mgt: ["management"],
    busn: ["business"], bus: ["business"], law: ["law"], pols: ["politics"], pol: ["politics"], soc: ["sociology"], art: ["art"],
};
const FILLER = new Set(["my", "the", "our", "your", "ur", "pls", "plz", "lol", "tonite", "2nite", "tmr", "his", "a", "an", "this", "that", "block", "blocks", "session", "sessions", "today", "todays",
    "tonight", "tonights", "tomorrow", "tomorrows", "tmrw", "time", "some", "later", "earlier", "first", "next", "last", "very", "please", "thing"]);
const CLASS_WORDS = new Set(["class", "classes", "lecture", "lectures", "seminar", "seminars", "tutorial", "tutorials", "recitation"]);
const SHORT_FILLER = new Set(["to", "at", "on", "in", "of", "up", "go", "do", "is", "it", "me", "we", "so", "or", "by", "no", "am", "pm", "vs", "my"]);
/** Words in a course's long name that say nothing about which course it is. */
const SUBJECT_STOP = new Set(["introduction", "intro", "principles", "principle", "of", "to", "and", "the", "in", "for", "a", "an", "fundamentals",
    "foundations", "basics", "course", "class", "lecture", "seminar", "tutorial", "lab", "module", "part", "with", "is", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday", "due", "quiz", "exam", "final", "midterm"]);
const CODE = /^([a-z]{2,5})(\d{3,5})$/;
export const norm = (t) => t.toLowerCase().replace(/&/g, " ").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Title words, with a split course code joined back up ("CS 2100" → "cs2100"). */
function titleTokens(title) {
    const raw = norm(title).split(" ").filter(Boolean);
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
        if (/^[a-z]{2,5}$/.test(raw[i]) && /^\d{3,5}$/.test(raw[i + 1] ?? "")) {
            out.push(raw[i] + raw[i + 1]);
            i += 1;
        }
        else
            out.push(raw[i]);
    }
    return out;
}
function lev(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        for (let j = 1; j <= b.length; j += 1)
            cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        prev = cur;
    }
    return prev[b.length];
}
/** One word of his is one word of the title: the same, one the start of the other (4+ letters, or a code), or a small typo. */
export function sameWord(said, word) {
    if (said === word)
        return true;
    const short = Math.min(said.length, word.length);
    if (short >= 4 && (said.startsWith(word) || word.startsWith(said)))
        return true;
    if (short >= 3 && CODE.test(word) && word.startsWith(said))
        return true;
    return short >= 3 && said[0] === word[0] && !/\d/.test(said + word) && lev(said, word) <= (short >= 7 ? 2 : 1);
}
const initials = (title) => norm(title).split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !CLASS_WORDS.has(w) && !["lab", "for", "and", "the"].includes(w)).map((w) => w[0]).join("");
/** A short qualifier he said ("cs") is a title word or the letters of a course code in it ("CS2100"). */
const hasQualifier = (q, tokens) => tokens.some((t) => t === q || CODE.exec(t)?.[1] === q);
export function spokenName(name) {
    const all = norm(name).split(" ").filter(Boolean);
    return { words: all.filter((w) => !FILLER.has(w) && !CLASS_WORDS.has(w)), wantsClass: all.some((w) => CLASS_WORDS.has(w)) };
}
/** Whether a phrase is only filler and kind words ("my class", "the lecture"): it names no block by itself. */
export const isGenericName = (name) => spokenName(name).words.length === 0;
/** The words a title answers to: its own, then its codes' subject words from data, then the codes' generic words. */
export function titleWords(title, aliases = courseAliases()) {
    const own = titleTokens(title);
    const data = [];
    const generic = [];
    for (const t of own) {
        const m = CODE.exec(t);
        if (!m)
            continue;
        data.push(m[1], ...(aliases.get(t) ?? []));
        generic.push(...(PREFIX_WORDS[m[1]] ?? []));
    }
    return { own, data, generic };
}
/** Every word a title answers to, flat (for the lenient guards that look for any one shared word). */
export const allTitleWords = (title, aliases) => { const w = titleWords(title, aliases); return [...w.own, ...w.data, ...w.generic]; };
/** How well his name fits a title: 3 the same title, 2 its words or its course's subject from data, 1 only the code's generic words, 0 not it. */
export function nameLevel(name, title, aliases = courseAliases()) {
    const { words } = spokenName(name);
    if (!words.length)
        return 0;
    const tw = titleWords(title, aliases);
    const ownCore = tw.own.filter((w) => !FILLER.has(w));
    if (words.join(" ") === ownCore.join(" "))
        return 3;
    const long = words.filter((w) => w.length >= 3);
    const short = words.filter((w) => /^[a-z]{2}$/.test(w) && !SHORT_FILLER.has(w));
    if (!long.length && !short.length)
        return 0;
    const fits = (pool) => long.every((w) => pool.some((x) => sameWord(w, x))) && short.every((q) => hasQualifier(q, tw.own) || pool.includes(q));
    if (fits([...tw.own, ...tw.data]))
        return 2;
    if (words.length === 1 && words[0].length >= 2 && initials(title) === words[0])
        return 2;
    if (fits([...tw.own, ...tw.data, ...tw.generic]))
        return 1;
    return 0;
}
/** Whether his name for a block is this title (any level). */
export const namesTitle = (name, title, aliases) => nameLevel(name, title, aliases) > 0;
/** A class: the scheduler says so, or a fixed block whose title starts with a course code. */
export const isClassBlock = (b) => b.kind === "class" || (!!b.fixed && /^[A-Za-z]{2,5}\s?\d{3,5}\b/.test(b.title.trim()));
/** What the verb around a name implies he means: the class (attend, skip, late, missed) or the study block (study, work on). */
export function intentOf(text) {
    const t = text.toLowerCase();
    if (/\b(?:study|studying|studied|revis(?:e|ing)|review(?:ing)?|work(?:ing)? on|problem sets?|psets?|homework|hw|practi[cs]e|prep(?:ping)? for|reading for)\b/.test(t))
        return "study";
    if (/\b(?:attend(?:ing|ed)?|go(?:ing)? to|went to|goin to|make it to|made it to|skip(?:ping|ped)?|miss(?:ed|ing)?|late (?:to|for)|running late|cancel(?:led|ed)?|class(?:es)?|lectures?|seminars?|was in|in class)\b/.test(t))
        return "class";
    return undefined;
}
/** Every block on the day his name fits, at the best level any of them reaches; "marketing class" keeps the classes when there are any. */
export function blocksNamedBy(name, blocks, opts = {}) {
    const aliases = opts.aliases ?? courseAliases();
    const scored = blocks.filter((b) => b.kind !== "commute").map((b) => ({ b, level: nameLevel(name, b.title, aliases) })).filter((x) => x.level > 0);
    const top = Math.max(0, ...scored.map((x) => x.level));
    const found = scored.filter((x) => x.level === top).map((x) => x.b);
    return byIntent(found, spokenName(name).wantsClass ? "class" : opts.intent);
}
function byIntent(found, intent) {
    if (!intent)
        return found;
    const classes = found.filter(isClassBlock);
    const others = found.filter((b) => !isClassBlock(b));
    const kept = intent === "class" ? classes : others;
    return kept.length ? kept : found;
}
/** The one block he means: one still ahead (earliest) first, else the latest that ended. A class and a study block by the same name,
 *  with no verb to tell them apart: ambiguous (ask with whichOne). */
export function resolveBlockName(name, blocks, opts) {
    const found = blocksNamedBy(name, blocks, opts);
    if (!found.length)
        return undefined;
    const kinds = new Set(found.map((b) => isClassBlock(b)));
    if (kinds.size > 1 && new Set(found.map((b) => norm(b.title))).size > 1)
        return { ambiguous: found };
    return { block: pickByTime(found, opts.now) };
}
export function pickByTime(found, now) {
    const ahead = found.filter((b) => toMin(b.end) > now).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
    return ahead ?? [...found].sort((a, b) => toMin(b.end) - toMin(a.end))[0];
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const ampm = (hhmm) => { const v = toMin(hhmm); const h = Math.floor(v / 60); return `${(h + 11) % 12 + 1}:${String(v % 60).padStart(2, "0")} ${h < 12 || h >= 24 ? "AM" : "PM"}`; };
/** "Do you mean ECON1115 at 11:00 AM or Econ problem set at 3:00 PM? I haven't changed anything." */
export function whichOne(blocks) {
    const seen = new Map();
    for (const b of blocks)
        if (!seen.has(norm(b.title)))
            seen.set(norm(b.title), b);
    const items = [...seen.values()].map((b) => `${b.title.replace(/\s+—.*$/, "")} at ${ampm(b.start)}`);
    return `Do you mean ${items.slice(0, -1).join(", ")} or ${items.at(-1)}? I haven't changed anything.`;
}
// ---- the alias data ----
/** His subject words in a course's long name ("Principles of Macroeconomics 2026/27" → ["macroeconomics"]). */
export function subjectWords(text) {
    return norm(text).split(" ").filter((w) => w.length >= 3 && !/\d/.test(w) && !SUBJECT_STOP.has(w));
}
const add = (map, code, words) => {
    if (!words.length)
        return;
    const key = code.toLowerCase().replace(/\s+/g, "");
    map.set(key, new Set([...(map.get(key) ?? []), ...words]));
};
/** "ECON1115 Macro", "MKTG2201 Marketing", "CS2100 is Program Design & Implementation 1" in free text (USER.md, notes). */
export function coursesInText(text, into = new Map()) {
    const re = /\b([A-Z]{2,5})\s?(\d{4})\b(?:[ \t]*(?:is|=|:|—|–|-)[ \t]*|\s+)((?:[A-Z][A-Za-z]*|&)(?:[ \t]+(?:[A-Z][A-Za-z]*|&|of|to|and|in|for))*)/g;
    for (const m of text.matchAll(re))
        add(into, m[1] + m[2], subjectWords(m[3]));
    return into;
}
/** A brain course note (`<CODE>.md`): its "[name]" and "[course_code]" lines. */
export function courseNote(code, text, into = new Map()) {
    for (const m of text.matchAll(/^\s*-\s*\[(?:name|course_code|title)\]\s*(.+)$/gm))
        add(into, code, subjectWords(m[1].replace(new RegExp(`\\b${code}\\b`, "ig"), "")));
    return into;
}
export function defaultAliasSources() {
    const home = homedir();
    return {
        userMd: join(process.env.ORION_WORKSPACE_DIR || join(home, ".openclaw", "workspace"), "USER.md"),
        coursesDir: join(process.env.ORION_BRAIN_VAULT || join(home, "Documents", "orionBrain"), "20 Areas", "School", "Courses"),
        lifeConfig: join(process.env.ORION_CONTROLLED_DIR || join(home, ".openclaw", "orion-controlled"), "life-config.json"),
    };
}
const readText = (p) => { if (!p)
    return ""; try {
    return readFileSync(p, "utf8");
}
catch {
    return "";
} };
/** Reads every source that exists; a missing or unreadable one adds nothing. Never throws. */
export function loadCourseAliases(src) {
    const map = new Map();
    coursesInText(readText(src.userMd), map);
    if (src.coursesDir) {
        let files = [];
        try {
            files = readdirSync(src.coursesDir).filter((f) => /^[A-Za-z]{2,5}\d{4}\.md$/.test(f));
        }
        catch {
            files = [];
        }
        for (const f of files)
            courseNote(f.replace(/\.md$/, ""), readText(join(src.coursesDir, f)), map);
    }
    try {
        const courses = JSON.parse(readText(src.lifeConfig) || "{}").courses;
        if (courses && typeof courses === "object" && !Array.isArray(courses)) {
            for (const [code, name] of Object.entries(courses))
                if (typeof name === "string")
                    add(map, code, subjectWords(name));
        }
    }
    catch { /* a broken life-config adds nothing here */ }
    return new Map([...map].map(([k, v]) => [k, [...v]]));
}
let override;
let cache;
const RECHECK_MS = 30_000;
const stamp = (p) => { if (!p)
    return "-"; try {
    return String(statSync(p).mtimeMs);
}
catch {
    return "-";
} };
/** His course aliases from the default sources, cached; re-read when a source changes (checked at most every 30 s). */
export function courseAliases() {
    if (override)
        return override;
    const now = Date.now();
    if (cache && now - cache.at < RECHECK_MS)
        return cache.value;
    const src = defaultAliasSources();
    const key = [src.userMd, stamp(src.userMd), src.coursesDir, stamp(src.coursesDir), src.lifeConfig, stamp(src.lifeConfig)].join("|");
    if (cache && cache.key === key) {
        cache = { ...cache, at: now };
        return cache.value;
    }
    cache = { key, at: now, value: loadCourseAliases(src) };
    return cache.value;
}
/** Tests: use these aliases instead of the files (undefined goes back to the files). */
export function useCourseAliases(aliases) { override = aliases; cache = undefined; }
