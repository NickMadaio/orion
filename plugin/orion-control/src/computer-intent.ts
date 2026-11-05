/**
 * Which of Nick's turns are computer use, and what they ask for (2026-10-30).
 *
 * Code, not the 9B, reads the request: a small closed set of clauses (open an app, new document, type, click,
 * close tabs or a window, focus a window, a menu path, scroll, read the screen). The model is used later only to
 * pick among on-screen candidates. Only Nick's own words come in here, never screen text, so nothing read off
 * the screen can add a clause.
 *
 * Conservative on purpose: a turn about messages, files, the calendar, reminders or secrets is never claimed
 * (those have their own flows and gates), and a turn with no UI object ("type up my essay tonight") is not either.
 */
import type { RoleGroup } from "./computer-ax.js";

export type AppRef = { readonly name: string; readonly bundleId?: string };
export type TargetRef = { readonly words: string; readonly group: RoleGroup; readonly generic: boolean };
export type TabFilter =
  | { readonly mode: "all" }
  | { readonly mode: "keep" | "only"; readonly words: string; readonly count?: number }
  | { readonly mode: "ambiguous"; readonly words: string };

export type Clause =
  | { readonly kind: "open"; readonly app: AppRef }
  | { readonly kind: "new_doc"; readonly title?: string; readonly body?: string }
  | { readonly kind: "type"; readonly text: string; readonly into?: TargetRef }
  | { readonly kind: "click"; readonly target: TargetRef }
  | { readonly kind: "close_tabs"; readonly filter: TabFilter }
  | { readonly kind: "close_window"; readonly discard: boolean }
  | { readonly kind: "focus"; readonly title: string }
  | { readonly kind: "menu"; readonly path: readonly string[] }
  | { readonly kind: "scroll"; readonly direction: "up" | "down" }
  | { readonly kind: "read_back" };

export type ComputerIntent =
  | { readonly kind: "read"; readonly question: string; readonly wantsSummary: boolean }
  | { readonly kind: "act"; readonly app?: AppRef; readonly clauses: readonly Clause[]; readonly text: string };

/** Apps he names, by the words he uses for them. Unknown names still open by name (`open -a`). */
export const APPS: Readonly<Record<string, AppRef>> = {
  notes: { name: "Notes", bundleId: "com.apple.Notes" },
  textedit: { name: "TextEdit", bundleId: "com.apple.TextEdit" },
  "text edit": { name: "TextEdit", bundleId: "com.apple.TextEdit" },
  safari: { name: "Safari", bundleId: "com.apple.Safari" },
  chrome: { name: "Google Chrome", bundleId: "com.google.Chrome" },
  opera: { name: "Opera", bundleId: "com.operasoftware.Opera" },
  finder: { name: "Finder", bundleId: "com.apple.finder" },
  preview: { name: "Preview", bundleId: "com.apple.Preview" },
  mail: { name: "Mail", bundleId: "com.apple.mail" },
  messages: { name: "Messages", bundleId: "com.apple.MobileSMS" },
  music: { name: "Music", bundleId: "com.apple.Music" },
  spotify: { name: "Spotify", bundleId: "com.spotify.client" },
  pages: { name: "Pages", bundleId: "com.apple.iWork.Pages" },
  keynote: { name: "Keynote", bundleId: "com.apple.iWork.Keynote" },
  numbers: { name: "Numbers", bundleId: "com.apple.iWork.Numbers" },
  word: { name: "Microsoft Word", bundleId: "com.microsoft.Word" },
  powerpoint: { name: "Microsoft PowerPoint", bundleId: "com.microsoft.Powerpoint" },
  excel: { name: "Microsoft Excel", bundleId: "com.microsoft.Excel" },
  calculator: { name: "Calculator", bundleId: "com.apple.calculator" },
  discord: { name: "Discord", bundleId: "com.hnc.Discord" },
  slack: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
  terminal: { name: "Terminal", bundleId: "com.apple.Terminal" },
  "system settings": { name: "System Settings", bundleId: "com.apple.systempreferences" },
};

const APP_WORDS = Object.keys(APPS).sort((a, b) => b.length - a.length).join("|");
const APP_RE = new RegExp(`\\b(${APP_WORDS})(?:\\s+app)?\\b`, "i");

/** Turns that belong to other flows even when they share a verb with computer use. */
const NOT_OURS = [
  /\b(?:text|message|imessage|email|e-mail|dm|ping)\s+(?!(?:edit|field|box|area|input)\b)[a-z]+\b/i, // "text annika", never "textedit" or "text field"
  /\bdraft\b/i,
  /\b(?:calendar|schedule|week|blocks?|class(?:es)?|gym|deadline)\b/i,
  /\b(?:remind|reminder|to-?dos?|alarm|timer)\b/i,
  /\b(?:api\s+keys?|passwords?|secrets?|connectors?|keychain|tokens?)\b/i,
  /\b(?:folder|directory|\.txt|\.pdf|\.docx?|files?\b(?!\s*(?:>|→|->)))/i,
];

/** w20 r3 (#5, #55): a sentence about WHEN something is or where it goes back to is his schedule, never text for the Mac's keyboard. */
const SCHEDULE_SHAPE = /\b(?:at|by|around|@)\s*(?:\d|half\b|quarter\b|noon\b|midnight\b)|\bback\s+(?:where|how|to|as|like)\b|\b(?:where|how)\s+(?:it|they)\s+(?:was|were)\b|\b(?:before|after)\s+(?:lunch|dinner|class|my|the)\b|\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;

const READ_RE = /\b(?:what(?:'|’)?s|what is)\s+on\s+(?:my|the)\s+screen\b|\b(?:look|glance)\s+at\s+(?:my|the)\s+screen\b|\bread\s+(?:me\s+)?(?:this|the|my)\s+(?:slide|page|screen|window|doc(?:ument)?|article)\b|\bwhat\s+am\s+i\s+looking\s+at\b|\bsummari[sz]e\s+(?:this|the|my)\s+(?:slide|page|screen|window)\b|\bwhat(?:'|’)?s\s+(?:this|on\s+this)\s+(?:slide|page|window)\b/i;
const SUMMARY_RE = /\bsummari[sz]e|\bbullets?\b|\btl;?dr\b|\bgist\b|\bexplain\b/i;

/** Where one request becomes several steps: commas, "then", and "and" before a step verb. */
const STEP_VERBS = "open|pull up|bring up|fire up|launch|make|create|start|type|write|enter|put|click|press|hit|tap|close|quit|read|focus|switch|go|scroll|title|name|call|select|choose|use";
const SPLIT_RE = new RegExp(`\\s*,\\s*(?:and\\s+)?(?:then\\s+)?|\\s+(?:and\\s+)?then\\s+|\\s+and\\s+(?=(?:${STEP_VERBS})\\b)`, "i");

function appIn(text: string): AppRef | undefined {
  const match = text.match(APP_RE);
  return match ? APPS[match[1]!.toLowerCase()] : undefined;
}

const GENERIC_TARGET = /^(?:the|that|this|a)?\s*(?:button|box|field|text\s*field|text\s*box|input|thing|one|it)?(?:\s+(?:on|in)\s+(?:the|this|that)\s+(?:page|form|window|screen|site))?$/i;

function groupFor(words: string, fallback: RoleGroup): RoleGroup {
  if (/\b(?:field|box|input|search\s*bar|text\s*area)\b/i.test(words)) return "editable";
  if (/\btab\b/i.test(words)) return "tab";
  return fallback;
}

function targetRef(raw: string, fallback: RoleGroup): TargetRef {
  const trimmed = raw.replace(/\s+(?:on|in)\s+(?:the|this|that)\s+(?:test\s+)?(?:page|form|window|screen|site)$/i, "").trim();
  const group = groupFor(raw, fallback);
  if (GENERIC_TARGET.test(raw.trim()) || GENERIC_TARGET.test(trimmed)) return { words: "", group, generic: true };
  const words = trimmed.replace(/^(?:the|that|this|a|an|my)\s+/i, "").replace(/\s+(?:button|link|tab|checkbox)$/i, "").trim();
  return { words: words.toLowerCase(), group, generic: words === "" };
}

function stripQuotes(text: string): string {
  const quoted = text.match(/^["“'‘](.*)["”'’]$/);
  return (quoted ? quoted[1]! : text).trim();
}

/** "close the 4 tabs that arent econ", "close the econ tabs", "close all the junk tabs", "close my safari tabs". */
function tabFilter(clause: string): TabFilter {
  const count = Number(clause.match(/\b(\d{1,2})\s+tabs?\b/i)?.[1] ?? NaN);
  const withCount = <T extends object>(f: T): T => (Number.isFinite(count) ? { ...f, count } : f);
  const keep = clause.match(/tabs?\s+(?:that\s+)?(?:are\s*n[o']?t|arent|aren’t|are\s+not|not|except(?:\s+for)?|other\s+than|without)\s+(?:about\s+|the\s+)?([a-z0-9 ]+?)(?:\s+(?:ones?|tabs?))?(?:\s+in\s+[a-z ]+)?$/i);
  if (keep) return withCount({ mode: "keep" as const, words: keep[1]!.trim().toLowerCase() });
  const vague = clause.match(/\b(junk|useless|unneeded|unnecessary|random|old|extra|irrelevant|pointless)\b/i);
  if (vague) return { mode: "ambiguous", words: vague[1]!.toLowerCase() };
  const about = clause.match(/tabs?\s+(?:about|on|for|with)\s+([a-z0-9 ]+?)(?:\s+in\s+[a-z ]+)?$/i)
    ?? clause.match(/\bthe\s+([a-z0-9 ]+?)\s+tabs?\b/i);
  const word = about?.[1]?.trim().toLowerCase();
  if (word && !/^(?:all|all the|\d+|my|open|other)$/.test(word) && !APPS[word]) return withCount({ mode: "only" as const, words: word });
  return { mode: "all" };
}

function parseClause(raw: string, appNamed = false): Clause | "title" | null {
  const clause = raw.trim().replace(/[.!?]+$/, "");
  const text = clause.replace(/^(?:please|pls|can you|could you|now)\s+/i, "");
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(?:title|name|call)\s+it\s+(.+)$/i))) return { kind: "new_doc", title: stripQuotes(m[1]!) };
  if (/\btabs?\b/i.test(text) && /^(?:close|kill|get rid of|shut)\b/i.test(text)) return { kind: "close_tabs", filter: tabFilter(text) };
  if ((m = text.match(/^(?:close|shut)\s+(?:it|this|that|the\s+(?:doc(?:ument)?|window|note|file)|this\s+window)\b(.*)$/i))) {
    return { kind: "close_window", discard: /\b(?:without\s+saving|don['’]?t\s+save|no\s+save|discard)\b/i.test(m[1] ?? "") };
  }
  if ((m = text.match(/^(?:make|create|start|open)\s+(?:a\s+)?(?:new\s+)?(?:one|note|doc(?:ument)?|page|file)(?:\s+(?:called|titled|named)\s+(.+))?$/i))
    && (/\bnew\b|\bone\b|called|titled|named/i.test(text) || /^(?:make|create|start)\b/i.test(text))) {
    return m[1] ? { kind: "new_doc", title: stripQuotes(m[1]) } : { kind: "new_doc" };
  }
  // "put" types only into a named place ("put hello in the box"): bare, it is "put the gym at 7", his schedule.
  if ((m = text.match(/^(?:type|write|enter|put)\s+(?:in\s+)?(["“].+?["”]|.+?)(?:\s+(?:in|into)\s+(.+))?$/i)) && !/^up\b/i.test(m[1]!) && (!/^put\b/i.test(text) || m[2] || appNamed)) {
    const into = m[2] ? targetRef(m[2], "editable") : undefined;
    return into ? { kind: "type", text: stripQuotes(m[1]!), into } : { kind: "type", text: stripQuotes(m[1]!) };
  }
  if (/^read\s+(?:it|that|this)\s+back\b/i.test(text)) return { kind: "read_back" };
  if ((m = text.match(/^(?:click|press|hit|tap|select|choose|use)\s+(?:on\s+)?(?:the\s+)?([A-Za-z][\w ]*?)\s*(?:>|→|->)\s*(.+)$/i))) {
    return { kind: "menu", path: [m[1]!.trim(), ...m[2]!.split(/\s*(?:>|→|->)\s*/).map((s) => s.trim())] };
  }
  if ((m = text.match(/^(?:click|press|hit|tap)\s+(?:on\s+)?(.+)$/i))) return { kind: "click", target: targetRef(m[1]!, "pressable") };
  if ((m = text.match(/^(?:switch|go|focus)\s+(?:to\s+|on\s+)?(?:the\s+)?(.+?)\s+window\b/i))) return { kind: "focus", title: m[1]!.trim().toLowerCase() };
  if ((m = text.match(/^scroll\s+(up|down)\b/i))) return { kind: "scroll", direction: m[1]!.toLowerCase() as "up" | "down" };
  if ((m = text.match(/^(?:open|launch|start|pull\s+up|bring\s+up|fire\s+up)\s+(?:up\s+)?(?:the\s+)?(.+?)(?:\s+app)?$/i))) {
    const app = appIn(m[1]!);
    return app ? { kind: "open", app } : null;
  }
  return null;
}

/** Moves "in safari," / "in safari" out of a clause, so "close the 4 tabs that arent econ in safari" parses. */
function stripAppContext(clause: string): string {
  return clause.replace(new RegExp(`^in\\s+(?:the\\s+)?(?:${APP_WORDS})(?:\\s+app)?\\s*,?\\s*`, "i"), "")
    .replace(new RegExp(`\\s+in\\s+(?:the\\s+)?(?:${APP_WORDS})(?:\\s+app)?$`, "i"), "")
    .replace(new RegExp(`\\bmy\\s+(?:${APP_WORDS})\\s+tabs\\b`, "i"), "my tabs");
}

/** Joins "make a new note" + "title it X" into one new-note clause. */
function mergeTitles(clauses: readonly (Clause | "title")[]): Clause[] {
  const out: Clause[] = [];
  for (const clause of clauses) {
    if (clause === "title") continue;
    const last = out[out.length - 1];
    if (clause.kind === "new_doc" && last?.kind === "new_doc" && !last.title && clause.title) {
      out[out.length - 1] = { ...last, title: clause.title };
    } else out.push(clause);
  }
  return out;
}

export function detectComputerIntent(message: string): ComputerIntent | null {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (READ_RE.test(text)) return { kind: "read", question: text, wantsSummary: SUMMARY_RE.test(text) };
  if (NOT_OURS.some((re) => re.test(text))) return null;
  if (SCHEDULE_SHAPE.test(text.replace(/["“][^"”]*["”]/g, " "))) return null;
  const app = appIn(text);
  // Quoted text is typed verbatim: shield it from the clause split (its commas are not step boundaries).
  const quotes: string[] = [];
  const shielded = text.replace(/["“][^"”]*["”]/g, (q) => `\u0000${quotes.push(q) - 1}\u0000`);
  const unshield = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quotes[Number(i)] ?? "");
  const pieces = shielded.replace(/^in\s+[a-z ]+?,\s*/i, (lead) => (appIn(lead) ? "" : lead)).split(SPLIT_RE).filter(Boolean);
  const parsed = pieces.map((piece) => parseClause(stripAppContext(unshield(piece)), !!app && new RegExp(`\\bin\\s+(?:the\\s+)?(?:${APP_WORDS})\\b`, "i").test(unshield(piece))));
  if (parsed.length === 0 || parsed.some((c) => c === null)) return null;
  const clauses = mergeTitles(parsed as (Clause | "title")[]);
  if (clauses.length === 0) return null;
  return app ? { kind: "act", app, clauses, text } : { kind: "act", clauses, text };
}
