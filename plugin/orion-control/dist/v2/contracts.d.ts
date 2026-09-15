/**
 * ORION v2 Phase 1 language-neutral boundary contracts.
 *
 * These fields and vocabularies mirror the canonical JSON Schemas under
 * `orion/core/schemas`. This module is deliberately provider-, platform-, and
 * executor-free: it validates data and grants no authority.
 */
export declare const PROPOSAL_FIELDS: readonly ["schema_version", "proposal_id", "correlation_id", "source", "capability", "arguments", "created_at", "provenance", "sensitivity"];
export declare const DECISION_FIELDS: readonly ["schema_version", "decision_id", "proposal_id", "outcome", "policy_version", "reason_codes", "decided_at", "expires_at"];
export declare const EXECUTION_RESULT_FIELDS: readonly ["schema_version", "execution_id", "proposal_id", "status", "observed_outcome", "audit_reference", "started_at", "finished_at"];
export declare const SENSITIVITIES: readonly ["PUBLIC", "INTERNAL", "SENSITIVE", "RESTRICTED"];
export declare const DECISION_OUTCOMES: readonly ["ALLOW", "DENY", "REQUIRE_APPROVAL"];
export declare const EXECUTION_STATUSES: readonly ["SUCCEEDED", "FAILED", "DENIED", "CANCELLED"];
export type Sensitivity = (typeof SENSITIVITIES)[number];
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export interface ProposalEnvelope {
    readonly schema_version: 1;
    readonly proposal_id: string;
    readonly correlation_id: string;
    readonly source: string;
    readonly capability: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly created_at: string;
    readonly provenance: readonly string[];
    readonly sensitivity: Sensitivity;
}
export interface DecisionEnvelope {
    readonly schema_version: 1;
    readonly decision_id: string;
    readonly proposal_id: string;
    readonly outcome: DecisionOutcome;
    readonly policy_version: string;
    readonly reason_codes: readonly string[];
    readonly decided_at: string;
    readonly expires_at: string;
}
export interface ExecutionResultEnvelope {
    readonly schema_version: 1;
    readonly execution_id: string;
    readonly proposal_id: string;
    readonly status: ExecutionStatus;
    readonly observed_outcome: Readonly<Record<string, unknown>>;
    readonly audit_reference: string;
    readonly started_at: string;
    readonly finished_at: string;
}
export declare function proposalEnvelope(value: unknown): ProposalEnvelope;
export declare function decisionEnvelope(value: unknown): DecisionEnvelope;
export declare function executionResultEnvelope(value: unknown): ExecutionResultEnvelope;
