import type { TaskGraph, TrustProvenance } from "./types.js";
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
export type TrustTurnSource = "channel_message" | "agent_prompt" | "session_transcript";
/** Reserved input-id prefix. Only the harness may mint inputs with this prefix. */
export declare const HARNESS_INPUT_PREFIX = "orion_user_turn_";
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
export declare class HarnessProvenance {
    private readonly maxTurns;
    private readonly maxBindings;
    private readonly now;
    private readonly turns;
    private readonly bindings;
    private readonly fired;
    private transcriptTurnsUsed;
    private lastBinding;
    constructor(maxTurns?: number, maxBindings?: number, now?: () => number);
    private push;
    /** Raw inbound user message as delivered by a channel. Strongest source. */
    recordChannelMessage(record: {
        content?: unknown;
        runId?: unknown;
        sessionKey?: unknown;
        sessionId?: unknown;
    }): void;
    /** Host-assembled prompt for one agent turn. Used only as a fallback source. */
    recordAgentPrompt(record: {
        prompt?: unknown;
        runId?: unknown;
        sessionKey?: unknown;
        sessionId?: unknown;
    }): void;
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
    }): void;
    /**
     * Did any hook already supply user text for a turn still inside the TTL?
     *
     * Used to skip the transcript read on gateways where `message_received` or
     * `llm_input` do fire — the transcript is a fallback, never a substitute for
     * a stronger source.
     */
    hasUsableTurn(withinMs?: number): boolean;
    /** Bind a host-generated tool call id to the run that issued it. */
    bindToolCall(record: {
        toolCallId?: unknown;
        runId?: unknown;
        sessionKey?: unknown;
    }): void;
    /**
     * Resolve the trust anchor for one tool call. The binding is consumed so a
     * single host tool call cannot be replayed against a later model turn.
     */
    resolve(toolCallId: string | undefined, policy?: ProvenancePolicy): TrustAnchor;
    health(): ProvenanceHealth;
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
        approval?: {
            status: "approved";
            canonicalHash: string;
        };
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
export declare function authorizeTaskGraph(graph: ModelTaskGraph, anchor: TrustAnchor): AuthorizedGraph;
