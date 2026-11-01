/*
 Raw CLI / tool text never reaches Nick (H4, round 8b2, 2026-10-16; reworked for review 5 H1, 2026-10-16 r8b).
 q069: a reply carried `Get "https://gmail.googleapis.com/…": … oauth2: "invalid_grant" …`.
 q070: a reply ended with "⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search …`" (stripExecFailed ran only in
 reply_payload_sending, which never fires on the Mac chat / phone route).
 This runs in before_agent_finalize and the result is put in place; it catches what the worker paraphrased or the host
 appended. Review 5 H1: it removes only the matched span (never a whole line that also holds a real answer), the OAuth /
 permission rules fire only when this run had a FAILED gmail/messages tool result and only on raw error shapes, and the
 generic failure line is returned only when nothing readable survives.
*/
import { stripExecFailed } from "./memory-facts.js";
import { acknowledgement, acknowledgesFailure, failedTools, wroteSomething } from "./tool-failure.js";
import { outcomeOf, type ToolResult } from "./work-check.js";

const GMAIL_SIGN_IN = "Gmail's sign-in expired — run `gog auth add nmadaio08@gmail.com` to reconnect.";
const GMAIL_OFFLINE = "I couldn't reach Gmail just now.";
const GMAIL_OTHER = "I couldn't read your Gmail just now.";
// Review 6 H-A (2026-10-16): an offline Mac prints `Get "https://…": … oauth2: cannot fetch token: … no such host` — that is
// a network failure, not a sign-in. Only invalid_grant means signing in again.
const NETWORK = /no such host|dial tcp|network is unreachable|could not resolve|getaddrinfo|ENOTFOUND|timed? ?out|connection refused/i;
const mailLine = (text: string): string => /invalid_grant/i.test(text) ? GMAIL_SIGN_IN : NETWORK.test(text) ? GMAIL_OFFLINE : GMAIL_OTHER;
// A change claim left standing after a failure tail was cut ("Done. ⚠️ Exec failed: …", review 6 M-B).
const NEGATED = /\b(?:no|nothing|not|never|none)\b|n't\b/i; // "Nothing was moved — Gym is not on Friday." is an honest reply (review 7 M2)
const CHANGE_CLAIM = /\b(?:done|added|moved|booked|scheduled|pushed|set|cancell?ed|removed|sent|logged|saved)\b/i;
const FULL_DISK = "I can't read your texts — ORION needs Full Disk Access.";
export const REPLY_FAILED = "I couldn't finish that just now.";

/** Raw error shapes a failed gmail/messages script prints (first match starts the span that is cut). */
const RAW_OAUTH = /invalid_grant|\boauth2: "|\bGet "https?:\/\/[^"\n]*"\s*:/i;
const RAW_PERMISSION = /operation not permitted|authorization denied|not authori[sz]ed to (?:open|read)/i;
const MAIL_TOOL = /orion-gmail|orion-messages|\bgmail\b|\bmessages\b/i;

// Spans cut out of a line (the rest of the sentence stays).
const SPANS: RegExp[] = [
  /(?:⚠️\s*)?(?:🛠️\s*)?\bExec failed\b:?[^\n]*/gi,
  /`[^`\n]*(?:\/scripts\/|~\/Desktop\/ORION|\borion-[a-z-]+)[^`\n]*`/g,
  /--[a-z-]+\s+\d{4}-\d{2}-\d{2}/g,
  /--[a-z][a-z-]*\s+(?:HH:MM|YYYY-MM-DD|<[^>\n]+>)/g,
  /\(Command exited with code \d+\)/g,
  /\bIf he meant\b[^\n]*/gi,
];
// A known scheduler/tool banner label ("NOTHING WAS BOOKED: …"), not any ALL-CAPS label. Review 6 H-B (2026-10-16): the
// line is honest and must be told to him ("NOT BOOKED: Laundry (no room before 9 PM)"), so only the shouting label is
// rewritten to plain words; the line is never dropped.
const BANNER = /\b(NOTHING WAS (?:BOOKED|CHANGED|SENT|ADDED|MOVED|DELETED|SAVED|SCHEDULED)|NOT (?:BOOKED|SENT|CHANGED|SCHEDULED))\b(?=[^:\n]*:)/g;
/** The raw error shapes alone (never prose): cut on every turn. A bare "invalid_grant" in a sentence is prose. */
const RAW_SHAPE = /\boauth2: "|\bGet "https?:\/\/[^"\n]*"\s*:/i;
/** A lead-in that ends in ":" before the raw text becomes its own sentence ("I couldn't read your Gmail:" → "…Gmail."). */
const asSentence = (piece: string): string => /:\s*$/.test(piece) ? (/\b(?:couldn'?t|can'?t|cannot|unable)\b/i.test(piece) ? piece.replace(/\s*:\s*$/, ".") : "") : piece;

/** `strict`: this turn had a failed tool, so paths, long CLI flags, JSON and stack frames are tool text, not prose. */
export type SanitizeContext = { mailFailed?: boolean; strict?: boolean; codeAuthored?: boolean };

/** True when this run's tool results include a gmail/messages read that failed (non-zero exit or a raw error shape). */
export function mailReadFailed(tools: ReadonlyArray<{ canonical: string; stdout: string; exit?: number | null }>): boolean {
  return tools.some((t) => MAIL_TOOL.test(t.canonical)
    && ((typeof t.exit === "number" && t.exit !== 0) || RAW_OAUTH.test(t.stdout) || RAW_PERMISSION.test(t.stdout)));
}

/*
 Gate run-1031133008 (cluster 5): the worker paraphrased tool failures in its own words, which the spans above do not catch:
 "The command failed. Try this: /Users/…/scripts/orion-brain learn Nick fact …" (per-preference-remember-c) and "The orion-brain
 tool isn't available in the current tool catalog." (hea-sleep-debt-c). A sentence that talks about ORION's plumbing is dropped
 whole; what is left is the honest part of the reply, or REPLY_FAILED when nothing is.
*/
const LEAK_SENTENCE = /\b(?:the command failed|command (?:failed|didn'?t work|returned an error)|try (?:this|running)\s*:|tools? (?:isn'?t|is not|aren'?t|are not) available|tools?\b[^.!?\n]{0,40}?\b(?:isn'?t|is not|aren'?t|are not|not|un)\s*available|stop retrying|without (?:that|the|this|any) tools?|(?:can'?t|cannot|unable to) (?:use|call|access) (?:the |that |this )?tools?|(?:current |my )?tool catalog|exec(?:ution)? (?:failed|denied|error)|allowlist|exit code|stderr|stack trace|orion-[a-z]+(?:-[a-z]+)*|orion_task_run|tool_call|traceback \(most recent)\b|\(Command exited with code \d+\)|"status"\s*:\s*"error"|^\s+at\s+\S.*:\d+(?::\d+)?\)?\s*$|^(?:Type|Reference|Syntax)?Error: (?:spawn|ENOENT|EACCES)|\/scripts\/|~\/Desktop\/ORION|\/Users\/[^/\s]+\/Desktop\/ORION/i;
const FAILED_WORDS = /\b(?:fail(?:ed|s|ure)?|didn'?t work|returned an error|error|denied|couldn'?t|could not|can'?t|cannot|unable|isn'?t available|not available)\b/i;
export const ONE_PART_FAILED = "One part didn't work.";
// Only on a turn with a failed tool: a path, a long flag, a JSON key or a stack frame there is tool output (elsewhere it can be the answer).
const STRICT_LEAK = /(?:^|[\s(])(?:~|\/Users\/[^/\s]+)\/\S+|(?<![\w-])--[a-z][a-z-]{2,}\b|^\s*[[{]\s*"[\w-]+"\s*:|\{\s*"[\w-]+"\s*:|\bat\s+\S+\s*\(\S+:\d+:\d+\)|\bspawn \S+ ENOENT/;
const leaks = (text: string, strict: boolean): boolean => LEAK_SENTENCE.test(text) || (strict && STRICT_LEAK.test(text));
function dropLeaks(line: string, strict = false): string {
  if (!leaks(line, strict)) return line;
  // "Try this: <command>" carries the command after the colon: the rest of the line goes with it.
  const pieces = line.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  const kept: string[] = [];
  // REV2 finding 17: a dropped sentence that said something FAILED leaves its meaning behind ("Done: moved gym and set reminder. The command
  // failed for the reminder." must not read as a plain "Done").
  let failed = false;
  for (const p of pieces) {
    if (leaks(p, strict)) {
      if (FAILED_WORDS.test(p) && !failed && kept.length) { failed = true; kept.push(ONE_PART_FAILED); }
      if (/try (?:this|running)\s*:/i.test(p)) break;
      continue;
    }
    kept.push(p);
  }
  return kept.join(" ").trim();
}

const tidy = (line: string): string => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

/** The reply with raw CLI/tool spans removed (known failures become one short line). Returns the input when it is clean. */
export function sanitizeReply(reply: string, ctx: SanitizeContext = {}): string {
  const stripped = stripExecFailed(reply);
  let changed = stripped !== reply.trim();
  let execCut = changed;
  const out: string[] = [];
  for (const raw of stripped.split("\n")) {
    let line = raw.replace(BANNER, (label: string) => { changed = true; return `${label.charAt(0)}${label.slice(1).toLowerCase()}`; })
      .replace(/^(\W*Not done:\s*)Nothing was booked:\s*/i, "$1");
    const oauth = line.search(RAW_OAUTH);
    const shape = line.search(RAW_SHAPE);
    // Review 6 M-D: a raw error shape is never prose, so it is cut on every turn; only the spoken line needs a failed mail read.
    if (shape >= 0 && !ctx.mailFailed) {
      const prefix = asSentence(tidy(line.slice(0, shape).replace(/\b(?:Get|Post)\s+"[^"]*$/i, "")));
      changed = true;
      if (/\w/.test(prefix) && /[.!?]$/.test(prefix)) out.push(prefix);
      continue;
    }
    if (ctx.mailFailed) {
      const perm = line.search(RAW_PERMISSION);
      const hit = oauth >= 0 ? { at: oauth, say: mailLine(line) } : perm >= 0 && !/Full Disk Access/i.test(line) ? { at: perm, say: FULL_DISK } : null;
      if (hit) {
        const prefix = line.slice(0, hit.at).replace(/\b(?:Get|Post)\s+"[^"]*$/i, "").trim();
        // Review 6 M-C: a leftover piece is kept only when it is a whole sentence, never with a URL in it.
        const piece = asSentence(tidy(prefix).replace(/https?:\/\/\S+/g, "").trim());
        if (/\w/.test(piece) && /[.!?]$/.test(piece) && !/\b(?:I tried|tried|got|error|failed)\W*$/i.test(piece)) out.push(piece);
        out.push(hit.say);
        changed = true;
        continue;
      }
    }
    for (const re of SPANS) line = line.replace(re, () => { changed = true; if (re === SPANS[0]) execCut = true; return ""; });
    // A lead-in whose command was cut ("Undo with.") says nothing: it goes with it.
    if (ctx.codeAuthored && line !== raw) line = line.replace(/(?:^|(?<=[.!?])\s+)[^.!?\n]*\b(?:with|run|use|try|using|via)\s*[.:]?\s*$/i, "");
    const kept = dropLeaks(line, ctx.strict === true);
    if (kept !== line) { changed = true; execCut = true; line = kept; }
    if (line !== raw) { line = tidy(line); if (!/\w/.test(line)) continue; }
    out.push(line);
  }
  if (!changed) return reply;
  const unique = out.filter((l, i) => !l.trim() || out.indexOf(l) === i);
  const text = unique.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Code-authored text reports a change the code itself made: only the leaked hint is cut, a success never becomes a failure.
  if (ctx.codeAuthored) return text || REPLY_FAILED;
  // "Done." with the failure that followed it cut away would be a false claim (review 6 M-B).
  if (execCut && CHANGE_CLAIM.test(text) && !NEGATED.test(text) && text.split(/\s+/).length <= 12) return REPLY_FAILED;
  return text || REPLY_FAILED;
}

/*
 Wave 8 B (gate run-1101080052, per-legit-vs-excuse-c): "Gym is bumped to 10:30 AM tonight because of your 9:30 AM deadline." went out
 with no calendar write: the worker restated his own sentence as done. An affirmative "<thing> is/got moved|bumped|pushed|shifted to <time>"
 is a claim that a move happened; with no successful write (and nothing awaiting approval) this turn it is never sent as it stands.
*/
const MOVED = String.raw`(?:bumped|moved|pushed|shifted|rescheduled|switched)`;
const MOVE_TIME = String.raw`(?:\d|noon\b|midnight\b)`;
/** "gym is moved to 5", "gym moved to noon", "I moved gym to 5", "I've pushed the nap to 3". */
const MOVE_CLAIM = new RegExp(String.raw`\b(?:[\w']+\s+${MOVED}|I(?:'ve| have)?\s+${MOVED}\s+(?:your\s+|the\s+|my\s+)?[\w ]{1,30}?)(?:\s+(?:back|up|later|over))?\s+(?:to|till|until|for)\s+${MOVE_TIME}`, "gi");
// Read inside the claim's own clause (from the last clause break to the end of the claim): a "no problem" after it, or a "no" in another
// sentence, hedges nothing. An "if / unless / whether" later in the same sentence, and a closing "?", do.
const MOVE_HEDGE = /\b(?:if|should|would|could|can|want|unless|once|whether|when|will|won'?t|can'?t|couldn'?t|didn'?t|haven'?t|hasn'?t|isn'?t|wasn'?t|not|never|no|nothing)\b|n't/i;
const CLAUSE_BREAK = /[.!?;:,\u2014\u2013]|\s-\s|\bbut\b/gi;
export const NOTHING_MOVED = "I haven't changed your calendar. Nothing was moved yet. Tell me the block and the time and I'll do it.";
const STOP_SUBJECT = new Set(["is", "are", "was", "has", "have", "been", "got", "gets", "now", "i", "ive", "the", "your", "my", "and", "its", "it", "yes", "yep", "yeah", "okay", "done", "all", "set", "sure", "just", "also", "then", "there", "that", "this"]);

/** The claim's subject words ("gym", "side project"): what a calendar write has to mention to back it. */
function subjectWords(clause: string): string[] {
  const parts = clause.split(new RegExp(String.raw`\b${MOVED}\b`, "i"));
  const clean = (t: string): string[] => t.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP_SUBJECT.has(w));
  const before = clean(parts[0] ?? "").slice(-3);
  const after = clean((parts[1] ?? "").split(/\b(?:to|till|until|for)\b/i)[0] ?? "").slice(0, 3);
  return [...before, ...after];
}
/** A calendar or schedule write that went through this turn (a task add, a note or a message is not one), mentioning the claim's block when it names one. */
function calendarWrote(tools: ReadonlyArray<ToolResult>, subject: string[]): boolean {
  const wrote = tools.filter((t) => /\borion-reschedule\b/.test(t.canonical) && (outcomeOf(t) === "success" || outcomeOf(t) === "partial"));
  if (!subject.length) return wrote.length > 0;
  return wrote.some((t) => { const text = `${t.canonical} ${t.stdout}`.toLowerCase(); return subject.some((w) => text.includes(w)); });
}
function unhedgedClaim(reply: string): string | undefined {   // the clause up to the end of the claim
  for (const m of reply.matchAll(MOVE_CLAIM)) {
    const before = reply.slice(0, m.index);
    let start = 0;
    for (const b of before.matchAll(CLAUSE_BREAK)) start = b.index! + b[0].length;
    const prefix = `${reply.slice(start, m.index)}${m[0]}`;
    const rest = reply.slice(m.index! + m[0].length);
    const end = /[.!?]/.exec(rest);
    const sentenceTail = end ? rest.slice(0, end.index) : rest;
    if (MOVE_HEDGE.test(prefix) || end?.[0] === "?" || /\b(?:if|unless|whether)\b/i.test(sentenceTail)) continue;
    return prefix;
  }
  return undefined;
}
function restatesMoveWithoutWrite(reply: string, tools: ReadonlyArray<ToolResult>, askedChange: boolean): boolean {
  if (!askedChange) return false;   // a read-only turn ("did you move gym?") is answered truthfully by the worker; only a requested change needs a write
  const claim = unhedgedClaim(reply);
  if (!claim) return false;
  if (tools.some((t) => outcomeOf(t) === "pending")) return false;
  return !calendarWrote(tools, subjectWords(claim));
}

export type FinalizeContext = {
  mailFailed?: boolean;
  /** Tool calls the host itself ran this turn (the host's raw "Exec failed" payload exists only for these). */
  hostTools?: number;
  changeRequest?: boolean;
  /** His message asked for a change to his day (not a question about one): the only turn where an unbacked "X is moved to T" is replaced. */
  askedChange?: boolean;
  /** The text was written by code from tool results: cleaned of raw spans, never given an acknowledgement. */
  codeAuthored?: boolean;
};

/*
 The last line of defence (gate run-1031202318 cluster 4). Raw tool text is cut (sanitizeReply, strict on a turn with a failed tool);
 when a tool the host ran failed, the reply must own it in words the host accepts as an acknowledgement, which also stops the host
 appending its own "Exec failed" payload, and a bare "Done" with no successful write behind it is replaced rather than left standing.
 Never silently drops a failure: the plain sentence says what did not happen.
*/
export function finalizeReply(reply: string, tools: ReadonlyArray<ToolResult>, ctx: FinalizeContext = {}): string {
  const failed = ctx.codeAuthored ? [] : failedTools(tools);
  if (!ctx.codeAuthored && restatesMoveWithoutWrite(reply, tools, ctx.askedChange === true)) return NOTHING_MOVED;
  const clean = sanitizeReply(reply, { ...(ctx.mailFailed ? { mailFailed: true } : {}), ...(failed.length ? { strict: true } : {}), ...(ctx.codeAuthored ? { codeAuthored: true } : {}) });
  if (ctx.codeAuthored || !failed.length || !(ctx.hostTools && ctx.hostTools > 0)) return clean;
  const changeRequest = ctx.changeRequest === true;
  const nothingLeft = !clean.trim() || clean === REPLY_FAILED;
  const claimsChange = CHANGE_CLAIM.test(clean) && !NEGATED.test(clean) && !/\?\s*$/.test(clean);
  if (nothingLeft || (claimsChange && !wroteSomething(tools))) return acknowledgement(failed, changeRequest);
  if (acknowledgesFailure(clean)) return clean;
  // Something else did change: the acknowledgement must not say nothing did.
  if (wroteSomething(tools)) return `${clean} ${ONE_PART_FAILED} I couldn't run one of those changes.`;
  return `${acknowledgement(failed, changeRequest, false)} ${clean}`;
}
