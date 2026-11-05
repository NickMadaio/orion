/*
 "open my CS group on safari" (live 11-05 11:21: "Opened google.com in Safari."). A page he names in his own words has no address ORION knows;
 opening a generic site (a Google search) for it is a lie. It is looked up in what ORION really holds (the domains his Mac showed him on, and
 any address his notes or brain keep next to those words); one clear match is opened, several are asked about, none is asked for ("What's the link?").
 Pure matching here; the live reads are in chat-asks-live.ts.
*/
const GENERIC = new Set(["group", "page", "site", "link", "chat", "doc", "docs", "form", "portal", "account", "the", "my", "our", "thing", "stuff", "one", "web", "website"]);
const URL_RE = /https?:\/\/[^\s)>"'\]]+/gi;
/** The words that name it: "cs group" -> ["cs"]. A name made only of generic words falls back to all its words. */
export function nameWords(name) {
    const all = name.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
    const named = all.filter((w) => !GENERIC.has(w));
    return named.length ? named : all;
}
const hostOf = (url) => { try {
    return new URL(url).host.replace(/^www\./, "");
}
catch {
    return url;
} };
const clean = (url) => url.replace(/[.,;:!?]+$/, "");
/** A domain matches a word when one of its dot/dash labels IS the word, or contains it when the word has 3+ letters. */
const domainHas = (domain, word) => domain.toLowerCase().split(/[.-]/).some((l) => l === word || (word.length >= 3 && l.includes(word)));
/** Candidate addresses for a name, best first, one per host: addresses written near the name in his notes, then domains he has been on that carry its words. */
export function pageCandidates(name, found) {
    const words = nameWords(name);
    if (!words.length)
        return [];
    const out = new Map();
    const text = found.snippets ?? "";
    for (const m of text.matchAll(URL_RE)) {
        const near = text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160).toLowerCase();
        if (words.every((w) => near.includes(w))) {
            const url = clean(m[0]);
            if (!out.has(hostOf(url)))
                out.set(hostOf(url), url);
        }
    }
    for (const d of [...new Set(found.domains ?? [])])
        if (d && words.some((w) => domainHas(d, w)) && !out.has(d.replace(/^www\./, "")))
            out.set(d.replace(/^www\./, ""), `https://${d}`);
    return [...out.values()];
}
/** What is said for each outcome (the page is opened by the caller when there is exactly one). */
export const askWhich = (name, urls) => `Which one for your ${name}: ${urls.slice(0, 3).map(hostOf).join(" or ")}?`;
export const askLink = (name) => `What's the link for your ${name}? I don't have that page saved, and I won't open a search for it.`;
export { hostOf };
