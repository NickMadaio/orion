import { constants } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { ACTION_CATALOG } from "./catalog.js";
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
];
/** The default, and the one mode whose behaviour is defined as "what shipped". */
export const DEFAULT_MODE = "guarded";
export const MODE_SUMMARY = {
    contained: "Reads run. Everything else asks first. The mode Orion may enter by himself and may not leave.",
    guarded: "The catalog's own levels, unmodified. Self-repair happens and is reported; authority changes and outbound messages are approved first.",
    open: "The announcements stop; the gates stay. He repairs himself and writes files without narrating it, and every action the catalog gates is still gated — modes raise friction and never lower it.",
    sovereign: "Everything runs unannounced except what the floor holds back: authority changes, reaching another person, and anything he cannot undo. It frees ANNOUNCEMENT, not gates — an action the catalog demands approval for is still approved, in every mode.",
};
const LADDER = ["AUTO", "NOTIFY", "APPROVAL"];
const worst = (a, b) => {
    if (a === "NEVER" || b === "NEVER")
        return "NEVER";
    return LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b;
};
// MARK: - The floor
export const FLOOR_REASONS = [
    "authority_change",
    "third_party_reach",
    "irreversible",
];
const NO_FLOOR = {
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
export function floorForAction(name, definition) {
    if (/_authority_(?:set|modify)$/.test(name)) {
        return {
            level: "APPROVAL",
            reason: "authority_change",
            because: "it changes what Orion is allowed to do. No mode may relax this, because a mode that could would let him relax it.",
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
    if (definition.capabilityTier === "messages_send" ||
        (definition.reversible === false &&
            (definition.risk === "high" || definition.risk === "critical"))) {
        return {
            level: "APPROVAL",
            reason: "third_party_reach",
            because: "it cannot be undone and its blast radius is large — typically it lands somewhere Nick does not control, and nobody there agreed to anything",
        };
    }
    if (definition.reversible === false) {
        return {
            level: "NOTIFY",
            reason: "irreversible",
            because: "Orion has no inverse to run, so he may do it but may not do it quietly",
        };
    }
    return NO_FLOOR;
}
// MARK: - What the catalog itself demands, before any mode
/*
 The base level, derived from an action's own metadata.

 THIS LIVED IN `scripts/orion-authority` AND NOWHERE ELSE, which is how the
 strictness ladder came to be a description rather than a gate. An oblivious
 review on 2026-09-04 found that `strictness.ts` was imported by exactly two
 non-test files -- `index.ts`, for a status readout, and orion-authority, for
 documentation -- and that `validator.ts` had never seen a mode at all. Every
 number in the mode summaries was computed for DISPLAY.

 Moving the derivation here is what makes enforcement possible, and it removes
 a duplication rather than creating one: orion-authority reads the installed
 plugin, so it now imports this instead of keeping its own copy.

 The rungs are the ones orion-authority already used, in the same order:
 an approval the catalog demands, then irreversibility, then blast radius.
*/
export function baseLevelFor(name, definition) {
    if (definition.approvalRequired)
        return "APPROVAL";
    if (definition.reversible === false)
        return "NOTIFY";
    if (definition.risk === "high" || definition.risk === "critical")
        return "NOTIFY";
    return "AUTO";
}
/*
 WHICH RUNG IS ENFORCEABLE, and why the answer is only one of them.

 AUTO and NOTIFY differ in whether Orion SAYS something afterwards. Nothing in
 a validator can make a model narrate, so that distinction is guidance and has
 always been guidance. APPROVAL is different: it is a refusal, and a refusal is
 something code can perform.

 So a mode enforces by RAISING to APPROVAL and never by lowering from it. That
 asymmetry is deliberate and it is the safe direction:

   · `contained` really contains. Before this, it claimed "everything else asks
     first" and changed nothing at all -- and `orion-incident freeze` declined
     to drop the permission profile on the stated grounds that "contained
     already stops every write", which was false. That was the finding with
     real safety cost.
   · `open` and `sovereign` cannot unlock an action the catalog marks
     `approvalRequired`. They never could, and the summaries overstated it: what
     those modes free is ANNOUNCEMENT, not gates. Every approval-gated action
     is also held by the floor, so there is nothing for them to open even if
     they were allowed to.
*/
export function modeRequiresApproval(name, definition, mode, except = {}) {
    const leveled = levelForAction(name, definition, baseLevelFor(name, definition), mode, except);
    return leveled.level === "APPROVAL";
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
const MODE_RULES = {
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
export function applyMode(base, floor, mode, options = {}) {
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
export function exceptionFor(name, definition, except) {
    const byName = except[name];
    const byTier = except[definition.capabilityTier];
    if (byName && byTier)
        return worst(byName, byTier);
    return byName ?? byTier;
}
export function levelForAction(name, definition, base, mode, except = {}) {
    const exception = exceptionFor(name, definition, except);
    return applyMode(base, floorForAction(name, definition), mode, {
        reads: READ_KINDS.has(definition.execution.kind),
        ...(exception ? { exception } : {}),
    });
}
export const GUARDED_STATE = {
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
const isMode = (value) => typeof value === "string" && STRICTNESS_MODES.includes(value);
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
export function resolveStrictness(statePath, now = new Date()) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(statePath, "utf8"));
    }
    catch (error) {
        const code = error.code;
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
    const state = {
        ...GUARDED_STATE,
        ...parsed,
        mode: parsed.mode,
        except: parsed.except && typeof parsed.except === "object" ? parsed.except : {},
        // Only absolute, dot-free prefixes survive: a malformed entry is dropped,
        // and dropping one can only make the scope smaller.
        resources: Array.isArray(parsed.resources)
            ? parsed.resources.filter((entry) => typeof entry === "string" && entry.startsWith("/") && !entry.split("/").includes(".."))
            : [],
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
export function isRelaxation(from, to) {
    return STRICTNESS_MODES.indexOf(to) > STRICTNESS_MODES.indexOf(from);
}
export async function writeStrictness(statePath, state) {
    const directory = path.dirname(statePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.strictness-${process.pid}-${Date.now()}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await rename(temporary, statePath);
}
/** Every action's level under one mode. Used by the status tool and the docs. */
export function levelMap(bases, mode, except = {}) {
    return new Map(Object.entries(ACTION_CATALOG).map(([name, definition]) => [
        name,
        levelForAction(name, definition, bases.get(name) ?? "AUTO", mode, except),
    ]));
}
/** Kept out of the module's happy path so a caller must ask for it explicitly. */
export async function seedIfAbsent(statePath) {
    await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    await writeFile(statePath, `${JSON.stringify(GUARDED_STATE, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
    }).catch(() => undefined);
}
/**
 * The first file target of a step that lies outside the delegation's
 * resources, or null. Targets are an absolute `path`, or a named root plus
 * `relativePath` / `destinationPath`. No resources, or no file target, is null:
 * the scope limits where files may be touched, not what else may happen.
 */
export function targetOutsideResources(arguments_, resources, roots) {
    if (!resources.length)
        return null;
    const targets = [];
    if (typeof arguments_.path === "string" && arguments_.path.startsWith("/"))
        targets.push(arguments_.path);
    const base = typeof arguments_.root === "string" ? roots[arguments_.root] : undefined;
    for (const key of ["relativePath", "destinationPath"]) {
        const value = arguments_[key];
        // A root the caller cannot resolve is a target it cannot place inside the
        // scope, so it counts as outside rather than being skipped.
        if (typeof value === "string")
            targets.push(base ? `${base.replace(/\/+$/, "")}/${value}` : `(${String(arguments_.root)})/${value}`);
    }
    const inside = (target) => resources.some((prefix) => {
        const clean = prefix.replace(/\/+$/, "");
        return target === clean || target.startsWith(`${clean}/`);
    });
    return targets.find((target) => target.split("/").includes("..") || !inside(target)) ?? null;
}
