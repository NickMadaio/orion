/*
 "Open X" as code reads it (w18 opensafari). Live 2026-11-04 09:33: "open amazon in safari" was left to the 9B worker; it
 made the browser call, Safari failed to resolve, and the reply blamed the user's Mac. Three shapes, each one exact call:
 an app (app_open), a site or domain in a named or default browser (browser_open_url), a known folder (folder_open).
 Not requests to open anything: his tabs, the day, a door, "open source", or a sentence that merely contains "open".
*/
import { OPENABLE_FOLDERS } from "./catalog.js";
import { APPS } from "./computer-intent.js";
const OPEN_VERB = String.raw `(?:op(?:en|ne|n|em)|oepn|launch|lauch|lanch|luanch|launhc|pu(?:l|ll)\s?up|bring up|fire up)(?:\s+up)?`;
const LEAD = String.raw `(?:(?:wait|yo|hey|ok|okay|so|and|can you|could you|can u|could u|would you|will you|pls|please|orion|just|go ahead and|i need you to|i want you to|i wanna|let'?s|lets)[,\s]+)*`;
const OPEN_RE = new RegExp(String.raw `^${LEAD}${OPEN_VERB}\s+(.+)$`, "i");
const FILLER = /(?:\s+(?:again|please|pls|plz|for me|real quick|quick|rn|now|back up|back))+[\s.!?]*$/i;
const BROWSER_IN = /^(.+?)\s+(?:in|on|with|using|via|through)\s+(safari|chrome|google chrome|opera air|opera)$/i;
// "in my browser", "on the browser": the default browser, no name (11-04: "open amazon on my browser").
const DEFAULT_BROWSER_IN = /^(.+?)\s+(?:in|on|with|using|via|through)\s+(?:my |the |my default |the default )?(?:web )?browser$/i;
const BROWSER_TO = /^(safari|chrome|google chrome|opera air|opera)\s+(?:and go to|and open|to|at)\s+(.+)$/i;
const BROWSERS = { safari: "Safari", chrome: "Google Chrome", "google chrome": "Google Chrome", opera: "Opera", "opera air": "Opera Air" };
const DOMAIN = /^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[\x21-\x7e]*)?$/i;
const SITE_WORD = /^(?:the |my )?([a-z0-9 ]+?)\s+(?:website|web ?site|site|web ?page)$/i;
const SITES = {
    amazon: "www.amazon.com", "amazon uk": "www.amazon.co.uk", "amazon co uk": "www.amazon.co.uk", "amazon ik": "www.amazon.co.uk", "uk amazon": "www.amazon.co.uk", "the uk amazon": "www.amazon.co.uk", "amazon.co.uk": "www.amazon.co.uk", youtube: "www.youtube.com", google: "www.google.com", gmail: "mail.google.com", reddit: "www.reddit.com",
    github: "github.com", netflix: "www.netflix.com", facebook: "www.facebook.com", instagram: "www.instagram.com", twitter: "twitter.com",
    linkedin: "www.linkedin.com", wikipedia: "www.wikipedia.org", nytimes: "www.nytimes.com", "new york times": "www.nytimes.com", bbc: "www.bbc.com",
    ebay: "www.ebay.com", twitch: "www.twitch.tv", tiktok: "www.tiktok.com", maps: "maps.google.com", "google maps": "maps.google.com",
    "google drive": "drive.google.com", drive: "drive.google.com", canvas: "canvas.instructure.com", chatgpt: "chatgpt.com", hulu: "www.hulu.com",
};
// Not an app, so not app_open: the same exclusions yesterday's app route used (his tabs, the day, the mouse popup, a door, a gerund).
const NOT_AN_APP = /\b(?:tasks?|plans?|schedule|calendar|agenda|day|week|home|health|finances?|projects?|settings|door|tabs?|window|it|that|this|them|something|file|folder|mouse|button|buttons|mapper|setup|focus|session|timer|workout|reminders?|notes? on|what|why|how|when|where|new|a|an|the|my|into|to|of|in|on|for|source|link|url|page|site|email|mail|messages?|texts?|list|stuff|everything|anything|tomorrow|today|tonight|him|her|me|you|us)\b|\.[a-z]{2,}$|^https?:|^[a-z]+ing\b/i;
// Site names that are first an app on a Mac: "open maps" is Apple Maps.
const APP_FIRST = new Set(["maps", "drive"]);
const tidy = (s) => s.trim().replace(/^(?:the |my )/i, "").trim();
function siteUrl(target) {
    const t = target.trim().replace(/[.,!?]+$/, "");
    if (/^https?:\/\//i.test(t))
        return DOMAIN.test(t) ? t : null;
    if (DOMAIN.test(t))
        return `https://${t}`;
    const key = tidy(t).toLowerCase();
    if (SITES[key])
        return `https://${SITES[key]}`;
    const words = key.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 12);
    return words.length ? `https://www.google.com/search?q=${words.join("+")}` : null;
}
/** What he asked to open, or null when it is anything else. */
export function openRequest(message) {
    const said = message.trim().replace(/\s+/g, " ");
    if (!said || said.length > 120)
        return null;
    // A correction before the ask ("amazon is a website, i asked you to open it. open amazon UK on my browser"): the last sentence is the request.
    // w20 r3: "put spotify on" / "put youtube on" is "open it" (computer-intent no longer reads a bare "put" as typing). Only a name it knows: "put the kettle on" is not.
    const putOn = new RegExp(String.raw `^${LEAD}put\s+(.+?)\s+on[\s.!?]*$`, "i").exec(said)?.[1]?.trim().toLowerCase();
    if (putOn && (SITES[putOn] || APPS[putOn]))
        return openRequest(`open ${putOn}`);
    const sentences = said.split(/(?<=[.!?])\s+/);
    const ask = OPEN_RE.test(said) || sentences.length < 2 ? said : sentences[sentences.length - 1];
    const rest = OPEN_RE.exec(ask)?.[1]?.replace(FILLER, "").trim().replace(/[.!?]+$/, "");
    if (!rest)
        return null;
    const inBrowser = BROWSER_IN.exec(rest);
    if (inBrowser) {
        const url = siteUrl(inBrowser[1]);
        return url ? { kind: "url", url, browser: BROWSERS[inBrowser[2].toLowerCase()] } : null;
    }
    const inDefault = DEFAULT_BROWSER_IN.exec(rest);
    if (inDefault) {
        const url = siteUrl(inDefault[1]);
        return url ? { kind: "url", url } : null;
    }
    const toSite = BROWSER_TO.exec(rest);
    if (toSite) {
        const url = siteUrl(toSite[2]);
        return url ? { kind: "url", url, browser: BROWSERS[toSite[1].toLowerCase()] } : null;
    }
    const folder = /^(?:the |my )?([a-z]+) folder$/i.exec(rest)?.[1]?.toLowerCase();
    if (folder)
        return OPENABLE_FOLDERS.includes(folder) ? { kind: "folder", folder } : null;
    if (DOMAIN.test(rest))
        return { kind: "url", url: /^https?:/i.test(rest) ? rest : `https://${rest}` };
    const siteName = SITE_WORD.exec(rest)?.[1]?.trim().toLowerCase();
    if (siteName)
        return SITES[siteName] ? { kind: "url", url: `https://${SITES[siteName]}` } : null;
    // A bare well-known site ("amazon uk") is a site: the app route said "amazon uk was not found" (11-04 11:20). "maps" is an app.
    const bare = tidy(rest).toLowerCase();
    if (SITES[bare] && !APP_FIRST.has(bare))
        return { kind: "url", url: `https://${SITES[bare]}` };
    const name = tidy(rest).replace(/\s+app$/i, "");
    if (!name || name.split(" ").length > 3 || NOT_AN_APP.test(name) || !/^[A-Za-z0-9][A-Za-z0-9 .&'+_-]*$/.test(name))
        return null;
    return { kind: "app", name };
}
