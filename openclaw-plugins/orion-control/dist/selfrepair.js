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
export const FORBIDDEN_CONFIG = [
    {
        // Not an authority question — a secret-handling one. Orion writing a
        // credential means Orion holding a credential in a tool argument, in the
        // ledger, and in a transcript.
        pattern: /(?:^|\.)(?:apikey|token|secret|password|credential)s?(?:\.|$)/i,
        reason: "that is a credential. Orion never writes credentials — set it yourself with `openclaw config set`, or through `openclaw configure`",
    },
    {
        // Reaches the network surface of the gateway itself (bind address,
        // Tailscale, auth mode). A repair loop is the wrong place for it.
        pattern: /^gateway\./,
        reason: "that changes how the gateway is reachable on the network. Change it yourself with `openclaw config set`",
    },
    {
        // `command` and `args` under a TTS provider are spawned. Writing them is
        // arbitrary command execution wearing a settings hat.
        pattern: /^(?:talk|messages\.tts)\.providers\.[^.]+\.(?:command|args)$/,
        reason: "that is a command Orion would then run. Change it yourself with `openclaw config set`",
    },
    {
        // Where the audit and the permission state live. Redirecting the record of
        // a change is a way of making the change unrecorded.
        // `approvalRoot` and `strictnessStatePath` were added 2026-09-02 and belong
        // here more than anything else on the line: redirecting the grant directory
        // at a path Orion CAN write turns the approval gate into a formality
        // without touching a capability flag, which is exactly the shape of
        // widening this pattern exists to refuse.
        pattern: /^plugins\.entries\.orion-control\.config\.(?:permissionStatePath|permissionAuditPath|approvalRoot|strictnessStatePath|ledgerPath|workshopPath|desktopRoot|homeRoot|testWorkspaceRoot|scratchWorkspaceRoot|healthLogPath|remindersPath)$/,
        reason: "that moves where Orion's audit trail or his filesystem roots live, which is a way of widening reach without touching a capability flag. Change it yourself with `openclaw config set`",
    },
    {
        pattern: /^agents\.defaults\.workspace$/,
        reason: "that moves the agent workspace, which is where memory lives. Change it yourself with `openclaw config set`",
    },
];
/**
 * Behaviour tuning. Every one of these changes how well Orion works and none of
 * them changes what he is permitted to do, which is the whole test for this
 * table. Ranges are enforced, so "set my timeout to a day" is refused here
 * rather than discovered later.
 */
export const OPERATIONAL_CONFIG = {
    "talk.silenceTimeoutMs": {
        kind: "integer",
        min: 400,
        max: 20000,
        description: "How long Orion waits in silence before deciding a spoken turn is over.",
    },
    "talk.interruptOnSpeech": {
        kind: "boolean",
        description: "Whether speaking over Orion stops him mid-sentence.",
    },
    "talk.provider": {
        kind: "enum",
        values: ["tts-local-cli", "system", "mlx"],
        description: "Which configured voice Orion speaks with.",
    },
    "talk.providers.tts-local-cli.timeoutMs": {
        kind: "integer",
        min: 1000,
        max: 60000,
        description: "How long the local TTS call may take before Orion gives up.",
    },
    "talk.providers.tts-local-cli.env.ORION_TTS_SPEED": {
        kind: "numeric_string",
        min: 0.5,
        max: 2,
        description: "Speaking rate multiplier.",
    },
    "talk.providers.tts-local-cli.env.ORION_TTS_VOICE": {
        kind: "enum",
        values: ["conversational_a", "conversational_b", "expressive_a"],
        description: "Which voice the local TTS daemon renders.",
    },
    "talk.providers.tts-local-cli.env.ORION_TTS_CLIENT_BUDGET_MS": {
        kind: "numeric_string",
        min: 1000,
        max: 30000,
        description: "How long the TTS client waits on the daemon socket.",
    },
    "messages.tts.providers.tts-local-cli.timeoutMs": {
        kind: "integer",
        min: 1000,
        max: 60000,
        description: "The same TTS timeout, on the message-reading path.",
    },
    "messages.tts.providers.tts-local-cli.env.ORION_TTS_SPEED": {
        kind: "numeric_string",
        min: 0.5,
        max: 2,
        description: "Speaking rate multiplier when reading messages aloud.",
    },
    "messages.tts.providers.tts-local-cli.env.ORION_TTS_VOICE": {
        kind: "enum",
        values: ["conversational_a", "conversational_b", "expressive_a"],
        description: "Voice used when reading messages aloud.",
    },
    "agents.defaults.model.primary": {
        kind: "model_id",
        description: "The model Orion thinks with. Restricted to providers already configured.",
    },
    "agents.defaults.model.fallbacks": {
        kind: "model_id_array",
        max: 6,
        description: "Ordered fallbacks when the primary model is unavailable.",
    },
    "agents.defaults.utilityModel": {
        kind: "model_id",
        description: "The small model used for summaries and routing.",
    },
    "agents.defaults.timeoutSeconds": {
        kind: "integer",
        min: 30,
        max: 3600,
        description: "How long one agent turn may run.",
    },
    "agents.defaults.thinkingDefault": {
        kind: "enum",
        values: ["off", "on", "auto"],
        description: "Whether Orion thinks before answering by default.",
    },
    "agents.defaults.experimental.localModelLean": {
        kind: "boolean",
        description: "Trim the prompt for small local models.",
    },
    "agents.defaults.memorySearch.enabled": {
        kind: "boolean",
        description: "Whether Orion searches his memory index before answering.",
    },
};
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
export const AUTHORITY_CONFIG = [
    {
        pattern: /^plugins\.entries\.orion-control\.config\.enable[A-Za-z]+Actions$/,
        kind: "boolean",
        description: "one of Orion's own capability switches",
    },
    {
        pattern: /^tools\.exec\.ask$/,
        kind: "enum",
        values: ["off", "on", "always"],
        description: "whether an unapproved command prompts instead of denying",
    },
    {
        pattern: /^tools\.exec\.security$/,
        kind: "enum",
        values: ["allowlist", "strict", "off"],
        description: "how commands Orion runs are policed",
    },
    {
        pattern: /^tools\.(?:deny|alsoAllow)$/,
        kind: "string_array",
        description: "which host tools Orion may or may not call",
    },
    {
        pattern: /^plugins\.allow$/,
        kind: "string_array",
        description: "which plugins may load at all",
    },
    {
        pattern: /^plugins\.bundledDiscovery$/,
        kind: "enum",
        values: ["compat", "off", "all"],
        description: "whether bundled plugins are discovered automatically",
    },
    {
        pattern: /^plugins\.entries\.[A-Za-z0-9_.-]+\.enabled$/,
        kind: "boolean",
        description: "whether a whole plugin is switched on",
    },
    {
        pattern: /^skills\.entries\.[A-Za-z0-9_.-]+\.enabled$/,
        kind: "boolean",
        description: "whether a skill — and the commands it carries — is switched on",
    },
];
/**
 * Plugin sources that hold no authority decision and execute no effect.
 *
 * Short on purpose. Every other file in `src/` either decides what Orion may do
 * or is the thing that does it, and a file that can call `writeFile` can reach
 * the permission state whatever its name suggests. Those are not forbidden —
 * Nick can ask for them — but they are not silent-repair material.
 */
export const OPERATIONAL_PLUGIN_FILES = [
    "ambient.ts",
    "health.ts",
    "ledger.ts",
    "workshop.ts",
];
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
export const AUTHORITY_PLUGIN_FILES = [
    // The two halves of the gate added 2026-09-02. `approvals.ts` decides
    // whether a person said yes; `strictness.ts` decides how often one has to be
    // asked. `gate.test.ts` is here for the same reason `index.test.ts` is: the
    // adversarial cases ARE the proof, and a change that deletes its own proof
    // should require Nick to have asked for it.
    "approvals.ts",
    // The two capability surfaces added for Phases 51 and 57. `devops.ts` holds
    // the repository table and the fixed argv; `automation.ts` holds the closed
    // action table a scheduled job may draw from. Both decide what Orion may
    // reach, which is the test for this list.
    "automation.ts",
    "catalog.ts",
    "controller.ts",
    "devops.ts",
    "executors.ts",
    "gate.test.ts",
    "index.test.ts",
    "index.ts",
    "permissions.ts",
    "provenance.ts",
    "selfrepair.ts",
    "strictness.ts",
    "transcript.ts",
    "types.ts",
    "validator.ts",
];
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
export const ENFORCEMENT_PLUGIN_FILES = [
    "approvals.ts",
    "catalog.ts",
    "controller.ts",
    "index.ts",
    "permissions.ts",
    "provenance.ts",
    "selfrepair.ts",
    "strictness.ts",
    "transcript.ts",
    "validator.ts",
];
/** Wrapper scripts with no authority surface: repairable under the ordinary gate. */
export const OPERATIONAL_SCRIPTS = [
    "orion-agenda",
    "orion-bench",
    "orion-daily",
    "orion-focus",
    "orion-learn",
    "orion-mic-doctor",
    "orion-mission",
    "orion-recall",
    "orion-session",
    "orion-standing",
    "orion-trace",
    "orion-weather-alert",
];
/**
 * Refused outright, and the reason has to be said out loud rather than implied.
 *
 * `orion-repair` is the engine that enforces every rule in this file. Asked to
 * check an edit to itself it would be using the code under test as the test, so
 * it refuses and says which file a human has to open.
 */
export const FORBIDDEN_SCRIPTS = {
    "orion-repair": "that is the repair engine itself — it cannot vouch for a change to its own gates. Edit ~/Desktop/ORION/scripts/orion-repair by hand",
    "orion-forge": "that is the Swift self-modification engine and its three gates. Edit ~/Desktop/ORION/scripts/orion-forge by hand",
    /*
     The two scripts that represent Nick rather than Orion.
  
     `orion-approve` is the act of a person saying yes; `orion-mode` is the act
     of a person deciding how often that has to happen. A repair engine that
     could edit either would be able to arrange its own approvals, and the same
     argument that keeps `orion-repair` off this list keeps these off it: the
     thing that vouches for a change cannot vouch for a change to itself.
  
     Neither is on the exec allowlist either. That is the enforcement; this
     entry is what makes the refusal say why.
    */
    "orion-approve": "that is how Nick says yes. Orion editing it would be Orion arranging his own approvals. Edit ~/Desktop/ORION/scripts/orion-approve by hand",
    "orion-mode": "that is how Nick sets how much Orion has to ask. Edit ~/Desktop/ORION/scripts/orion-mode by hand",
    "orion-automation": "that is the only thing that can schedule an automation, and you may propose but never install. Edit ~/Desktop/ORION/scripts/orion-automation by hand",
};
const PLUGIN_FILE_NAME = /^[A-Za-z0-9_.-]+\.ts$/;
const SCRIPT_NAME = /^orion-[a-z0-9][a-z0-9-]*$/;
/**
 * Refuse anything that is not a bare name.
 *
 * The engine resolves against a fixed directory and compares realpaths, so this
 * is the second of two checks rather than the only one — but it is the cheap one
 * and it is the one whose message Orion can read back. `../`, an absolute path,
 * a symlink name and a NUL all die here.
 */
export function isBareName(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        value.length <= 96 &&
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        !value.startsWith(".") &&
        value !== "." &&
        value !== "..");
}
export function classifyPluginFile(file) {
    if (!isBareName(file) || !PLUGIN_FILE_NAME.test(file)) {
        return {
            klass: "forbidden",
            reason: "file must be a bare TypeScript filename from self_plugin_list, such as ambient.ts",
        };
    }
    if (OPERATIONAL_PLUGIN_FILES.includes(file))
        return { klass: "operational" };
    if (AUTHORITY_PLUGIN_FILES.includes(file))
        return { klass: "authority" };
    return {
        klass: "forbidden",
        reason: `'${file}' is not a plugin source Orion knows about. Run self_plugin_list to see what is editable`,
    };
}
export function classifyScript(name) {
    if (!isBareName(name) || !SCRIPT_NAME.test(name)) {
        return {
            klass: "forbidden",
            reason: "script must be a bare wrapper name from self_script_list, such as orion-agenda",
        };
    }
    const forbidden = FORBIDDEN_SCRIPTS[name];
    if (forbidden)
        return { klass: "forbidden", reason: forbidden };
    if (OPERATIONAL_SCRIPTS.includes(name))
        return { klass: "operational" };
    // Fail closed but not fail shut: a wrapper nobody has classified is treated
    // as authority-bearing, so it is reachable only when Nick names it.
    return { klass: "authority" };
}
export function classifyConfigPath(path) {
    if (typeof path !== "string" ||
        path.length === 0 ||
        path.length > 200 ||
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(path) ||
        path.includes("..")) {
        return {
            klass: "forbidden",
            reason: "key must be a dot path such as talk.silenceTimeoutMs",
        };
    }
    for (const entry of FORBIDDEN_CONFIG) {
        if (entry.pattern.test(path)) {
            return { klass: "forbidden", reason: entry.reason };
        }
    }
    const operational = OPERATIONAL_CONFIG[path];
    if (operational)
        return { klass: "operational", setting: operational };
    for (const entry of AUTHORITY_CONFIG) {
        if (entry.pattern.test(path)) {
            return {
                klass: "authority",
                setting: {
                    kind: entry.kind,
                    ...(entry.values ? { values: entry.values } : {}),
                    description: entry.description,
                },
            };
        }
    }
    return {
        klass: "forbidden",
        reason: `'${path}' is not a setting Orion can change. Run self_config_list to see the ones he can, and set anything else yourself with \`openclaw config set ${path} <value>\``,
    };
}
/**
 * Does the change to this plugin file have to prove the gate still works?
 */
export function requiresGateSelfTest(file) {
    return ENFORCEMENT_PLUGIN_FILES.includes(file);
}
/** `provider/model`, where the provider half has to already exist in the config. */
const MODEL_ID = /^[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9._:-]{1,80}$/;
const NUMERIC = /^[0-9]+(?:\.[0-9]+)?$/;
const TOOL_NAME = /^[A-Za-z0-9_:.-]{1,64}$/;
/**
 * Range- and shape-check a value before anything writes it.
 *
 * `openclaw config set` validates against the schema and would catch a type
 * error on its own, but the schema does not know that a two-second endpointing
 * delay makes Orion unusable or that a model id naming a provider with no
 * credentials makes him mute. Refusing here means the refusal arrives as a
 * sentence Orion can read out, before the file is touched.
 */
export function validateConfigValue(setting, value) {
    const range = (n) => (setting.min !== undefined && n < setting.min) ||
        (setting.max !== undefined && n > setting.max)
        ? [
            `value must be between ${setting.min ?? "any"} and ${setting.max ?? "any"}`,
        ]
        : [];
    switch (setting.kind) {
        case "boolean":
            return typeof value === "boolean" ? [] : ["value must be true or false"];
        case "integer":
            return typeof value === "number" && Number.isInteger(value)
                ? range(value)
                : ["value must be a whole number"];
        case "enum":
            return typeof value === "string" && (setting.values ?? []).includes(value)
                ? []
                : [`value must be one of: ${(setting.values ?? []).join(", ")}`];
        case "numeric_string":
            if (typeof value !== "string" || !NUMERIC.test(value)) {
                return ["value must be a number written as a string, such as \"1.0\""];
            }
            return range(Number(value));
        case "model_id":
            return typeof value === "string" && MODEL_ID.test(value)
                ? []
                : ["value must be a model id such as anthropic/claude-haiku-4-5-20251001"];
        case "model_id_array":
            if (!Array.isArray(value))
                return ["value must be a list of model ids"];
            if (setting.max !== undefined && value.length > setting.max) {
                return [`value must hold at most ${setting.max} entries`];
            }
            return value.every((entry) => typeof entry === "string" && MODEL_ID.test(entry))
                ? []
                : ["every entry must be a model id such as ollama/llama3.2:3b"];
        case "string_array":
            if (!Array.isArray(value))
                return ["value must be a list of names"];
            if (value.length > 64)
                return ["value must hold at most 64 entries"];
            return value.every((entry) => typeof entry === "string" && TOOL_NAME.test(entry))
                ? []
                : ["every entry must be a plain tool or plugin name"];
        default:
            return ["value has no validation rule, so it is refused"];
    }
}
