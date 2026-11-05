/*
 Runs a knowledge move (knowledge-moves.ts) through the scripts that own the data, and says what they did (wave 6, 2026-11-01).

   forget   orion-brain forget "<topic>" lists matching saved entries; orion-brain forget --apply <ids> archives them (reversible).
   links    orion-brain links "<thing>": graph edges and the vault's relations, said as connections.
   profile  orion-brain profile: classes, gym, side project, home and priorities first; trivia after.
   trash    orion-trash find / move --confirm "<name>": into the Trash, never rm.
 Every reply is built from the script's JSON. A script that fails is said plainly ("couldn't reach…, nothing was removed"),
 never with its name, a flag or an error string.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
import type { Candidate, KnowledgeHeld, KnowledgeMove } from "./knowledge-moves.js";
import type { TrashMove } from "./trash-move.js";

export type KnowledgeRun = (script: "orion-brain" | "orion-trash", args: string[]) => Promise<{ stdout: string; code: number }>;
export type KnowledgeOut = { text: string; held?: KnowledgeHeld; calls: string[]; outputs: string[] };

type Entry = Candidate & { where?: string; copies?: number };
type Link = { label: string; kind: string; dir: "out" | "in"; type?: string };
type Found = { path: string; shown: string; name: string; kind: "file" | "folder"; items?: number; refused?: string; exact?: boolean };

async function call<T>(run: KnowledgeRun, script: "orion-brain" | "orion-trash", args: string[], log: KnowledgeOut): Promise<T | undefined> {
  const out = await run(script, args).catch(() => ({ stdout: "", code: 1 }));
  log.calls.push(`exec ${script} ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  log.outputs.push(out.stdout);
  if (out.code !== 0) return undefined;
  try { return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as T; } catch { return undefined; }
}

const quote = (s: string) => `"${s.replace(/[.\s]+$/, "")}"`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const UNREACHABLE = "I couldn't reach your saved memory just now, so nothing was removed. Say go and I'll retry it.";

async function archive(ids: string[], run: KnowledgeRun, log: KnowledgeOut): Promise<Entry[] | undefined> {
  if (!ids.length) return [];
  const out = await call<{ archived: Entry[] }>(run, "orion-brain", ["forget", "--apply", ...ids], log);
  return out?.archived;
}

// Wave 4 review finding 5: letters and digits in any script are kept; a line with none (emoji only) has an empty key, which is never "the same".
const sameText = (s: string) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const forgotLine = (gone: Entry[]) => {
  const said = [...new Map(gone.map((g) => [sameText(g.text) || `\u0000${g.id}`, quote(g.text)])).values()];
  return said.length ? `Forgot ${list(said)}.` : "";
};
const undoHeld = (gone: Entry[]): KnowledgeHeld | undefined => (gone.length ? { kind: "forget-undo", ids: gone.map((g) => g.id), texts: gone.map((g) => g.text) } : undefined);

async function forget(move: Extract<KnowledgeMove, { kind: "forget" }>, run: KnowledgeRun, log: KnowledgeOut): Promise<KnowledgeOut> {
  const found: Array<{ topic: string; matches: Entry[] }> = [];
  for (const topic of move.targets) {
    const out = await call<{ matches: Entry[] }>(run, "orion-brain", ["forget", topic], log);
    if (!out) return { ...log, text: UNREACHABLE };
    found.push({ topic, matches: out.matches ?? [] });
  }
  // The same line saved in two notes is one memory (run-1101020721: a learned line and its copy): never "which one?" about twins.
  const oneMemory = (ms: Entry[]) => ms.length === 1 || (ms.length > 1 && ms.every((m) => sameText(m.text)) && new Set(ms.map((m) => sameText(m.text))).size === 1);
  const sure = found.filter((f) => oneMemory(f.matches) || (move.all && f.matches.length > 1));
  const unsure = move.all ? undefined : found.find((f) => !oneMemory(f.matches));
  const none = found.filter((f) => !f.matches.length).map((f) => f.topic);
  const gone = await archive([...new Set(sure.flatMap((f) => f.matches.map((m) => m.id)))], run, log);
  if (!gone) return { ...log, text: UNREACHABLE };
  const nothing = none.length ? `I have nothing saved about ${list(none.map(quote))}${gone.length ? ", so nothing else was removed" : ", so nothing was removed"}.` : "";
  if (unsure) {
    const options = unsure.matches.slice(0, 5).map((m, i) => `${i + 1}) ${m.text.replace(/[.\s]+$/, "")}`).join("; ");
    const ask = `A few saved things match ${quote(unsure.topic)}: ${options}. Which should I forget? A number, or "all".`;
    return { ...log, text: [forgotLine(gone), nothing, ask].filter(Boolean).join(" "), held: { kind: "forget-pick", candidates: unsure.matches.slice(0, 5).map(({ id, text }) => ({ id, text })), topic: unsure.topic } };
  }
  const tail = gone.length ? " It's archived, not deleted, so say \"put it back\" if that was a mistake." : "";
  return { ...log, text: [forgotLine(gone), nothing].filter(Boolean).join(" ") + tail, ...(undoHeld(gone) ? { held: undoHeld(gone)! } : {}) };
}

async function forgetPick(move: Extract<KnowledgeMove, { kind: "forget-pick" }>, run: KnowledgeRun, log: KnowledgeOut): Promise<KnowledgeOut> {
  if (!move.picked.length) return { ...log, text: "Okay, I kept all of them." };
  const gone = await archive(move.picked.map((p) => p.id), run, log);
  if (!gone) return { ...log, text: UNREACHABLE };
  if (!gone.length) return { ...log, text: "Those were already gone, so nothing changed." };
  return { ...log, text: `${forgotLine(gone)} The rest stays.`, ...(undoHeld(gone) ? { held: undoHeld(gone)! } : {}) };
}

async function forgetUndo(move: Extract<KnowledgeMove, { kind: "forget-undo" }>, run: KnowledgeRun, log: KnowledgeOut): Promise<KnowledgeOut> {
  const out = await call<{ restored: Entry[] }>(run, "orion-brain", ["forget", "--restore", ...move.held.ids], log);
  if (!out) return { ...log, text: "I couldn't put that back just now; it's still archived, so nothing is lost. Say go and I'll retry it." };
  return { ...log, text: out.restored.length ? `Put back ${list(out.restored.map((r) => quote(r.text)))}.` : "That was already back." };
}

// ---- links ---------------------------------------------------------------------------------------------------------------
const phrase = (l: Link): string => {
  const words = l.kind.replace(/[_-]+/g, " ").trim();
  if (l.kind === "mentioned in") return "mentions it";
  if (l.dir === "in") return `${words} it`;
  const has = /^has (.+)$/.exec(words)?.[1];
  if (has) return has;
  return words === "mentions" ? (l.type || "mentioned") : words;
};
const LINK_LIMIT = 10;
type Fallback = { from: string; via: string; why: "class" | "title" };
type LinksOut = { found: boolean; subject: string; title?: string; facts?: string[]; links: Link[]; fallback?: Fallback };
/** run-1101020721 kno-connections-v: a subject that is no node falls back to the nearest one, and the reply says which. */
function fallbackLine(f: Fallback, title: string): string {
  return f.why === "class"
    ? `I don't have a note called ${quote(f.from)} itself, so here's the nearest: ${title}, the class ${quote(f.via)} belongs to.`
    : `I don't have a note called ${quote(f.from)} itself, so here's the closest one, ${title}.`;
}
function linksReply(out: LinksOut): string {
  const body = linksBody(out);
  return out.found && out.fallback ? `${fallbackLine(out.fallback, out.title ?? out.subject)} ${body}` : body;
}
function linksBody(out: LinksOut): string {
  if (!out.found) return `I don't have anything called ${quote(out.subject)} in your notes or knowledge graph.`;
  const title = out.title ?? out.subject;
  const fact = out.facts?.[0] ? `, ${lower1(out.facts[0].replace(/[.\s]+$/, ""))},` : "";
  if (!out.links.length) return `${title}${fact} is in your notes, but nothing is linked to it yet.`;
  const rank = (l: Link) => (l.kind === "mentioned in" || l.kind === "mentions" ? 2 : /^nick$/i.test(l.label) ? 1 : 0);
  const ordered = [...out.links].sort((a, b) => rank(a) - rank(b));
  const shown = ordered.slice(0, LINK_LIMIT).map((l) => `${l.label} (${phrase(l)})`);
  const more = ordered.length > LINK_LIMIT ? `, and ${ordered.length - LINK_LIMIT} more` : "";
  return `${title}${fact} links to: ${shown.join(", ")}${more}.`;
}

// ---- profile -------------------------------------------------------------------------------------------------------------
type Profile = { name?: string; school?: string; classes?: string[]; gym?: string; sideProject?: string; priorities?: string; home?: string; commute?: string; builds?: string[]; working?: string[]; trivia?: string[]; learned?: string[] };
const sentence = (s: string) => s.replace(/[.\s]+$/, "") + ".";
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
function distinct(lines: string[], max: number): string[] {
  const key = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return lines.reduceRight<string[]>((kept, line) => {
    if (kept.length >= max) return kept;
    const k = key(line);
    const near = kept.some((x) => { const kx = key(x); const shared = [...k].filter((w) => kx.has(w)).length; return shared >= Math.min(k.size, kx.size) * 0.6; });
    return near ? kept : [...kept, line];
  }, []).reverse();
}
/** A saved line is in the third person ("Nick takes creatine"); said to him it is "you take creatine". */
const IRREGULAR: Record<string, string> = { is: "you're", has: "you have", does: "you do", was: "you were" };
const toYou = (s: string): string => s
  .replace(/\bNick's\b/g, "your")
  .replace(/\bNick (is|has|does|was)\b/g, (_m, v: string) => IRREGULAR[v] ?? `you ${v}`)
  .replace(/\bNick (\w+)\b/g, (_m, v: string) => `you ${/(?:ch|sh|ss|x)es$/.test(v) ? v.slice(0, -2) : /[^s]s$/.test(v) ? v.slice(0, -1) : v}`);
function profileReply(p: Profile): string {
  const lead = p.name ? `You're ${p.name}${p.school ? `, at ${p.school}` : ""}.` : p.school ? `You're at ${p.school}.` : "";
  const stable = [
    lead,
    p.classes?.length ? `Classes: ${list(p.classes)}.` : "",
    p.gym ? `Gym: ${sentence(p.gym)}` : "",
    p.sideProject ? `Side project: ${sentence(p.sideProject)}` : "",
    p.home ? `Home: ${p.home}${p.commute ? `, ${p.commute}` : ""}.` : "",
    p.priorities ? `Priorities, highest first: ${sentence(p.priorities)}` : "",
    p.builds?.length || p.working?.length ? `You're ${[p.builds?.length ? `building ${list(p.builds)}` : "", p.working?.length ? `working on ${list(p.working)}` : ""].filter(Boolean).join(" and ")}.` : "",
  ].filter(Boolean);
  if (!stable.length) return "I don't have your profile on record yet: no classes, gym or home saved. Tell me and I'll keep it.";
  const trivia = (p.trivia ?? []).slice(0, 2).map((t) => lower1(t.replace(/\s*\([^)]*\)/g, "").replace(/[.\s]+$/, "")));
  const extra = trivia.length ? `Routine-wise, you ${list(trivia.map((t) => t.replace(/^(falls|wakes|usually up)/, (w) => ({ falls: "fall", wakes: "wake", "usually up": "are usually up" })[w] ?? w)))}.` : "";
  const told = distinct(p.learned ?? [], 3);
  const learned = told.length ? `You've also told me: ${told.map((t) => toYou(t.replace(/[.\s]+$/, ""))).join("; ")}.` : "";
  return [...stable, extra, learned].filter(Boolean).join(" ");
}

/** "Do you know me": the key facts in two or three warm sentences; the rest waits for "be specific". */
function briefProfile(p: Profile): string {
  if (!p.name && !p.school && !p.classes?.length && !p.home) return profileReply(p);
  const classes = p.classes ?? [];
  const named = classes.length > 3 ? `${classes.length} classes, ${list([...classes.slice(0, 3), "the rest"])}` : classes.length ? list(classes) : "";
  const who = `Yeah, you're ${p.name?.split(" ")[0] ?? "you"}${p.school ? `, at ${p.school}` : ""}${named ? ` taking ${named}` : ""}.`;
  const life = [p.home ? `you live in ${p.home}` : "", p.gym ? "you hit the gym every day" : "", p.builds?.length ? `you're building ${list(p.builds)}` : p.sideProject ? "you put time into a side project daily" : ""].filter(Boolean);
  const second = life.length ? `${life[0]!.charAt(0).toUpperCase()}${life[0]!.slice(1)}${life.length > 1 ? `, ${list(life.slice(1))}` : ""}.` : "";
  return [who, second, "Say \"be specific\" and I'll give you the rest."].filter(Boolean).join(" ");
}

// ---- trash ---------------------------------------------------------------------------------------------------------------
const parent = (shown: string) => shown.split("/").slice(0, -1).join("/") || shown;
const movedLine = (f: { name: string; shown: string }, folder: boolean) => `Moved ${folder ? "the folder " : ""}${f.name} (${parent(f.shown)}) to the Trash. Nothing else was touched, and you can put it back from the Trash.`;

async function trash(move: TrashMove, run: KnowledgeRun, log: KnowledgeOut): Promise<KnowledgeOut> {
  const where = move.root ? `your ${move.root.charAt(0).toUpperCase()}${move.root.slice(1)}` : "your Desktop, Documents or Downloads";
  if (/^(?:desktop|documents|docs|downloads?|home|library|applications)$/i.test(move.name)) return { ...log, text: `I won't move your whole ${move.name} folder to the Trash. Tell me which file or folder inside it.` };
  const args = ["find", move.name, ...(move.root ? ["--root", move.root] : []), ...(move.within ? ["--in", move.within] : [])];
  const out = await call<{ matches: Found[] }>(run, "orion-trash", args, log);
  if (!out) return { ...log, text: "I couldn't check your files just now, so nothing was touched." };
  const kinds = out.matches.filter((f) => (move.folder ? f.kind === "folder" : f.kind === "file") || !move.folder);
  if (!kinds.length) return { ...log, text: `I couldn't find ${move.name}${move.within ? ` in ${move.within}` : ""} in ${where}, so nothing was touched.` };
  const allowed = kinds.filter((f) => !f.refused);
  if (!allowed.length) return { ...log, text: `I won't move ${move.name} to the Trash: ${kinds[0]!.refused}. Nothing was touched.` };
  if (allowed.length > 1) return { ...log, text: `There's more than one ${move.name}: ${allowed.slice(0, 4).map((f, i) => `${i + 1}) ${f.shown}`).join("; ")}. Which folder is it in? Nothing was touched.` };
  const f = allowed[0]!;
  if (f.kind === "folder") {
    const items = f.items === undefined ? "" : `, ${f.items} item${f.items === 1 ? "" : "s"}`;
    return { ...log, text: `Move the folder ${quote(f.name)} (${f.shown}${items}) to the Trash? Say yes and I'll do it.`, held: { kind: "trash-confirm", path: f.path, name: f.name, shown: f.shown, folder: true } };
  }
  if (!placedAsSaid(f, move)) return { ...log, text: `Move ${f.name} (${f.shown}) to the Trash? Say yes and I'll do it.`, held: { kind: "trash-confirm", path: f.path, name: f.name, shown: f.shown } };
  return moveIt({ path: f.path, name: f.name, shown: f.shown }, false, run, log);
}

/**
 REV6 MUST 2: the find is loose (case, punctuation, four levels across all three roots), and --confirm is filled from it, so it is no
 confirmation. A file moves at once only when its name is exactly what he said AND it sits in the root or folder he named; otherwise
 he is asked, by its real name and place, as folders already are.
*/
function placedAsSaid(f: Found, move: TrashMove): boolean {
  if (f.exact !== true || f.name !== move.name) return false;
  const dirs = f.shown.split("/").slice(0, -1).map((d) => d.toLowerCase());
  if (move.within) return dirs.slice(1).includes(move.within.toLowerCase());
  return !!move.root && dirs[0] === move.root;
}

async function moveIt(f: { path: string; name: string; shown: string }, folder: boolean, run: KnowledgeRun, log: KnowledgeOut): Promise<KnowledgeOut> {
  const done = await call<{ ok: boolean; refused?: string }>(run, "orion-trash", ["move", f.path, "--confirm", f.name], log);
  if (!done) return { ...log, text: `I couldn't move ${f.name} just now, so nothing was touched.` };
  if (!done.ok) return { ...log, text: `I didn't move ${f.name}: ${done.refused ?? "it was refused"}. Nothing was touched.` };
  return { ...log, text: movedLine(f, folder) };
}

/** Runs one move; `held` is what the reply now waits on (one turn). */
export async function runKnowledgeMove(move: KnowledgeMove, run: KnowledgeRun): Promise<KnowledgeOut> {
  const log: KnowledgeOut = { text: "", calls: [], outputs: [] };
  switch (move.kind) {
    case "forget": return forget(move, run, log);
    case "forget-pick": return forgetPick(move, run, log);
    case "forget-undo": return forgetUndo(move, run, log);
    case "links": {
      const out = await call<LinksOut>(run, "orion-brain", ["links", move.subject], log);
      return { ...log, text: out ? linksReply(out) : "I couldn't read your knowledge graph just now. Say go and I'll retry it." };
    }
    case "profile": {
      const out = await call<Profile>(run, "orion-brain", ["profile"], log);
      if (!out) return { ...log, text: "I couldn't read what I have on you just now. Say go and I'll retry it." };
      return move.brief ? { ...log, text: briefProfile(out), held: { kind: "profile-more" } } : { ...log, text: profileReply(out) };
    }
    case "trash": return trash(move, run, log);
    case "trash-confirm":
      return move.yes ? moveIt(move.held, !!move.held.folder, run, log) : { ...log, text: `Okay, I left ${move.held.name} where it is.` };
  }
}

/** The real scripts (no shell, fixed argument lists), found by the plugin's scripts-dir resolver. Wired in by index.ts only. */
export const liveKnowledgeRun: KnowledgeRun = (script, args) => new Promise((resolve) =>
  execFile(scriptPath(script), args, { timeout: 15000, maxBuffer: 1 << 20 }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 })));
