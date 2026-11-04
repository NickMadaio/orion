/*
 Websites during a focus session (2026-11-04).

 Nick: "I set Safari to be open but I can go on YouTube... feels counterproductive." An allowed browser is not an allowed internet.
 Pure pieces: the blocked list, the one decision (override, then the task's allowed sites, then the blocked list, else allow),
 and the guard's step. The step is a state machine over what activity.json shows each tick: nudge once and quietly, and if he is
 still on the site about 20 s later, redirect that tab back to a calm page. Effects (notify, AppleScript) are the caller's.
*/

export const NUDGE_GRACE_MS = 20_000;
// An activity.json older than this is not evidence of where he is now.
export const STALE_MS = 45_000;
// After a denied Automation prompt the guard can only nudge; do not repeat it more than once a minute.
export const DENIED_RENUDGE_MS = 60_000;

export const BLOCKED = [
  "youtube.com", "youtu.be", "reddit.com", "tiktok.com", "instagram.com", "netflix.com", "twitch.tv", "x.com", "twitter.com",
  "facebook.com", "snapchat.com", "pinterest.com", "tumblr.com", "hulu.com", "disneyplus.com", "primevideo.com", "max.com",
  "kick.com", "crunchyroll.com", "9gag.com", "9now.com.au", "bilibili.com", "vimeo.com", "dailymotion.com", "threads.net",
];

const BRANDS = { "youtube.com": "YouTube", "youtu.be": "YouTube", "reddit.com": "Reddit", "tiktok.com": "TikTok", "instagram.com": "Instagram",
  "netflix.com": "Netflix", "twitch.tv": "Twitch", "x.com": "X", "twitter.com": "X", "facebook.com": "Facebook", "snapchat.com": "Snapchat",
  "pinterest.com": "Pinterest", "tumblr.com": "Tumblr", "hulu.com": "Hulu", "disneyplus.com": "Disney+", "primevideo.com": "Prime Video", "threads.net": "Threads" };

export const BROWSERS = new Set(["com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "com.google.Chrome.canary"]);

/** "https://www.YouTube.com/watch" or "www.youtube.com" -> "youtube.com"; null when it is not a host. */
export function normalizeDomain(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let host = value.trim().toLowerCase();
  try { host = new URL(/^[a-z]+:\/\//.test(host) ? host : `https://${host}`).hostname; } catch { return null; }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

/** True when `domain` is `entry` or a subdomain of it ("m.youtube.com" matches "youtube.com"; "notyoutube.com" does not). */
export const domainMatches = (domain, entry) => {
  const d = normalizeDomain(domain), e = normalizeDomain(entry);
  return !!d && !!e && (d === e || d.endsWith(`.${e}`));
};
const inList = (domain, list) => (list ?? []).some((e) => domainMatches(domain, e));

export const brandOf = (domain) => {
  const d = normalizeDomain(domain);
  const hit = d && Object.keys(BRANDS).find((k) => domainMatches(d, k));
  return hit ? BRANDS[hit] : d ?? "that site";
};

/** The decision table. override > the task's allowed sites > the blocked list > allow (a site nobody listed is not policed). */
export function decideDomain({ domain, allowed = [], overrides = [], blocked = BLOCKED }) {
  const d = normalizeDomain(domain);
  if (!d) return "allow";
  if (inList(d, overrides)) return "allow";
  if (inList(d, allowed)) return "allow";
  return inList(d, blocked) ? "block" : "allow";
}
export const isBlockedSite = (domain) => decideDomain({ domain }) === "block";

export const initialGuard = () => ({ domain: null, nudgedAt: null, actedAt: null, deniedAt: null });

/**
 * One tick. `input`: {nowMs, active (a focus phase is running), activityAtMs, bundleId, domain, allowed, overrides}.
 * `denied` is set (on the returned state) by the caller when Automation was refused; the guard then only nudges.
 * Returns {state, action: "none"|"nudge"|"redirect", domain}. Never mutates `state`.
 */
export function guardStep(state, input) {
  const { nowMs, active, activityAtMs, bundleId, domain } = input;
  const d = normalizeDomain(domain);
  const fresh = typeof activityAtMs === "number" && nowMs - activityAtMs <= STALE_MS;
  const away = !active || !fresh || !BROWSERS.has(bundleId) || !d || decideDomain({ domain: d, allowed: input.allowed, overrides: input.overrides }) === "allow";
  if (away) return { state: { ...initialGuard(), deniedAt: state.deniedAt }, action: "none", domain: null };
  if (state.domain !== d) return { state: { ...state, domain: d, nudgedAt: nowMs, actedAt: null }, action: "nudge", domain: d };
  if (state.deniedAt !== null) {
    const again = nowMs - Math.max(state.nudgedAt ?? 0, state.deniedAt ?? 0) >= DENIED_RENUDGE_MS;
    return again ? { state: { ...state, nudgedAt: nowMs }, action: "nudge", domain: d } : { state, action: "none", domain: d };
  }
  const last = Math.max(state.nudgedAt ?? 0, state.actedAt ?? 0);
  if (nowMs - last >= NUDGE_GRACE_MS) return { state: { ...state, actedAt: nowMs }, action: "redirect", domain: d };
  return { state, action: "none", domain: d };
}

export const nudgeLine = (domain) => `${brandOf(domain)} isn't part of this session.`;

const BY_BRAND = new Map([["youtube", "youtube.com"], ["reddit", "reddit.com"], ["tiktok", "tiktok.com"], ["instagram", "instagram.com"], ["insta", "instagram.com"],
  ["netflix", "netflix.com"], ["twitch", "twitch.tv"], ["twitter", "twitter.com"], ["x", "x.com"], ["facebook", "facebook.com"], ["snapchat", "snapchat.com"]]);
/** A site as he says it ("youtube", "netflix.com", a pasted url) -> its domain; null when it is not one word or a host. */
export function resolveSiteName(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (!w) return null;
  return BY_BRAND.get(w) ?? normalizeDomain(w);
}

// Sites that count as work or study, for what ORION may learn on its own. Anything else is added only when Nick says "i need X".
export const WORK_SITES = [
  "docs.google.com", "drive.google.com", "slides.google.com", "sheets.google.com", "scholar.google.com", "mail.google.com", "calendar.google.com",
  "github.com", "gitlab.com", "stackoverflow.com", "stackexchange.com", "developer.mozilla.org", "developer.apple.com", "docs.python.org", "docs.oracle.com",
  "chat.openai.com", "chatgpt.com", "claude.ai", "overleaf.com", "notion.so", "figma.com", "canva.com", "leetcode.com", "gradescope.com", "piazza.com",
  "canvas.northeastern.edu", "northeastern.edu", "wikipedia.org", "khanacademy.org", "coursera.org", "quizlet.com", "jstor.org", "arxiv.org", "desmos.com",
  "wolframalpha.com", "grammarly.com", "linkedin.com", "handshake.com", "indeed.com", "zotero.org", "w3schools.com", "geeksforgeeks.org", "readthedocs.io",
];
const WORK_HOST = /(?:^|\.)(?:edu|ac\.[a-z]{2}|gov)$/;
/** A site that is plainly work or study: on the list, a school or government host, or a docs. / library. subdomain. */
export function isWorkSite(domain) {
  const d = normalizeDomain(domain);
  return !!d && (WORK_SITES.some((w) => domainMatches(d, w)) || WORK_HOST.test(d) || /^(?:docs|library|learn|canvas)\./.test(d));
}
