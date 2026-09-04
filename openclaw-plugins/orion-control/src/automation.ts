import os from "node:os";
import path from "node:path";

/*
 PHASES 57 AND 58 — automation as a structured proposal, and the simulation
 that has to survive before it becomes permanent.

 ## What was already true, and what was not

 Three OpenClaw cron jobs run on this machine right now: the focus guard every
 minute, standing orders hourly, the memory rollup at 02:10. So automation is
 not missing. What was missing is the half the manifest actually specifies:

     Model may propose automation.
     Model may not silently install permanent automation.

 The second sentence was already true, by absence: nothing in ACTION_CATALOG
 can write a LaunchAgent or a crontab, and `openclaw` is not on the exec
 allowlist, so Orion has no route to a scheduler at all. Absence is a strong
 enforcement and it is also a brittle one -- it holds until somebody adds a
 wrapper for an unrelated reason. This file makes it structural instead: there
 is a PROPOSE action in the catalog and there is no INSTALL action, and there
 cannot be one, because installing is a separate program Orion may not run.

 The first sentence was not true at all. He could describe an automation in
 English and had nowhere to put it, which is the same failure `orion-skill`
 was built for: no `file_write` tool, no writes on the exec allowlist, so a
 capability that exists in conversation and nowhere on disk.

 ## Why the fields are the manifest's fields

 Phase 57 lists seven, and each is here because leaving it out has a specific
 cost rather than because the list was copied:

   trigger           when. A closed set of shapes, never a raw cron string. A
                     minute-field of "star slash one" and a minute-field of "1"
                     differ by one character and by a factor of sixty, and the
                     expression itself is derived at install time from a shape
                     nobody can typo.
   conditions        when NOT, even though the trigger fired. Quiet hours are
                     the case that matters; an automation that texts at 03:00
                     gets switched off entirely rather than adjusted.
   actions           what. A CLOSED table, the same argument as everywhere
                     else: an automation that can run an arbitrary command is
                     arbitrary execution on a timer, which is worse than
                     arbitrary execution because nobody is watching.
   permissions       what authority it runs with. Automations run at the
                     strictness mode in force AT FIRE TIME and may not carry
                     their own -- a standing grant that outlives the
                     conversation that created it is the thing Phase 50's
                     expiry exists to prevent.
   expiration        when it stops on its own. Required, because the failure
                     mode of automation is not the one that misfires, it is the
                     one that keeps working after it stopped being wanted.
   riskLimits        how many times, how loudly. A misfiring automation should
                     hit a ceiling before Nick does.
   failureBehavior   what happens when it errors. Defaulting to "retry
                     forever" is how one broken job becomes a pager.

 ## Simulation is not a preview

 Phase 58 asks how often a proposal WOULD have fired. Answered by replaying the
 trigger against the clock over a window -- arithmetic, not a dry run -- and by
 saying plainly when there is no history to answer from. A simulation that
 quietly reports zero because it had no data is worse than one that refuses.
*/

export const AUTOMATION_ROOT = path.join(
  os.homedir(),
  ".openclaw/orion-controlled/automations",
);

/** Trigger shapes. Never a raw cron string; see the header. */
export type AutomationTrigger =
  | { kind: "daily"; atHour: number; atMinute: number }
  | { kind: "hourly"; atMinute: number }
  | { kind: "weekly"; weekday: number; atHour: number; atMinute: number };

/**
 * What an automation may do.
 *
 * Every entry is a command that already runs unattended on this machine and
 * already knows how to stay quiet -- `orion-standing` says only what changed,
 * `orion-focus check` speaks on a cooldown. Adding to this table is a
 * deliberate act with a reviewer; there is no entry that takes free text and
 * no shape that could hold one.
 */
export const AUTOMATION_ACTIONS: Readonly<
  Record<string, { argv: readonly string[]; describe: string; risk: "low" | "medium" }>
> = {
  standing_check: {
    argv: ["orion-standing", "check"],
    describe: "look for a commitment coming up that Nick may not have clocked",
    risk: "low",
  },
  standing_morning: {
    argv: ["orion-standing", "morning"],
    describe: "the morning brief, and nothing if there is nothing to say",
    risk: "low",
  },
  standing_evening: {
    argv: ["orion-standing", "evening"],
    describe: "what is still open tonight and whether tomorrow starts early",
    risk: "low",
  },
  agenda_today: {
    argv: ["orion-agenda", "today"],
    describe: "read today's calendar",
    risk: "low",
  },
  daily_rollup: {
    argv: ["orion-daily"],
    describe: "roll the day's memory up into the brain",
    risk: "medium",
  },
};

export type FailureBehavior = "stop" | "retry_once" | "report_and_continue";

export interface AutomationProposal {
  name: string;
  /** Nick's words, or Orion's summary of them. Shown at approval time. */
  intent: string;
  trigger: AutomationTrigger;
  conditions: {
    /** Local hours during which it must NOT speak. [start, end), 0-23. */
    quietHours?: readonly [number, number];
    /** Skip when Orion is in a focus session. */
    skipDuringFocus?: boolean;
  };
  action: keyof typeof AUTOMATION_ACTIONS;
  /**
   * Recorded, never granted. An automation runs at whatever strictness mode is
   * in force when it fires; this field says what it EXPECTS, so a mismatch is
   * visible rather than silently permissive.
   */
  permissions: { expectsMode: "contained" | "guarded" | "open" | "sovereign" };
  /** ISO date. Required — see the header on why. */
  expiresOn: string;
  riskLimits: { maxRunsPerDay: number; maxMessagesPerDay: number };
  failureBehavior: FailureBehavior;
  proposedAt: string;
  /** Set once a person installs it. Orion cannot write this field. */
  installedAt?: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** The longest an automation may run before somebody has to want it again. */
export const MAX_AUTOMATION_DAYS = 180;

/**
 * Validate a proposal completely, returning every problem at once.
 *
 * All of them rather than the first, because a model that fixes one field per
 * round trip takes seven turns to write one automation, and the seventh is
 * where it starts inventing fields to make the errors stop.
 */
export function validateProposal(value: unknown): string[] {
  const issues: string[] = [];
  const p = (value ?? {}) as Partial<AutomationProposal>;

  if (typeof p.name !== "string" || !NAME_RE.test(p.name)) {
    issues.push("name must be lower-case letters, digits and hyphens, 2-48 characters");
  }
  if (typeof p.intent !== "string" || p.intent.trim().length < 8) {
    issues.push("intent must say in a sentence what this is for — it is what Nick reads before approving");
  } else if (p.intent.length > 400) {
    issues.push("intent must be one sentence, under 400 characters");
  }

  const t = p.trigger;
  const hour = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23;
  const minute = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 59;
  if (!t || typeof t !== "object") {
    issues.push("trigger is required: daily, hourly or weekly");
  } else if (t.kind === "daily") {
    if (!hour(t.atHour) || !minute(t.atMinute)) issues.push("a daily trigger needs atHour 0-23 and atMinute 0-59");
  } else if (t.kind === "hourly") {
    if (!minute(t.atMinute)) issues.push("an hourly trigger needs atMinute 0-59");
  } else if (t.kind === "weekly") {
    if (!Number.isInteger(t.weekday) || t.weekday < 0 || t.weekday > 6) {
      issues.push("a weekly trigger needs weekday 0-6, Sunday first");
    }
    if (!hour(t.atHour) || !minute(t.atMinute)) issues.push("a weekly trigger needs atHour 0-23 and atMinute 0-59");
  } else {
    issues.push("trigger.kind must be daily, hourly or weekly — a raw cron string is not accepted");
  }

  /*
   `Object.hasOwn`, not `in`. `in` walks the prototype chain, so `constructor`,
   `toString`, `valueOf` and `__proto__` all passed a check whose entire job is
   to say the table is closed — found by review on 2026-09-04. It was not
   exploitable into execution (orion-automation then does `action.argv[0]` on
   an Object.prototype member and throws), but a validator that accepts a
   proposal it advertises as impossible turns a validation message into a crash
   at install time.
  */
  if (typeof p.action !== "string" || !Object.hasOwn(AUTOMATION_ACTIONS, p.action)) {
    issues.push(`action must be one of: ${Object.keys(AUTOMATION_ACTIONS).join(", ")}`);
  }

  const quiet = p.conditions?.quietHours;
  if (quiet !== undefined) {
    if (!Array.isArray(quiet) || quiet.length !== 2 || !hour(quiet[0]) || !hour(quiet[1])) {
      issues.push("quietHours must be two hours, 0-23, as [start, end)");
    }
  }

  if (typeof p.expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.expiresOn)) {
    issues.push("expiresOn is required as YYYY-MM-DD — an automation with no end is the one that outlives being wanted");
  } else {
    const ends = Date.parse(`${p.expiresOn}T23:59:59`);
    const limit = Date.now() + MAX_AUTOMATION_DAYS * 86_400_000;
    if (!Number.isFinite(ends) || ends <= Date.now()) issues.push("expiresOn must be in the future");
    else if (ends > limit) issues.push(`expiresOn must be within ${MAX_AUTOMATION_DAYS} days`);
  }

  const runs = p.riskLimits?.maxRunsPerDay;
  const messages = p.riskLimits?.maxMessagesPerDay;
  if (!Number.isInteger(runs) || (runs as number) < 1 || (runs as number) > 1440) {
    issues.push("riskLimits.maxRunsPerDay must be 1-1440");
  }
  if (!Number.isInteger(messages) || (messages as number) < 0 || (messages as number) > 48) {
    // Zero is allowed and useful: an automation that only writes to the log.
    issues.push("riskLimits.maxMessagesPerDay must be 0-48 — this is the number that stops a car alarm");
  }
  if (!["stop", "retry_once", "report_and_continue"].includes(String(p.failureBehavior))) {
    issues.push("failureBehavior must be stop, retry_once or report_and_continue");
  }
  if (
    !["contained", "guarded", "open", "sovereign"].includes(
      String(p.permissions?.expectsMode),
    )
  ) {
    issues.push("permissions.expectsMode must name a strictness mode — it is recorded, never granted");
  }
  return issues;
}

/** The trigger, in the words a person would use. */
export function describeTrigger(trigger: AutomationTrigger): string {
  const at = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  switch (trigger.kind) {
    case "daily":
      return `every day at ${at(trigger.atHour, trigger.atMinute)}`;
    case "hourly":
      return `every hour at ${String(trigger.atMinute).padStart(2, "0")} past`;
    case "weekly":
      return `every ${WEEKDAYS[trigger.weekday]} at ${at(trigger.atHour, trigger.atMinute)}`;
  }
}

/** The cron expression, derived at INSTALL time and never accepted as input. */
export function cronExpression(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case "daily":
      return `${trigger.atMinute} ${trigger.atHour} * * *`;
    case "hourly":
      return `${trigger.atMinute} * * * *`;
    case "weekly":
      return `${trigger.atMinute} ${trigger.atHour} * * ${trigger.weekday}`;
  }
}

export interface Simulation {
  /** Every moment it would have fired in the window. */
  fireCount: number;
  /** How many of those the conditions would have suppressed. */
  suppressedCount: number;
  /** Firings that would have spoken, after the daily message ceiling. */
  messageCount: number;
  windowDays: number;
  /** True when the ceiling, not the trigger, decided the message count. */
  cappedByRiskLimit: boolean;
  notes: string[];
}

/**
 * PHASE 58 — how often this would have fired, over a real window of clock time.
 *
 * Arithmetic against the calendar rather than a dry run, and deliberately so:
 * a dry run of `orion-daily` would roll up the day's memory, which is the
 * thing simulation exists to avoid doing.
 *
 * What it CANNOT answer is stated in `notes` rather than folded into a number.
 * Whether `orion-standing check` would actually have SAID anything depends on
 * what was in the calendar that morning, and this has no way to know — so it
 * reports the ceiling, calls it a ceiling, and says which part is unknown. A
 * simulation that quietly reports zero because it had no data is worse than
 * one that refuses to guess.
 */
export function simulate(
  proposal: AutomationProposal,
  options: { windowDays?: number; from?: Date } = {},
): Simulation {
  const windowDays = options.windowDays ?? 30;
  const from = options.from ?? new Date();
  const notes: string[] = [];
  const quiet = proposal.conditions.quietHours;

  const inQuiet = (hour: number): boolean => {
    if (!quiet) return false;
    const [start, end] = quiet;
    // Wrapping windows are the normal case here: 22 to 8 crosses midnight, and
    // reading that as an empty range is how a quiet-hours rule silently does
    // nothing.
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  };

  let fires = 0;
  let suppressed = 0;
  const perDay = new Map<string, number>();
  for (let day = 0; day < windowDays; day += 1) {
    const date = new Date(from.getTime() - day * 86_400_000);
    const key = date.toLocaleDateString("en-CA");
    const hours: number[] =
      proposal.trigger.kind === "hourly"
        ? Array.from({ length: 24 }, (_, h) => h)
        : proposal.trigger.kind === "weekly" && date.getDay() !== proposal.trigger.weekday
          ? []
          : [proposal.trigger.atHour ?? 0];
    for (const hour of hours) {
      fires += 1;
      if (inQuiet(hour)) {
        suppressed += 1;
        continue;
      }
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
  }

  const ceiling = proposal.riskLimits.maxMessagesPerDay;
  let messages = 0;
  let capped = false;
  for (const count of perDay.values()) {
    messages += Math.min(count, ceiling);
    if (count > ceiling) capped = true;
  }

  notes.push(
    `This is a CEILING, not a forecast: it counts every moment the trigger fires, and ${proposal.action} stays silent when it has nothing to say.`,
  );
  if (proposal.conditions.skipDuringFocus) {
    notes.push("Firings during a focus session are not modelled — there is no history of past sessions to replay against.");
  }
  if (capped) {
    notes.push(`The daily ceiling of ${ceiling} is doing real work here; without it this would speak more often.`);
  }
  return {
    fireCount: fires,
    suppressedCount: suppressed,
    messageCount: messages,
    windowDays,
    cappedByRiskLimit: capped,
    notes,
  };
}
