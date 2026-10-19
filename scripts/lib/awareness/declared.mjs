// "Going to bed now" is a statement about sleep, not a clock reading (2026-10-19: he said it at 01:43 and the gym nagged
// at 01:45 and 01:50). A bedtime statement writes sleep-declared.json; readAwareness then reports `sleep.state: asleep`
// (source "declared"), which the one delivery gate holds for everything except a reminder he set or a class he is about
// to miss. It ends at his wake (the morning brief, a wake signal), when he writes again, or after at most 10 hours.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./io.mjs";

export const FILE = "sleep-declared.json";
export const MAX_HOURS = 10;
/** A message he sends this long after the declaration means he is up again. */
export const STIR_MINUTES = 10;
/** Real keyboard or mouse input this long after the declaration means he is not asleep (awareness mac facet). */
export const INPUT_MINUTES = 15;
/** A wake signal this soon after the declaration is the phone going on the charger, not him waking. */
const SETTLE_MINUTES = 30;
const MIN = 60_000;

const NEGATED = /\b(?:not|never|n't|won't|can't|cannot|before|until|unless|if i|when i|should i|do i)\b/i;
const SUBJECT = "(?:(?:i'?m|im|i am|i'?ll|ill|i will|we'?re)\\s+)?(?:just\\s+)?";
// an immediate, first-person, present intent: the clause IS the declaration...
const GOING = new RegExp(`^${SUBJECT}(?:(?:going|gonna|heading|headed|off|about)\\s+(?:to\\s+)?(?:(?:go|head)\\s+)?(?:to\\s+)?(?:bed|sleep)|(?:hitting|hit) the (?:sack|hay)|calling it a night|signing off for the night)\\b(.*)$`, "i");
// ...or a bare statement of it
const BARE = /^(?:(?:i'?m\s+)?(?:sleeping|going to sleep|going to bed|heading to bed) now|bed\s?time|time (?:for bed|to (?:go to )?(?:bed|sleep)))[\s!.]*$/i;
const GOODNIGHT = /^(?:good\s?night|night night|nighty night|night|gn)(?:\s+(?:orion|everyone|all|nick|bud|buddy|man|dude|mate|friend))?[\s!.]*$/i;
// what may follow the phrase: nothing that says "not now" (a time, a day, "on it", "early", "for 20 min", "after this")
const TAIL_OK = new Set(["now", "for", "the", "night", "tonight", "nite", "orion", "ok", "okay", "then", "guys", "bye", "cya", "ttyl", "here", "lol", "x", "xx", "gn"]);
const tailOk = (tail) => tail.toLowerCase().replace(/[\p{Extended_Pictographic}\u200d\ufe0f!]/gu, " ").split(/[^a-z0-9']+/).filter(Boolean).every((w) => TAIL_OK.has(w));
const FILLER = /^(?:ok(?:ay)?|so|well|alright|right|yeah|yep|now|anyway|aight)\s+/i;

/** Is this message Nick saying he is going to sleep now? First person, present, immediate: not a question, a nap, a plan for later or a third person. */
export function isBedtimeStatement(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 90 || t.includes("?") || NEGATED.test(t)) return false;
  return t.split(/[,;.!\n]+|\s+(?:so|and|but)\s+/i).map((c) => c.trim().replace(FILLER, "").replace(FILLER, "")).filter(Boolean).some((c) => {
    if (GOODNIGHT.test(c) || BARE.test(c)) return true;
    const m = GOING.exec(c);
    return !!m && tailOk(m[1]);
  });
}

/** Declaring sleep makes sense after 21:00, before 06:00, or within 3 hours of his bedtime: "going to bed" at 15:00 is a nap or a story. */
export function plausibleBedtime(now, bedtime = "23:45") {
  const minute = now.getHours() * 60 + now.getMinutes();
  const [h, m] = String(bedtime).split(":").map(Number);
  const bed = (Number.isFinite(h) ? h * 60 + (m || 0) : 1425);
  const bedEvening = bed < 12 * 60 ? bed + 1440 : bed;
  return minute >= 21 * 60 || minute < 6 * 60 || minute >= bedEvening - 180;
}

export function declareSleep(dir, now = new Date()) {
  writeJsonAtomic(dir, FILE, { at: now.toISOString(), source: "inbound-turn" });
}

export function clearDeclared(dir) {
  try { rmSync(join(dir, FILE), { force: true }); } catch { /* nothing to clear */ }
}

/** `iso` is after `t` and not in the future of `now` (a later wake signal is not evidence yet). */
const after = (iso, t, now) => { const x = Date.parse(iso); return Number.isFinite(x) && x > t && x <= now; };

/** Evidence that he woke after the declaration: the morning brief went out, a wake signal, or WHOOP's wake time. */
function wokeSince(dir, declaredAt, now) {
  const brief = readJson(join(dir, "morning-sent.json")) ?? {};
  if (Object.values(brief).some((e) => after(e?.at, declaredAt, now))) return true;
  const log = readJson(join(dir, "health-log.json")) ?? {};
  const settled = declaredAt + SETTLE_MINUTES * MIN;
  if ((log.sleepLog ?? []).some((e) => ["up", "unplugged", "used"].includes(e?.event) && after(e.at, settled, now))) return true;
  const nights = readJson(join(dir, "sleep-actual.json"))?.nights ?? [];
  return nights.some((n) => after(n?.wokeAt, declaredAt, now));
}

/** The declaration in force at `now`, or null (none, over, or he is evidently up). */
export function activeDeclaration({ dir, now = new Date() }) {
  if (!existsSync(join(dir, FILE))) return null;
  const d = readJson(join(dir, FILE));
  const at = Date.parse(d?.at);
  if (!Number.isFinite(at) || now.getTime() < at - MIN) return null;
  if (now.getTime() - at > MAX_HOURS * 60 * MIN) return null;
  if (wokeSince(dir, at, now.getTime())) return null;
  return { at: d.at, source: d.source ?? null };
}

/** A message from Nick: a bedtime statement declares sleep; any other message a while after one means he is up. */
export function noteInboundText({ dir, text, now = new Date(), bedtime, afterDeclare = null }) {
  if (isBedtimeStatement(text) && plausibleBedtime(now, bedtime)) {
    declareSleep(dir, now);
    try { afterDeclare?.(); } catch { /* e.g. starting the review: never undoes the declaration */ }
    return "declared";
  }
  const d = readJson(join(dir, FILE));
  const at = Date.parse(d?.at);
  if (Number.isFinite(at) && now.getTime() - at >= STIR_MINUTES * MIN && String(text ?? "").trim()) { clearDeclared(dir); return "cleared"; }
  return null;
}
