// Mail alerts as Nick reads them (wave 14, 2026-11-02). Pure.
//
//   one     "Prof. Smith emailed about the CS2100 midterm — 'room change to …'"
//   several "3 emails worth a look: Prof. Smith about the CS2100 midterm; Barclays about a payment due; Sam about Friday."
// Never raw tool text: no addresses, no thread ids, no links, no "[url removed]".
//
// Spacing: at most one alert every 30 minutes. Mail that arrives inside the gap waits in mail-state.json and goes out in the next
// alert as part of the digest. Urgent mail (a known service's security code, a deadline today) goes now, taking anything waiting
// with it, but at most three urgent alerts an hour: after that, urgent mail waits for the gap like the rest.
// Sensitive mail (a code, a sign-in notice; sensitive.mjs) is told by sender and label only: "Google sent a sign-in code".
import { isSensitive, sensitiveLabel } from "./sensitive.mjs";

export const ALERT_GAP_MS = 30 * 60_000;
/** Waiting mail older than this is no longer news: dropped rather than told late. */
export const QUEUE_TTL_MS = 12 * 3600_000;
export const URGENT_PER_HOUR = 3;
const HOUR_MS = 3600_000;
const MAX_IN_DIGEST = 4;

const ACRONYM = /^[A-Z0-9]{2,}$/;
const tidy = (s) => String(s ?? "").replace(/\[url removed\]/gi, "").replace(/https?:\/\/\S+/g, "").replace(/[<>{}[\]]/g, "").replace(/\s+/g, " ").trim();

/**
 * Who wrote it, as he would say it: the display name, else the brand from the domain. A title in the display name ("Prof. Jane
 * Smith") is shown as a role only when the tick verified the sender (`verifiedTeacher`: a teacher in his knowledge graph, writing
 * from his school's domain). Anyone can type "Prof." into a display name, so otherwise it is the name and the domain.
 */
export function whoOf(item) {
  const name = tidy(item.fromName).replace(/["']/g, "").replace(/\s*\(.*?\)\s*/g, " ").trim();
  const title = name.match(/^(prof(?:essor)?\.?|dr\.?)\s+/i);
  if (title) {
    const surname = name.split(/\s+/).at(-1);
    if (item.verifiedTeacher) return `${/^dr/i.test(title[1]) ? "Dr." : "Prof."} ${surname}`;
    const bare = name.slice(title[0].length).trim() || surname;
    return item.domain ? `${bare} (${item.domain})` : bare;
  }
  if (name && !name.includes("@")) return name.length > 32 ? name.split(/\s+/).slice(0, 2).join(" ") : name;
  const parts = String(item.domain ?? "").split(".");
  const suffix = parts.length > 2 && parts.at(-1).length === 2 && /^(?:co|ac|com|org|gov|net|edu)$/.test(parts.at(-2)) ? 2 : 1;
  const brand = parts.slice(0, -suffix).filter((p) => !/^(?:e|em|mail|email|news|mkt|info|notifications?|accounts?)$/.test(p)).at(-1) || "someone";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** What it is about: the subject without Re:/Fwd:, its first letter lowered unless it is an acronym ("CS2100 midterm"). */
export function topicOf(item) {
  if (isSensitive(item)) return null;
  const subject = tidy(item.subject).replace(/^(?:(?:re|fwd?|fw|aw)\s*:\s*)+/i, "").replace(/[.!?]+$/, "");
  if (!subject) return null;
  const first = subject.split(/\s+/)[0];
  const lowered = ACRONYM.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first) ? subject : subject.charAt(0).toLowerCase() + subject.slice(1);
  const short = lowered.length > 60 ? `${lowered.slice(0, 57).replace(/\s+\S*$/, "")}…` : lowered;
  // "the CS2100 midterm" reads better than "CS2100 midterm" when the subject is a short noun phrase.
  return /^(?:[A-Z]{2,}\d{3,}|cs\d{4})\b/i.test(short) && short.split(/\s+/).length <= 4 ? `the ${short}` : short;
}

/** A code is never repeated: a phone notification shows it on the lock screen. Sensitive mail has no quote at all. */
const quoteOf = (item) => {
  if (isSensitive(item)) return null;
  const s = tidy(item.snippet).replace(/^(?:hi|hello|hey|dear)\b[^,.!]{0,30}[,.!]\s*/i, "");
  if (!s) return null;
  return s.length > 70 ? `${s.slice(0, 67).replace(/\s+\S*$/, "")} …` : s;
};

/** One mail, one line, naming its account ("Yahoo: …") when the item carries one (only with several accounts). */
export function alertLine(item, { named = true } = {}) {
  const prefix = named && item.account ? `${tidy(item.account)}: ` : "";
  if (isSensitive(item)) return `${prefix}${whoOf(item)} sent ${sensitiveLabel(item)}`;
  const topic = topicOf(item);
  const quote = quoteOf(item);
  return `${prefix}${whoOf(item)} emailed${topic ? ` about ${topic}` : ""}${quote ? ` — '${quote}'` : ""}`;
}

/** Several, one line: "3 emails worth a look: A about x; B about y." */
export function digestLine(items) {
  if (items.length === 1) return alertLine(items[0]);
  // One account for all of them: named once up front; mixed accounts: each one named after its sender.
  const accounts = [...new Set(items.map((i) => i.account).filter(Boolean))];
  const lead = accounts.length === 1 && items.every((i) => i.account) ? `${tidy(accounts[0])}: ` : "";
  const via = (i) => (!lead && i.account ? ` (${tidy(i.account)})` : "");
  const shown = items.slice(0, MAX_IN_DIGEST).map((i) => {
    if (isSensitive(i)) return `${whoOf(i)}${via(i)} with ${sensitiveLabel(i)}`;
    const t = topicOf(i);
    return `${whoOf(i)}${via(i)}${t ? ` about ${t}` : ""}`;
  });
  const more = items.length - shown.length;
  return `${lead}${items.length} emails worth a look: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`;
}

/** The urgent sends still inside the last hour. */
export const recentUrgent = (urgentSentAt = [], now) => urgentSentAt.filter((at) => { const age = now.getTime() - Date.parse(at); return age >= 0 && age < HOUR_MS; });

/**
 * What to send now. queue: items waiting from earlier ticks; fresh: important items found now; urgentSentAt: when urgent alerts went.
 * @returns {{ send: object[], keep: object[], reason: string, urgent: boolean }}
 */
export function planAlert({ queue = [], fresh = [], lastAlertAt = null, urgentSentAt = [], now }) {
  const t = now.getTime();
  const live = [...queue.filter((q) => t - Date.parse(q.foundAt ?? 0) < QUEUE_TTL_MS), ...fresh];
  const unique = live.filter((x, i) => live.findIndex((y) => y.messageId === x.messageId) === i);
  if (!unique.length) return { send: [], keep: [], reason: "nothing to tell", urgent: false };
  const urgent = unique.some((x) => x.urgent) && recentUrgent(urgentSentAt, now).length < URGENT_PER_HOUR;
  const gapOpen = !lastAlertAt || t - Date.parse(lastAlertAt) >= ALERT_GAP_MS;
  if (urgent || gapOpen) return { send: [...unique.filter((x) => x.urgent), ...unique.filter((x) => !x.urgent)], keep: [], reason: urgent ? "urgent" : "gap open", urgent };
  return { send: [], keep: unique, reason: "spacing: last alert under 30 min ago", urgent: false };
}

/** The row kept in mail-alerts.jsonl: what the alert named, so a reply can be read against it. */
export const alertRow = ({ id, text, items, now }) => ({
  id, at: now.toISOString(), text,
  items: items.map((i) => ({ messageId: i.messageId, who: whoOf(i), ...(i.account ? { account: i.account } : {}), fromAddress: i.fromAddress, domain: i.domain, topic: topicOf(i), person: !!i.person,
    ...(isSensitive(i) ? { sensitive: sensitiveLabel(i) } : {}) })),
});
