// How much a new email matters to Nick (wave 14, 2026-11-02). Pure: a mail item and what ORION knows in, a verdict out.
//
// Order: his own rules (mail-prefs.json) decide first. Then signals:
//   raise   a person wrote it (not a no-reply or marketing sender), his school's domain, a professor or TA, a deadline / date / "due",
//           money, bills or a security code, a reply in a thread he wrote in, someone in his knowledge graph, one of his course codes
//   lower   newsletters and promotions, a List-Unsubscribe header, Gmail's promotions / social / forums tabs, social notifications
// The sum puts it in one of three bands. "borderline" is the only band the local model is asked about (model.mjs).
// `urgent` (a security code from a known service, a deadline today) lets an alert skip the 30-minute spacing; it never skips quiet
// hours or focus. A stranger's "verification code" is not urgent: that is what a phishing mail looks like (wave 14 fix).

import { prefVerdict } from "./prefs.mjs";
import { SECURITY } from "./sensitive.mjs";
import { DEFAULT_SCHOOL_DOMAINS, KNOWN_SERVICE_DOMAINS, onDomain } from "./domains.mjs";

export { DEFAULT_SCHOOL_DOMAINS };

export const IMPORTANT_AT = 4;
export const BORDERLINE_AT = 1;

const AUTOMATED_LOCAL = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|notify|news(?:letter)?s?|info|marketing|updates?|alerts?|support|hello|hi|team|mailer(?:-daemon)?|bounces?|digest|offers?|deals|promo(?:tions)?|account(?:s)?|billing|receipts?|orders?|service|automated|system|admin|jobs|careers|community|feedback|survey)(?:[-_.+].*)?$/;
const MARKETING_DOMAIN = /(?:^|\.)(?:mailchimp|mcsv|sendgrid|mailgun|klaviyo|hubspot|marketo|constantcontact|substack|beehiiv|mail\.beehiiv|emails?\.[a-z0-9-]+|e\.[a-z0-9-]+|em\.[a-z0-9-]+|news\.[a-z0-9-]+|mkt\.[a-z0-9-]+)\./;
const SOCIAL = /(?:^|\.)(?:linkedin|facebook|facebookmail|instagram|twitter|x|tiktok|reddit|redditmail|pinterest|snapchat|discord|quora|youtube|medium|strava|nextdoor)\.com$/;
const PROMO_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const NEWSLETTER = /\b(?:newsletter|digest|weekly (?:roundup|update|recap)|unsubscribe|\d+% off|sale|deal(?:s)? (?:of|for)|limited time|webinar|sponsored|promo code|free shipping|new arrivals|you might like|recommended for you|top picks|trending)\b/i;
const MONEY = /\b(?:payment (?:due|failed|declined|received)|bill(?:ing)? (?:is )?(?:due|ready)|invoice|overdue|overdrawn|direct debit|rent|refund|tuition|fee(?:s)? (?:due|owed)|statement is ready|low balance|charge(?:d)?|£\s?\d|\$\s?\d)\b/i;
const DEADLINE = /\b(?:due|deadline|submit(?:ted|ssion)?|extension|exam|midterm|final|quiz|test|assignment|homework|problem set|pset|lab report|office hours|room change|cancel+ed|reschedul(?:ed|ing)|postponed|moved to|interview|appointment|meeting|by (?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|tonight|today|this (?:week|evening|afternoon|morning))\b/i;
const TODAY = /\b(?:due (?:today|tonight)|deadline (?:is )?(?:today|tonight)|(?:today|tonight) (?:at|by) \d{1,2}(?::\d{2})?\s*(?:am|pm)?|by (?:end of )?(?:today|tonight)|in (?:an|one|1|two|2) hours?|this (?:morning|afternoon|evening)|cancel+ed (?:today|this)|starts in \d+ ?min)\b/i;
const TEACHER = /\b(?:prof(?:essor)?\.?|dr\.?|lecturer|instructor|teaching assistant|\bta\b|tutor|module leader|course leader)\b/i;

const norm = (s) => String(s ?? "").toLowerCase();
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** A person, not a machine: neither the address nor the domain looks automated. */
export function fromPerson(item) {
  const local = item.fromAddress.split("@")[0] ?? "";
  if (!local || AUTOMATED_LOCAL.test(local) || MARKETING_DOMAIN.test(item.domain) || SOCIAL.test(item.domain)) return false;
  return !item.listUnsubscribe && !item.precedenceBulk;
}

/** A sender whose security code may be urgent: a big sign-in or banking provider, or his school's single sign-on. */
export const knownService = (item, ctx = {}) => onDomain(item.domain, [...KNOWN_SERVICE_DOMAINS, ...(ctx.schoolDomains ?? DEFAULT_SCHOOL_DOMAINS)]);

/** A teacher in his knowledge graph, writing from his school's domain: the only sender an alert may call "Prof." */
export const verifiedTeacher = (item, ctx = {}) => knownPerson(item, ctx.people)?.role === "teacher" && onDomain(item.domain, ctx.schoolDomains ?? DEFAULT_SCHOOL_DOMAINS);

/** The knowledge-graph person this sender is, matched on a full name or a surname of 3+ letters. */
export function knownPerson(item, people = []) {
  const name = words(item.fromName);
  const local = words(item.fromAddress.split("@")[0]);
  return people.find((p) => {
    const parts = words(p.name);
    if (!parts.length) return false;
    if (parts.every((w) => name.includes(w))) return true;
    const last = parts.at(-1);
    return parts.length > 1 && last.length >= 3 && (name.includes(last) || local.includes(last));
  }) ?? null;
}

const has = (re, item) => re.test(`${item.subject} ${item.snippet}`);

/**
 * The verdict for one mail item.
 * ctx: { prefs, people: [{ name, role? }], courses: ["CS2100", …], schoolDomains }
 * @returns {{ level: "important"|"borderline"|"skip", score: number, urgent: boolean, reasons: string[], rule: object|null, topic: string|null }}
 */
export function scoreMail(item, ctx = {}) {
  const rule = prefVerdict(ctx.prefs, item);
  const urgentSignals = (has(SECURITY, item) && knownService(item, ctx)) || (has(DEADLINE, item) && has(TODAY, item));
  if (rule?.action === "boost") return { level: "important", score: 99, urgent: urgentSignals, reasons: [`he said to always tell him (${rule.kind}: ${rule.value})`], rule, topic: courseIn(item, ctx.courses) };
  if (rule?.action === "mute") return { level: "skip", score: -99, urgent: false, reasons: [`he said this isn't important (${rule.kind}: ${rule.value})`], rule, topic: null };

  const signals = [];
  const add = (points, why) => signals.push([points, why]);
  const person = fromPerson(item);
  const school = onDomain(item.domain, ctx.schoolDomains ?? DEFAULT_SCHOOL_DOMAINS);
  const known = knownPerson(item, ctx.people);
  const course = courseIn(item, ctx.courses);
  if (person) add(3, "from a person");
  if (school) add(person ? 2 : 1, "his school");
  if (TEACHER.test(item.fromName) || TEACHER.test(known?.role ?? "")) add(3, "a professor or TA");
  if (known) add(3, `someone he knows (${known.name})`);
  if (item.nickInThread) add(3, "a reply in a thread he wrote in");
  if (course) add(2, `about ${course}`);
  if (has(DEADLINE, item)) add(2, "a deadline or date");
  if (has(SECURITY, item)) add(4, "a security code or sign-in");
  else if (has(MONEY, item)) add(3, "money or a bill");
  if (item.listUnsubscribe) add(-4, "a mailing list");
  if (item.labels.some((l) => PROMO_LABELS.includes(l))) add(-4, "Gmail filed it under promotions/social");
  else if (item.labels.includes("CATEGORY_UPDATES") && !person) add(-1, "an automated update");
  if (has(NEWSLETTER, item)) add(-3, "reads like a newsletter or promotion");
  if (SOCIAL.test(item.domain)) add(-4, "a social notification");
  if (item.fromNick) add(-99, "he sent it");

  const score = signals.reduce((sum, [p]) => sum + p, 0);
  const level = score >= IMPORTANT_AT ? "important" : score >= BORDERLINE_AT ? "borderline" : "skip";
  // A security code from a stranger's newsletter is not urgent: urgency needs the mail itself to have scored as worth telling.
  return { level, score, urgent: urgentSignals && level === "important", reasons: signals.map(([p, w]) => `${p > 0 ? "+" : ""}${p} ${w}`), rule: null, topic: course };
}

/** The first of his course codes the subject or snippet names ("cs 2100" counts as CS2100). */
export function courseIn(item, courses = []) {
  const text = norm(`${item.subject} ${item.snippet}`).replace(/\b([a-z]{2,5})\s+(\d{4})\b/g, "$1$2");
  return courses.find((c) => new RegExp(`\\b${norm(c).replace(/\s+/g, "")}\\b`).test(text)) ?? null;
}
