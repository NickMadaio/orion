import { ACTION_CATALOG } from "./catalog.js";
/** Reserved input-id prefix. Only the harness may mint inputs with this prefix. */
export const HARNESS_INPUT_PREFIX = "orion_user_turn_";
/** Hard ceiling on the text length retained per authenticated turn. */
const MAX_TURN_CHARACTERS = 8192;
const DEFAULT_POLICY = {
    allowTranscriptSource: true,
    allowPromptSource: true,
    allowSessionBinding: true,
    allowRecentBinding: true,
    ttlMs: 15 * 60 * 1000,
    recentWindowMs: 2 * 60 * 1000,
};
export class HarnessProvenance {
    maxTurns;
    maxBindings;
    now;
    turns = [];
    bindings = new Map();
    fired = {
        channelMessage: false,
        prompt: false,
        toolCall: false,
    };
    transcriptTurnsUsed = 0;
    lastBinding;
    constructor(maxTurns = 64, maxBindings = 64, now = () => Date.now()) {
        this.maxTurns = maxTurns;
        this.maxBindings = maxBindings;
        this.now = now;
    }
    push(turn) {
        this.turns.push(turn);
        while (this.turns.length > this.maxTurns)
            this.turns.shift();
    }
    /** Raw inbound user message as delivered by a channel. Strongest source. */
    recordChannelMessage(record) {
        this.fired.channelMessage = true;
        const content = normalizeText(record.content);
        if (!content)
            return;
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
    recordAgentPrompt(record) {
        this.fired.prompt = true;
        const content = normalizeText(record.prompt);
        if (!content)
            return;
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
    recordTranscriptTurn(record) {
        const content = normalizeText(record.content);
        if (!content)
            return;
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
    hasUsableTurn(withinMs = DEFAULT_POLICY.ttlMs) {
        const at = this.now();
        return this.turns.some((turn) => turn.source !== "session_transcript" && at - turn.receivedAt <= withinMs);
    }
    /** Bind a host-generated tool call id to the run that issued it. */
    bindToolCall(record) {
        this.fired.toolCall = true;
        const toolCallId = normalizeText(record.toolCallId);
        if (!toolCallId)
            return;
        this.bindings.set(toolCallId, {
            boundAt: this.now(),
            ...optionalText("runId", record.runId),
            ...optionalText("sessionKey", record.sessionKey),
        });
        while (this.bindings.size > this.maxBindings) {
            const oldest = this.bindings.keys().next();
            if (oldest.done)
                break;
            this.bindings.delete(oldest.value);
        }
    }
    /**
     * Resolve the trust anchor for one tool call. The binding is consumed so a
     * single host tool call cannot be replayed against a later model turn.
     */
    resolve(toolCallId, policy = {}) {
        const effective = { ...DEFAULT_POLICY, ...policy };
        const at = this.now();
        const binding = toolCallId ? this.bindings.get(toolCallId) : undefined;
        if (toolCallId)
            this.bindings.delete(toolCallId);
        const usable = this.turns.filter((turn) => {
            if (turn.source === "channel_message")
                return true;
            if (turn.source === "session_transcript") {
                return effective.allowTranscriptSource;
            }
            return effective.allowPromptSource;
        });
        const fresh = (turn, windowMs) => at - turn.receivedAt <= windowMs;
        const pick = (candidates, tier) => {
            if (candidates.length === 0)
                return undefined;
            const channelOnly = candidates.filter((turn) => turn.source === "channel_message");
            // `llm_input` fires once per LLM iteration in a turn, so collapse repeats.
            const seen = new Set();
            const chosen = (channelOnly.length > 0 ? channelOnly : candidates).filter((turn) => {
                if (seen.has(turn.content))
                    return false;
                seen.add(turn.content);
                return true;
            });
            return {
                turns: chosen,
                binding: tier,
                ...optionalText("runId", binding?.runId),
                ...optionalText("sessionKey", binding?.sessionKey),
            };
        };
        let anchor;
        if (binding?.runId) {
            anchor = pick(usable.filter((turn) => turn.runId === binding.runId && fresh(turn, effective.ttlMs)), "run");
        }
        if (!anchor && effective.allowSessionBinding && binding?.sessionKey) {
            anchor = pick(usable.filter((turn) => turn.sessionKey === binding.sessionKey && fresh(turn, effective.ttlMs)), "session");
        }
        if (!anchor && effective.allowRecentBinding) {
            const recent = usable.filter((turn) => fresh(turn, effective.recentWindowMs));
            const newest = recent.at(-1);
            anchor = newest ? pick([newest], "recent") : undefined;
        }
        const resolved = anchor ?? { turns: [], binding: "none" };
        this.lastBinding = resolved.binding;
        return resolved;
    }
    health() {
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
function normalizeText(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return undefined;
    return trimmed.length > MAX_TURN_CHARACTERS
        ? trimmed.slice(0, MAX_TURN_CHARACTERS)
        : trimmed;
}
function optionalText(key, value) {
    const text = normalizeText(value);
    return text ? { [key]: text } : {};
}
/**
 * Build the internal, authorized TaskGraph.
 *
 * Trust is assigned here and nowhere else. Every input the model supplied is
 * rebuilt field by field as `untrusted_external`; the only `trusted_user`
 * inputs are minted from harness provenance. There is therefore no byte the
 * model controls that can land in `TaskInput.trust`.
 */
export function authorizeTaskGraph(graph, anchor) {
    const modelInputs = Array.isArray(graph.inputs) ? graph.inputs : [];
    let discardedTrustAssertion = false;
    const trustedInputs = anchor.turns.map((turn, index) => ({
        id: `${HARNESS_INPUT_PREFIX}${index + 1}`,
        kind: "instruction",
        trust: "trusted_user",
        content: turn.content,
    }));
    const untrustedInputs = [];
    for (const candidate of modelInputs) {
        if (typeof candidate?.id !== "string")
            continue;
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
    const steps = (Array.isArray(graph.steps) ? graph.steps : []).map((step) => {
        const definition = ACTION_CATALOG[step.action];
        const declaredRefs = Array.isArray(step.sourceRefs) ? step.sourceRefs : [];
        const sourceRefs = [
            ...new Set([
                ...declaredRefs.filter((ref) => typeof ref === "string" && !ref.startsWith(HARNESS_INPUT_PREFIX)),
                ...harnessIds,
            ]),
        ];
        const authorized = {
            id: step.id,
            action: step.action,
            arguments: step.arguments && typeof step.arguments === "object"
                ? step.arguments
                : {},
            dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
            sourceRefs,
            risk: definition?.risk ?? "critical",
            verify: definition?.verification ?? "unknown_action",
            reversible: definition?.reversible ?? false,
            expectedEffect: typeof step.expectedEffect === "string"
                ? step.expectedEffect
                : step.action,
            ...(step.approval?.status === "approved" &&
                typeof step.approval.canonicalHash === "string"
                ? { approval: step.approval }
                : {}),
        };
        return authorized;
    });
    const authorizedGraph = {
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
        retryBudget: Number.isInteger(graph.retryBudget) &&
            graph.retryBudget >= 0 &&
            graph.retryBudget <= 2
            ? graph.retryBudget
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
