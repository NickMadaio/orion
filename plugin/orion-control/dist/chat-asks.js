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
import { openRequest } from "./open-request.js";
import { splitAsks } from "./multi-ask.js";
const LEAD = String.raw `(?:(?:hey|ok|okay|so|and|also|pls|please|orion|can you|could you|can u|would you|just|wait|yo)[,\s]+)*`;
const ADD = new RegExp(String.raw `^${LEAD}(?:add|put|stick|throw|pop|chuck)\s+(.+?)\s+(?:to|on|onto|in|into)\s+(?:my|the|our)\s+(?:(?:to-?do|todo|to do|shopping|grocery|groceries|task)\s+)?(?:lists?|to-?dos?|tasks)\s*[.!]*$`, "i");
const NOT_A_LIST_ITEM = /\b(?:calendar|schedule|reminders?|alarm|timer|plan|day|tonight|tomorrow|today|at \d|\d\s*(?:am|pm))\b/i;
const READ = new RegExp(String.raw `^${LEAD}(?:(?:whats|what's|what is|what are|wats|show me|show|read me|read out|read|list|give me|tell me|pull up|check)\s+(?:on\s+)?(?:my|the)\s+(?:(?:to-?do|todo|to do|task|shopping)\s*)?(?:lists?|to-?dos?|tasks?)(?:\s+(?:rn|right now|now|again|please|pls))?|what(?:'?s| is| do i have)\s+(?:left\s+)?on\s+(?:my\s+)?(?:to-?dos?|list)|what\s+(?:to-?dos?|tasks)\s+do\s+i\s+have(?:\s+(?:left|open))?|(?:any|have i got any)\s+(?:to-?dos?|tasks)\s+(?:left|open|outstanding))\s*[?.!]*$`, "i");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Foods and things that are one item although they say "and" (w20 r4: "add eggs and bread" is two rows, "add salt and pepper" is one).
const ONE_THING = /\b(?:salt and pepper|mac and cheese|macaroni and cheese|fish and chips|bread and butter|peanut butter and jelly|beans and rice|rice and beans|ham and cheese|cheese and onion|surf and turf|bangers and mash|sweet and sour|black and white|pen and paper|bits and bobs)\b/gi;
const ARTICLE = /^(?:a|an|the|some|another|more|a bit of|a couple of|a few)\s+/i;
/** "oat milk and a phone charger cable" is two items, each its own row (so ticking one off finds it); "salt and pepper" stays one. */
export function splitListItems(text) {
    const kept = [];
    const guarded = text.replace(ONE_THING, (m) => { kept.push(m); return `\u0001${kept.length - 1}\u0001`; });
    const parts = guarded.split(/\s*(?:,|;|&|\band\b|\bplus\b|\balso\b)\s*/i).map((p) => p.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]).trim().replace(ARTICLE, "").trim()).filter((p) => /[a-z0-9]/i.test(p));
    return [...new Set(parts)];
}
function readOne(clause) {
    const said = clause.trim().replace(/\s+/g, " ");
    if (!said)
        return null;
    const add = ADD.exec(said)?.[1]?.trim().replace(/^(?:some|a bit of)\s+/i, "");
    if (add && add.length <= 120 && !NOT_A_LIST_ITEM.test(add) && /[a-z0-9]/i.test(add)) {
        const items = splitListItems(add);
        if (items.length && items.length <= 8 && items.every((i) => i.length <= 80))
            return items.map((item) => ({ kind: "list-add", item }));
    }
    if (READ.test(said) && !/\b(?:calendar|schedule|day)\b/i.test(said))
        return [{ kind: "todo-list" }];
    const open = openRequest(said);
    if (open && (open.kind === "app" || open.kind === "url"))
        return [{ kind: "open", req: open }];
    return null;
}
/** What code does for this message, or null when any part of it is something else (the worker or another flow keeps it). */
export function readChatAsks(message) {
    const one = readOne(message);
    if (one)
        return one;
    const parts = splitAsks(message);
    if (!parts)
        return null;
    const asks = parts.map(readOne);
    return asks.every((a) => a !== null) ? asks.flat() : null;
}
/** The web player or site for an app that is not installed. */
const WEB_VERSION = {
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
const hostOf = (url) => { try {
    return new URL(url).host.replace(/^www\./, "");
}
catch {
    return url;
} };
const appLabel = (name) => name.split(" ").map(cap).join(" ");
async function openOne(ask, deps, out) {
    const run = async (args) => { const r = await deps.open(args).catch(() => ({ stdout: "", code: 1 })); out.calls.push(`open ${args.join(" ")}`); out.outputs.push(r.stdout); return r; };
    if (ask.req.kind === "url") {
        const { url, browser } = ask.req;
        const r = await run(browser ? ["-a", browser, url] : [url]);
        return r.code === 0 ? `Opened ${hostOf(url)}${browser ? ` in ${browser}` : ""}.` : `I couldn't open ${hostOf(url)}${browser ? ` in ${browser}` : ""}: nothing opened.`;
    }
    const name = ask.req.name;
    const label = appLabel(name);
    if (!(await deps.installed(name).catch(() => false))) {
        const web = WEB_VERSION[name.toLowerCase()];
        if (!web)
            return `${label} isn't installed on this Mac, so I haven't opened it.`;
        out.offer = { url: web.url, label: web.label };
        return `${label} isn't installed on this Mac. Want me to open ${web.label} instead?`;
    }
    const r = await run(["-a", name]);
    return r.code === 0 ? `Opened ${label}.` : `I couldn't open ${label}: nothing opened.`;
}
const LIST_LINE = /^- (.+?)(?: · .*)?$/;
const MAX_SPOKEN = 7;
/** "You have 3 on your list: milk, email careers (due 2026-11-06), ...", from `orion-tasks list` output. */
export function listReply(stdout) {
    const rows = stdout.split("\n").map((l) => l.trim()).filter((l) => LIST_LINE.test(l));
    if (!rows.length)
        return "Nothing on your list right now.";
    const spoken = rows.slice(0, MAX_SPOKEN).map((row) => {
        const title = LIST_LINE.exec(row)[1].trim();
        const due = /· due (\d{4}-\d{2}-\d{2})/.exec(row)?.[1];
        return `${title}${/OVERDUE/.test(row) ? " (overdue)" : due ? ` (due ${due.slice(5)})` : ""}`;
    });
    const more = rows.length > MAX_SPOKEN ? `, and ${rows.length - MAX_SPOKEN} more` : "";
    return `You have ${rows.length} on your list: ${spoken.join("; ")}${more}.`;
}
async function listOne(ask, deps, out) {
    const args = ask.kind === "list-add" ? ["add", cap(ask.item)] : ["list"];
    const r = await deps.tasks(args).catch(() => ({ stdout: "", code: 1 }));
    out.calls.push(`exec orion-tasks ${args[0]}${ask.kind === "list-add" ? ` ${JSON.stringify(args[1])}` : ""}`);
    out.outputs.push(r.stdout);
    if (ask.kind === "list-add")
        return r.code === 0 && /^Added /m.test(r.stdout) ? `Added ${ask.item} to your list.` : `I couldn't add ${ask.item} to your list: nothing was added.`;
    return r.code === 0 ? listReply(r.stdout) : "I couldn't read your list just now. Say go and I'll retry it.";
}
/** Runs every ask in order (one failing never stops the next) and says what happened to each; items added in a row are one sentence naming each. */
export async function runChatAsks(asks, deps) {
    const out = { text: "", calls: [], outputs: [] };
    const said = [];
    const added = [], failed = [];
    const flush = () => {
        const names = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
        if (added.length)
            said.push(`Added ${names(added)} to your list${added.length > 1 ? " as separate items" : ""}.`);
        if (failed.length)
            said.push(`I couldn't add ${names(failed)} to your list: nothing was added.`);
        added.length = 0;
        failed.length = 0;
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
const YES = /^(?:(?:yeah|yes|yep|yup|ya|ok|okay|sure|please|pls)[\s,]+)*(?:do it|go(?: ahead| for it)?|open it|that one|do that|sounds good|yes|yeah|yep|yup|sure|ok|okay|please|pls)(?:[\s,]+(?:please|pls|thanks))?[\s.!]*$/i;
export const answersWebOffer = (message) => YES.test(message.trim());
