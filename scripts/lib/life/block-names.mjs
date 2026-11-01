// The names he uses for blocks (2026-10-31 gate run-1031224700, wave 5): the scheduler scripts' copy of
// plugin/orion-control/src/block-names.ts (the plugin cannot import scripts). "marketing" is MKTG2201, "macro"/"econ" ECON1115,
// "side project tonight" the Side project block; "cs lab" is never "DS Lab 05". A course code in a title brings its subject words:
// from data (USER.md, his brain's course notes, life-config.json `courses`), cached, then the code letters' generic words.
// tests/fixtures/block-names-cases.json is run against both copies so they match names the same way.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PREFIX_WORDS = {
  mktg: ["marketing"], mkt: ["marketing"],
  econ: ["econ", "economics", "macro", "micro", "macroeconomics", "microeconomics"], eco: ["econ", "economics"],
  cs: ["computer science", "compsci", "programming"], ds: ["data science"],
  math: ["math", "maths", "mathematics"], mth: ["math", "maths"], stat: ["stats", "statistics"],
  phys: ["physics"], chem: ["chemistry"], biol: ["biology", "bio"], bio: ["biology"],
  psyc: ["psych", "psychology"], psy: ["psych", "psychology"], engl: ["english"], eng: ["english"], hist: ["history"],
  phil: ["philosophy"], acct: ["accounting"], fina: ["finance"], fin: ["finance"], mgmt: ["management"], mgt: ["management"],
  busn: ["business"], bus: ["business"], law: ["law"], pols: ["politics"], pol: ["politics"], soc: ["sociology"], art: ["art"],
};
const FILLER = new Set(["my", "the", "our", "your", "ur", "pls", "plz", "lol", "tonite", "2nite", "tmr", "his", "a", "an", "this", "that", "block", "blocks",
  "session", "sessions", "today", "todays", "tonight", "tonights", "tomorrow", "tomorrows", "tmrw", "time", "some", "later", "earlier", "first",
  "next", "last", "very", "please", "thing"]);
const CLASS_WORDS = new Set(["class", "classes", "lecture", "lectures", "seminar", "seminars", "tutorial", "tutorials", "recitation"]);
const SHORT_FILLER = new Set(["to", "at", "on", "in", "of", "up", "go", "do", "is", "it", "me", "we", "so", "or", "by", "no", "am", "pm", "vs", "my"]);
const SUBJECT_STOP = new Set(["introduction", "intro", "principles", "principle", "of", "to", "and", "the", "in", "for", "a", "an", "fundamentals",
  "foundations", "basics", "course", "class", "lecture", "seminar", "tutorial", "lab", "module", "part", "with", "is", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday", "due", "quiz", "exam", "final", "midterm"]);
const CODE = /^([a-z]{2,5})(\d{3,5})$/;

export const norm = (t) => String(t ?? "").toLowerCase().replace(/&/g, " ").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function titleTokens(title) {
  const raw = norm(title).split(" ").filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (/^[a-z]{2,5}$/.test(raw[i]) && /^\d{3,5}$/.test(raw[i + 1] ?? "")) { out.push(raw[i] + raw[i + 1]); i += 1; } else out.push(raw[i]);
  }
  return out;
}
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}
export function sameWord(said, word) {
  if (said === word) return true;
  const short = Math.min(said.length, word.length);
  if (short >= 4 && (said.startsWith(word) || word.startsWith(said))) return true;
  if (short >= 3 && CODE.test(word) && word.startsWith(said)) return true;
  return short >= 3 && said[0] === word[0] && !/\d/.test(said + word) && lev(said, word) <= (short >= 7 ? 2 : 1);
}
const initials = (title) => norm(title).split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !CLASS_WORDS.has(w) && !["lab", "for", "and", "the"].includes(w)).map((w) => w[0]).join("");
const hasQualifier = (q, tokens) => tokens.some((t) => t === q || CODE.exec(t)?.[1] === q);

export function spokenName(name) {
  const all = norm(name).split(" ").filter(Boolean);
  return { words: all.filter((w) => !FILLER.has(w) && !CLASS_WORDS.has(w)), wantsClass: all.some((w) => CLASS_WORDS.has(w)) };
}
export function titleWords(title, aliases = courseAliases()) {
  const own = titleTokens(title); const data = []; const generic = [];
  for (const t of own) {
    const m = CODE.exec(t);
    // A bare code's letters in a title ("DS Lab 05") bring the generic words too, like the letters of "DS1000" would.
    if (!m) { if (PREFIX_WORDS[t]) generic.push(...PREFIX_WORDS[t].map((w) => w.replace(/ /g, "_"))); continue; }
    data.push(m[1], ...(aliases.get(t) ?? []));
    generic.push(...(PREFIX_WORDS[m[1]] ?? []).map((w) => w.replace(/ /g, "_")));
  }
  return { own, data, generic };
}
/** 3 the same title, 2 its words or its course's subject from data, 1 only the code's generic words, 0 not it. */
export function nameLevel(name, title, aliases = courseAliases()) {
  const { words } = spokenName(name);
  if (!words.length) return 0;
  const tw = titleWords(title, aliases);
  if (words.join(" ") === tw.own.filter((w) => !FILLER.has(w)).join(" ")) return 3;
  const long = words.filter((w) => w.length >= 3);
  const short = words.filter((w) => /^[a-z]{2}$/.test(w) && !SHORT_FILLER.has(w));
  if (!long.length && !short.length) return 0;
  const fits = (pool) => long.every((w) => pool.some((x) => sameWord(w, x))) && short.every((q) => hasQualifier(q, tw.own) || pool.includes(q));
  if (fits([...tw.own, ...tw.data])) return 2;
  if (words.length === 1 && words[0].length >= 2 && initials(title) === words[0]) return 2;
  // The code's generic words match exactly (no typos, no prefixes): "marking" is not "mkt", "science" alone is no course.
  const spoken = ` ${long.join(" ")} `;
  const phrased = tw.generic.reduce((acc, g) => (g.includes("_") ? acc.replace(` ${g.replace(/_/g, " ")} `, ` ${g} `) : acc), spoken).trim().split(" ").filter(Boolean);
  const own = [...tw.own, ...tw.data];
  const fitsGeneric = phrased.every((w) => own.some((x) => sameWord(w, x)) || tw.generic.includes(w)) && short.every((q) => hasQualifier(q, tw.own) || own.includes(q));
  if (fitsGeneric) return 1;
  return 0;
}
export const namesTitle = (name, title, aliases) => nameLevel(name, title, aliases) > 0;

// ---- the alias data ----
export const subjectWords = (text) => norm(text).split(" ").filter((w) => w.length >= 3 && !/\d/.test(w) && !SUBJECT_STOP.has(w));
const add = (map, code, words) => {
  if (!words.length) return;
  const key = code.toLowerCase().replace(/\s+/g, "");
  map.set(key, new Set([...(map.get(key) ?? []), ...words]));
};
export function coursesInText(text, into = new Map()) {
  const re = /\b([A-Z]{2,5})\s?(\d{4})\b(?:[ \t]*(?:is|=|:|—|–|-)[ \t]*|\s+)((?:[A-Z][A-Za-z]*|&)(?:[ \t]+(?:[A-Z][A-Za-z]*|&|of|to|and|in|for))*)/g;
  for (const m of String(text ?? "").matchAll(re)) add(into, m[1] + m[2], subjectWords(m[3]));
  return into;
}
export function courseNote(code, text, into = new Map()) {
  for (const m of String(text ?? "").matchAll(/^\s*-\s*\[(?:name|course_code|title)\]\s*(.+)$/gm)) add(into, code, subjectWords(m[1].replace(new RegExp(`\\b${code}\\b`, "ig"), "")));
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
const readText = (p) => { if (!p) return ""; try { return readFileSync(p, "utf8"); } catch { return ""; } };
/** Reads every source that exists; a missing or unreadable one adds nothing. Never throws. */
export function loadCourseAliases(src = {}) {
  const map = new Map();
  coursesInText(readText(src.userMd), map);
  if (src.coursesDir) {
    let files = [];
    try { files = readdirSync(src.coursesDir).filter((f) => /^[A-Za-z]{2,5}\d{4}\.md$/.test(f)); } catch { files = []; }
    for (const f of files) courseNote(f.replace(/\.md$/, ""), readText(join(src.coursesDir, f)), map);
  }
  try {
    const { courses } = JSON.parse(readText(src.lifeConfig) || "{}");
    if (courses && typeof courses === "object" && !Array.isArray(courses)) {
      for (const [code, name] of Object.entries(courses)) if (typeof name === "string") add(map, code, subjectWords(name));
    }
  } catch { /* a broken life-config adds nothing here */ }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}
let override; let cache;
const stamp = (p) => { try { return String(statSync(p).mtimeMs); } catch { return "-"; } };
/** His course aliases from the default sources, cached per process and re-read when a source changes. */
export function courseAliases() {
  if (override) return override;
  const src = defaultAliasSources();
  const key = [src.userMd, stamp(src.userMd), src.coursesDir, stamp(src.coursesDir), src.lifeConfig, stamp(src.lifeConfig)].join("|");
  if (cache?.key === key) return cache.value;
  cache = { key, value: loadCourseAliases(src) };
  return cache.value;
}
/** Tests: use these aliases instead of the files (undefined goes back to the files). */
export function useCourseAliases(aliases) { override = aliases; cache = undefined; }
