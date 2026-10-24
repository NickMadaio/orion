// The plan-vs-reality loop (spec 3.4.1-3.4.2): what should be happening vs what is, one tick at a time. Pure:
// awareness, today's blocks and the ledgers in, actions out. Nothing here sends; orion-proactive acts on the result
// through the machinery that exists (the leave ladder, the check-in loop, orion-reach).
//
// Unknown stays unknown: an unknown facet is never evidence of a mismatch. At most ONE new mismatch per tick (the
// highest-weight block first); a class-ladder rung always goes first. A mismatch is never backed off (only blank asks are).
import { classLadder } from "../reach/class-ladder.mjs";
import { blankAsk } from "./decide.mjs";
import { words } from "./words.mjs";

const MIN = 60_000;
const NOT_STARTED_AFTER = 5, NOT_STARTED_WINDOW = 30, OFF_PLAN_DWELL = 15;
const SCORE = { fixed: 0, must: 1, high: 2, medium: 3, low: 4 };
// Until WP6's weightOf is on the block (`rank`), the kind default (SCHEDULING.md): gym, study, deadline high; the rest medium.
const KIND_RANK = { sleep: "high", gym: "high", deadline: "high", study: "high", class: "high", rest: "low", commute: "low", wind: "low" };
const OPEN_PHASES = ["waiting", "reminded", "intervening", "deferred"];
const rankOf = (b) => b.rank ?? KIND_RANK[b.kind] ?? "medium";
/** A must block (the gym, an anchor) is never starved by the low-value budget: its nudges are protected (reach --tier). */
const protectedBlock = (b) => b.rank === "must" || b.kind === "gym" || b.anchor === true;
const windowOf = (b, date) => ({ date, start: b.start, end: b.end });
const words4 = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 4);
const sharesWord = (a, b) => { const set = new Set(words4(b)); return words4(a).some((w) => set.has(w)); };

/** Why the loop must wait right now (focus, sleep, class), or null. Nothing is held: the next tick re-decides. */
export function deferral(aw, now) {
  if (aw.sleep?.state === "asleep") return "sleep";
  const s = aw.session ?? {};
  if (s.state === "focus") return "focus";
  if (s.state === "paused" && !(Date.parse(s.since) && now.getTime() - Date.parse(s.since) >= 3 * MIN)) return "pause";
  if (aw.calendar?.now?.kind === "class" || aw.calendar?.travelNow) return "class";
  if (aw.routine?.holdsAsks) return "routine";   // out on his usual night: no "should be home" / not-started nudges
  return null;
}

/** Movable block ORION planned for him (not a fixed event, not logged reality, not a break). */
const planned = (b) => !b.fixed && b.source === "orion" && !b.logged && !["rest", "sleep", "commute"].includes(b.kind) && rankOf(b) !== "low";
const blockPlace = (b) => b.where ?? b.place ?? (b.kind === "gym" ? "gym" : null);
const loopFor = (checkins, b) => (checkins ?? []).find((c) => c.block === b.id && OPEN_PHASES.concat("active").includes(c.loop?.phase));

/** Positive evidence that he is doing the block: session on its task, a work app, being at its place, a log, a `started` check-in. */
export function evidenceOfStart(aw, b, { day, checkin, minute }) {
  if (checkin?.loop?.phase === "active") return "check-in";
  if ((day ?? []).some((x) => x.logged && x.start <= minute && x.end > minute)) return "logged";
  const s = aw.session ?? {};
  if (s.state === "focus" && (!s.task || sharesWord(s.task, b.title))) return "session";
  const place = blockPlace(b);
  if (place && aw.location?.placeId === place) return "place";
  if (!place && ["study", "side", "other", "deadline"].includes(b.kind) && aw.mac?.state === "active" && aw.mac.workApp) return "work-app";
  return null;
}

const dwell = (loc, now) => (Date.parse(loc?.since) ? Math.floor((now.getTime() - Date.parse(loc.since)) / MIN) : null);

function offPlan(aw, b, now) {
  const loc = aw.location ?? {};
  const place = blockPlace(b);
  if (place) return false;                                            // a block with its own place is judged by not-started
  const awayFromHome = loc.state === "elsewhere" || (loc.state === "known" && !/^(home|campus)/.test(String(loc.placeId)));
  return awayFromHome && (dwell(loc, now) ?? -1) >= OFF_PLAN_DWELL;
}

/**
 * @param aw   awareness (C1)
 * @param ctx  { day, checkins, ledger, sent, todos, travel, signals, out, turns, now: Date }
 * @returns [{ key, type: "should-leave"|"not-started"|"off-plan"|"blank"|"close", action: "say"|"checkin"|"ask"|"close", ... }]
 */
export function planVsReality(aw, ctx) {
  const { day = [], checkins = [], ledger, sent = {}, todos = [], travel = [], signals = {}, out, turns = [], now, wakeGrace = false } = ctx;
  const minute = now.getHours() * 60 + now.getMinutes();
  const date = now.toLocaleDateString("en-CA");
  if (aw.calendar?.state !== "ok") return [];                         // an unreadable calendar is not a blank, nor a plan
  const actions = [];

  // should-leave: the ladder, with awareness location as the evidence (class-ladder.mjs). Urgent rungs are never deferred.
  const rungs = [];
  classLadder({ minute, day, travel, signals, out, atHome: aw.derived?.atHome ?? null }, (key, text, kind, extra = {}) => {
    if (!sent[key]) rungs.push({ key, type: "should-leave", action: "say", text, kind, ...extra });
  });
  actions.push(...rungs);

  // A plan loop whose block now has evidence closes quietly: no more messages.
  for (const c of checkins.filter((x) => x.block && OPEN_PHASES.includes(x.loop?.phase))) {
    const b = day.find((x) => x.id === c.block);
    if (b && evidenceOfStart(aw, b, { day, checkin: null, minute })) actions.push({ key: `close-${c.id}`, type: "close", action: "close", checkinId: c.id, blockId: b.id });
  }

  // Just after he wakes: no scolding (a block not started, an off-plan question). Class and leave rungs above are untouched.
  const wait = deferral(aw, now) ?? (wakeGrace ? "wake-grace" : null);
  if (wait) return actions;

  const mismatches = [];
  for (const b of day.filter((x) => planned(x) && x.start <= minute && x.end > minute)) {
    const checkin = loopFor(checkins, b);
    if (checkin) continue;                                            // one live loop per block: it owns the follow-ups
    if (offPlan(aw, b, now)) {
      const key = `mismatch-off-plan-${b.id}-1`;
      if (!sent[key]) mismatches.push({ key, type: "off-plan", action: "ask", blockId: b.id, rank: rankOf(b), kind: "question", text: words.offPlan({ title: b.title }),
        ask: { type: "mismatch", blockId: b.id, title: b.title, window: { date, start: b.start, end: b.end } } });
      continue;
    }
    const lateBy = minute - b.start;
    if (lateBy < NOT_STARTED_AFTER || lateBy > NOT_STARTED_WINDOW || !["must", "high", "medium"].includes(rankOf(b))) continue;
    if (["elsewhere", "known"].includes(aw.location?.state) && !blockPlace(b)) continue;   // away from a home block: off-plan's call
    if (evidenceOfStart(aw, b, { day, checkin, minute })) continue;
    const key = `mismatch-not-started-${b.id}-1`;
    if (!sent[key]) mismatches.push({ key, type: "not-started", action: "checkin", blockId: b.id, title: b.title, rank: rankOf(b), tier: protectedBlock(b) ? "protected" : "low", window: windowOf(b, date), kind: "checkin", text: words.notStarted({ title: b.title, start: b.start }) });
  }
  const first = mismatches.sort((a, b) => SCORE[a.rank] - SCORE[b.rank])[0];
  if (first) return [...actions, first];

  // Nothing is off: a blank (nothing on the calendar, nothing known) is asked about, within the backoff.
  const blank = blankAsk(aw, { minute, date, day, todos, travel, ledger, turns, now: now.getTime() });
  return blank && !sent[blank.key] ? [...actions, { ...blank, type: "blank", blankType: blank.type, action: "ask", kind: "question" }] : actions;
}
