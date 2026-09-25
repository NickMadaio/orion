import path from "node:path";
/*
 GOVERNED SELF-DEVELOPMENT -- the boundary, built before the loop.

 Nick's #5 asked for local models to handle "self propogation changes...
 and coding tasks I don't need in a rush". The name is deliberately not kept:
 replication, silent persistence and self-granted authority are not wanted,
 and "self-propagation" reads like all three. What is wanted is a local model
 proposing a DIFF to Orion's own source, reviewed and applied through the same
 gate everything else goes through -- so this file calls it what it is:
 governed self-development. Never on by default; see
 `GOVERNED_SELF_DEVELOPMENT_ENABLED` below.

 THIS FILE IS THE BOUNDARY, NOT THE LOOP

 There is no code here that reads a local model's output, no code that writes
 a file, and no code that calls `git`. That machinery does not exist yet on
 purpose -- the job tonight was to make the boundary a proof rather than a
 promise, and a boundary is easiest to trust when it has nothing else to hide
 behind. What is here:

   1. A single flag, `GOVERNED_SELF_DEVELOPMENT_ENABLED`, hard-coded false.
      Turning the capability on is a decision for whoever wires the loop in,
      made in one place, not an emergent property of enough other flags being
      true.

   2. A deny-list of paths a proposed diff may never touch, checked BEFORE
      the diff is accepted -- not after it runs, not by asking the diff's
      author to promise it stayed away. `assertDiffAllowed` is the one
      function anything wiring this in has to call, and it throws with the
      file and the reason.

 WHY THESE PATHS AND NOT A NARROWER SET

 The job named eight surfaces: the policy evaluator, the approval verifier,
 the audit ledger, the secret store, the sandbox rules, update signing,
 LOCK ORION, and the privileged broker. Each maps onto a real path in this
 repository, not a category left to interpretation:

   policy evaluator     catalog.ts (the tier/policy tables) and validator.ts
                         (what actually enforces them against an argument)
   approval verifier     approvals.ts
   audit ledger          ledger.ts and provenance.ts (the hash chain behind it)
   secret store           orion/security/ (Keychain-adjacent Python) and the
                         provider-credential shape in permissions.ts
   sandbox rules          orion/security/ again (risk.py, profiles.py) and
                         devops.ts's fixed-argv repository table
   update signing         native/Orion/ wholesale -- Sparkle, the EdDSA key
                         reference, and make_app_bundle.sh's inside-out
                         signing order all live under it, and getting this
                         wrong is the one mistake AGENTS.md calls the single
                         invariant of the whole program
   LOCK ORION              scripts/orion-lock
   privileged broker      backend/connectors/broker.py, the one module that
                         actually sends or writes to an external service on
                         Nick's behalf

 `selfrepair.ts` already has a table shaped like this (`AUTHORITY_PLUGIN_FILES`,
 `FORBIDDEN_SCRIPTS`) for Orion's EXISTING self-repair capability, and it is
 not reused here on purpose: that table's job is "reachable, but only with
 Nick's named authority instruction" -- AUTHORITY is a class you can still
 enter. Every path below must be reachable by NOTHING this capability does,
 in EVERY strictness mode including `sovereign`, with no instruction able to
 open it. Folding the two together would make the stricter guarantee only as
 strong as the weaker one the day someone edits the shared table for a reason
 that has nothing to do with governed self-development.

 THE PROOF THIS FILE MAKES POSSIBLE

 `assertDiffAllowed` is a pure function over path strings -- no filesystem
 access, no dependency on `selfrepair.ts` or any other file this session does
 not own. self-development-authority.test.ts mutation-tests it: comment out
 the `approvals.ts` entry, run the named test that expects a diff touching it
 to be refused, watch it fail with a quoted assertion message, then restore
 the entry and watch the same test pass again.
*/
/** Off tonight, and every night after this one until something turns it on
 * deliberately. Not read from an environment variable or a config file --
 * both are things a local model's own diff could eventually touch, and a
 * kill switch that the thing it switches off can move is not a kill switch. */
export const GOVERNED_SELF_DEVELOPMENT_ENABLED = false;
export class GovernedSelfDevelopmentDisabledError extends Error {
    constructor() {
        super("governed self-development is disabled (GOVERNED_SELF_DEVELOPMENT_ENABLED " +
            "is false in self-development-authority.ts). The machinery and the " +
            "boundary exist; nothing may run yet.");
        this.name = "GovernedSelfDevelopmentDisabledError";
    }
}
/** Call this at the single entry point that would ever hand a diff to a
 * local model for authorship. Throws unconditionally while the flag is off. */
export function assertGovernedSelfDevelopmentEnabled() {
    if (!GOVERNED_SELF_DEVELOPMENT_ENABLED) {
        throw new GovernedSelfDevelopmentDisabledError();
    }
}
/**
 * Checked in order; the first match wins. Patterns are anchored (`^...$` or
 * a directory prefix) against a POSIX-style, repo-root-relative path, never
 * against a bare filename -- so `notes/approvals.ts` does not collide with
 * the real `approvals.ts` and a same-named file elsewhere in the tree cannot
 * borrow its refusal or, worse, its absence of one.
 */
export const FORBIDDEN_SELF_CHANGE_SURFACES = [
    {
        pattern: /^plugin\/orion-control\/src\/catalog\.ts$/,
        reason: "the policy evaluator's tier and action tables (catalog.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/validator\.ts$/,
        reason: "the policy evaluator that enforces those tables against a real argument (validator.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/approvals\.ts$/,
        reason: "the approval verifier (approvals.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/permissions\.ts$/,
        reason: "the permission-profile ladder permissions.ts enforces",
    },
    {
        pattern: /^plugin\/orion-control\/src\/strictness\.ts$/,
        reason: "the friction ladder and its floor (strictness.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/ledger\.ts$/,
        reason: "the audit ledger (ledger.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/provenance\.ts$/,
        reason: "the hash chain behind the audit ledger (provenance.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/selfrepair\.ts$/,
        reason: "the classification tables that decide what ordinary self-repair may touch (selfrepair.ts)",
    },
    {
        pattern: /^plugin\/orion-control\/src\/self-development-authority\.ts$/,
        reason: "this file: the deny-list may not remove itself from its own deny-list",
    },
    {
        pattern: /^orion\/security\//,
        reason: "the sandbox and secret-handling rules under orion/security/",
    },
    {
        pattern: /^scripts\/orion-lock$/,
        reason: "LOCK ORION, the emergency off switch",
    },
    {
        pattern: /^scripts\/orion-repair$/,
        reason: "the repair engine that enforces selfrepair.ts's own rules",
    },
    {
        pattern: /^scripts\/orion-forge$/,
        reason: "the Swift self-modification engine and its gates",
    },
    {
        pattern: /^scripts\/orion-approve$/,
        reason: "how a person says yes",
    },
    {
        pattern: /^scripts\/orion-mode$/,
        reason: "how a person sets how much has to be asked",
    },
    {
        pattern: /^scripts\/orion-sign-setup$/,
        reason: "code-signing setup",
    },
    {
        pattern: /^scripts\/orion-keys$/,
        reason: "credential and Keychain material",
    },
    {
        pattern: /^native\/Orion\//,
        reason: "the signed Mac app -- update signing (Sparkle), the designated code-signing " +
            "identity, and LOCK ORION's native half all live under it",
    },
    {
        pattern: /^backend\/connectors\/broker\.py$/,
        reason: "the privileged broker that actually sends or writes to an external service",
    },
    // Added 2026-09-21 with the local agentic runtime. Same argument as every
    // entry above, applied to the newest thing that governs a model: the
    // orchestrator owns the review gates, the escalation state and the write
    // boundary, and its prompts are the operating instructions an unattended
    // worker follows. A model that can edit either can remove its own
    // constraints, and every other rule here becomes advisory.
    //
    // The runtime ALSO carries its own copy of these surfaces
    // (scripts/lib/agentic/boundary.mjs, RUNTIME_PROTECTED_SURFACES) and checks
    // both. That is deliberate rather than redundant: entries here are not in
    // force until a human rebuilds and deploys the plugin, which is exactly the
    // friction this file was built for, but it would have left the new surfaces
    // unguarded until then.
    {
        pattern: /^scripts\/lib\/agentic\//,
        reason: "the local agentic runtime: its write boundary, its review gates and the agent operating-system prompts",
    },
    {
        pattern: /^scripts\/lib\/orion-project-agent\.mjs$/,
        reason: "the durable controller that owns workflow state and enforces the review gates",
    },
    {
        pattern: /^scripts\/orion-agent$/,
        reason: "the supervisor entrypoint and its enablement gate",
    },
    {
        pattern: /^scripts\/orion-project-agent$/,
        reason: "the operator control CLI (pause, resume, steer, resolve)",
    },
    {
        pattern: /^docs\/agentic\//,
        reason: "the mission and architecture that define what the agentic runtime is for",
    },
];
export class SelfChangeForbiddenError extends Error {
    path;
    surfaceReason;
    constructor(path, surfaceReason) {
        super(`a proposed diff may not touch "${path}" -- that is ${surfaceReason}. ` +
            "This surface is refused for governed self-development regardless of " +
            "strictness mode; there is no instruction that reopens it.");
        this.path = path;
        this.surfaceReason = surfaceReason;
        this.name = "SelfChangeForbiddenError";
    }
}
class UnsafeDiffPathError extends Error {
    constructor(raw, reason) {
        super(`"${raw}" is not an acceptable diff path: ${reason}`);
        this.name = "UnsafeDiffPathError";
    }
}
/**
 * Turn whatever a caller handed in into a repo-root-relative, forward-slash
 * path, refusing anything that could name a location outside the deny-list's
 * own vocabulary by escaping it rather than by being listed.
 */
function normalizeRelativePath(raw) {
    if (typeof raw !== "string" || raw.length === 0) {
        throw new UnsafeDiffPathError(String(raw), "path must be a non-empty string");
    }
    if (path.isAbsolute(raw) || raw.startsWith("~")) {
        throw new UnsafeDiffPathError(raw, "path must be relative to the repository root");
    }
    const posixed = raw.split(path.sep).join("/");
    const normalized = path.posix.normalize(posixed);
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
        throw new UnsafeDiffPathError(raw, "path must not traverse above the repository root");
    }
    if (normalized.includes("\0")) {
        throw new UnsafeDiffPathError(raw, "path must not contain a NUL byte");
    }
    return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}
/** The matching entry, or `undefined` if the path is not on the deny-list. */
export function forbiddenSelfChangeSurface(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    return FORBIDDEN_SELF_CHANGE_SURFACES.find((surface) => surface.pattern.test(normalized));
}
/**
 * The one function anything proposing a diff must call before accepting it.
 * Throws `SelfChangeForbiddenError` naming the first forbidden path found;
 * returns nothing when every path is acceptable.
 */
export function assertDiffAllowed(paths) {
    for (const candidate of paths) {
        const hit = forbiddenSelfChangeSurface(candidate);
        if (hit) {
            throw new SelfChangeForbiddenError(normalizeRelativePath(candidate), hit.reason);
        }
    }
}
