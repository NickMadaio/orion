import { ACTION_CATALOG } from "./catalog.js";
import type { TaskGraph, TaskInput, TaskStep, TrustProvenance } from "./types.js";

/**
 * Harness-owned provenance.
 *
 * The model never writes to this module. Records arrive only from OpenClaw host
 * hooks (`message_received` for the raw inbound user message, `llm_input` for
 * the prompt the host assembled for the turn) and from `before_tool_call`,
 * which binds a host-generated `toolCallId` to the run that produced it.
 *
 * A tool call resolves to a `TrustAnchor` describing which authenticated user
 * turns — if any — may be treated as `trusted_user`. Absence of an anchor is a
 * hard deny: there is no model-writable path that can produce one.
 */

export type TrustBinding = "run" | "session" | "recent" | "none";
export type TrustTurnSource =
  | "channel_message"
  | "agent_prompt"
  | "session_transcript";

/** Reserved input-id prefix. Only the harness may mint inputs with this prefix. */
export const HARNESS_INPUT_PREFIX = "orion_user_turn_";

/** Hard ceiling on the text length retained per authenticated turn. */
const MAX_TURN_CHARACTERS = 8192;

export interface AuthenticatedUserTurn {
  content: string;
  receivedAt: number;
  source: TrustTurnSource;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
}

export interface TrustAnchor {
  turns: AuthenticatedUserTurn[];
  binding: TrustBinding;
  runId?: string;
  sessionKey?: string;
}

export interface ProvenancePolicy {
  /** Accept the host-assembled turn prompt when no raw channel message exists. */
  allowPromptSource?: boolean;
  /** Accept a same-session turn when the run ids do not match. */
  allowSessionBinding?: boolean;
  /** Accept the newest authenticated turn when no tool-call binding exists. */
  allowRecentBinding?: boolean;
  /**
   * Accept the host-written session transcript as a source of the user turn.
   *
   * On this gateway neither `message_received` nor `llm_input` fires for
   * locally-initiated runs, so without this there is no user text at all and
   * every action fails closed. The model cannot author a `role: "user"` entry,
   * so the transcript is a genuine harness source, not a relaxation.
   */
  allowTranscriptSource?: boolean;
  /** Age limit for run/session bound turns. */
  ttlMs?: number;
  /** Age limit for the unbound `recent` tier. */
  recentWindowMs?: number;
}

const DEFAULT_POLICY: Required<ProvenancePolicy> = {
  allowTranscriptSource: true,
  allowPromptSource: true,
  allowSessionBinding: true,
  allowRecentBinding: true,
  ttlMs: 15 * 60 * 1000,
  recentWindowMs: 2 * 60 * 1000,
};

export interface ProvenanceHealth {
  channelMessageHookFired: boolean;
  promptHookFired: boolean;
  toolCallHookFired: boolean;
  transcriptTurnsUsed: number;
  retainedTurns: number;
  pendingToolCallBindings: number;
  lastTurnSource?: TrustTurnSource;
  lastTurnAgeMs?: number;
  lastBinding?: TrustBinding;
}

interface ToolCallBinding {
  runId?: string;
  sessionKey?: string;
  boundAt: number;
}

export class HarnessProvenance {
  private readonly turns: AuthenticatedUserTurn[] = [];
  private readonly bindings = new Map<string, ToolCallBinding>();
  private readonly fired = {
    channelMessage: false,
    prompt: false,
    toolCall: false,
  };
  private transcriptTurnsUsed = 0;
  private lastBinding: TrustBinding | undefined;

  constructor(
    private readonly maxTurns = 64,
    private readonly maxBindings = 64,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private push(turn: AuthenticatedUserTurn): void {
    this.turns.push(turn);
    while (this.turns.length > this.maxTurns) this.turns.shift();
  }

  /** Raw inbound user message as delivered by a channel. Strongest source. */
  recordChannelMessage(record: {
    content?: unknown;
    runId?: unknown;
    sessionKey?: unknown;
    sessionId?: unknown;
  }): void {
    this.fired.channelMessage = true;
    const content = normalizeText(record.content);
    if (!content) return;
    this.push({
      content,
      receivedAt: this.now(),
      source: "channel_message",
      ...optionalText("runId", record.runId),
      ...optionalText("sessionKey", record.sessionKey),
      ...optionalText("sessionId", record.sessionId),
    });
  }

  /** Host-assembled prompt for one agent turn. Used only as a fallback source. */
  recordAgentPrompt(record: {
    prompt?: unknown;
    runId?: unknown;
    sessionKey?: unknown;
    sessionId?: unknown;
  }): void {
    this.fired.prompt = true;
    const content = normalizeText(record.prompt);
    if (!content) return;
    this.push({
      content,
      receivedAt: this.now(),
      source: "agent_prompt",
      ...optionalText("runId", record.runId),
      ...optionalText("sessionKey", record.sessionKey),
      ...optionalText("sessionId", record.sessionId),
    });
  }

  /**
   * A user turn recovered from the host-written session transcript.
   *
   * Only ever called with text the HOST attributed to `role: "user"`. See
   * `transcript.ts` for why that attribution is unforgeable by the model.
   */
  recordTranscriptTurn(record: {
    content?: unknown;
    sessionId?: unknown;
    receivedAt?: number;
  }): void {
    const content = normalizeText(record.content);
    if (!content) return;
    this.transcriptTurnsUsed += 1;
    this.push({
      content,
      receivedAt: record.receivedAt ?? this.now(),
      source: "session_transcript",
      ...optionalText("sessionId", record.sessionId),
    });
  }

  /**
   * Did any hook already supply user text for a turn still inside the TTL?
   *
   * Used to skip the transcript read on gateways where `message_received` or
   * `llm_input` do fire — the transcript is a fallback, never a substitute for
   * a stronger source.
   */
  hasUsableTurn(withinMs = DEFAULT_POLICY.ttlMs): boolean {
    const at = this.now();
    return this.turns.some(
      (turn) =>
        turn.source !== "session_transcript" && at - turn.receivedAt <= withinMs,
    );
  }

  /** Bind a host-generated tool call id to the run that issued it. */
  bindToolCall(record: {
    toolCallId?: unknown;
    runId?: unknown;
    sessionKey?: unknown;
  }): void {
    this.fired.toolCall = true;
    const toolCallId = normalizeText(record.toolCallId);
    if (!toolCallId) return;
    this.bindings.set(toolCallId, {
      boundAt: this.now(),
      ...optionalText("runId", record.runId),
      ...optionalText("sessionKey", record.sessionKey),
    });
    while (this.bindings.size > this.maxBindings) {
      const oldest = this.bindings.keys().next();
      if (oldest.done) break;
      this.bindings.delete(oldest.value);
    }
  }

  /**
   * Resolve the trust anchor for one tool call. The binding is consumed so a
   * single host tool call cannot be replayed against a later model turn.
   */
  resolve(toolCallId: string | undefined, policy: ProvenancePolicy = {}): TrustAnchor {
    const effective = { ...DEFAULT_POLICY, ...policy };
    const at = this.now();
    const binding = toolCallId ? this.bindings.get(toolCallId) : undefined;
    if (toolCallId) this.bindings.delete(toolCallId);

    const usable = this.turns.filter((turn) => {
      if (turn.source === "channel_message") return true;
      if (turn.source === "session_transcript") {
        return effective.allowTranscriptSource;
      }
      return effective.allowPromptSource;
    });
    const fresh = (turn: AuthenticatedUserTurn, windowMs: number) =>
      at - turn.receivedAt <= windowMs;

    const pick = (
      candidates: AuthenticatedUserTurn[],
      tier: TrustBinding,
    ): TrustAnchor | undefined => {
      if (candidates.length === 0) return undefined;
      const channelOnly = candidates.filter(
        (turn) => turn.source === "channel_message",
      );
      // `llm_input` fires once per LLM iteration in a turn, so collapse repeats.
      const seen = new Set<string>();
      const chosen = (channelOnly.length > 0 ? channelOnly : candidates).filter(
        (turn) => {
          if (seen.has(turn.content)) return false;
          seen.add(turn.content);
          return true;
        },
      );
      return {
        turns: chosen,
        binding: tier,
        ...optionalText("runId", binding?.runId),
        ...optionalText("sessionKey", binding?.sessionKey),
      };
    };

    let anchor: TrustAnchor | undefined;
    if (binding?.runId) {
      anchor = pick(
        usable.filter(
          (turn) => turn.runId === binding.runId && fresh(turn, effective.ttlMs),
        ),
        "run",
      );
    }
    if (!anchor && effective.allowSessionBinding && binding?.sessionKey) {
      anchor = pick(
        usable.filter(
          (turn) =>
            turn.sessionKey === binding.sessionKey && fresh(turn, effective.ttlMs),
        ),
        "session",
      );
    }
    if (!anchor && effective.allowRecentBinding) {
      const recent = usable.filter((turn) => fresh(turn, effective.recentWindowMs));
      const newest = recent.at(-1);
      anchor = newest ? pick([newest], "recent") : undefined;
    }
    const resolved: TrustAnchor = anchor ?? { turns: [], binding: "none" };
    this.lastBinding = resolved.binding;
    return resolved;
  }

  health(): ProvenanceHealth {
    const newest = this.turns.at(-1);
    return {
      channelMessageHookFired: this.fired.channelMessage,
      promptHookFired: this.fired.prompt,
      toolCallHookFired: this.fired.toolCall,
      transcriptTurnsUsed: this.transcriptTurnsUsed,
      retainedTurns: this.turns.length,
      pendingToolCallBindings: this.bindings.size,
      ...(newest ? { lastTurnSource: newest.source } : {}),
      ...(newest ? { lastTurnAgeMs: this.now() - newest.receivedAt } : {}),
      ...(this.lastBinding ? { lastBinding: this.lastBinding } : {}),
    };
  }
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > MAX_TURN_CHARACTERS
    ? trimmed.slice(0, MAX_TURN_CHARACTERS)
    : trimmed;
}

function optionalText<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const text = normalizeText(value);
  return text ? ({ [key]: text } as Partial<Record<K, string>>) : {};
}

/** Model-facing graph shape: it has no field that can express trust. */
export interface ModelTaskGraph {
  version?: "1";
  goal: string;
  workingContext?: string;
  inputs?: Array<{
    id: string;
    kind?: "instruction" | "observation";
    content?: string;
    [extra: string]: unknown;
  }>;
  assumptions?: string[];
  questions?: string[];
  retryBudget?: number;
  steps: Array<{
    id: string;
    action: string;
    arguments?: Record<string, unknown>;
    dependsOn?: string[];
    sourceRefs?: string[];
    expectedEffect?: string;
    approval?: { status: "approved"; canonicalHash: string };
    [extra: string]: unknown;
  }>;
}

export interface AuthorizedGraph {
  graph: TaskGraph;
  provenance: TrustProvenance;
  /** True when the caller tried to assert trust itself; the value was discarded. */
  discardedTrustAssertion: boolean;
}

/**
 * Build the internal, authorized TaskGraph.
 *
 * Trust is assigned here and nowhere else. Every input the model supplied is
 * rebuilt field by field as `untrusted_external`; the only `trusted_user`
 * inputs are minted from harness provenance. There is therefore no byte the
 * model controls that can land in `TaskInput.trust`.
 */
export function authorizeTaskGraph(
  graph: ModelTaskGraph,
  anchor: TrustAnchor,
): AuthorizedGraph {
  const modelInputs = Array.isArray(graph.inputs) ? graph.inputs : [];
  let discardedTrustAssertion = false;

  const trustedInputs: TaskInput[] = anchor.turns.map((turn, index) => ({
    id: `${HARNESS_INPUT_PREFIX}${index + 1}`,
    kind: "instruction",
    trust: "trusted_user",
    content: turn.content,
  }));

  const untrustedInputs: TaskInput[] = [];
  for (const candidate of modelInputs) {
    if (typeof candidate?.id !== "string") continue;
    if (candidate.id.startsWith(HARNESS_INPUT_PREFIX)) {
      discardedTrustAssertion = true;
      continue;
    }
    if ("trust" in candidate && candidate.trust !== undefined) {
      discardedTrustAssertion = true;
    }
    untrustedInputs.push({
      id: candidate.id,
      kind: candidate.kind === "instruction" ? "instruction" : "observation",
      trust: "untrusted_external",
      ...(typeof candidate.content === "string"
        ? { content: candidate.content }
        : {}),
    });
  }

  const harnessIds = trustedInputs.map((input) => input.id);
  const steps: TaskStep[] = (Array.isArray(graph.steps) ? graph.steps : []).map(
    (step) => {
      const definition = ACTION_CATALOG[step.action];
      const declaredRefs = Array.isArray(step.sourceRefs) ? step.sourceRefs : [];
      const sourceRefs = [
        ...new Set([
          ...declaredRefs.filter(
            (ref) => typeof ref === "string" && !ref.startsWith(HARNESS_INPUT_PREFIX),
          ),
          ...harnessIds,
        ]),
      ];
      const authorized: TaskStep = {
        id: step.id,
        action: step.action,
        arguments:
          step.arguments && typeof step.arguments === "object"
            ? step.arguments
            : {},
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
        sourceRefs,
        risk: definition?.risk ?? "critical",
        verify: definition?.verification ?? "unknown_action",
        reversible: definition?.reversible ?? false,
        expectedEffect:
          typeof step.expectedEffect === "string"
            ? step.expectedEffect
            : step.action,
        ...(step.approval?.status === "approved" &&
        typeof step.approval.canonicalHash === "string"
          ? { approval: step.approval }
          : {}),
      };
      return authorized;
    },
  );

  const authorizedGraph: TaskGraph = {
    version: "1",
    goal: typeof graph.goal === "string" ? graph.goal : "",
    ...(typeof graph.workingContext === "string"
      ? { workingContext: graph.workingContext }
      : {}),
    inputs: [...trustedInputs, ...untrustedInputs],
    assumptions: Array.isArray(graph.assumptions)
      ? graph.assumptions.filter((entry) => typeof entry === "string")
      : [],
    ...(Array.isArray(graph.questions)
      ? { questions: graph.questions.filter((entry) => typeof entry === "string") }
      : {}),
    retryBudget:
      Number.isInteger(graph.retryBudget) &&
      (graph.retryBudget as number) >= 0 &&
      (graph.retryBudget as number) <= 2
        ? (graph.retryBudget as number)
        : 0,
    steps,
  };

  return {
    graph: authorizedGraph,
    provenance: {
      binding: anchor.binding,
      turnCount: anchor.turns.length,
      sources: [...new Set(anchor.turns.map((turn) => turn.source))],
      ...(anchor.runId ? { runId: anchor.runId } : {}),
      ...(anchor.sessionKey ? { sessionKey: anchor.sessionKey } : {}),
    },
    discardedTrustAssertion,
  };
}
