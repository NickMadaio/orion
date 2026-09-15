/** Default-off Phase 1 bridge for the single read-only system_status route. */
import type { TaskGraph, TaskRunRecord, TrustProvenance, ValidationResult } from "../types.js";
import { type DecisionEnvelope, type ExecutionResultEnvelope, type ProposalEnvelope } from "./contracts.js";
/**
 * What the bridge observed. Every field is optional because the bridge is an
 * observer, not a gate: when a strict check fails it records `contractError`
 * and stands aside rather than refusing the action. See
 * `runSystemStatusContractBridge` for why.
 */
export interface SystemStatusContractEvidence {
    readonly proposal?: ProposalEnvelope;
    readonly decision?: DecisionEnvelope;
    readonly execution?: ExecutionResultEnvelope;
    readonly contractError?: string;
}
export declare function isSystemStatusContractCandidate(graph: TaskGraph): boolean;
/**
 * Observe the v2 envelopes around the existing authoritative route.
 *
 * `runLegacy` still performs validation, execution, independent verification,
 * and ledger append. Returning the exact same record object keeps the tool's
 * public response stable; non-enumerable evidence exists only for tests and
 * in-process diagnostics.
 *
 * This function must never throw. The strict checks above are a drift
 * detector, not an authority: `system_status` accepts extra arguments on the
 * legacy path (`requiredArguments: []`), and the ambient reader may one day
 * report a field the schema has not learned yet. Either would have taken the
 * tool down with an opaque exception while the flag was on, which is a
 * behavioral regression against the flag-off route and a way for a contract
 * experiment to stop Orion from answering a question. So a failed check
 * records its reason in the evidence and stands aside; the legacy record is
 * returned untouched either way.
 */
export declare function runSystemStatusContractBridge(options: {
    graph: TaskGraph;
    provenance: TrustProvenance;
    validation: ValidationResult;
    runLegacy: () => Promise<TaskRunRecord>;
    now?: () => Date;
    nonce?: () => string;
    onWarning?: (message: string) => void;
}): Promise<TaskRunRecord>;
export declare function systemStatusContractEvidence(record: TaskRunRecord): SystemStatusContractEvidence | undefined;
