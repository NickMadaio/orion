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
    /*
     Ten minutes, raised from two, and paired with the multi-turn fix in
     `resolve`. Two minutes is shorter than a single sentence of thinking-out-loud
     followed by a decision: "text Gia and ask about Saturday… actually hold on…
     yeah okay do it" crosses it easily, and when it did, the request was refused
     for naming a recipient Nick had demonstrably named. Ten matches
     MAX_TRANSCRIPT_AGE_MS in transcript.ts, which is the real ceiling anyway —
     past it the session file is not read at all, so a larger number here would
     be a promise this class cannot keep.
    */
    recentWindowMs: 10 * 60 * 1000,
};
/** Tools whose output is text from somewhere that is not Nick. */
/**
 * Tools whose output is Orion's OWN bookkeeping, not text from outside.
 *
 * Everything not on this list is treated as untrusted, and the inversion is the
 * point. The first version listed the untrusted tools instead — web_search,
 * web_fetch, browser — which was fine while those were the only way outside
 * text arrived. It stops being fine the moment an MCP server is connected: a
 * Gmail tool is called something like `gmail_search_threads` and matches no
 * entry on a list of web tool names, so every email would have been treated as
 * trustworthy. Email is the oldest hostile-content channel there is.
 *
 * An allowlist of tools I have to remember to update is a guarantee that
 * whatever gets connected next is unprotected until someone notices. A denylist
 * of Orion's own control plane fails the other way: a new tool is untrusted
 * until proven otherwise, which is the correct direction for this.
 *
 * These three are excluded because they return Orion's own ledger and
 * permission state. Including them would let a filename from a past action
 * count as "untrusted content" and block a later legitimate action on the same
 * file — self-poisoning from his own audit trail.
 */
const OWN_BOOKKEEPING_TOOLS = [
    "orion_task_status",
    "orion_permission_status",
    "orion_permission_change",
];
export function isUntrustedResultTool(toolName) {
    const name = toolName.toLowerCase();
    return !OWN_BOOKKEEPING_TOOLS.includes(name);
}
export class HarnessProvenance {
    maxTurns;
    maxBindings;
    now;
    observed = [];
    /** Per entry. Enough to catch a smuggled path, not a whole page of prose. */
    static maxObservedChars = 20000;
    /** Total across entries. */
    static maxObservedEntries = 12;
    /** Older than this and it is not what the current request is about. */
    static observedTtlMs = 10 * 60 * 1000;
    /**
     * Record text a tool brought in from outside.
     *
     * Deliberately indiscriminate about shape: results differ per tool and a
     * missed field means a missed check, so anything string-ish in the payload is
     * flattened and kept.
     */
    recordUntrustedResult(toolName, payload, now = Date.now()) {
        if (!isUntrustedResultTool(toolName))
            return;
        const text = flattenStrings(payload).slice(0, HarnessProvenance.maxObservedChars);
        if (text.trim().length === 0)
            return;
        this.observed.push({ text, at: now });
        while (this.observed.length > HarnessProvenance.maxObservedEntries) {
            this.observed.shift();
        }
    }
    /** Everything read recently, for the validator to compare targets against. */
    untrustedContent(now = Date.now()) {
        return this.observed
            .filter((entry) => now - entry.at <= HarnessProvenance.observedTtlMs)
            .map((entry) => entry.text)
            .join("\n");
    }
    /*
     Files Orion created or wrote HIMSELF, under a real authenticated turn.
  
     Why this exists: `orion_task_run` is not on the bookkeeping denylist above,
     so `after_tool_call` records its result — which names every path the run
     touched — as untrusted content. One turn later the taint check in the
     validator sees that path in "untrusted content", fails to find it in the
     user's newest words ("now add a line to it" names no file), and refuses.
  
     Orion was therefore blocked from editing a file he had just created on Nick's
     explicit instruction. The comment on OWN_BOOKKEEPING_TOOLS anticipated this
     exact failure — "self-poisoning from his own audit trail" — and then listed
     `orion_task_status` while omitting the tool that actually performs the write.
  
     The obvious patch is to add `orion_task_run` to that denylist. That is wrong:
     a run result also carries the CONTENTS of anything the run read — file_read,
     a fetched page — and trusting all of it would reopen the injection hole the
     denylist exists to close.
  
     So record the narrow thing instead: the specific target of a step that already
     passed the full gate and then verified. An injected "create exfil.txt" is
     refused at creation and so never lands here; only paths Nick authorized do.
     The model cannot write to this registry — the controller does, after the fact.
    */
    authored = new Map();
    static maxAuthoredEntries = 256;
    /** A session, generously. Long enough to keep working, short enough to end. */
    static authoredTtlMs = 12 * 60 * 60 * 1000;
    /** Record a target Orion successfully wrote under an authenticated turn. */
    recordAuthoredArtifact(target, now = Date.now()) {
        const value = normalizeText(target);
        if (!value)
            return;
        this.authored.set(normalizeArtifactPath(value), now);
        while (this.authored.size > HarnessProvenance.maxAuthoredEntries) {
            const oldest = this.authored.keys().next();
            if (oldest.done)
                break;
            this.authored.delete(oldest.value);
        }
    }
    /**
     * Is this path something Orion already created on Nick's authority?
     *
     * Matched on the full path or on a trailing path segment, because the two
     * sides speak different dialects: the executor records an absolute target
     * (`/Users/nick/ws/notes.txt`) while the model's argument is usually relative
     * to a workspace root (`notes.txt`, `sub/notes.txt`).
     *
     * A suffix and not a basename, deliberately. Basename matching would excuse
     * `~/.ssh/notes.txt` on the strength of an unrelated `notes.txt` Orion once
     * wrote in a scratch folder. A suffix match cannot: the leading directories
     * still have to be the ones he actually wrote to.
     */
    isSelfAuthored(candidate, now = Date.now()) {
        const wanted = normalizeArtifactPath(candidate);
        if (wanted.length === 0)
            return false;
        for (const [authored, at] of this.authored) {
            if (now - at > HarnessProvenance.authoredTtlMs)
                continue;
            if (authored === wanted || authored.endsWith(`/${wanted}`))
                return true;
        }
        return false;
    }
    /** Count of live self-authored artifacts, for diagnosis. */
    authoredArtifactCount(now = Date.now()) {
        let live = 0;
        for (const at of this.authored.values()) {
            if (now - at <= HarnessProvenance.authoredTtlMs)
                live += 1;
        }
        return live;
    }
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
            /*
             The conversational window, and why it is no longer a single turn.
      
             This branch used to take `recent.at(-1)` — the newest turn and nothing
             else — while the `run` and `session` branches above both pass EVERY
             matching turn. That asymmetry was not a decision, it was an oversight,
             and on this gateway it was the one that mattered: neither
             `message_received` nor `llm_input` fires for locally-initiated runs, so
             `recent` is the tier essentially every real request lands in. Orion was
             running the whole system on a one-turn memory.
      
             What it cost, from the ledger (2026-08-13T14:53:46Z):
      
                 Nick, turn N-1:  "text Gia ..."
                 Nick, turn N:    (anything else at all)
                 -> argument_not_from_user: "'Gia' does not appear in anything
                    you said"
      
             He HAD said it. One turn earlier. `argumentNotFromUser` searches the
             authenticated turns for the recipient, was handed exactly one of them,
             and truthfully reported not finding it. The feature read as broken
             because it was.
      
             WHY WIDENING THIS IS NOT A WEAKENING.
      
             Everything in `this.turns` arrived from a host hook or from a
             `role: "user"` transcript entry — text OpenClaw attributes to Nick.
             Content Orion merely READ never lands here: tool results go to
             `this.observed` via `recordUntrustedResult`, and `userTextFromLine` in
             transcript.ts accepts only `type: "text"` blocks, explicitly skipping
             `tool_result`. So this widens the window over Nick's OWN authenticated
             words and over nothing else. An incoming text naming its own recipient
             is refused exactly as before — it is not in this array to be found, at
             any window size. That is `refuses a recipient that came out of a message
             Orion read`, and `a wider window still refuses a recipient that only a
             read message named`, which exists to pin this specific reasoning.
      
             Bounded on both ends: `recentWindowMs` by time, and `readRecentUserTurns`
             reads at most RECENT_TURN_LIMIT (8) turns, so "the conversation" stays a
             window rather than becoming a transcript.
            */
            anchor = pick(usable.filter((turn) => fresh(turn, effective.recentWindowMs)), "recent");
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
            selfAuthoredArtifacts: this.authoredArtifactCount(),
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
/** One spelling for a path, so the executor's and the model's forms compare. */
function normalizeArtifactPath(value) {
    return value
        .trim()
        .replace(/^\.\//, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}
function optionalText(key, value) {
    const text = normalizeText(value);
    return text ? { [key]: text } : {};
}
/**
 * Find the approval hash wherever the model put it.
 *
 * Observed, live, on 2026-08-13, on the turn AFTER Nick said "yes, go ahead":
 *
 *     steps: [ { id, action, arguments, approvalHash: "dac4df2f…" } ]
 *
 * The schema wanted `approval: { status: "approved", canonicalHash: "…" }`.
 * A flat `approvalHash` on the step matched no field, was dropped in silence,
 * and the run came back `needs_approval` with the identical hash — so Orion
 * approved, re-ran, and was refused for not having done the thing he had just
 * done. From the outside that is indistinguishable from the approval gate
 * being broken, and it is exactly how "he said he sent it" happens: the model
 * has no way to tell a rejected approval from a bug, and eventually stops
 * reporting the difference.
 *
 * WHY ACCEPTING EVERY SHAPE IS NOT A WEAKENING.
 *
 * The canonical hash is not a secret and it is not a credential. It is derived
 * server-side in `canonicalActionHash` from the action, the arguments, and the
 * working context, and the gate is that the supplied value EQUALS the one
 * recomputed from the bytes actually submitted. Change any argument and the
 * hash no longer matches; replay an approval from a different message and it
 * no longer matches. The security lives entirely in that equality check, and
 * none of it lives in which JSON key the value arrived under. Refusing a
 * correct hash for being in the wrong field protects nobody — it only fails
 * the one user who did everything right.
 */
function approvalCanonicalHash(step, graphLevel) {
    const nested = step.approval;
    if (nested?.status === "approved" &&
        typeof nested.canonicalHash === "string" &&
        nested.canonicalHash.length > 0) {
        return nested.canonicalHash;
    }
    // Flat on the step, which is what the model actually reaches for.
    if (typeof step.approvalHash === "string" && step.approvalHash.length > 0) {
        return step.approvalHash;
    }
    // A bare string where the object was expected: `approval: "dac4df…"`.
    if (typeof nested === "string" && nested.length > 0) {
        return nested;
    }
    // One approval covering a single-step graph.
    if (typeof graphLevel === "string" && graphLevel.length > 0) {
        return graphLevel;
    }
    return undefined;
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
            ...(() => {
                const canonicalHash = approvalCanonicalHash(step, graph.approvalHash);
                return canonicalHash
                    ? { approval: { status: "approved", canonicalHash } }
                    : {};
            })(),
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
/** Collect every string in an arbitrary tool result, bounded by depth. */
function flattenStrings(value, depth = 0) {
    if (depth > 6)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (Array.isArray(value)) {
        return value.map((item) => flattenStrings(item, depth + 1)).join("\n");
    }
    if (value !== null && typeof value === "object") {
        return Object.values(value)
            .map((item) => flattenStrings(item, depth + 1))
            .join("\n");
    }
    return "";
}
