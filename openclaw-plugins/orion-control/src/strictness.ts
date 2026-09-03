import { constants } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { ACTION_CATALOG, type ActionDefinition } from "./catalog.js";

/*
 HOW MUCH FRICTION, as a separate question from WHAT IS POSSIBLE.

 Orion already had one authority axis: `PermissionProfile`, five rungs, which
 answers "does this capability exist for him at all". It is the right question
 and it is answered well. It is also not the question Nick keeps hitting.

 His machine sits at `external_connected` -- the top profile -- with 158
 capabilities live. Nothing is missing. What is wrong is that reaching them
 costs a conversation: an action marked `approvalRequired` stops, explains
 itself, and waits, and it does that identically whether Orion is deleting a
 calendar event or telling the time in a room with nobody in it. One axis
 cannot express "he may do this" and "he may do this without checking" at the
 same time, so this file adds the second axis and leaves the first alone.

   PermissionProfile   what exists          (untouched, five rungs)
   StrictnessMode      what it costs        (this file, four rungs)

 The two compose. A mode can never reach something the profile has not granted
 -- `NEVER` is availability, not friction, and no mode moves it.

 ## The floor is the load-bearing part

 A mode relaxes the ladder. A FLOOR stops it, per capability, derived from that
 capability's own metadata rather than from a list somebody maintains. Three
 things never become free, in any mode, including the most permissive:

   · changing what Orion is allowed to do. If `sovereign` made this free,
     Orion could put himself in `sovereign`, and the whole ladder would be a
     suggestion he writes himself.
   · reaching a third party. A sent message is on someone else's phone in a
     second, there is no unsend, and the person on the other end consented to
     nothing.
   · anything he cannot undo. This one floors at NOTIFY rather than APPROVAL:
     he may do it, he may not do it quietly.

 Everything else is genuinely delegable, and `sovereign` delegates all of it.

 ## Why the modes are named this way

 Nick's sketch was "full OOS -> loose -> what we have now -> super strict???",
 and the question marks were the honest part: a rung with nothing on it is a
 rung that will rot. `external_connected` spent months as `consequential_local`
 spelled differently for exactly that reason. So `contained` was given a job
 rather than a position: reads stay free, everything else asks. It is the mode
 for a machine that is being handed around, for the hour after a self-repair,
 and for the moment something looks wrong and locking Orion out entirely is too
 blunt. It is also the ONLY direction of travel Orion may take by himself.
*/

export const STRICTNESS_MODES = [
  "contained",
  "guarded",
  "open",
  "sovereign",
] as const;
export type StrictnessMode = (typeof STRICTNESS_MODES)[number];

/** The default, and the one mode whose behaviour is defined as "what shipped". */
export const DEFAULT_MODE: StrictnessMode = "guarded";

export const MODE_SUMMARY: Record<StrictnessMode, string> = {
  contained:
    "Reads run. Everything else asks first. The mode Orion may enter by himself and may not leave.",
  guarded:
    "The catalog's own levels, unmodified. Self-repair happens and is reported; authority changes and outbound messages are approved first.",
  open:
    "The announcements stop; the gates stay. He repairs himself and writes files without narrating it, and the same things stop him that stopped him before.",
  sovereign:
    "Everything runs unannounced except what the floor holds back: authority changes, reaching another person, and anything he cannot undo.",
};

const LADDER = ["AUTO", "NOTIFY", "APPROVAL"] as const;
export type GateLevel = (typeof LADDER)[number] | "NEVER";

const worst = (a: GateLevel, b: GateLevel): GateLevel => {
  if (a === "NEVER" || b === "NEVER") return "NEVER";
  return LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b;
};

// MARK: - The floor

export const FLOOR_REASONS = [
  "authority_change",
  "third_party_reach",
  "irreversible",
] as const;
export type FloorReason = (typeof FLOOR_REASONS)[number];

export interface Floor {
  level: GateLevel;
  reason: FloorReason | null;
  because: string;
}

const NO_FLOOR: Floor = {
  level: "AUTO",
  reason: null,
  because: "reversible, local, and reaches nobody but Nick",
};

/**
 * An action's floor, read off the action.
 *
 * `authority_change` is matched on the NAME rather than on the tier, and that
 * is deliberate. `self_config` carries both halves: most of it is a timeout,
 * and one route of it decides what Orion may do. The catalog already splits
 * them by action name (`self_config_set` vs `self_config_authority_set`) and
 * that split is the one that matters here, so it is the one this reads.
 *
 * Everything is derived. Add an action to the catalog with
 * `reversible: false` and it floors at NOTIFY without anybody editing this
 * file -- which is the property that stops this from becoming the kind of
 * capability prose that was true when it was written.
 */
export function floorForAction(name: string, definition: ActionDefinition): Floor {
  if (/_authority_(?:set|modify)$/.test(name)) {
    return {
      level: "APPROVAL",
      reason: "authority_change",
      because:
        "it changes what Orion is allowed to do. No mode may relax this, because a mode that could would let him relax it.",
    };
  }
  /*
   Reaching a person who is not Nick.

   Matched on "irreversible AND high risk" rather than on a list of send-shaped
   names, because the list is the thing that goes stale. `messages_send` is
   named as well and not instead: it is the one action whose tier exists purely
   to hold it, and if its risk metadata were ever softened by an edit, that
   edit should not also quietly move its floor.

   `email_send` lands here through the general rule -- it is `risk: high`,
   `reversible: false` -- which is the correct answer for a reason worth
   writing down: it executes as `simulate` today, so it does nothing at all,
   and a floor derived from what an action CLAIMS to do keeps holding on the
   day somebody wires it up for real.
  */
  if (
    definition.capabilityTier === "messages_send" ||
    (definition.reversible === false &&
      (definition.risk === "high" || definition.risk === "critical"))
  ) {
    return {
      level: "APPROVAL",
      reason: "third_party_reach",
      because:
        "it cannot be undone and its blast radius is large — typically it lands somewhere Nick does not control, and nobody there agreed to anything",
    };
  }
  if (definition.reversible === false) {
    return {
      level: "NOTIFY",
      reason: "irreversible",
      because:
        "Orion has no inverse to run, so he may do it but may not do it quietly",
    };
  }
  return NO_FLOOR;
}

// MARK: - Applying a mode

/**
 * Does this action only look?
 *
 * The same list `orion-authority` uses, and it is a list of the execution
 * kinds that READ rather than a list of the ones that write, because a new
 * execution kind should default to "this writes" and get more friction, not
 * less.
 */
const READ_KINDS = new Set([
  "list_directory",
  "path_metadata",
  "read_text",
  "self_source",
  "simulate",
  "messages_read",
  "ambient_info",
]);

const MODE_RULES: Record<StrictnessMode, (level: GateLevel, reads: boolean) => GateLevel> = {
  // Reads are free even here. A mode nobody can bear to switch on protects
  // nothing, and asking before `ls` is how that happens.
  contained: (level, reads) => (level === "NEVER" ? "NEVER" : reads ? "AUTO" : "APPROVAL"),
  // Byte-for-byte what shipped. This is asserted by a test rather than
  // believed: with `guarded` the derived authority map must equal the
  // committed CURRENT_AUTHORITY.json exactly.
  guarded: (level) => level,
  /*
   Stop narrating; keep the gates.

   `open` was one rung softer everywhere at first, and that made it a near-copy
   of `sovereign`: 123 capabilities free against 124. A rung with nothing on it
   is a rung that rots -- `external_connected` spent months being
   `consequential_local` spelled differently for exactly that reason -- so the
   two were given different jobs rather than different amounts of the same one.

   `open` clears the ANNOUNCEMENTS. Everything Orion would have done and then
   reported he now just does, which is Nick's "easy self propagation": the
   self-repair tiers sit at NOTIFY under `guarded`, so this is the mode where
   he fixes himself without a running commentary. What still stops him is
   exactly what stopped him before.

   `sovereign` clears the GATES as well. That is the real step, and it is why
   the two are one rung apart rather than one number apart.
  */
  open: (level) => (level === "APPROVAL" || level === "NEVER" ? level : "AUTO"),
  sovereign: (level) => (level === "NEVER" ? "NEVER" : "AUTO"),
};

export interface LeveledCapability {
  /** What the catalog and the profile say, before any mode is applied. */
  base: GateLevel;
  /** What the mode would make it. */
  relaxed: GateLevel;
  /** What it actually is: the mode's answer, never below the floor. */
  level: GateLevel;
  floor: Floor;
  /** Set when the floor, not the mode, decided the outcome. */
  heldByFloor: boolean;
}

export function applyMode(
  base: GateLevel,
  floor: Floor,
  mode: StrictnessMode,
  options: { reads?: boolean; exception?: GateLevel } = {},
): LeveledCapability {
  const relaxed = MODE_RULES[mode](base, options.reads === true);
  /*
   An exception is combined with `worst`, which is what makes it raise-only.

   Phase 50's example is "allow calendar create/update, never delete". That is
   expressible: name the tier or action, give it APPROVAL, and it keeps that
   however permissive the mode is. The inverse -- a hole punched through the
   floor for one favourite capability -- is not expressible at all, because
   `worst` cannot return something lower than either input. A delegation that
   could carve exceptions INTO the floor would be a floor with extra steps.
  */
  const level = worst(worst(relaxed, floor.level), options.exception ?? "AUTO");
  return {
    base,
    relaxed,
    level,
    floor,
    heldByFloor: level !== relaxed,
  };
}

/**
 * The exception that applies to one action, if any.
 *
 * Keyed by action name OR by capability tier, because both are things a person
 * says: "never let him delete a calendar event" and "nothing that touches the
 * calendar" are different sentences and both should work. The stricter of the
 * two wins when both are present.
 */
export function exceptionFor(
  name: string,
  definition: ActionDefinition,
  except: Readonly<Record<string, GateLevel>>,
): GateLevel | undefined {
  const byName = except[name];
  const byTier = except[definition.capabilityTier];
  if (byName && byTier) return worst(byName, byTier);
  return byName ?? byTier;
}

export function levelForAction(
  name: string,
  definition: ActionDefinition,
  base: GateLevel,
  mode: StrictnessMode,
  except: Readonly<Record<string, GateLevel>> = {},
): LeveledCapability {
  const exception = exceptionFor(name, definition, except);
  return applyMode(base, floorForAction(name, definition), mode, {
    reads: READ_KINDS.has(definition.execution.kind),
    ...(exception ? { exception } : {}),
  });
}

// MARK: - The stored delegation

/**
 * What is on disk. A mode plus the four things Phase 50 requires of any
 * delegation: when it expires, what it does not cover, which device it is for,
 * and who granted it.
 */
export interface StrictnessState {
  mode: StrictnessMode;
  version: number;
  setAt: string;
  setBy: string;
  reason: string;
  /** ISO instant, or null for "until changed". */
  expiresAt: string | null;
  /**
   * Per-tier exceptions. RAISING ONLY -- an exception may add friction to one
   * tier and may never remove it. "Allow calendar writes but never a delete"
   * is expressible; "sovereign, and also let this one thing through the floor"
   * is not, because that is just a floor with extra steps.
   */
  except: Readonly<Record<string, GateLevel>>;
  /** Which Mac this delegation is for. */
  deviceId: string | null;
}

export const GUARDED_STATE: StrictnessState = {
  mode: DEFAULT_MODE,
  version: 0,
  setAt: new Date(0).toISOString(),
  setBy: "default",
  reason: "no delegation on file",
  expiresAt: null,
  except: {},
  deviceId: null,
};

/**
 * The longest a delegation may run before it has to be renewed.
 *
 * Bounded rather than open-ended for a reason worth naming: expiry is
 * evaluated against the system clock at read time, so a clock that jumps
 * backwards extends whatever is in force. A cap means the blast radius of that
 * is a day, not forever. It is also the honest read of "I am going out" --
 * that is a delegation with an end, and one nobody has to remember to revoke.
 */
export const MAX_DELEGATION_MS = 24 * 60 * 60 * 1000;

export interface ResolvedStrictness {
  state: StrictnessState;
  /** The mode actually in force, after expiry. */
  mode: StrictnessMode;
  /** Set when a delegation was on file but has run out. */
  expired: boolean;
  /** Set when the file could not be trusted; the reason is for the operator. */
  degraded?: string;
}

const isMode = (value: unknown): value is StrictnessMode =>
  typeof value === "string" && (STRICTNESS_MODES as readonly string[]).includes(value);

/**
 * Read the delegation, and fall back to `guarded` for every possible reason.
 *
 * Every failure path here lands on `guarded`, never on anything softer. A
 * missing file, a corrupt file, a file naming a mode that does not exist, a
 * symlink where a file should be -- all of them mean "we do not know what was
 * delegated", and the only safe reading of that is the default.
 *
 * Synchronous on purpose: the validator is pure and synchronous, and every
 * test in this codebase depends on it staying that way.
 */
export function resolveStrictness(
  statePath: string,
  now: Date = new Date(),
): ResolvedStrictness {
  let parsed: Partial<StrictnessState>;
  try {
    parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<StrictnessState>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { state: GUARDED_STATE, mode: DEFAULT_MODE, expired: false }
      : {
          state: GUARDED_STATE,
          mode: DEFAULT_MODE,
          expired: false,
          degraded: `strictness file unreadable (${code ?? "parse error"}); running guarded`,
        };
  }
  if (!isMode(parsed.mode)) {
    return {
      state: GUARDED_STATE,
      mode: DEFAULT_MODE,
      expired: false,
      degraded: `strictness file names no known mode; running guarded`,
    };
  }
  const state: StrictnessState = {
    ...GUARDED_STATE,
    ...parsed,
    mode: parsed.mode,
    except: parsed.except && typeof parsed.except === "object" ? parsed.except : {},
  };
  /*
   Phase 50's "target devices", enforced rather than recorded.

   A delegation names the machine it is for, or names none and applies here. A
   delegation carrying somebody else's hostname is not this Mac's, and the
   right reading of a delegation that is not yours is `guarded` -- the same
   answer every other unreadable case gets.
  */
  if (state.deviceId && state.deviceId !== hostname()) {
    return {
      state,
      mode: DEFAULT_MODE,
      expired: false,
      degraded: `this delegation is addressed to ${String(state.deviceId).slice(0, 40)}, not to this Mac`,
    };
  }
  if (state.expiresAt) {
    const ends = Date.parse(state.expiresAt);
    // An unparseable expiry is an expired one. The alternative is treating
    // "expires: banana" as "never expires", which is the wrong direction.
    if (!Number.isFinite(ends) || ends <= now.getTime()) {
      return { state, mode: DEFAULT_MODE, expired: true };
    }
  }
  return { state, mode: state.mode, expired: false };
}

/** Is `to` less friction than `from`? That is the direction that needs a human. */
export function isRelaxation(from: StrictnessMode, to: StrictnessMode): boolean {
  return STRICTNESS_MODES.indexOf(to) > STRICTNESS_MODES.indexOf(from);
}

export async function writeStrictness(
  statePath: string,
  state: StrictnessState,
): Promise<void> {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.strictness-${process.pid}-${Date.now()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, statePath);
}

/** Every action's level under one mode. Used by the status tool and the docs. */
export function levelMap(
  bases: ReadonlyMap<string, GateLevel>,
  mode: StrictnessMode,
  except: Readonly<Record<string, GateLevel>> = {},
): Map<string, LeveledCapability> {
  return new Map(
    Object.entries(ACTION_CATALOG).map(([name, definition]) => [
      name,
      levelForAction(name, definition, bases.get(name) ?? "AUTO", mode, except),
    ]),
  );
}

/** Kept out of the module's happy path so a caller must ask for it explicitly. */
export async function seedIfAbsent(statePath: string): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(GUARDED_STATE, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  }).catch(() => undefined);
}
