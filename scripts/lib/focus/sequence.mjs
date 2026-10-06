// Focus sequences (6 Oct 2026): any order of work and breaks, started from any
// point, and the unfinished part of a session that ended by accident. Pure: no
// clock, no files. orion-session turns the result into a start-sequence request.

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, "twenty-five": 25, "twenty five": 25, thirty: 30, "forty-five": 45, "forty five": 45,
  forty: 40, fifty: 50, sixty: 60, ninety: 90 };
const FOCUS = /\b(work|focus|block|study|session|sprint|pomodoro|w)\b/;
const REST = /\b(break|rest|pause|b|r)\b/;
const LIMITS = { focus: 180, rest: 60 };

function minutesIn(piece) {
  if (/\bhour and a half\b/.test(piece)) return 90;
  if (/\bhalf an hour\b/.test(piece)) return 30;
  if (/\ban hour\b/.test(piece)) return 60;
  const digits = piece.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)?\b/);
  if (digits) return Number(digits[1]) * (digits[2] ? 60 : 1);
  const word = Object.keys(WORDS).sort((a, b) => b.length - a.length)
    .find(w => new RegExp(`\\b${w}\\b`).test(piece));
  if (!word) return null;
  const hours = new RegExp(`\\b${word}[- ]?(h|hr|hour|hours)\\b`).test(piece);
  return WORDS[word] * (hours ? 60 : 1);
}

function compact(text) {
  const tokens = text.trim().split(/\s+/);
  if (tokens.every(t => /^\d+(\.\d+)?[wbr]$/.test(t))) {
    return tokens.map(t => ({ kind: t.endsWith("w") ? "focus" : "rest", minutes: Number(t.slice(0, -1)) }));
  }
  if (/^\d+(\/\d+)+$/.test(text.trim())) {
    return text.trim().split("/").map((n, i) => ({ kind: i % 2 === 0 ? "focus" : "rest", minutes: Number(n) }));
  }
  return null;
}

function validate(phases) {
  if (phases.length === 0) throw new TypeError("A focus sequence needs at least one phase.");
  if (phases.length > 12) throw new TypeError("A focus sequence can have at most 12 phases.");
  for (const p of phases) {
    if (!(p.minutes >= 1 && p.minutes <= LIMITS[p.kind])) {
      throw new TypeError(`A ${p.kind === "focus" ? "work block" : "break"} must be 1–${LIMITS[p.kind]} minutes (got ${p.minutes}).`);
    }
  }
  const total = phases.reduce((sum, p) => sum + p.minutes, 0);
  if (total > 600) throw new TypeError(`The whole sequence must be 10 hours or less (got ${total} minutes).`);
  return phases;
}

export function parseSequence(text) {
  if (typeof text !== "string" || !text.trim()) throw new TypeError("Say the sequence, e.g. \"20 work, 5 break, 40 work\".");
  const lowered = text.toLowerCase();
  const short = compact(lowered);
  if (short) return validate(short);
  const pieces = lowered.split(/\s*(?:,|;|→|->|\+|\band then\b|\bthen\b|\bfollowed by\b|\bafter that\b)\s*/).filter(p => p.trim());
  const phases = [];
  for (const piece of pieces) {
    const minutes = minutesIn(piece);
    if (minutes === null) throw new TypeError(`No length in "${piece.trim()}".`);
    const kind = REST.test(piece) ? "rest" : FOCUS.test(piece) ? "focus"
      : phases.length === 0 ? "focus" : phases.at(-1).kind === "focus" ? "rest" : "focus";
    phases.push({ kind, minutes });
  }
  return validate(phases);
}

export function remainingFrom(phases, { phaseIndex, elapsedMinutes }) {
  if (!Array.isArray(phases) || phases.length === 0) throw new TypeError("phases must be a non-empty list");
  if (!Number.isInteger(phaseIndex) || phaseIndex < 0 || phaseIndex >= phases.length) throw new TypeError("phaseIndex is out of range");
  if (!(elapsedMinutes >= 0)) throw new TypeError("elapsedMinutes must be 0 or more");
  const [first, ...rest] = phases.slice(phaseIndex);
  const left = Math.round((first.minutes - elapsedMinutes) * 2) / 2;
  return left <= 0.5 ? rest : [{ ...first, minutes: left }, ...rest];
}

export function recoverFromHistory(record, { blockMinutes, restMinutes } = {}) {
  if (!record || typeof record !== "object") throw new TypeError("record must be a history object");
  if (record.reason === "completed") return null;
  const blocks = Math.max(1, Number(record.totalFocusBlocks) || 1);
  const blockSeconds = blockMinutes ? blockMinutes * 60 : (Number(record.plannedFocusSeconds) || 0) / blocks;
  const restDefault = blocks > 1 ? (Number(record.plannedRestSeconds) || 0) / (blocks - 1) / 60 : 0;
  const rest = restMinutes ?? (restDefault || (blocks > 1 ? 10 : 0));
  const completed = Math.max(0, Number(record.completedFocusBlocks) || 0);
  const served = (Number(record.servedFocusSeconds) || 0) - completed * blockSeconds;
  const sequence = [];
  const remainder = Math.round((blockSeconds - served) / 60);
  if (remainder >= 1 && completed < blocks) sequence.push({ kind: "focus", minutes: remainder });
  for (let b = completed + 1; b < blocks; b += 1) {
    if (sequence.length > 0) sequence.push({ kind: "rest", minutes: Math.max(1, Math.round(rest)) });
    sequence.push({ kind: "focus", minutes: Math.max(1, Math.round(blockSeconds / 60)) });
  }
  return sequence.length ? sequence : null;
}

const length = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
export function describeSequence(phases) {
  return phases.map(p => `${length(p.minutes)} ${p.kind === "focus" ? "focus" : "break"}`).join(" → ");
}

export function toRequestPhases(phases) {
  return phases.map(p => ({ kind: p.kind, seconds: Math.round(p.minutes * 60) }));
}
