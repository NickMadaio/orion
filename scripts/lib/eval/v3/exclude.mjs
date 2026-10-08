// Tell evaluation traffic from Nick's real use (ORION V3 handoff §5.1).
// A session whose key names it real (the Mac app, a chat, main) is never dropped
// whole: only its probe or eval turns go, because one coding-session probe once
// threw away 47 of his real turns. Whole-session rules apply only to reset
// sessions whose key is gone, where the signals are the eval clock line, a
// probe opener, replayed scenario lines, the phone route's audit log (it names
// every eval session it carried) and a harness replaying the same sentences.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation; reworked after review.)

const AUDIT_WINDOW_MS = 60 * 1000;
const CHAT_WINDOW_MS = 3 * 60 * 1000;
const EVAL_KEY = /orion-eval|probe|claude-(api-)?check|claude-safari|weather-check|orion-doctor/;
const EVAL_SESSION = /eval|probe|check|bench|test/i;
const FAKE_SENDER = /probe|example\.com|attacker/i;
const SCRIPTED_MIN_WORDS = 4;
const SCRIPTED_MIN_FILES = 3;

// One-line checks coding sessions sent while testing the route.
const PROBE_STARTS = [
  "reply with (exactly|the single word)", "verify the new .* capability", "say only:", "standing guidance \\(from agents\\.md\\)",
  "you are orion running", "for a wiring check only", "read-only (probe|self-audit)", "(security )?diagnostic\\b",
  "run (this|the) exact shell command", "run exactly:", "use your orion_task_run tool", "call orion_permission_status",
  "change your own setting",
];
const PROBE_TEXT = new RegExp(`^(${PROBE_STARTS.join("|")})|fixture codename|\\bTCC probe\\b|awesome-probe`, "i");

const norm = (t) => (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const isLong = (t) => norm(t).split(" ").length >= SCRIPTED_MIN_WORDS;

export const isProbe = (text) => PROBE_TEXT.test((text ?? "").trim());

/** text → times, for audit entries an evaluation or probe sent. */
export function evalAuditIndex(entries) {
  return entries
    .filter((e) => EVAL_SESSION.test(e?.session ?? "") || FAKE_SENDER.test(e?.from ?? ""))
    .reduce((index, e) => index.set(norm(e.text), [...(index.get(norm(e.text)) ?? []), Date.parse(e.at)]), new Map());
}

export function matchesEvalAudit(index, text, at) {
  const t = Date.parse(at);
  return (index.get(norm(text)) ?? []).some((when) => Math.abs(when - t) <= AUDIT_WINDOW_MS);
}

/** Files (Map file → user texts) where most long sentences recur verbatim in ≥3 files. */
export function scriptedFiles(fileTexts) {
  const filesPerText = new Map();
  for (const [file, texts] of fileTexts) for (const t of new Set(texts.filter(isLong).map(norm))) filesPerText.set(t, [...(filesPerText.get(t) ?? []), file]);
  const repeated = new Set([...filesPerText].filter(([, files]) => files.length >= SCRIPTED_MIN_FILES).map(([t]) => t));
  return new Set([...fileTexts].filter(([, texts]) => {
    const long = texts.filter(isLong).map(norm);
    return long.length > 0 && long.filter((t) => repeated.has(t)).length * 2 > long.length;
  }).map(([file]) => file));
}

const isEvalTurn = (t, audit) => t.evalClock || isProbe(t.userText) || matchesEvalAudit(audit, t.userText, t.at);

// Why a keyless session is evaluation traffic, or null.
const keylessReason = (turns, { says, audit }) => {
  if (turns.some((t) => t.evalClock)) return "eval-clock";
  if (turns.length && isProbe(turns[0].userText)) return "probe";
  const replayed = turns.filter((t) => says.has(t.userText.trim()) || isEvalTurn(t, audit)).length;
  return turns.length && replayed * 2 >= turns.length ? "replay" : null;
};

/**
 * sessions: [{ file, key, turns: [{ line, at, userText, evalClock }] }].
 * Returns each with `excluded` (reason or null) and `turns` minus eval turns.
 */
export function judgeSessions(sessions, { says, audit }) {
  const first = sessions.map((s) => {
    if (s.key && EVAL_KEY.test(s.key)) return { ...s, excluded: "eval-key" };
    if (s.key) return { ...s, excluded: null, turns: s.turns.filter((t) => !isEvalTurn(t, audit)) };
    return { ...s, excluded: keylessReason(s.turns, { says, audit }) };
  });
  const scripted = scriptedFiles(new Map(first.filter((s) => !s.key && !s.excluded).map((s) => [s.file, s.turns.map((t) => t.userText)])));
  return first.map((s) => (!s.key && !s.excluded && scripted.has(s.file) ? { ...s, excluded: "scripted" } : s));
}

/** Chat-thread turns that are copies of excluded turns, probes or audit-named eval sends are dropped. */
export function dropEvalChatTurns(chats, excludedTurns, audit) {
  const copies = excludedTurns.reduce((m, t) => m.set(norm(t.userText), [...(m.get(norm(t.userText)) ?? []), Date.parse(t.at)]), new Map());
  const isCopy = (c) => (copies.get(norm(c.userText)) ?? []).some((when) => Math.abs(when - Date.parse(c.at)) <= CHAT_WINDOW_MS);
  return chats.filter((c) => !isProbe(c.userText) && !matchesEvalAudit(audit, c.userText, c.at) && !isCopy(c));
}
