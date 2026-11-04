/*
 Per-task app profiles for focus sessions (2026-11-04).

 "I get home, I tell him I'm ready to work. He starts a focus session, automatically allows Safari because I'll need it, and notes down
 what apps I need to complete that task for future use." A profile is what a kind of task needs: apps and websites. Seeds cover the common
 kinds; what he adds in chat, and what he actually kept frontmost for more than 2 minutes, is stored per task in focus-profiles.json
 and comes back next time. Store shape: {version:1, tasks:{<taskKey>:{apps:[bundleId], domains:[host], updatedAt}}}. Pure; the file helpers
 are the only I/O. Apps are stored as bundle ids (names only in the seeds).
*/
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isBlockedSite, normalizeDomain } from "./sites.mjs";

export const MIN_STAY_MS = 120_000;

const APPS = {
  Safari: "com.apple.Safari", Pages: "com.apple.iWork.Pages", Terminal: "com.apple.Terminal", "Visual Studio Code": "com.microsoft.VSCode",
  Notes: "com.apple.Notes", Preview: "com.apple.Preview", Numbers: "com.apple.iWork.Numbers", Keynote: "com.apple.iWork.Keynote",
  "Google Chrome": "com.google.Chrome", Xcode: "com.apple.dt.Xcode", "Microsoft Word": "com.microsoft.Word", Canva: "com.canva.canvaeditor",
  Obsidian: "md.obsidian", Notion: "notion.id", Arc: "company.thebrowser.Browser", PyCharm: "com.jetbrains.pycharm", IntelliJ: "com.jetbrains.intellij",
  Zotero: "org.zotero.zotero", ChatGPT: "com.openai.chat", Excel: "com.microsoft.Excel", PowerPoint: "com.microsoft.Powerpoint", Calculator: "com.apple.calculator",
};
const BY_NAME = new Map(Object.entries(APPS).map(([n, id]) => [n.toLowerCase(), id]));
const ALIASES = { vscode: "com.microsoft.VSCode", "vs code": "com.microsoft.VSCode", code: "com.microsoft.VSCode", chrome: "com.google.Chrome", word: "com.microsoft.Word",
  "ms word": "com.microsoft.Word", powerpoint: "com.microsoft.Powerpoint", "google docs": "com.apple.Safari", docs: "com.apple.Safari", intellij: "com.jetbrains.intellij", "chat gpt": "com.openai.chat" };
const BY_ID = new Map(Object.entries(APPS).map(([n, id]) => [id, n]));

/** A bundle id for a name he says ("pages", "vscode"), a bundle id as given, or null for a name not in the table (the caller may ask the Mac). */
export function bundleIdOf(app) {
  const s = String(app ?? "").trim();
  if (!s) return null;
  if (/^[\w-]+(\.[\w-]+)+$/.test(s)) return s;
  return BY_NAME.get(s.toLowerCase()) ?? ALIASES[s.toLowerCase()] ?? null;
}
export const nameOf = (app) => {
  const s = String(app ?? "");
  const id = bundleIdOf(s) ?? s;
  return BY_ID.get(id) ?? (/\./.test(id) ? id.split(".").at(-1) : s);
};

const SCHOOL_SITES = ["docs.google.com", "drive.google.com", "chat.openai.com", "chatgpt.com", "canvas.northeastern.edu", "northeastern.edu", "scholar.google.com"];
/** Seeds: kinds are whole-word keywords in the task title. The browser is in all of them. */
export const SEED = [
  { id: "resume", kinds: ["resume", "cv", "cover letter", "linkedin", "job application", "applications"], apps: ["Pages", "Safari"], domains: ["docs.google.com", "drive.google.com", "chat.openai.com", "chatgpt.com", "linkedin.com", "canva.com", "overleaf.com", "indeed.com", "handshake.com"] },
  { id: "code", kinds: ["cs", "lab", "code", "coding", "program", "programming", "debug", "leetcode", "assignment code", "hw code", "pset code", "project", "side project", "app"], apps: ["Visual Studio Code", "Terminal", "Safari"], domains: ["github.com", "stackoverflow.com", "developer.mozilla.org", "docs.python.org", "docs.oracle.com", "chat.openai.com", "chatgpt.com", "canvas.northeastern.edu", "northeastern.edu", "docs.google.com", "leetcode.com"] },
  { id: "essay", kinds: ["essay", "paper", "write", "writing", "draft", "report", "brief", "thesis", "reflection", "discussion post"], apps: ["Pages", "Safari"], domains: [...SCHOOL_SITES, "jstor.org", "library.northeastern.edu", "grammarly.com"] },
  { id: "study", kinds: ["study", "studying", "revise", "revision", "midterm", "exam", "final", "quiz", "econ", "reading", "notes", "flashcards", "homework", "hw", "problem set", "pset", "lecture"], apps: ["Safari", "Notes", "Preview"], domains: [...SCHOOL_SITES, "quizlet.com", "khanacademy.org", "wikipedia.org", "coursera.org"] },
  { id: "slides", kinds: ["slides", "presentation", "deck", "pitch"], apps: ["Keynote", "Safari"], domains: [...SCHOOL_SITES, "canva.com", "slides.google.com", "figma.com"] },
];
const DEFAULT_PROFILE = { id: "default", apps: ["Safari"], domains: SCHOOL_SITES };

const FILLER = new Set(["the", "my", "a", "an", "some", "to", "on", "for", "of", "finish", "finishing", "do", "doing", "work", "working", "start", "starting", "complete", "get", "going", "up", "with", "and", "out", "some", "more", "lock", "in"]);
/** The key a task is remembered under: lowercase content words, so "Finish the Resume!" and "finish my resume" are one task. */
export const taskKey = (task) => String(task ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).join(" ") || "focus";

const words = (task) => ` ${String(task ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
function seedFor(task) {
  const text = words(task);
  let best = null, bestScore = 0;
  for (const seed of SEED) {
    const score = seed.kinds.filter((k) => text.includes(` ${k} `)).length;
    if (score > bestScore) { best = seed; bestScore = score; }
  }
  return best;
}
const uniq = (list) => [...new Set(list)];
const id = (app) => bundleIdOf(app) ?? String(app);

/** What a task gets: the kind's seed (or the default), plus what was learned or added for this very task. {apps:[bundle ids], domains, source, kind}. */
export function profileFor(store, task) {
  const seed = seedFor(task);
  const base = seed ?? DEFAULT_PROFILE;
  const own = store?.tasks?.[taskKey(task)];
  return {
    apps: uniq([...base.apps.map(id), ...(own?.apps ?? [])]),
    domains: uniq([...base.domains, ...(own?.domains ?? [])]),
    source: own ? "task" : seed ? "kind" : "default",
    kind: base.id,
  };
}

const emptyStore = () => ({ version: 1, tasks: {} });
const NOW = () => new Date().toISOString();
/** A new store with `apps` and `domains` added for this task. Apps become bundle ids; one that cannot be resolved is kept by name. */
export function rememberApps(store, task, apps = [], domains = [], now = NOW) {
  const key = taskKey(task);
  const prev = store?.tasks?.[key] ?? { apps: [], domains: [] };
  const entry = {
    apps: uniq([...prev.apps, ...apps.map(id).filter(Boolean)]),
    domains: uniq([...prev.domains, ...domains.map(normalizeDomain).filter(Boolean)]),
    updatedAt: now(),
  };
  return { version: 1, tasks: { ...(store?.tasks ?? {}), [key]: entry } };
}

// Frontmost time that says nothing about the work: the games, feeds and media he stays in, and the machine's own surfaces.
const NOT_WORK_CATEGORY = new Set(["game", "social", "media", "system"]);
const NEVER = new Set(["com.nickmadaio.orion.app", "com.apple.finder", "com.apple.loginwindow", "com.apple.systempreferences", "com.apple.SecurityAgent", "com.apple.dock"]);

function spans(rows, key, from, to) {
  const list = rows.map((r) => ({ t: Date.parse(r.at), r })).filter((x) => Number.isFinite(x.t) && x.t < to).sort((a, b) => a.t - b.t);
  const out = [];
  list.forEach((x, i) => {
    const end = Math.min(list[i + 1]?.t ?? to, to), start = Math.max(x.t, from);
    if (end <= start) return;
    const value = key(x.r);
    const last = out.at(-1);
    if (last && last.value === value && last.end === start) out[out.length - 1] = { ...last, end };
    else out.push({ value, start, end, row: x.r });
  });
  return out;
}

/** What he actually used in the window [from,to] (ms): apps and sites that stayed frontmost for more than two minutes in one stretch. */
export function learnFromHistory(rows, { from, to }) {
  const stays = (list) => list.filter((s) => s.end - s.start > MIN_STAY_MS);
  const apps = stays(spans(rows, (r) => r.bundleId ?? null, from, to))
    .filter((s) => s.value && !NEVER.has(s.value) && !NOT_WORK_CATEGORY.has(s.row.category)).map((s) => s.value);
  const domains = stays(spans(rows, (r) => normalizeDomain(r.domain), from, to))
    .filter((s) => s.value && !isBlockedSite(s.value)).map((s) => s.value);
  return { apps: uniq(apps), domains: uniq(domains) };
}

export const profilesFile = (dir) => join(dir, "focus-profiles.json");
export function loadProfiles(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed.tasks === "object" && parsed.tasks !== null && !Array.isArray(parsed.tasks) ? { version: 1, tasks: parsed.tasks } : emptyStore();
  } catch { return emptyStore(); }
}
export function saveProfiles(file, store) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, file);
}
export const readHistoryRows = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
