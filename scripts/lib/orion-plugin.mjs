/*
 The one place that answers "which capability tiers are actually on".

 This module exists because the answer used to be written down twice. It was
 derived correctly in `orion-authority` and hand-copied, badly, into
 `orion-selfdoc` -- and the copy rotted. `orion-selfdoc`'s table was missing
 `self_modification`, `self_tuning` and `health_tracking` entirely, so those
 tiers resolved to `flag === undefined`, failed the `configured` test, and were
 printed into TOOLS.md under "Switched off right now". Orion read his own
 generated capability list, believed it, and told Nick "self-modification is
 disabled" while the config flag, the permission profile and the build script
 were all sitting there switched on.

 A copied table is a second source of truth, and a second source of truth is a
 lie with a delay fuse. So there is one derivation now, here, and both scripts
 import it. Nothing in this file states which tiers exist or what turns them on:
 every fact is read back out of the INSTALLED plugin -- the code the daemon
 actually loads -- so adding a tier to the plugin cannot silently switch it off
 in Orion's self-description.
*/

import { readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

export const HOME = homedir();

export const PATHS = {
  installed: join(HOME, ".openclaw/extensions/orion-control/dist"),
  built: join(HOME, "Desktop/ORION/openclaw-plugins/orion-control/dist"),
  config: join(HOME, ".openclaw/openclaw.json"),
  approvals: join(HOME, ".openclaw/exec-approvals.json"),
  state: join(HOME, ".openclaw/orion-controlled/permission-state.json"),
  scripts: join(HOME, "Desktop/ORION/scripts"),
  /*
   The gate: the strictness delegation, and the approval tickets and grants.

   Deliberately NOT under `orion-controlled`. That directory is Orion's own
   state -- his ledger, his reminders, his remote inbox -- and `orion-authority`
   classifies writes there as `orion_state`, which is AUTO. Keeping the grants
   that authorize him inside the directory he owns would make the boundary
   decorative. Kept in step with `defaultGateRoot()` in the plugin's index.ts.
  */
  gate: join(HOME, ".openclaw/orion-gate"),
  strictness: join(HOME, ".openclaw/orion-gate/strictness.json"),
  gateApprovals: join(HOME, ".openclaw/orion-gate/approvals"),
};

/* ------------------------------------------------------------ plugin loading */

/*
 The INSTALLED plugin is the truth: that is the code the daemon loads. The built
 copy on the Desktop is only a candidate. Falling back to it is better than
 failing outright, but the caller is told which one it got so it can say so.

 `permissions.js` is a leaf module -- its only import from the plugin is a
 type-only `CapabilityTier`, erased at compile time -- so importing it here
 costs nothing and registers nothing with the host.
*/
export async function loadPlugin() {
  const failures = [];
  for (const dist of [PATHS.installed, PATHS.built]) {
    try {
      const catalog = await import(join(dist, "catalog.js"));
      const permissions = await import(join(dist, "permissions.js"));
      // Both leaf modules, same as `permissions.js`: they import types and
      // node builtins only, so loading them here registers nothing with the
      // host and cannot start a plugin.
      const approvals = await import(join(dist, "approvals.js"));
      const strictness = await import(join(dist, "strictness.js"));
      const automation = await import(join(dist, "automation.js"));
      const explain = await import(join(dist, "explain.js"));
      const index = await readFile(join(dist, "index.js"), "utf8");
      return { catalog, permissions, approvals, strictness, automation, explain, index, dist };
    } catch (error) {
      failures.push(`${dist}: ${error.message}`);
    }
  }
  throw new Error(
    `no built plugin found.\n  ${failures.join("\n  ")}`,
  );
}

export async function deployDrift() {
  const read = (dir) => readFile(join(dir, "catalog.js"), "utf8").catch(() => null);
  const [installed, built] = await Promise.all([read(PATHS.installed), read(PATHS.built)]);
  return Boolean(installed && built && installed !== built);
}

/* ------------------------------------------------------- tier availability */

const pascal = (tier) =>
  tier.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join("");

/*
 Which config flag turns a tier on, worked out from the tier's own name rather
 than copied out of index.ts -- a copy is a second source of truth and would rot
 the first time a tier is added. Both spellings the plugin actually uses are
 tried (`reminders` is switched by `enableReminderActions`), and the winner has
 to appear verbatim in the compiled plugin or it is not a real flag.
*/
export function resolveFlag(tier, indexSource) {
  const stem = pascal(tier);
  const candidates = [`enable${stem}Actions`];
  if (stem.endsWith("s")) candidates.push(`enable${stem.slice(0, -1)}Actions`);
  return candidates.find((name) => indexSource.includes(name));
}

/*
 A tier is reachable only where the config flag AND the permission profile both
 say yes -- `intersectTiers` in the plugin. Desktop-rooted tiers additionally
 need `desktopRoot` set, and that dependency is read off the catalog (does any
 action in the tier address the Desktop?) rather than hardcoded.

 `unresolved` is the important field. A tier whose flag cannot be found in the
 compiled plugin is NOT quietly reported as off -- that is precisely the bug
 this module was extracted to kill. It is flagged, and callers are expected to
 make noise about it. See `unresolvedTiers` below.
*/
export function tierAvailability({ catalog, permissions, index }, config, profile) {
  const allowed = permissions.profileAllowedTiers(profile);
  if (!allowed) {
    throw new Error(`unknown permission profile '${profile}'`);
  }
  const desktopTiers = new Set(
    Object.values(catalog.ACTION_CATALOG)
      .filter((definition) => definition.execution.root === "desktop")
      .map((definition) => definition.capabilityTier),
  );
  const tiers = new Map();
  for (const definition of Object.values(catalog.ACTION_CATALOG)) {
    const tier = definition.capabilityTier;
    if (tiers.has(tier)) continue;
    const flag = tier === "simulation" ? null : resolveFlag(tier, index);
    const unresolved = tier !== "simulation" && flag === undefined;
    const needsRoot = desktopTiers.has(tier);
    const configOn =
      tier === "simulation" ||
      (!unresolved && config[flag] === true && (!needsRoot || Boolean(config.desktopRoot)));
    const profileOn = allowed.has(tier);
    tiers.set(tier, {
      tier,
      flag,
      unresolved,
      configOn,
      profileOn,
      needsRoot,
      available: configOn && profileOn,
    });
  }
  return tiers;
}

/** Tiers whose config flag could not be found in the installed plugin. */
export const unresolvedTiers = (availability) =>
  [...availability.values()].filter((entry) => entry.unresolved);

/* -------------------------------------------------------------- the inputs */

export async function readJson(path, what) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read ${what} at ${path}: ${error.message}`);
  }
}

export async function readOrionConfig(path = PATHS.config) {
  const file = await readJson(path, "openclaw.json");
  return {
    file,
    orion: file.plugins?.entries?.["orion-control"]?.config ?? {},
  };
}

export async function readProfile(path = PATHS.state) {
  const state = await readJson(path, "permission-state.json").catch(() => null);
  return state?.profile ?? "restricted_read_only";
}

/* -------------------------------------------------- allowlist canonicalising */

/*
 `~/Desktop/ORION/scripts/orion-recall` and
 `/Users/nickmadaio/Desktop/ORION/scripts/orion-recall` are the same capability.
 The exec-approvals file happily holds both -- approving a command Orion spelled
 with a tilde appends the tilde spelling next to the absolute one already there
 -- and every consumer that keyed off the raw pattern string therefore saw two.

 That was never merely cosmetic. The tilde spelling is not a readable path, so
 `orion-authority` could not load the script's source for it, fell through to
 its fail-closed branch, and published a SECOND row for the same script at
 APPROVAL. Orion's own authority map thus said `orion-recall` was both automatic
 and needed permission, and `explain` read the contradiction out loud.

 So: expand `~`, resolve, and follow symlinks where the file exists. Entries
 that land on the same real file collapse into one, keeping every spelling for
 display.
*/
export function expandHome(value) {
  if (value === "~") return HOME;
  if (value.startsWith("~/")) return join(HOME, value.slice(2));
  return value;
}

/** The stable identity of an allowlist pattern: a real path, or the bare name. */
export async function canonicalPattern(pattern) {
  const expanded = expandHome(pattern);
  if (!expanded.includes("/")) return { key: expanded, path: null, name: expanded };
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(PATHS.scripts, expanded);
  const real = await realpath(absolute).catch(() => absolute);
  return { key: real, path: real, name: basename(real) };
}

/*
 Every command Orion could name, collapsed to one entry per real file.

 `spellings` is what the allowlist literally contains; `allowlisted` is whether
 ANY spelling of this file is on it. Scripts on disk that are not allowlisted
 are included deliberately, so `check` can explain why they are unreachable
 rather than claiming they do not exist.
*/
export async function collectCommands(approvals, scriptsDir = PATHS.scripts) {
  const entries = approvals.agents?.main?.allowlist ?? [];
  const commands = new Map();

  const upsert = (canonical, { spelling = null, allowlisted = false }) => {
    const existing = commands.get(canonical.key);
    if (existing) {
      if (spelling && !existing.spellings.includes(spelling)) existing.spellings.push(spelling);
      existing.allowlisted = existing.allowlisted || allowlisted;
      return existing;
    }
    const created = {
      key: canonical.key,
      name: canonical.name,
      path: canonical.path,
      pattern: spelling ?? canonical.key,
      spellings: spelling ? [spelling] : [],
      allowlisted,
      source: null,
    };
    commands.set(canonical.key, created);
    return created;
  };

  for (const entry of entries) {
    const spelling = String(entry?.pattern ?? "");
    if (!spelling) continue;
    upsert(await canonicalPattern(spelling), { spelling, allowlisted: true });
  }

  for (const file of await readdir(scriptsDir).catch(() => [])) {
    if (!file.startsWith("orion-") || file.includes(".")) continue;
    upsert(await canonicalPattern(join(scriptsDir, file)), {});
  }

  for (const command of commands.values()) {
    // Prefer an absolute spelling for display; a tilde reads fine but cannot be
    // handed to anything that opens files.
    command.pattern = command.spellings.find((s) => isAbsolute(s)) ?? command.spellings[0] ?? command.key;
    command.spellings.sort();
    if (command.path) {
      command.source = await readFile(command.path, "utf8").catch(() => null);
    }
  }

  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/*
 The allowlisted wrapper scripts, deduplicated, by bare name. Used for the
 "commands you run through exec" section of TOOLS.md, which used to list every
 wrapper twice for the same tilde-versus-absolute reason.
*/
export async function allowlistedWrapperNames(approvals, scriptsDir = PATHS.scripts) {
  const commands = await collectCommands(approvals, scriptsDir);
  return commands
    .filter((command) => command.allowlisted && command.name.startsWith("orion-"))
    .map((command) => command.name)
    .sort();
}
