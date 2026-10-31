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
import { isCrisis } from "./distress.js";

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

/*
 One side of someone else's conversation (2026-10-31, gate run-1031133008 cluster 7).
 cha-phone-call-v: "i can call you back on sunday probably" got "Sounds good, Nick. Talk to you Sunday." and "ok love you bye" got
 "Love you too, Nick!": the desk read them as chit-chat for ORION. cha-thinking-aloud-v: "no thats wrong, ugh" right after a
 thinking-aloud line got "I didn't actually do that". cha-tv-v: TV lines got "What time should I remind you?" and a crisis reply.
 Out loud and without his name, two things now mean "not for ORION":
   - the line itself reads as talk to a person in the room or on the phone (a vocative like "mom", a goodbye, "call you back");
   - it follows, within ROOM_STREAK_MS, a spoken line that already went unanswered as not for ORION, and it is not shaped like a
     request to an assistant. A conversation he is having does not stop being one between two lines.
 Saying "orion" always gets through, and so does a plain request ("remind me…", "what's the weather", "move gym to 7"), though
 inside a streak only a flow that acts may answer it (roomQuiet).
*/
export const ROOM_STREAK_MS = 3 * 60_000;
// REV2 finding 5: "man", "dude", "bro", "mate" are his casual register with ORION too ("dude remind me…", "move gym to 7, man"), not a person.
const PERSON = String.raw`(?:mom|mum|mam|mommy|ma|dad|daddy|pops|brother|sis|babe|baby|grandma|grandpa|nan|nana|granny)`;
const SOMEONE_ELSE = new RegExp([
  String.raw`^(?:(?:yeah|yea|ya|yes|no|nah|ok|okay|hi|hey|hello|bye|thanks|sorry|listen|look)[,\s]+)+${PERSON}\b`,
  String.raw`^${PERSON}[,\s]`,
  String.raw`,\s*${PERSON}\s*[.!?]*$`,
  String.raw`\b(?:love you|love ya|luv you|luv ya|miss you)\b(?:\s+(?:too|more|bye|so much|lots))*\s*[.!]*$`,
  String.raw`\b(?:bye(?: bye)?|goodbye|see ya|see you(?: later| soon| then| tomorrow| on \w+)?|ttyl|catch you later|talk (?:to you )?(?:later|soon|tomorrow|tmrw|then|on \w+day|\w+day))\s*[.!]*$`,
  String.raw`\b(?:call|ring|text|facetime) you (?:back|later|tomorrow|tmrw|on \w+day|\w+day|tonight|in a bit)\b`,
  String.raw`\bi(?:'ll| will| can|ll)? (?:call|ring|text|facetime) you\b`,
  String.raw`\b(?:tell|say hi to|give my love to) (?:dad|mom|mum|grandma|grandpa|nan|everyone|the family)\b`,
].join("|"), "i");
/** A line that reads as said to a person in the room or on the phone. Only meaningful for a spoken line without "orion". */
export const talksToSomeoneElse = (message: string): boolean => SOMEONE_ELSE.test(message.trim());

// Shaped like a request to an assistant: these still go through inside a streak.
const REQUEST_SHAPE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|um+|uh+|yo|dude|man|bro|mate|orion)[,\s]+)*(?:remind me|fix|lighten|sort out|replan|set (?:a|an|my|the)\b|start|stop|pause|resume|end|finish|turn (?:on|off|up|down)|lights?\b|play|skip|open|close|move|push|put|add|book|schedule|cancel|drop|clear|text|email|send|log|mark|what(?:'s|s| is| are| time)?\b|when(?:'s| is| does| do)\b|how (?:long|much|many|did|was|is)\b|where(?:'s| is)\b|is (?:my|it going)\b|do i\b|did i\b|can you|could you|would you|will you|show me|tell me|read me|read my|check)\b/i;
export const requestShaped = (message: string): boolean => REQUEST_SHAPE.test(message.trim());
/** REV2 finding 5: a status he tells ORION ("im running late", "gym done", "im sick", "i slept badly", "i have a quiz thursday", "i need
 *  to leave at 5") is not room chatter either, inside a streak. */
const STATUS_SHAPE = /\b(?:i'?m|im|i am)\s+(?:so\s+|really\s+|kinda\s+|feeling\s+)?(?:running late|late|sick|ill|tired|exhausted|wrecked|done|going to|gonna|leaving|heading|off to|back)\b|\brunning (?:\d+\s*(?:min(?:ute)?s?\s*)?)?late\b|^(?:the\s+|my\s+)?(?:gym|class|lecture|study|studying|lab|workout|it)\s+(?:is\s+|was\s+)?(?:done|over|finished)\b|\bi\s+slept\b|\bslept (?:badly|bad|terribly|like)\b|\bi\s+(?:have|need|got|'?ve got|ve got)\b|\b(?:fix|lighten|sort out|replan)\s+(?:my|the)\b/i;
export const statusShaped = (message: string): boolean => STATUS_SHAPE.test(message.trim());

/** Per session: when a spoken turn last went unanswered as not for ORION. */
export class RoomStreak {
  private readonly last = new Map<string, number>();
  mark(sessionKey: string | undefined, now: number): void { if (sessionKey) this.last.set(sessionKey, now); }
  recent(sessionKey: string | undefined, now: number): boolean {
    const at = sessionKey ? this.last.get(sessionKey) : undefined;
    return at !== undefined && now - at < ROOM_STREAK_MS;
  }
  clear(sessionKey: string | undefined): void { if (sessionKey) this.last.delete(sessionKey); }
}

/** 2026-10-31 17:40 (build 1052): a body-cam video on the TV woke the app, and "insert at just the right point in the shoe … And then"
 *  was held as half a request: ORION said "Go on." to the television. Half a request to ORION is short ("can", "can you move gym to
 *  after my"); a long line that trails off with no request or status in it is someone else mid-sentence. The caller passes `trailing`. */
export const ROOM_FRAGMENT_WORDS = 8;
const overheardFragment = (message: string): boolean =>
  (message.match(/[a-z0-9']+/gi) ?? []).length >= ROOM_FRAGMENT_WORDS && !statusShaped(message);

/** How a spoken line without "orion" is read: "room" (silent, nothing runs), "streak" (only a flow that acts may answer), or null. */
export function roomTalk(message: string, ctx: { spoken: boolean; streak: boolean; trailing?: boolean }): "room" | "streak" | null {
  // Orchestrator decision (REV2 5): a crisis signal is never silenced, spoken or typed, addressed or not.
  if (!ctx.spoken || addressed(message) || isCrisis(message)) return null;
  // A request reads as one before any goodbye or vocative in it ("turn off the lights, bye", "remind me to call you back tomorrow").
  if (requestShaped(message)) return ctx.streak ? "streak" : null;
  if (talksToSomeoneElse(message)) return "room";
  if (ctx.trailing && overheardFragment(message)) return "room";
  if (!ctx.streak) return null;
  return statusShaped(message) ? "streak" : "room";
}

/** Inside a streak, a code reply that only asks or reports a failure is not said to a room that was not talking to ORION. */
export const roomQuiet = (text: string, kind?: string): boolean => kind === "ask" || /\?\s*$/.test(text.trim()) || FAILURE.test(text.trim());
