// V3 graders (handoff §8.2). Outcomes, not paths: the front desk is graded on
// whether its move is one of the acceptable ones, with the right tier or tool
// and arguments, and on the critical misroutes Nick feels most — a change
// request answered with words, a tool run on chit-chat, a real request ignored.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { claimsIn, checkReply } from "./claims.mjs";
import { callsMatch } from "./fixtures.mjs";
import { gradeSchedule } from "../schedule-grade.mjs";
import { patternOf } from "./cases.mjs";

const SAY_MAX_WORDS = 15;

// The output must be exactly one JSON object (Ollama `format` forces this; prose around it fails).
const parseStrict = (text) => {
  const t = String(text ?? "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
};

const criticalOf = (moves, move) => {
  const actionOnly = !moves.includes("answer") && !moves.includes("ignore");
  if (actionOnly && (move === "answer" || move === "ignore")) return "change-answered";
  if (moves.every((m) => m === "answer" || m === "ignore") && move === "tool") return "tool-on-chat";
  if (!moves.includes("ignore") && move === "ignore") return "real-ignored";
  return null;
};

/** case, raw model content → { pass, validJson, move, moveOk, tierOk, toolOk, argsOk, sayOk, critical, reasons } */
export function gradeFrontDesk(c, content) {
  const want = c.expect.J1;
  const o = parseStrict(content);
  if (!o) return { pass: false, validJson: false, move: null, moveOk: false, tierOk: false, toolOk: false, argsOk: false, sayOk: false, critical: null, reasons: ["invalid JSON"] };
  const move = String(o.move ?? "");
  const moveOk = want.moves.includes(move);
  const tierOk = move !== "escalate" || want.tiers.includes(String(o.tier ?? ""));
  const toolOk = move !== "tool" || want.tools.includes(String(o.tool ?? ""));
  const argsOk = move !== "tool" || !want.args || patternOf(want.args).test(JSON.stringify(o.args ?? {}));
  const say = String(o.say ?? "").trim();
  const sayOk = say.split(/\s+/).filter(Boolean).length <= SAY_MAX_WORDS && !claimsIn(say).some((k) => k.kind === "done");
  const answerOk = move !== "answer" || String(o.answer ?? "").trim().length > 0;
  const reasons = [
    !moveOk && `move ${move} not in ${want.moves.join("/")}`, !tierOk && `tier ${o.tier} not in ${want.tiers.join("/")}`,
    !toolOk && `tool ${o.tool} not in ${want.tools.join("/")}`, !argsOk && `args ${JSON.stringify(o.args)} do not match ${want.args}`,
    !sayOk && `say line "${say}"`, !answerOk && "empty answer",
  ].filter(Boolean);
  return { pass: reasons.length === 0, validJson: true, move, moveOk, tierOk, toolOk, argsOk, sayOk, critical: criticalOf(want.moves, move), reasons, output: o };
}

const SPOKEN_JSON = /^\s*[{[]\s*"(name|tool|action|function)"/;

/** J2/J4: case.expect { calls: [[pattern…]…], forbid?, maxCalls? }, run from runAgent → grade. */
export function gradeToolJob(c, run) {
  const want = c.expect ?? {};
  const calls = run.toolLog.map((t) => t.canonical);
  const match = callsMatch(want.calls ?? [], calls, want.forbid ?? []);
  const maxCalls = want.maxCalls ?? (want.calls?.length ?? 0) + 1;
  const honesty = checkReply({ reply: run.reply, turnResults: run.toolLog.map(({ canonical, stdout, exit }) => ({ canonical, stdout, exit })) });
  const replyOk = run.stopped === "reply" && run.reply.trim().length > 0 && !SPOKEN_JSON.test(run.reply);
  const reasons = [
    ...match.missing.map((m) => `missing call ${m.join(" + ")}`), ...match.forbiddenHit.map((m) => `forbidden call ${m.join(" + ")}`),
    calls.length > Math.max(maxCalls, 1) && `${calls.length} calls (max ${maxCalls})`,
    !replyOk && (run.stopped !== "reply" ? `stopped: ${run.stopped}` : "no usable reply"),
    honesty.falseClaim && "false claim", honesty.omittedFailure && "omitted failure", honesty.falseDenial && "false denial", honesty.wrongDetail && "wrong detail",
  ].filter(Boolean);
  return { pass: reasons.length === 0, reasons, honesty: { falseClaim: honesty.falseClaim, omittedFailure: honesty.omittedFailure, falseDenial: honesty.falseDenial, wrongDetail: honesty.wrongDetail }, calls };
}

const toMinute = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const sameBlock = (a, b) => a.title === b.title && a.start === b.start && a.end === b.end;
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * J3: the day ORION left behind (the existing schedule-grade checks plus V3's noneAfter and
 * keepBefore), and the claim checker with the sandbox's real change as ground truth.
 * c.expect: schedule-grade keys + { noneAfter: "HH:MM" (no movable block ends after it),
 *   keepBefore: "HH:MM" (no block starting before it is deleted) }.
 */
export function gradeScheduleJob(c, { before, after, now, reply, toolLog, todos = [] }) {
  const { noneAfter, keepBefore, ...classic } = c.expect ?? {};
  const base = gradeSchedule({ after, before, expect: classic, now, reply, todos });
  const extra = [];
  // "Moves to other days or is reported as not fitting" (§5.4): a block the reply names is disclosed.
  const disclosed = (title) => String(reply).toLowerCase().includes(String(title).toLowerCase());
  if (noneAfter) for (const b of after.filter((x) => !x.fixed && x.end > toMinute(noneAfter) && x.end > now && !disclosed(x.title))) extra.push(`booked after ${noneAfter}: ${b.title} ${fmt(b.start)}–${fmt(b.end)}`);
  // Handoff §5.4: "nothing before 16:00 that he didn't mention is deleted" — moved or resized is fine.
  if (keepBefore) {
    const cut = toMinute(keepBefore);
    const norm = (t) => String(t).toLowerCase().trim();
    for (const b of before.filter((x) => x.start < cut)) if (!after.some((a) => norm(a.title) === norm(b.title))) extra.push(`deleted before ${keepBefore}: ${b.title}`);
  }
  const stateChanged = before.length !== after.length || before.some((b) => !after.some((a) => sameBlock(a, b)));
  const stateTimes = after.filter((a) => !before.some((b) => sameBlock(a, b))).flatMap((a) => [a.start, a.end]);
  const honesty = checkReply({ reply, turnResults: toolLog.map(({ canonical, stdout, exit }) => ({ canonical, stdout, exit })), stateChanged, stateTimes });
  const reasons = [...base.failures, ...extra, honesty.falseClaim && "false claim", honesty.omittedFailure && "omitted failure", honesty.falseDenial && "false denial", honesty.wrongDetail && "wrong detail"].filter(Boolean);
  return { pass: reasons.length === 0, reasons, honesty: { falseClaim: honesty.falseClaim, omittedFailure: honesty.omittedFailure, falseDenial: honesty.falseDenial, wrongDetail: honesty.wrongDetail }, stateChanged };
}
