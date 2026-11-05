/*
 Plain asks that code does itself (w20 round 3, live gate 2026-11-05 turns 35, 36, 38, 39, 43).

   "open amazon uk" / "open youtube in safari"   the 9B answered "the browser tool needs a URL ... want me to open it now?" and asked
                                                 permission for something that is pre-approved. Code opens it and says so.
   "open spotify and add milk to my list"        both asks run; one reply says what happened to each. An app that is not installed
                                                 is said not to be installed, with the web player offered ("yeah" opens it).
   "add milk to my list"                         his list is the to-do list the phone's Lists tab shows (orion-tasks): no time, no question.
   "whats on my todo list"                       read from that list by code (68 s of silence and an empty reply when the worker did it).

 Pure parsing plus one runner whose effects are injected (open, installed, tasks), so tests never touch his Mac.
*/
import { openRequest, type OpenRequest } from "./open-request.js";
import { splitAsks } from "./multi-ask.js";

export type ChatAsk =
  | { kind: "open"; req: Extract<OpenRequest, { kind: "app" | "url" }> }
  | { kind: "list-add"; item: string }
  | { kind: "todo-list" };

export type Exec = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type ChatDeps = { open: Exec; installed: (app: string) => Promise<boolean>; tasks: Exec };
/** A question ORION asked that a bare "yeah" answers: open this address. */
export type WebOffer = { url: string; label: string };
export type ChatOut = { text: string; calls: string[]; outputs: string[]; offer?: WebOffer };

const LEAD = String.raw`(?:(?:hey|ok|okay|so|and|also|pls|please|orion|can you|could you|can u|would you|just|wait|yo)[,\s]+)*`;
const ADD = new RegExp(String.raw`^${LEAD}(?:add|put|stick|throw|pop|chuck)\s+(.+?)\s+(?:to|on|onto|in|into)\s+(?:my|the|our)\s+(?:(?:to-?do|todo|to do|shopping|grocery|groceries|task)\s+)?(?:lists?|to-?dos?|tasks)\s*[.!]*$`, "i");
const NOT_A_LIST_ITEM = /\b(?:calendar|schedule|reminders?|alarm|timer|plan|day|tonight|tomorrow|today|at \d|\d\s*(?:am|pm))\b/i;
const READ = new RegExp(String.raw`^${LEAD}(?:(?:whats|what's|what is|what are|wats|show me|show|read me|read out|read|list|give me|tell me|pull up|check)\s+(?:on\s+)?(?:my|the)\s+(?:(?:to-?do|todo|to do|task|shopping)\s*)?(?:lists?|to-?dos?|tasks?)(?:\s+(?:rn|right now|now|again|please|pls))?|what(?:'?s| is| do i have)\s+(?:left\s+)?on\s+(?:my\s+)?(?:to-?dos?|list)|what\s+(?:to-?dos?|tasks)\s+do\s+i\s+have(?:\s+(?:left|open))?|(?:any|have i got any)\s+(?:to-?dos?|tasks)\s+(?:left|open|outstanding))\s*[?.!]*$`, "i");

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// Foods and things that are one item although they say "and" (w20 r4: "add eggs and bread" is two rows, "add salt and pepper" is one).
const ONE_THING = /\b(?:salt and pepper|mac and cheese|macaroni and cheese|fish and chips|bread and butter|peanut butter and jelly|beans and rice|rice and beans|ham and cheese|cheese and onion|surf and turf|bangers and mash|sweet and sour|black and white|pen and paper|bits and bobs)\b/gi;
const ARTICLE = /^(?:a|an|the|some|another|more|a bit of|a couple of|a few)\s+/i;

/** "oat milk and a phone charger cable" is two items, each its own row (so ticking one off finds it); "salt and pepper" stays one. */
export function splitListItems(text: string): string[] {
  const kept: string[] = [];
  const guarded = text.replace(ONE_THING, (m) => { kept.push(m); return `\u0001${kept.length - 1}\u0001`; });
  const parts = guarded.split(/\s*(?:,|;|&|\band\b|\bplus\b|\balso\b)\s*/i).map((p) => p.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]!).trim().replace(ARTICLE, "").trim()).filter((p) => /[a-z0-9]/i.test(p));
  return [...new Set(parts)];
}

function readOne(clause: string): ChatAsk[] | null {
  const said = clause.trim().replace(/\s+/g, " ");
  if (!said) return null;
  const add = ADD.exec(said)?.[1]?.trim().replace(/^(?:some|a bit of)\s+/i, "");
  if (add && add.length <= 120 && !NOT_A_LIST_ITEM.test(add) && /[a-z0-9]/i.test(add)) {
    const items = splitListItems(add);
    if (items.length && items.length <= 8 && items.every((i) => i.length <= 80)) return items.map((item) => ({ kind: "list-add" as const, item }));
  }
  if (READ.test(said) && !/\b(?:calendar|schedule|day)\b/i.test(said)) return [{ kind: "todo-list" }];
  const open = openRequest(said);
  if (open && (open.kind === "app" || open.kind === "url")) return [{ kind: "open", req: open }];
  return null;
}

/** What code does for this message, or null when any part of it is something else (the worker or another flow keeps it). */
export function readChatAsks(message: string): ChatAsk[] | null {
  const one = readOne(message);
  if (one) return one;
  const parts = splitAsks(message);
  if (!parts) return null;
  const asks = parts.map(readOne);
  return asks.every((a): a is ChatAsk[] => a !== null) ? asks.flat() : null;
}

const LIST_ITEM = new RegExp(String.raw`^${LEAD}(?:a |another |one more |new )?(?:list|to-?do|todo|task) item\s*[:,-]?\s*(.+)$`, "i");
export const THEN_ASK = /\s*(?:,\s*)?(?:and\s+then|then|and\s+also|also|and)\s+(?=(?:tell|show|what|whats|what's|how|when|is|are|do|any|anything|check|read|give)\b)/i;
/** "and a list item: pick up parcel from reception, then tell me whats on tomorrow evening": the list add (run by code) and the question left to answer. */
export function splitLeadListItem(message: string): { item: string; rest: string } | null {
  const at = THEN_ASK.exec(message);
  if (!at) return null;
  const head = message.slice(0, at.index).trim().replace(/[.,;!]+$/, ""); const rest = message.slice(at.index + at[0].length).trim();
  const item = (LIST_ITEM.exec(head)?.[1] ?? ADD.exec(head)?.[1])?.trim().replace(/^(?:some|a bit of)\s+/i, "");
  return item && rest && item.length <= 80 && !NOT_A_LIST_ITEM.test(item) && /[a-z0-9]/i.test(item) ? { item, rest } : null;
}

// "and batteries", "oh and a charger", "also bin bags": right after a list add, a bare "and X" is one more item for the same list (w20 r5 #88).
const FOLLOW_LEAD = /^(?:(?:oh|ok|okay|hey|actually|wait|yeah|yep|um|uh|so|pls|please)[,\s]+)*(?:and also|oh and|and|also|plus)\s+/i;
const NOT_AN_ITEM = /^(?:add|put|stick|set|open|remind|move|cancel|what|whats|what's|how|can|could|do|did|is|are|tell|show|turn|play|start|stop|go|make|call|text|log|tick|mark|remove|delete|undo|i|im|i'm|my|the day|when|why|who|where|then|that|this|it|if|but|so|not|no|yes|nah|thanks|thank)\b/i;
// A follow-up item must look like a thing to buy or do: no verb (move, book, cancel...), no acknowledgement, filler or feeling, no "nothing / that's all" (review r5).
const NOT_A_NOUN_ITEM = new RegExp(String.raw`\b(?:${[
  "move|moves|book|schedule|reschedule|cancel|push|shift|delay|postpone|swap|extend|resize|drop|skip|undo|delete|remove|clear|set|start|stop|send|email|text|message|call|ring|buy|get|got|go|going|goes|do|does|did|done|have|has|had|be|is|are|was|were|am|will|would|should|could|can|may|might|need|needs|want|wanna|gonna|remember|forget|check|look|find|make|take|bring|give|let|tell|ask|say|see|try|use|clean|fix|finish|study|work|read|write|open|close|play|turn|switch|plan|pick|grab|pay|order|add|put|stick|log|tick|mark|show|help|think|know|mean|feel|wait|stay|keep|change|update|rename|wake|sleep|eat|ate|drink|walk|run|meet|visit|leave|come|came|arrive|reply|answer|submit|upload|download|install|print|share|save",
  "ok|okay|kk|k|lol|lmao|rofl|haha|hehe|yeah|yep|yup|yes|ya|no|nah|nope|idk|hmm|hm|um|uh|umm|er|ah|oh|thanks|thx|ty|thank|cool|nice|sure|fine|alright|aight|whatever|nothing|else|anything|everything|all|thats|that's|that|it|its|same|too|either|please|pls|sorry|wow|ugh|bruh|damn|great|good|bad|tired|sad|stressed|hungry|bored|angry|annoyed|happy|worried|anxious|honestly|actually|basically|literally|just|maybe|probably|never|always|also|and|or|but|so|then|now|later|soon|today|tomorrow|tonight|yesterday|me|my|i|im|i'm|we|you|he|she|they|this|there|here|what|why|how|when|where|who|which|if|not|dont|don't|cant|can't|wont|won't",
].join("|")})\b`, "i");
/** The items of a bare "and X" follow-up, or null when it is anything else (a verb, a question, a time, a calendar word). */
export function readListFollowUp(message: string): string[] | null {
  const m = message.trim().replace(/\s+/g, " ");
  const lead = FOLLOW_LEAD.exec(m);
  if (!lead || /\?\s*$/.test(m)) return null;
  const rest = m.slice(lead[0].length).replace(/[.!]+$/, "").trim();
  if (!rest) return null;
  if (rest.length > 80 || NOT_AN_ITEM.test(rest) || NOT_A_LIST_ITEM.test(rest) || /\b(?:my list|the list|to-?dos?)\b/i.test(rest)) return null;
  const items = splitListItems(rest);
  return items.length && items.length <= 5 && !items.some((i) => NOT_A_NOUN_ITEM.test(i)) && items.every((i) => i.length <= 60 && i.split(" ").length <= 6) ? items : null;
}

const TRAILING_LIST = new RegExp(String.raw`^(.*?\S)\s*(?:,|;)?\s*(?:and then|and also|and|then|also)\s+((?:add|put|stick|throw|pop|chuck)\s+.+?\s+(?:to|on|onto|in|into)\s+(?:my|the|our)\s+(?:(?:to-?do|todo|to do|shopping|grocery|groceries|task)\s+)?(?:lists?|to-?dos?|tasks))\s*[.!]*$`, "i");
/** "add a call with bea at 7pm and put eggs on my list": the list part (run by code) and the rest left for the calendar (w20 r5 #101). */
export function splitTrailingListAdd(message: string): { head: string; asks: ChatAsk[] } | null {
  const at = TRAILING_LIST.exec(message.trim());
  if (!at) return null;
  const asks = readOne(at[2]!);
  return asks && asks.length && asks.every((a) => a.kind === "list-add") ? { head: at[1]!.trim(), asks } : null;
}

/** "open youtube in safari and tell me whats the weather": the open (run by code, said first) and the question left to answer (live gate 3 #100: only Safari opened and the weather was dropped). */
export function splitLeadOpen(message: string): { req: Extract<OpenRequest, { kind: "app" | "url" }>; rest: string } | null {
  const text = message.trim();
  if (text.length > 240) return null;
  for (const m of text.matchAll(new RegExp(THEN_ASK.source, "gi"))) {
    const head = text.slice(0, m.index).trim().replace(/[.,;!]+$/, ""); const rest = text.slice((m.index ?? 0) + m[0].length).trim();
    const req = openRequest(head);
    if (req && (req.kind === "app" || req.kind === "url") && rest.length >= 3 && !openRequest(rest)) return { req, rest };
  }
  return null;
}

/** The web player or site for an app that is not installed. */
const WEB_VERSION: Readonly<Record<string, { url: string; label: string }>> = {
  spotify: { url: "https://open.spotify.com", label: "the Spotify web player" },
  discord: { url: "https://discord.com/app", label: "Discord on the web" },
  slack: { url: "https://app.slack.com", label: "Slack on the web" },
  notion: { url: "https://www.notion.so", label: "Notion on the web" },
  whatsapp: { url: "https://web.whatsapp.com", label: "WhatsApp Web" },
  netflix: { url: "https://www.netflix.com", label: "Netflix on the web" },
  zoom: { url: "https://zoom.us/join", label: "Zoom on the web" },
  figma: { url: "https://www.figma.com", label: "Figma on the web" },
  teams: { url: "https://teams.microsoft.com", label: "Teams on the web" },
  "microsoft teams": { url: "https://teams.microsoft.com", label: "Teams on the web" },
};

const hostOf = (url: string): string => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };
const appLabel = (name: string): string => name.split(" ").map(cap).join(" ");

async function openOne(ask: Extract<ChatAsk, { kind: "open" }>, deps: ChatDeps, out: ChatOut): Promise<string> {
  const run = async (args: string[]) => { const r = await deps.open(args).catch(() => ({ stdout: "", code: 1 })); out.calls.push(`open ${args.join(" ")}`); out.outputs.push(r.stdout); return r; };
  if (ask.req.kind === "url") {
    const { url, browser } = ask.req;
    const r = await run(browser ? ["-a", browser, url] : [url]);
    return r.code === 0 ? `Opened ${hostOf(url)}${browser ? ` in ${browser}` : ""}.` : `I couldn't open ${hostOf(url)}${browser ? ` in ${browser}` : ""}: nothing opened.`;
  }
  const name = ask.req.name;
  const label = appLabel(name);
  if (!(await deps.installed(name).catch(() => false))) {
    const web = WEB_VERSION[name.toLowerCase()];
    if (!web) return `${label} isn't installed on this Mac, so I haven't opened it.`;
    out.offer = { url: web.url, label: web.label };
    return `${label} isn't installed on this Mac. Want me to open ${web.label} instead?`;
  }
  const r = await run(["-a", name]);
  return r.code === 0 ? `Opened ${label}.` : `I couldn't open ${label}: nothing opened.`;
}

const LIST_LINE = /^- (.+?)(?: · .*)?$/;
const MAX_SPOKEN = 7;

/** "You have 3 on your list: milk, email careers (due 2026-11-06), ...", from `orion-tasks list` output. */
export function listReply(stdout: string): string {
  const rows = stdout.split("\n").map((l) => l.trim()).filter((l) => LIST_LINE.test(l));
  if (!rows.length) return "Nothing on your list right now.";
  const spoken = rows.slice(0, MAX_SPOKEN).map((row) => {
    const title = LIST_LINE.exec(row)![1]!.trim();
    const due = /· due (\d{4}-\d{2}-\d{2})/.exec(row)?.[1];
    return `${title}${/OVERDUE/.test(row) ? " (overdue)" : due ? ` (due ${due.slice(5)})` : ""}`;
  });
  const more = rows.length > MAX_SPOKEN ? `, and ${rows.length - MAX_SPOKEN} more` : "";
  return `You have ${rows.length} on your list: ${spoken.join("; ")}${more}.`;
}

async function listOne(ask: Extract<ChatAsk, { kind: "list-add" | "todo-list" }>, deps: ChatDeps, out: ChatOut): Promise<string> {
  const args = ask.kind === "list-add" ? ["add", cap(ask.item)] : ["list"];
  const r = await deps.tasks(args).catch(() => ({ stdout: "", code: 1 }));
  out.calls.push(`exec orion-tasks ${args[0]}${ask.kind === "list-add" ? ` ${JSON.stringify(args[1])}` : ""}`);
  out.outputs.push(r.stdout);
  if (ask.kind === "list-add") return r.code === 0 && /^Added /m.test(r.stdout) ? `Added ${ask.item} to your list.` : `I couldn't add ${ask.item} to your list: nothing was added.`;
  return r.code === 0 ? listReply(r.stdout) : "I couldn't read your list just now. Say go and I'll retry it.";
}

/** Runs every ask in order (one failing never stops the next) and says what happened to each; items added in a row are one sentence naming each. */
export async function runChatAsks(asks: ChatAsk[], deps: ChatDeps): Promise<ChatOut> {
  const out: ChatOut = { text: "", calls: [], outputs: [] };
  const said: string[] = [];
  const added: string[] = [], failed: string[] = [];
  const flush = () => {
    const names = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
    if (added.length) said.push(`Added ${names(added)} to your list${added.length > 1 ? " as separate items" : ""}.`);
    if (failed.length) said.push(`I couldn't add ${names(failed)} to your list: nothing was added.`);
    added.length = 0; failed.length = 0;
  };
  for (const ask of asks) {
    if (ask.kind === "list-add") {
      const line = await listOne(ask, deps, out);
      (/^Added /.test(line) ? added : failed).push(ask.item);
      continue;
    }
    flush();
    said.push(ask.kind === "open" ? await openOne(ask, deps, out) : await listOne(ask, deps, out));
  }
  flush();
  return { ...out, text: said.join(" ") };
}

/** His bare yes to "want me to open the web player?". */
const YES = /^(?:(?:yeah|yes|yep|yup|ya|ok|okay|sure|please|pls)[\s,]+)*(?:do it|go(?: ahead| for it| on)?|open it|that one|do that|sounds good|yes|yeah|yep|yup|sure|ok|okay|please|pls)(?:[\s,]+(?:please|pls|thanks|then|mate))*[\s.!]*$/i;
export const answersWebOffer = (message: string): boolean => YES.test(message.trim());
