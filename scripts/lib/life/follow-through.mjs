// plan → remind → observe → intervene → follow up, for one planned block
// (life-escalation). Pure: every step returns a new loop.
const GAPS = [10, 10, 5, 5];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const record = (loop, now, event, patch) => {
  const next = { ...loop, ...patch };
  return { ...next, history: [...loop.history, { at: now, event, phase: next.phase }] };
};

export function startLoop(block, now) {
  void now;
  return { blockId: block.id, phase: "waiting", level: 0, nextCheckAt: block.start, deferrals: 0, history: [] };
}

function escalate(loop, now, event) {
  const level = Math.min(4, loop.level + 1);
  return record(loop, now, event, { phase: loop.phase === "waiting" ? "reminded" : "intervening", level,
    nextCheckAt: now + GAPS[level - 1] });
}

export function step(loop, event, now) {
  if (loop.phase === "done" || loop.phase === "cancelled") return loop;
  const due = loop.nextCheckAt !== null && now >= loop.nextCheckAt;
  switch (event.type) {
    case "tick":
      if (!due) return loop;
      if (loop.phase === "waiting") return record(loop, now, "tick", { phase: "reminded", level: 1, nextCheckAt: now + 10 });
      if (loop.phase === "deferred") return record(loop, now, "tick", { phase: "reminded", level: Math.max(1, loop.level), nextCheckAt: now + 10 });
      if (loop.phase === "reminded" || loop.phase === "intervening") return escalate(loop, now, "tick");
      return loop; // active: a check-in is the caller's business
    case "ignored":
      return loop.phase === "active" ? loop : escalate({ ...loop, phase: loop.phase === "waiting" ? "reminded" : loop.phase }, now, "ignored");
    case "started":
      return record(loop, now, "started", { phase: "active", level: 0, nextCheckAt: now + 25 });
    case "done":
      return record(loop, now, "done", { phase: "done", nextCheckAt: null });
    case "cancelled":
      return record(loop, now, "cancelled", { phase: "cancelled", nextCheckAt: null });
    case "defer": {
      const legitimate = event.legitimate === true && loop.deferrals < 2;
      if (!legitimate) return escalate({ ...loop, deferrals: loop.deferrals + 1, phase: loop.phase === "waiting" ? "reminded" : loop.phase }, now, "defer");
      return record(loop, now, "defer", { phase: "deferred", deferrals: loop.deferrals + 1,
        nextCheckAt: now + clamp(event.minutes ?? 15, 5, 45) });
    }
    default:
      return loop;
  }
}
