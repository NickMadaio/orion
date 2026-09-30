// When phone use gets a nudge, and when it gets a lock (tighten-orion/distraction).
// Written by Claude after Qwen's run stopped, 2026-09-30.
const WORK = new Set(["class", "study", "deadline", "side_project"]);
const PROTECTED = new Set(["rest", "meal", "social"]);

export function decide(input) {
  if (!input || typeof input !== "object" || !input.now || !input.usage) throw new TypeError("decide needs now and usage");
  const { now, usage, windowMinutes, current = null, bedtime = null, recentNudges = 0, lockAllowed = false } = input;
  if (!Number.isInteger(windowMinutes) || windowMinutes < 30 || windowMinutes > 120) throw new TypeError("windowMinutes must be 30..120");
  const distracting = (usage.social ?? 0) + (usage.video ?? 0) + (usage.games ?? 0);
  const none = (reason) => ({ action: "none", reason, minutes: 0 });
  const nudge = (reason) => ({ action: "nudge", reason: recentNudges >= 4 && !lockAllowed ? `${reason} (lock not allowed)` : reason, minutes: 0 });

  if (current && PROTECTED.has(current.kind)) return none("break");

  if (bedtime !== null && distracting >= 10) {
    const late = (m) => (m < 300 ? m + 1440 : m);
    if (late(now.minute) >= late(bedtime)) {
      return recentNudges >= 2 && lockAllowed ? { action: "lock", reason: "past bedtime", minutes: 30 } : nudge("past bedtime");
    }
  }
  if (current && WORK.has(current.kind) && distracting >= 15) {
    const reason = `during ${current.title}`;
    if (recentNudges >= 2 && lockAllowed) {
      const untilEnd = typeof current.end === "number" ? current.end - now.minute : 45;
      return { action: "lock", reason, minutes: Math.min(45, Math.max(15, untilEnd)) };
    }
    return nudge(reason);
  }
  if (!current && distracting >= 0.75 * windowMinutes) return { action: "nudge", reason: "long scroll", minutes: 0 };
  return none("ok");
}
