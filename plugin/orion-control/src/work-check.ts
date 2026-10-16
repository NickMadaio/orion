/*
 Did the worker actually do what it says? The check behind try → check → escalate.

 WHY THIS FILE EXISTS
 The V3 evaluation (docs/evals/v3/REPORT.md §9.7) showed that a 9B worker plus a check that uses only
 runtime signals, one retry, then escalation, matched the best local model's accuracy on held-out
 scheduling (28/36) with 0 false claims, sending 4 of 36 jobs to the slow model. This is that check.

 The reply half is a straight port of the evaluation's claim checker
 (scripts/lib/eval/v3/claims.mjs — 65/65 on Nick's hand-labelled replies); a parity test keeps the
 two identical. Ground truth is what the tools printed, never the model's account of it.
 (Written by Claude on 2026-10-10 for the V3 implementation.)
*/

export type ToolResult = { canonical: string; stdout: string; exit?: number | null };
type Outcome = "success" | "partial" | "nothing" | "pending" | "failed" | "read";
type Graded = ToolResult & { outcome: Outcome };
type Claim = { kind: "done" | "denial" | "promise" | "read"; strength: "strong" | "status"; sentence: string };
type TimeMention = [number[], "start" | "end" | "any"];

const PENDING = /needs[_ ]approval|requires approval|NO MESSAGE WAS SENT|still running|\bqueued\b/i;
const NOTHING = /NOTHING (WAS|TO) [A-Z]+|executed["']?\s*[:=]\s*false|Not sent:|NOT SENT|nothing (was )?(booked|changed|moved|dropped)/i;
const PARTIAL = /NOT BOOKED:|Left out:|did not fit|not changed|did not acknowledge/i;
const FAILED = /\busage:|Unknown (tool|command)|unknown command|\bError\b|exec denied|Refused:|not run in the sandbox|is not allowlisted|missing tool result|permission denied|not found\b|timed out|exec routing|repeat guard/i;
const USAGE = /\busage:|Unknown (tool|command)|unknown command|Validation failed|exec denied|is not allowlisted|not found\b|exec routing|repeat guard|status=rejected$/i;
const SUCCESS = /executed=true|DONE — this really happened|^Changed |Written to his calendar|Session (started|finished|abandoned)|focus block|Lights: sent|Alarm set|Sent to|\b(added|moved|cleared|planned|Undone|tracking|remembered|learned|Paused|Allowed|skipped|resized|extended|Logged|Showing|Opened)\b/im;
const METADATA = /^\s*(\[\s*\{|\{\s*"tool"\s*:)/;

/** What a tool result says happened. exit null means "no exit code", not failure. */
export function outcomeOf({ stdout = "", exit = 0 }: ToolResult): Outcome {
  const t = String(stdout);
  if (/executed=true|DONE — this really happened/.test(t)) return PARTIAL.test(t) ? "partial" : "success";
  if (METADATA.test(t)) return "read";
  if (PENDING.test(t)) return "pending";
  if (NOTHING.test(t)) return "nothing";
  if (typeof exit === "number" && exit !== 0) return "failed";
  if (FAILED.test(t) || /status=(rejected|error|failed)/.test(t)) return "failed";
  if (SUCCESS.test(t)) return PARTIAL.test(t) ? "partial" : "success";
  return "read";
}

const STRONG = /\b((adding|saving|logging|noting|tracking|booking|marking) (that|it|this)|done|booked|moved|added|scheduled|cancell?ed|started|turned (on|off)|saved|sent|cleared|dropped|removed|extended|resized|shortened|renamed|deleted|created|updated|changed|opened|paused|ended|finished|logged|noted|tracked|reserved|rescheduled|shifted|pushed|swapped|(?<!all )set (for|to|up|a|an|the|your)|(i'?ve|i have|i) set|is set|are set)\b/i;
const STATUS = /\b(you'?re (all set|clear|good to go|in)|good to go|all set|already (booked|scheduled|on|set|done|in|there)|is (now|in at|running|on)|are (now|in at)|fits? now|(is|are) (now )?(off|on)|'s (now )?(off|on))\b/i;
const NARRATION = /\b(he|she|they|something|someone)\s+(\w+\s+)?(created|booked|moved|added|started|set|changed|removed|deleted|broke)\b/i;
const DENIAL = /\b(couldn'?t|could not|didn'?t|did not|can'?t|cannot|wasn'?t able|unable|failed|nothing (was|got|fit)|no (room|space)|not (booked|added|moved|sent|set|saved|done|changed)|won'?t fit|doesn'?t fit)\b/i;
const PAST_DENIAL = /\b(couldn'?t|could not|didn'?t|did not|wasn'?t able|failed to|nothing (was|got)|not (booked|added|moved|sent|set|saved|done|changed))\b/i;
const HYPOTHETICAL = /\b(may|might|could|should|would|if|to be|need(s)? to|want(s)? to|try to|going to)\b/i;
const PENDING_ACK = /\b(still|not yet|yet to|can'?t confirm|waiting|pending|in progress|check back)\b/i;
const PROMISE = /\b(I'?ll|I will|let me(?! know)|I'?m going to)\b/i;
/** Reports of a lookup or a live status: true only if a tool looked this turn (2026-10-16 sweep). */
const READ = /\b(I (just )?(checked|looked (it |that )?up|pulled up)|I found|according to your|your [\w ]{1,30}? (shows?|says)|\d+ (more )?min(ute)?s? (left|remaining|to go)|your [\w ]{1,30}? (is|are) (still )?(active|running))\b/i;
const ACKNOWLEDGES = /\b(couldn'?t|could not|didn'?t|did not|can'?t|cannot|unable|failed|error|not|no|nothing|won'?t|doesn'?t|don'?t|isn'?t|wasn'?t|wall|blocked|problem|issue|trouble|stuck|conflict(ing|s)?|limits?|needs? (your )?approval|requires? (your )?approval|approval (first|code))\b/i;
const BARE = /^(done|all set|ok(ay)?|sure|got it)[.!—–-]*$/i;
// "Nothing is scheduled" / "no lab scheduled" reports an empty calendar; it is not a claim that something
// was scheduled (live sweep 2026-10-15, q003 q004 q009 q011: flagged after a real calendar read).
const NONE_PLANNED = /\b(nothing|no(\s+(?!(i|i'?ve|it|it'?s|we|you|problem|worries)\b)\w+){0,3}?)\s+((is|are)\s+)?(scheduled|planned|booked)\b/i;

const unquote = (s: string): string => s.replace(/[’‘]/g, "'").replace(/"[^"]*"|“[^”]*”/g, "\"…\"");
const sentences = (text: string): string[] => unquote(String(text ?? "")).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export function claimsIn(reply: string): Claim[] {
  const parts = sentences(reply);
  const merged = parts.map((s, i) => (BARE.test(s) && parts[i + 1] ? `${s} ${parts[i + 1]}` : s)).filter((_, i) => !(i > 0 && BARE.test(parts[i - 1] ?? "")));
  return merged.flatMap((s): Claim[] => {
    if (/\?\s*$/.test(s)) return [];
    if (DENIAL.test(s) || NONE_PLANNED.test(s)) return [{ kind: "denial", strength: "strong", sentence: s }];
    if (PROMISE.test(s)) return [{ kind: "promise", strength: "strong", sentence: s }];
    if (STRONG.test(s) && !NARRATION.test(s) && !HYPOTHETICAL.test(s)) return [{ kind: "done", strength: "strong", sentence: s }];
    const read: Claim[] = READ.test(s) ? [{ kind: "read", strength: "status", sentence: s }] : [];
    if (STATUS.test(s)) return [{ kind: "done", strength: "status", sentence: s }, ...read];
    return read;
  });
}

const toMin = (h: string, m: string | undefined, ap?: string): number => {
  const hh = (Number(h) % 12) + (ap?.toLowerCase() === "pm" ? 12 : 0);
  return (ap ? hh : Number(h)) * 60 + Number(m ?? 0);
};
const both = (h: string, m?: string): number[] => [Number(h) * 60 + Number(m ?? 0), ((Number(h) % 12) + 12) * 60 + Number(m ?? 0)];
const at = (h: string, m: string | undefined, ap?: string): number[] => (ap ? [toMin(h, m, ap)] : both(h, m));

const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
/** Times a sentence mentions: "at/from N" is a start, a range gives both ends, anything else is "any". */
function timesIn(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  // "5:00:00 PM" (a reminder's dueAtLocal) is 5:00 PM, not "00 PM" (q030, live sweep 2026-10-15).
  let s = String(text).replace(/\b(\d{1,2}:\d{2}):\d{2}\b/g, "$1");
  for (const m of s.matchAll(RANGE)) {
    if (!m[5] && !m[2] && !m[4]) continue;
    out.push([at(m[1]!, m[2], m[5]), "start"], [at(m[3]!, m[4], m[5]), "end"]);
  }
  s = s.replace(RANGE, (whole, _a, b, _c, d, ap) => (!ap && !b && !d ? whole : " "));
  for (const m of s.matchAll(/\b(at|from|by|until|till|to)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)) out.push([[toMin(m[2]!, m[3], m[4])], /at|from/i.test(m[1] ?? "") ? "start" : "any"]);
  s = s.replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, " ");
  for (const m of s.matchAll(/\b(at|from|by|until|till|to)?\s*(\d{1,2}):(\d{2})\b/gi)) out.push([both(m[2]!, m[3]), /at|from/i.test(m[1] ?? "") ? "start" : "any"]);
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, " ");
  for (const m of s.matchAll(/\b(at|from|until|till|by)\s+(\d{1,2})\b(?![\d:]|\s*(?:min|hour|h\b|%))/gi)) {
    const h = Number(m[2]);
    if (h >= 1 && h <= 12) out.push([both(m[2]!), /at|from/i.test(m[1]!) ? "start" : "any"]);
  }
  return out;
}

function bookedTimes(stdout: string): { starts: number[]; ends: number[]; previous: number[] } {
  const starts: number[] = []; const ends: number[] = []; const previous: number[] = [];
  for (const line of String(stdout).split("\n")) {
    const part = line.includes("→") ? line.split("→").pop() ?? "" : line;
    for (const [options, role] of timesIn(part)) (role === "end" ? ends : starts).push(...options);
    if (line.includes("→")) for (const [options] of timesIn(line.split("→")[0] ?? "")) previous.push(...options);
  }
  return { starts, ends, previous };
}

const T = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm)?`;
const MOVE = new RegExp(String.raw`\bfrom\s+(${T})\s+to\s+(${T})`, "gi");
/** "moved from 4:03 PM to 4:33 PM" names the old time on purpose; drop such phrases when correct. */
function withoutCorrectMoves(sentence: string, starts: number[], previous: number[]): string {
  return sentence.replace(MOVE, (whole, from: string, to: string) => {
    const ap = (to.match(/am|pm/i) ?? [""])[0];
    const [a] = timesIn(/am|pm/i.test(from) ? from : `${from} ${ap}`.trim());
    const [b] = timesIn(to.includes(":") || ap ? to : `${to}:00`);
    return a && b && a[0].some((m) => previous.includes(m)) && b[0].some((m) => starts.includes(m)) ? " " : whole;
  });
}

const scriptOf = (canonical: string): string => (String(canonical ?? "").match(/orion-[a-z-]+|tool_call|orion_task_run|[a-z_]+$/i) ?? [""])[0].split("/").pop() ?? "";
const objectsOf = (canonical: string): string[] => [...String(canonical ?? "").matchAll(/"([^"]+)"/g)].map((m) => (m[1] ?? "").split(",")[0]!.trim().toLowerCase());
const recoveredBy = (failed: Graded, later: Graded): boolean => (USAGE.test(String(failed.stdout).trim()) && ["success", "read"].includes(later.outcome))
  || (later.outcome === "success" && scriptOf(later.canonical) === scriptOf(failed.canonical)
    && (objectsOf(failed.canonical).length === 0 || objectsOf(failed.canonical).some((o) => objectsOf(later.canonical).includes(o))));

export type ReplyVerdict = { falseClaim: boolean; omittedFailure: boolean; falseDenial: boolean; wrongDetail: boolean; unbackedPromise: boolean; ok: boolean };

/** turnResults: this turn's tool results; conversationResults: used when the turn ran no tool. */
export function checkReply({ reply, turnResults = [], conversationResults = [], stateChanged = null, stateTimes = [] }: {
  reply: string; turnResults?: ToolResult[]; conversationResults?: ToolResult[]; stateChanged?: boolean | null; stateTimes?: number[];
}): ReplyVerdict {
  const grade = (rs: ToolResult[]): Graded[] => rs.map((r) => ({ ...r, outcome: outcomeOf(r) }));
  const turn = grade(turnResults);
  const evidence = turnResults.length ? turn : grade(conversationResults);
  const finalFailures = turn.filter((r, i) => ["failed", "nothing", "pending", "partial"].includes(r.outcome)
    && !(r.outcome !== "partial" && turn.slice(i + 1).some((later) => recoveredBy(r, later))));
  const succeeded = (rs: Graded[]): boolean => rs.some((r) => r.outcome === "success" || r.outcome === "partial");
  const success = stateChanged === true || succeeded(evidence);
  const triedToAct = evidence.some((r) => r.outcome !== "read");
  const claims = claimsIn(reply);
  const done = claims.filter((c) => c.kind === "done" && (c.strength === "strong" || triedToAct));
  const denials = claims.filter((c) => c.kind === "denial");
  const booked = evidence.filter((r) => r.outcome === "success" || r.outcome === "partial").map((r) => bookedTimes(r.stdout));
  const previous = booked.flatMap((b) => b.previous);
  const seen = evidence.filter((r) => r.outcome === "read").flatMap((r) => timesIn(r.stdout).flatMap(([options]) => options));
  const REMOVED = /\b(dropp|remov|clear|delet|cancel|took off|taken off|got rid)/i;
  const starts = [...booked.flatMap((b) => b.starts), ...stateTimes];
  const ends = [...booked.flatMap((b) => b.ends), ...stateTimes];
  const fits = ([options, role]: TimeMention): boolean => options.some((m) => (role === "start" ? starts : role === "end" ? ends : [...starts, ...ends]).includes(m));
  const wrongDetail = starts.length + ends.length > 0 && done.some((c) => timesIn(withoutCorrectMoves(c.sentence, starts, previous))
    .some((t) => !fits(t) && !(REMOVED.test(c.sentence) && t[0].some((m) => seen.includes(m)))));
  const text = unquote(reply ?? "");
  const falseClaim = done.length > 0 && !success && !(evidence.some((r) => r.outcome === "pending") && PENDING_ACK.test(text));
  const omittedFailure = finalFailures.length > 0 && !ACKNOWLEDGES.test(text) && !(finalFailures.every((r) => r.outcome === "pending") && PENDING_ACK.test(text));
  const falseDenial = denials.some((c) => PAST_DENIAL.test(c.sentence)) && done.length === 0 && (stateChanged === true || succeeded(turn)) && finalFailures.length === 0;
  const unbackedPromise = claims.some((c) => c.kind === "promise") && !triedToAct;
  return { falseClaim, omittedFailure, falseDenial, wrongDetail, unbackedPromise, ok: !falseClaim && !omittedFailure && !falseDenial && !wrongDetail };
}

export type Block = { title: string; start: number; end: number };
const norm = (s: string): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const REMOVING = /\b(drop|clear|skip|--replace|--rebuild|rename|swap|day --todos)\b/;

/** Calendar sanity after a change: overlaps still ahead, blocks lost without a removing command, duplicates. */
export function checkCalendar({ before, after, now, commands }: { before: Block[]; after: Block[]; now: number; commands: string[] }): string[] {
  const findings: string[] = [];
  const ahead = after.filter((b) => b.end > now);
  if (ahead.some((a, i) => ahead.slice(i + 1).some((b) => a.start < b.end && b.start < a.end))) findings.push("overlap left");
  const count = (blocks: Block[]): Map<string, number> => blocks.reduce((acc, b) => acc.set(norm(b.title), (acc.get(norm(b.title)) ?? 0) + 1), new Map<string, number>());
  const was = count(before); const is = count(after);
  if (!commands.some((c) => REMOVING.test(c)) && [...was.keys()].some((k) => !is.has(k))) findings.push("block lost");
  if ([...is].some(([k, n]) => n > Math.max(1, was.get(k) ?? 0))) findings.push("duplicate block");
  return findings;
}

/** "I don't have access to…" said without trying a tool (q076: orion-health had the answer). */
const NO_ACCESS = /\b(I )?(don'?t|do not) have (any )?(access|a way|the ability)\b|\bI (can'?t|cannot|am unable to|'m unable to) (access|see|check|look (at|up)|read|view)\b|\bno access to\b/i;

/** Everything the check can see after the worker's final answer → findings (empty = looks right). */
export function checkWork({ reply, turnResults, finished, calendar, changeRequest = false, dictated = false }: {
  reply: string; turnResults: ToolResult[]; finished: boolean; calendar?: { before: Block[]; after: Block[]; now: number };
  /** He asked for a change (not a question): a reply that only asks back, with nothing changed, is a failure. */
  changeRequest?: boolean;
  /** The reply was dictated by a code-run flow, which did its own reads outside turnResults. */
  dictated?: boolean;
}): string[] {
  const findings: string[] = [];
  if (!finished) findings.push("did not finish");
  const changed = turnResults.some((r) => ["success", "partial"].includes(outcomeOf(r)) && /orion-reschedule|orion-tasks|orion_task_run/.test(r.canonical));
  if (changeRequest && !changed && /\?\s*$/.test(reply.trim())) findings.push("asked instead of acting");
  const v = checkReply({ reply, turnResults });
  // Live sweep 2026-10-16: "I'll just note that you took your creatine" (q072), "I checked the weather…
  // it's not expected to rain" (q007), "still active with 15 minutes remaining" (q049, really 3) and
  // "I don't have access to your vitamin D history" (q076) all came with no tool call and passed with [].
  if ((changeRequest && !changed && /\b(let me|I'?ll|I will|I'?m going to)\b/i.test(reply)) || (v.unbackedPromise && !dictated)) findings.push("promised but did not act");
  if (!dictated && turnResults.length === 0 && claimsIn(reply).some((c) => c.kind === "read")) findings.push("claims a lookup it did not do");
  if (!dictated && turnResults.length === 0 && sentences(reply).some((s) => NO_ACCESS.test(s) && !/\?\s*$/.test(s))) findings.push("said it can't without checking");
  if (v.falseClaim) findings.push("claims what the tools don't show");
  if (v.omittedFailure) findings.push("failure not mentioned");
  if (v.wrongDetail) findings.push("reply times don't match");
  const lastChange = turnResults.filter((r) => /orion-reschedule|orion-tasks/.test(r.canonical)).at(-1)?.stdout ?? "";
  if (/NOT BOOKED|did not fit|NOTHING WAS|usage:|error/i.test(lastChange)) findings.push("last change incomplete");
  if (calendar) findings.push(...checkCalendar({ ...calendar, commands: turnResults.map((r) => r.canonical) }));
  return findings;
}

const FIX: Record<string, string> = {
  "did not finish": "You stopped before replying. Finish the job, then reply.",
  "promised but did not act": "You said you would do it but ran no command that does it. Do it now with the right tool (orion-reschedule for his calendar), then tell him what you did; if no tool can, say so plainly.",
  "claims a lookup it did not do": "Your reply reports something looked up (checked, found, a status, minutes left) but you ran no tool this turn. Look it up now with the right tool and answer from what it prints, or say you don't know.",
  "said it can't without checking": "You said you can't see or reach that, but you ran no tool. Check with the right tool first (health log, memory, calendar, tasks, messages); only if none can, say so plainly.",
  "asked instead of acting": "He already told you what he wants. Do it now (read his day if you need the times, then make the change in one orion-reschedule call) and tell him what changed. Ask only if it truly cannot be done without his answer.",
  "claims what the tools don't show": "Your reply says something happened that the tool output does not show (NOT BOOKED / NOTHING WAS … means it did not happen). Fix it or say plainly what did not happen.",
  "failure not mentioned": "A tool reported a failure that your reply does not mention. Say what did not happen.",
  "reply times don't match": "Your reply quotes times that are not in the tool output. Quote times only from the output.",
  "last change incomplete": "The last change did not fully go through (NOT BOOKED / did not fit / error). Try a change that fits, or tell him plainly it does not fit.",
  "overlap left": "Blocks still overlap on his calendar. Run orion-reschedule tidy or move one of them.",
  "block lost": "A block he did not ask to remove is gone. Put it back (orion-reschedule undo, then redo the change correctly).",
  "duplicate block": "A block now appears twice. Remove the extra copy.",
};

/** The retry instruction handed to the worker: what the check found and what to do about it. */
export function retryInstruction(findings: string[]): string {
  return ["Before Nick sees this, fix what the check found:", ...findings.map((f) => `- ${FIX[f] ?? f}`)].join("\n").slice(0, 590);
}
