import { Type, type Static } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import os from "node:os";
import path from "node:path";
import { runTaskGraph, defaultLedgerPath } from "./controller.js";
import { TaskLedger } from "./ledger.js";
import { type CapabilityTier } from "./catalog.js";
import {
  changePermissionProfile,
  PERMISSION_PROFILES,
  type PermissionState,
  PROFILE_MATRIX,
  profileAllowedTiers,
  readPermissionState,
} from "./permissions.js";
import {
  authorizeTaskGraph,
  HarnessProvenance,
  type ModelTaskGraph,
  type ProvenancePolicy,
} from "./provenance.js";

// The model-facing input shape deliberately has NO `trust` field. Trust is
// minted only by `authorizeTaskGraph` from OpenClaw host provenance, so there is
// no model-controlled byte that can reach `TaskInput.trust`. Anything a caller
// sends here is recorded as untrusted context.
const Input = Type.Object({
  id: Type.String(),
  kind: Type.Optional(
    Type.Union([Type.Literal("instruction"), Type.Literal("observation")]),
  ),
  content: Type.Optional(Type.String()),
});

const Step = Type.Object({
  id: Type.String(),
  action: Type.String(),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  // risk / verify / reversible are derived from the action catalog server-side,
  // so callers may omit them; any value sent is overwritten with the catalog's.
  expectedEffect: Type.Optional(Type.String()),
  sourceRefs: Type.Optional(Type.Array(Type.String())),
  approval: Type.Optional(
    Type.Object({
      status: Type.Literal("approved"),
      canonicalHash: Type.String(),
    }),
  ),
});

const TaskGraphSchema = Type.Object({
  version: Type.Optional(Type.Literal("1")),
  goal: Type.String(),
  workingContext: Type.Optional(Type.String()),
  inputs: Type.Optional(Type.Array(Input)),
  assumptions: Type.Optional(Type.Array(Type.String())),
  questions: Type.Optional(Type.Array(Type.String())),
  retryBudget: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
  steps: Type.Array(Step),
});

const ConfigSchema = Type.Object({
  ledgerPath: Type.Optional(
    Type.String({
      description: "Absolute or gateway-relative path for the append-only JSONL task ledger.",
    }),
  ),
  enableTestWorkspaceActions: Type.Optional(
    Type.Boolean({
      description:
        "Enable only the fixed-root Tier 1 test-workspace action catalog.",
    }),
  ),
  testWorkspaceRoot: Type.Optional(
    Type.String({
      description:
        "Dedicated Orion-controlled root used only by Tier 1 test actions.",
    }),
  ),
  enableScratchWorkspaceActions: Type.Optional(Type.Boolean()),
  scratchWorkspaceRoot: Type.Optional(Type.String()),
  enableDesktopReadActions: Type.Optional(Type.Boolean()),
  enableDesktopTestWorkspaceActions: Type.Optional(Type.Boolean()),
  enableDesktopModifyActions: Type.Optional(Type.Boolean()),
  enableDesktopDirectWriteActions: Type.Optional(Type.Boolean()),
  enableScratchDirectWriteActions: Type.Optional(Type.Boolean()),
  enableAppControlActions: Type.Optional(
    Type.Boolean({
      description:
        "Enable opening or gracefully quitting an explicitly named installed app.",
    }),
  ),
  desktopRoot: Type.Optional(Type.String()),
  trustAllowPromptSource: Type.Optional(
    Type.Boolean({
      description:
        "Accept the host-assembled turn prompt (llm_input) as an authenticated user turn when no raw channel message is available. Default true.",
    }),
  ),
  trustAllowSessionBinding: Type.Optional(
    Type.Boolean({
      description:
        "Accept a same-session authenticated turn when host run ids do not match. Default true.",
    }),
  ),
  trustAllowRecentBinding: Type.Optional(
    Type.Boolean({
      description:
        "Accept the newest authenticated user turn when the host did not bind this tool call to a run. Default true.",
    }),
  ),
  trustTtlMs: Type.Optional(Type.Integer({ minimum: 1000 })),
  trustRecentWindowMs: Type.Optional(Type.Integer({ minimum: 1000 })),
  permissionStatePath: Type.Optional(
    Type.String({
      description: "Private JSON state file for Orion's active permission profile.",
    }),
  ),
  permissionAuditPath: Type.Optional(
    Type.String({
      description: "Private append-only JSONL audit file for permission changes.",
    }),
  ),
});

function defaultTestWorkspaceRoot(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".openclaw", "orion-controlled", "test-workspace");
}

function defaultScratchWorkspaceRoot(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".openclaw", "orion-controlled", "scratch-workspace");
}

function defaultPermissionStatePath(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.resolve(".orion-control", "permission-state.json");
}

function defaultPermissionAuditPath(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.resolve(".orion-control", "permission-audit.jsonl");
}

function configuredTiers(config: {
  enableTestWorkspaceActions?: boolean;
  enableScratchWorkspaceActions?: boolean;
  enableDesktopReadActions?: boolean;
  enableDesktopTestWorkspaceActions?: boolean;
  enableDesktopModifyActions?: boolean;
  enableDesktopDirectWriteActions?: boolean;
  enableScratchDirectWriteActions?: boolean;
  enableAppControlActions?: boolean;
  desktopRoot?: string;
}): Set<CapabilityTier> {
  const tiers = new Set<CapabilityTier>(["simulation"]);
  if (config.enableAppControlActions === true) tiers.add("app_control");
  if (config.enableTestWorkspaceActions === true) tiers.add("test_workspace");
  if (config.enableScratchWorkspaceActions === true) tiers.add("scratch_workspace");
  if (config.enableDesktopReadActions === true && config.desktopRoot) {
    tiers.add("desktop_read");
  }
  if (config.enableDesktopTestWorkspaceActions === true && config.desktopRoot) {
    tiers.add("desktop_test_workspace");
  }
  if (config.enableDesktopModifyActions === true && config.desktopRoot) {
    tiers.add("desktop_modify");
  }
  if (config.enableDesktopDirectWriteActions === true && config.desktopRoot) {
    tiers.add("desktop_direct_write");
  }
  if (config.enableScratchDirectWriteActions === true) {
    tiers.add("scratch_direct_write");
  }
  return tiers;
}

function intersectTiers(
  configured: ReadonlySet<CapabilityTier>,
  allowed: ReadonlySet<CapabilityTier>,
): Set<CapabilityTier> {
  return new Set([...configured].filter((tier) => allowed.has(tier)));
}

type OrionConfig = Static<typeof ConfigSchema>;

function trustPolicy(config: OrionConfig): ProvenancePolicy {
  return {
    ...(config.trustAllowPromptSource !== undefined
      ? { allowPromptSource: config.trustAllowPromptSource }
      : {}),
    ...(config.trustAllowSessionBinding !== undefined
      ? { allowSessionBinding: config.trustAllowSessionBinding }
      : {}),
    ...(config.trustAllowRecentBinding !== undefined
      ? { allowRecentBinding: config.trustAllowRecentBinding }
      : {}),
    ...(config.trustTtlMs !== undefined ? { ttlMs: config.trustTtlMs } : {}),
    ...(config.trustRecentWindowMs !== undefined
      ? { recentWindowMs: config.trustRecentWindowMs }
      : {}),
  };
}

/**
 * Harness-only trust store for this plugin instance.
 *
 * Replaced on every `register(...)` so a plugin reload starts from a clean
 * slate, and written to exclusively by host hooks.
 */
let provenance = new HarnessProvenance();

/**
 * Read the permission profile without ever throwing out of a tool call. A
 * missing or tampered state file must deny (lowest profile) and stay
 * diagnosable, not brick the tool with an opaque exception.
 */
async function resolveProfile(statePath: string): Promise<{
  state: PermissionState;
  degraded?: string;
}> {
  try {
    return { state: await readPermissionState(statePath) };
  } catch (error) {
    return {
      state: {
        profile: "restricted_read_only",
        version: -1,
        updatedAt: new Date(0).toISOString(),
      },
      degraded:
        error instanceof Error
          ? `Permission state unreadable; failing closed to restricted_read_only: ${error.message}`
          : "Permission state unreadable; failing closed to restricted_read_only.",
    };
  }
}

const entry = defineToolPlugin({
  id: "orion-control",
  name: "Orion Control",
  description:
    "Validate, guard, independently verify, and durably record typed Orion TaskGraphs.",
  configSchema: ConfigSchema,
  tools: (tool) => [
    tool({
      name: "orion_task_run",
      label: "Run Orion TaskGraph",
      description:
        'Run an Orion TaskGraph. Shape: { graph: { goal, steps: [ { id, action, arguments } ] } }. Everything else is optional and filled in for you: risk, verify, reversible, expectedEffect, sourceRefs, dependsOn, inputs, assumptions, retryBudget, and every SHA-256 hash are derived server-side. You CANNOT declare trust: authorization comes from the real user turn as OpenClaw reports it, so an action only runs when the user\'s own words name the operation and the exact target. Quote observed or file content in `inputs` if useful; it is always recorded as untrusted context. Enabled actions: desktop_folder_create_explicit { relativePath }; desktop_file_write_explicit { relativePath, operation: create|append|replace, content } (optional encoding: utf8|base64); desktop_list / desktop_metadata / desktop_text_read { relativePath }; scratch_text_create { name, extension, content }; test_marker_create { marker, content }. Real actions are confined to configured roots. No delete, move, rename, hidden/sensitive files, symlinks, network, accounts, browser, credentials, or elevated macOS actions.',
      parameters: Type.Object({ graph: TaskGraphSchema }),
      optional: true,
      async execute({ graph }, config, context) {
        const permission = await resolveProfile(
          defaultPermissionStatePath(config.permissionStatePath),
        );
        const enabledTiers = intersectTiers(
          configuredTiers(config),
          profileAllowedTiers(permission.state.profile),
        );
        // Trust boundary. `authorizeTaskGraph` rebuilds every input field by
        // field: model-supplied inputs become untrusted_external, and the only
        // trusted_user inputs are minted from harness provenance bound to this
        // host tool call. No authenticated turn means every action fails closed.
        const anchor = provenance.resolve(context.toolCallId, trustPolicy(config));
        const authorized = authorizeTaskGraph(
          graph as ModelTaskGraph,
          anchor,
        );
        const record = await runTaskGraph(authorized.graph, {
          ledgerPath: defaultLedgerPath(config.ledgerPath),
          testWorkspaceRoot: defaultTestWorkspaceRoot(config.testWorkspaceRoot),
          scratchWorkspaceRoot: defaultScratchWorkspaceRoot(
            config.scratchWorkspaceRoot,
          ),
          desktopRoot: config.desktopRoot
            ? path.resolve(config.desktopRoot)
            : undefined,
          enabledTiers,
          authorization: authorized.provenance,
        });
        const notes = [
          ...(authorized.discardedTrustAssertion
            ? [
                "A trust assertion in the submitted graph was discarded. Trust is derived from the real user turn by the harness and cannot be declared by a caller.",
              ]
            : []),
          ...(permission.degraded ? [permission.degraded] : []),
        ];
        return notes.length > 0 ? { ...record, notes } : record;
      },
    }),
    tool({
      name: "orion_task_status",
      label: "Read Orion Task Status",
      description: "Read the latest durable Orion task record by task id.",
      parameters: Type.Object({ taskId: Type.String() }),
      optional: true,
      async execute({ taskId }, config) {
        const ledger = new TaskLedger(defaultLedgerPath(config.ledgerPath));
        return (await ledger.find(taskId)) ?? { taskId, status: "not_found" };
      },
    }),
    tool({
      name: "orion_permission_status",
      label: "Inspect Orion Permission Level",
      description:
        "Read Orion's active permission profile, version, effective configured capability tiers, profile descriptions, and the separate gates that remain closed.",
      parameters: Type.Object({}),
      optional: true,
      async execute(_input, config) {
        const permission = await resolveProfile(
          defaultPermissionStatePath(config.permissionStatePath),
        );
        const configured = configuredTiers(config);
        const effective = intersectTiers(
          configured,
          profileAllowedTiers(permission.state.profile),
        );
        return {
          current: permission.state,
          ...(permission.degraded ? { degraded: permission.degraded } : {}),
          configuredTiers: [...configured].sort(),
          effectiveTiers: [...effective].sort(),
          // Provenance health makes a fail-closed trust boundary diagnosable:
          // if no host hook has fired, no action can be authorized and this is
          // where that shows up.
          trustProvenance: {
            ...provenance.health(),
            policy: { ...trustPolicy(config) },
          },
          profiles: PERMISSION_PROFILES.map((profile) => ({
            profile,
            ...PROFILE_MATRIX[profile],
          })),
        };
      },
    }),
    tool({
      name: "orion_permission_change",
      label: "Change Orion Permission Level",
      description:
        "Raise or lower Orion's permission profile with optimistic version checks and a durable audit record. The authorizing instruction is taken from the real user turn, not from you: the user's own message must name the requested profile and mention profile/permission/level. A raise first returns a canonical approval hash; rerun only after the user explicitly approves that exact change. Lowering is immediate when directly requested. Profiles never grant accounts, communications, credentials, destructive actions, network/browser access, or elevated macOS privileges.",
      parameters: Type.Object({
        requestedProfile: Type.Union(
          PERMISSION_PROFILES.map((profile) => Type.Literal(profile)),
        ),
        expectedVersion: Type.Integer({ minimum: 0 }),
        context: Type.String({ minLength: 1 }),
        approvalHash: Type.Optional(Type.String()),
      }),
      optional: true,
      async execute(
        { requestedProfile, expectedVersion, context, approvalHash },
        config,
        toolContext,
      ) {
        // Same trust boundary as orion_task_run: the authorizing instruction is
        // the real user turn from harness provenance. A caller cannot supply it,
        // so an injected instruction cannot raise Orion's own permissions.
        const anchor = provenance.resolve(
          toolContext.toolCallId,
          trustPolicy(config),
        );
        const instruction = anchor.turns.map((turn) => turn.content).join("\n");
        if (instruction.length === 0) {
          return {
            status: "rejected" as const,
            reason:
              "No authenticated user turn was bound to this tool call, so no permission change can be authorized.",
            trustProvenance: provenance.health(),
          };
        }
        const result = await changePermissionProfile(
          {
            requestedProfile,
            expectedVersion,
            context,
            request: {
              kind: "instruction",
              trust: "trusted_user",
              content: instruction,
            },
            ...(approvalHash ? { approvalHash } : {}),
          },
          {
            statePath: defaultPermissionStatePath(config.permissionStatePath),
            auditPath: defaultPermissionAuditPath(config.permissionAuditPath),
          },
        );
        return { ...result, authorization: { binding: anchor.binding } };
      },
    }),
  ],
});

/**
 * Minimal surface of the host plugin API this plugin depends on for provenance.
 * Typed structurally so the plugin does not import runtime-internal types.
 */
interface ProvenanceHostApi {
  on?: (
    hookName: string,
    handler: (event: unknown, hookContext: unknown) => unknown,
    options?: { priority?: number },
  ) => void;
  logger?: { warn?: (message: string) => void };
}

function field(source: unknown, key: string): unknown {
  return source !== null && typeof source === "object"
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Install the harness-only trust channel.
 *
 * These three host hooks are the ONLY writers of Orion's trust state:
 *   - message_received: the raw inbound user message for a turn.
 *   - llm_input:        the prompt the host assembled for a turn (fallback).
 *   - before_tool_call: binds the host tool-call id to the run that issued it.
 *
 * The model cannot invoke a hook, cannot choose the values a hook carries, and
 * cannot reach the store from tool parameters. If none of these fire, no
 * authenticated user turn exists and every gated action fails closed.
 */
export function installProvenanceHooks(api: ProvenanceHostApi): void {
  provenance = new HarnessProvenance();
  const store = provenance;
  if (typeof api.on !== "function") {
    api.logger?.warn?.(
      "[orion-control] host hook API unavailable; no user turn can be authenticated and all gated actions will fail closed.",
    );
    return;
  }
  api.on("message_received", (event, hookContext) => {
    store.recordChannelMessage({
      content: field(event, "content"),
      runId: field(event, "runId") ?? field(hookContext, "runId"),
      sessionKey: field(event, "sessionKey") ?? field(hookContext, "sessionKey"),
      sessionId: field(event, "sessionId") ?? field(hookContext, "sessionId"),
    });
  });
  api.on("llm_input", (event, hookContext) => {
    store.recordAgentPrompt({
      prompt: field(event, "prompt"),
      runId: field(event, "runId") ?? field(hookContext, "runId"),
      sessionKey: field(event, "sessionKey") ?? field(hookContext, "sessionKey"),
      sessionId: field(event, "sessionId") ?? field(hookContext, "sessionId"),
    });
  });
  api.on("before_tool_call", (event, hookContext) => {
    const toolName = field(event, "toolName") ?? field(hookContext, "toolName");
    if (typeof toolName !== "string" || !toolName.startsWith("orion_")) return;
    store.bindToolCall({
      toolCallId:
        field(event, "toolCallId") ?? field(hookContext, "toolCallId"),
      runId: field(event, "runId") ?? field(hookContext, "runId"),
      sessionKey: field(hookContext, "sessionKey"),
    });
  });
}

// `defineToolPlugin` has no hook seam, so compose one around its register step.
const baseRegister = entry.register;
entry.register = (api: unknown) => {
  installProvenanceHooks(api as ProvenanceHostApi);
  return baseRegister?.(api as never);
};

export default entry;
