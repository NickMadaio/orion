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
/** A wake signal this soon after the declaration is the phone going on the charger, not him waking. */
const SETTLE_MINUTES = 30;
const MIN = 60_000;

const BED = /\b(?:going|gonna|heading|headed|off|about)\s+(?:to\s+)?(?:go\s+)?(?:to\s+)?(?:bed|sleep)\b|\btime (?:for|to go to) (?:bed|sleep)\b|\bgood\s?night\b|\bnight night\b|\bnighty night\b|\b(?:hitting|hit) the (?:sack|hay)\b|\bcalling it a night\b|\bturning in\b|\bsleep(?:ing)? now\b|\bsigning off for the night\b/i;
const NEGATED = /\b(?:not|never|n't|won't|can't|cannot|before|until|unless|if i|when i|should i|do i)\b/i;

/** Is this message Nick saying he is going to sleep? Short statements only: a question or a long message that mentions bed is not. */
export function isBedtimeStatement(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 90 || t.includes("?")) return false;
  return BED.test(t) && !NEGATED.test(t);
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
export function noteInboundText({ dir, text, now = new Date() }) {
  if (isBedtimeStatement(text)) { declareSleep(dir, now); return "declared"; }
  const d = readJson(join(dir, FILE));
  const at = Date.parse(d?.at);
  if (Number.isFinite(at) && now.getTime() - at >= STIR_MINUTES * MIN && String(text ?? "").trim()) { clearDeclared(dir); return "cleared"; }
  return null;
}
