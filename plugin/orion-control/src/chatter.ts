/*
 Room speech, quiet windows and repeated failures (2026-10-30, server side).

 R2 live evidence: on 10-25 room chatter got "Saved: Frozen." and "I don't have a costume, Nick"; on 10-26 a rehearsed
 presentation got "Not done: 6:00 AM–6:00 AM is shorter than 5 minutes" thirty times. The app's address gate is not
 the only guard any more:
   - a spoken turn saves nothing to memory unless he addressed it ("remember …", "orion note that …");
   - a spoken turn the front desk calls "ignore" with no "orion" in it gets no reply (QUIET_REPLY);
   - "don't reply unless I say orion" / "shush" / "i'm rehearsing" starts a quiet window (quiet.json in the state dir):
     spoken turns are dropped until he says "orion" or it times out;
   - the same failure line is never sent twice in ten minutes in one session.
*/
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What a turn that should be silent sends. The Mac app treats an empty reply as an error, so it is an ellipsis, said as nothing. */
export const QUIET_REPLY = "…";
export const QUIET_FILE = "chat-quiet.json";
export const QUIET_DEFAULT_MIN = 30;
const QUIET_MAX_MIN = 180;
export const REPEAT_WINDOW_MS = 10 * 60_000;

/** He said ORION's name: the turn is for ORION (and it ends a quiet window). */
export const addressed = (message: string): boolean => /\borion\b/i.test(message);

const QUIET_ASK = /\b(?:don'?t|dont|do not|no need to)\s+(?:reply|respond|answer|talk|say anything)\b[^.?!]*\b(?:unless|until)\b[^.?!]*\b(?:orion|your name)\b|\b(?:shush|shh+|hush)\b|\bi'?m\s+(?:rehearsing|practi[cs]ing (?:my |a |the )?(?:presentation|talk|speech|pitch))|\bim\s+rehearsing\b|\b(?:be|stay|go) quiet\b|\bquiet mode\b|\bstop (?:talking|replying|responding)\b|\b(?:don'?t|dont|do not) (?:reply|respond) to (?:anything|me)\b/i;
const NOT_QUIET = /\b(?:don'?t|dont|do not|never|stop) (?:be|being|stay|go) quiet\b|\bend quiet\b|\bwhy (?:are|were) you quiet\b|\?\s*$/i;
/** "dont reply unless i say orion", "shush", "i'm rehearsing a presentation for the next 20 minutes": minutes of quiet, or null. */
export function quietRequest(message: string): number | null {
  const m = message.trim();
  if (!QUIET_ASK.test(m) || NOT_QUIET.test(m)) return null;
  const minutes = /\bfor (?:the next |another )?(\d{1,3})\s*(?:min|mins|minutes|m)\b/i.exec(m)?.[1];
  const hours = /\bfor (?:the next |another )?(an?|one|two|\d)\s*(?:hour|hr)s?\b/i.exec(m)?.[1];
  const half = /\bhalf an? hour\b/i.test(m);
  const n = minutes ? Number(minutes) : half ? 30 : hours ? (/^(an?|one)$/i.test(hours) ? 60 : hours === "two" ? 120 : Number(hours) * 60) : QUIET_DEFAULT_MIN;
  return Math.max(1, Math.min(QUIET_MAX_MIN, n));
}
export const quietAck = (minutes: number): string => `Okay, I'll stay quiet until you say "Orion" (or for ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes > 60 ? "s" : ""}` : `${minutes} minutes`}).`;

/** The quiet window: in the state dir when there is one (the app, voice and every session share it), else in memory. */
export class QuietWindow {
  private memory: { until: number } | null = null;
  constructor(private readonly dir?: string) {}
  until(now: number): number | null {
    let until = this.memory?.until ?? null;
    if (this.dir) { try { const f = JSON.parse(readFileSync(join(this.dir, QUIET_FILE), "utf8")) as { until?: string }; until = Date.parse(f.until ?? ""); } catch { until = null; } }
    return until && Number.isFinite(until) && until > now ? until : null;
  }
  start(now: number, minutes: number, reason: string): void { this.write({ until: new Date(now + minutes * 60_000).toISOString(), at: new Date(now).toISOString(), reason: reason.slice(0, 120) }); }
  end(now: number): void { this.write({ until: new Date(now).toISOString(), at: new Date(now).toISOString(), reason: "ended" }); }
  private write(row: { until: string; at: string; reason: string }): void {
    this.memory = { until: Date.parse(row.until) };
    if (!this.dir) return;
    try { mkdirSync(this.dir, { recursive: true }); const tmp = join(this.dir, `${QUIET_FILE}.${process.pid}.tmp`); writeFileSync(tmp, `${JSON.stringify(row)}\n`); renameSync(tmp, join(this.dir, QUIET_FILE)); } catch { /* the memory copy still holds */ }
  }
}

// Lines that report something did not work: these are what repeated thirty times.
const FAILURE = /^(?:Not done:|NOTHING WAS|That doesn't fit|I couldn't|I didn't|Didn't catch that|Something went wrong|Go on\.$)/;
export const STILL_FAILING = "Same problem as a moment ago, so still nothing changed. Tell me differently and I'll try again.";
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Per session, the failure lines sent and when. `guard` returns what to send instead of a repeat. */
export class RepeatGuard {
  private readonly sent = new Map<string, Array<{ key: string; at: number }>>();
  guard(sessionKey: string | undefined, text: string, spoken: boolean, now = Date.now()): string {
    if (!sessionKey || !FAILURE.test(text.trim())) return text;
    const recent = (this.sent.get(sessionKey) ?? []).filter((r) => now - r.at < REPEAT_WINDOW_MS);
    const key = squash(text);
    const repeat = recent.some((r) => r.key === key);
    if (!repeat) { this.sent.set(sessionKey, [...recent, { key, at: now }]); return text; }
    // A repeat: spoken, nothing at all; typed, one plain "same problem" line, then nothing.
    const still = squash(STILL_FAILING);
    const replacement = spoken || recent.some((r) => r.key === still) ? QUIET_REPLY : STILL_FAILING;
    this.sent.set(sessionKey, [...recent, ...(replacement === STILL_FAILING ? [{ key: still, at: now }] : [])]);
    return replacement;
  }
}
