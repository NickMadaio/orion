/**
 * What Orion may repair about himself, and which of those repairs count as
 * asking for more authority.
 *
 * Orion could already rewrite his own Swift and reinstall himself. He could not
 * touch the three things that actually break: the plugin that gives him his
 * tools, the wrapper scripts he runs, and the OpenClaw config underneath both.
 * Asked to fix a misconfiguration he correctly answered that he could not, which
 * is an honest answer to a missing capability rather than a safe one.
 *
 * THE RULE THIS FILE ENCODES
 *
 * Nick's rule is not "Orion may never widen his own permissions". It is:
 *
 *     he can grant authority as long as I ASK.
 *
 * That is a better rule than a blanket denylist, because a denylist has to
 * predict every path to authority and is wrong the first time one is added. So
 * every repairable thing is sorted into exactly one of three classes, and the
 * class decides which gate it goes through:
 *
 *   OPERATIONAL  changes how well Orion does what he already does. His voice
 *                timing, his model, his own log writer. Goes through the
 *                ordinary gate: real user turn, tier enabled, arguments valid.
 *
 *   AUTHORITY    changes what Orion is ALLOWED to do, or changes the code that
 *                decides that. Capability flags, the exec policy, the plugin
 *                allowlist, and every source file on the enforcement path.
 *                Reachable, but only when Nick named the exact thing himself,
 *                said something about permission, and approved the bound
 *                arguments. See `AUTHORITY_INSTRUCTION` below.
 *
 *   FORBIDDEN    refused whatever anyone says, because the mechanism that would
 *                have to vouch for the change is the thing being changed, or
 *                because it is a credential and Orion should never be the one
 *                handling it. Three narrow entries, each with its reason.
 *
 * Unlisted is not a fourth class. Anything that matches nothing here is
 * refused — the tables below are allowlists, and a repair surface nobody has
 * thought about is not one Orion gets by default.
 *
 * WHY THE TABLES ARE HERE AND ALSO IN `scripts/orion-repair`
 *
 * They are not. The engine enforces its own copy of the same rules because it
 * has to be safe when run directly, but the two are checked against each other
 * by `orion-repair policy-check`, which the test suite runs. A second source of
 * truth is only a lie if nothing compares them.
 */
/** Dot-path families that are refused no matter who asks, and why. */
export declare const FORBIDDEN_CONFIG: readonly {
    pattern: RegExp;
    reason: string;
}[];
export type ConfigValueKind = "boolean" | "integer" | "enum" | "model_id" | "model_id_array" | "string_array" | "numeric_string";
export interface ConfigSetting {
    kind: ConfigValueKind;
    min?: number;
    max?: number;
    values?: readonly string[];
    description: string;
}
/**
 * Behaviour tuning. Every one of these changes how well Orion works and none of
 * them changes what he is permitted to do, which is the whole test for this
 * table. Ranges are enforced, so "set my timeout to a day" is refused here
 * rather than discovered later.
 */
export declare const OPERATIONAL_CONFIG: Readonly<Record<string, ConfigSetting>>;
/**
 * The switches that decide what Orion may do.
 *
 * Reachable — this is the half of Nick's rule that the old design got wrong —
 * but only through `self_config_authority_set`, which demands that Nick named
 * the key himself, said something about permission, and approved the exact
 * arguments.
 *
 * Patterns rather than exact paths, because these are families: there is one
 * `enable*Actions` flag per capability tier and a new tier must not arrive
 * unprotected simply because nobody remembered to add its flag here.
 */
export declare const AUTHORITY_CONFIG: readonly {
    pattern: RegExp;
    kind: ConfigValueKind;
    values?: readonly string[];
    description: string;
}[];
/**
 * Plugin sources that hold no authority decision and execute no effect.
 *
 * Short on purpose. Every other file in `src/` either decides what Orion may do
 * or is the thing that does it, and a file that can call `writeFile` can reach
 * the permission state whatever its name suggests. Those are not forbidden —
 * Nick can ask for them — but they are not silent-repair material.
 */
export declare const OPERATIONAL_PLUGIN_FILES: readonly string[];
/**
 * The enforcement path plus everything that executes an effect.
 *
 * `executors.ts` is in here rather than in the operational list even though it
 * holds no policy, and that is deliberate: it is the file that actually spawns
 * processes and writes files, so an edit to it is an edit to what "refused"
 * means in practice. `index.test.ts` is here too, because the adversarial tests
 * ARE the proof that the gates hold, and a change that deletes its own proof
 * should require Nick to have asked for it.
 */
export declare const AUTHORITY_PLUGIN_FILES: readonly string[];
/**
 * Files whose change forces the gate self-test.
 *
 * A capability grant is scoped and reversible. An edit that breaks the
 * `trusted_user` check is neither: it removes the requirement to ask, including
 * the requirement that would have made the next such edit ask. So a change to
 * any of these has to prove, after it is built, that a forged anchor, an absent
 * anchor and a tainted target are all still refused — or it is rolled back.
 *
 * Every file that participates in deciding whether a step runs.
 */
export declare const ENFORCEMENT_PLUGIN_FILES: readonly string[];
/** Wrapper scripts with no authority surface: repairable under the ordinary gate. */
export declare const OPERATIONAL_SCRIPTS: readonly string[];
/**
 * Refused outright, and the reason has to be said out loud rather than implied.
 *
 * `orion-repair` is the engine that enforces every rule in this file. Asked to
 * check an edit to itself it would be using the code under test as the test, so
 * it refuses and says which file a human has to open.
 */
export declare const FORBIDDEN_SCRIPTS: Readonly<Record<string, string>>;
export type RepairClass = "operational" | "authority" | "forbidden";
export interface RepairDecision {
    klass: RepairClass;
    /** Present when refused: a sentence Orion can read out to Nick verbatim. */
    reason?: string;
    /** Present for a config path: how the value is checked. */
    setting?: ConfigSetting;
}
/**
 * Refuse anything that is not a bare name.
 *
 * The engine resolves against a fixed directory and compares realpaths, so this
 * is the second of two checks rather than the only one — but it is the cheap one
 * and it is the one whose message Orion can read back. `../`, an absolute path,
 * a symlink name and a NUL all die here.
 */
export declare function isBareName(value: unknown): value is string;
export declare function classifyPluginFile(file: unknown): RepairDecision;
export declare function classifyScript(name: unknown): RepairDecision;
export declare function classifyConfigPath(path: unknown): RepairDecision;
/**
 * Does the change to this plugin file have to prove the gate still works?
 */
export declare function requiresGateSelfTest(file: string): boolean;
/**
 * Range- and shape-check a value before anything writes it.
 *
 * `openclaw config set` validates against the schema and would catch a type
 * error on its own, but the schema does not know that a two-second endpointing
 * delay makes Orion unusable or that a model id naming a provider with no
 * credentials makes him mute. Refusing here means the refusal arrives as a
 * sentence Orion can read out, before the file is touched.
 */
export declare function validateConfigValue(setting: ConfigSetting, value: unknown): string[];
