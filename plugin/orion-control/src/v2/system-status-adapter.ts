/** Default-off Phase 1 bridge for the single read-only system_status route. */

import { randomUUID } from "node:crypto";
import type {
  TaskGraph,
  TaskRunRecord,
  TrustProvenance,
  ValidationResult,
} from "../types.js";
import {
  decisionEnvelope,
  executionResultEnvelope,
  proposalEnvelope,
  type DecisionEnvelope,
  type ExecutionResultEnvelope,
  type ProposalEnvelope,
} from "./contracts.js";

const REQUIRED_STATUS_FIELDS = new Set(["uptime", "summary"]);
const OPTIONAL_STATUS_FIELDS = new Set([
  "batteryPercent",
  "batteryState",
  "diskFreeGb",
  "diskTotalGb",
  "memoryPressure",
]);

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

const CONTRACT_EVIDENCE = Symbol("orion-v2-system-status-contract");

type ContractRecord = TaskRunRecord & {
  [CONTRACT_EVIDENCE]?: SystemStatusContractEvidence;
};

export function isSystemStatusContractCandidate(graph: TaskGraph): boolean {
  return graph.steps.length === 1 && graph.steps[0]?.action === "system_status";
}

function strictSystemStatusArguments(graph: TaskGraph): void {
  const step = graph.steps[0];
  if (!step || step.action !== "system_status") {
    throw new Error("v2 adapter accepts only one system_status action");
  }
  if (Object.keys(step.arguments).length !== 0) {
    throw new Error("system_status arguments must be empty");
  }
}

function strictSystemStatusOutput(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("system_status output must be an object");
  }
  const output = value as Record<string, unknown>;
  const keys = new Set(Object.keys(output));
  const unknown = [...keys]
    .filter(
      (key) =>
        !REQUIRED_STATUS_FIELDS.has(key) && !OPTIONAL_STATUS_FIELDS.has(key),
    )
    .sort();
  const missing = [...REQUIRED_STATUS_FIELDS].filter((key) => !keys.has(key)).sort();
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `system_status output mismatch: unknown=${JSON.stringify(unknown)} missing=${JSON.stringify(missing)}`,
    );
  }
  if (typeof output.uptime !== "string" || typeof output.summary !== "string") {
    throw new Error("system_status text fields must be strings");
  }
  for (const key of ["batteryPercent", "diskFreeGb", "diskTotalGb"] as const) {
    if (
      output[key] !== undefined &&
      (typeof output[key] !== "number" || !Number.isFinite(output[key]))
    ) {
      throw new Error(`${key} must be finite and numeric`);
    }
  }
  for (const key of ["batteryState", "memoryPressure"] as const) {
    if (output[key] !== undefined && typeof output[key] !== "string") {
      throw new Error(`${key} must be a string`);
    }
  }
  return output;
}

function decisionOutcome(status: ValidationResult["status"]):
  | "ALLOW"
  | "DENY"
  | "REQUIRE_APPROVAL" {
  if (status === "ready") return "ALLOW";
  if (status === "needs_approval") return "REQUIRE_APPROVAL";
  return "DENY";
}

function identifier(namespace: string, nonce: () => string): string {
  return `${namespace}-${nonce().replaceAll("-", "")}`;
}

function buildProposal(
  graph: TaskGraph,
  provenance: TrustProvenance,
  createdAt: Date,
  nonce: () => string,
): ProposalEnvelope {
  strictSystemStatusArguments(graph);
  const sources = provenance.sources.length > 0 ? provenance.sources : ["none"];
  return proposalEnvelope({
    schema_version: 1,
    proposal_id: identifier("proposal", nonce),
    correlation_id: identifier("correlation", nonce),
    source: "openclaw_taskgraph",
    capability: "system_status",
    arguments: {},
    created_at: createdAt.toISOString(),
    provenance: [
      `host-binding:${provenance.binding}`,
      ...sources.map((source) => `host-source:${source}`),
    ],
    sensitivity: "INTERNAL",
  });
}

function buildDecision(
  proposal: ProposalEnvelope,
  validation: ValidationResult,
  decidedAt: Date,
  nonce: () => string,
): DecisionEnvelope {
  const expiresAt = new Date(decidedAt.getTime() + 5 * 60 * 1000);
  const reasons =
    validation.issues.length > 0
      ? validation.issues.map((issue) => issue.code).slice(0, 32)
      : ["legacy_validator_ready"];
  return decisionEnvelope({
    schema_version: 1,
    decision_id: identifier("decision", nonce),
    proposal_id: proposal.proposal_id,
    outcome: decisionOutcome(validation.status),
    policy_version: "orion-control-v1",
    reason_codes: reasons,
    decided_at: decidedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
}

function buildExecution(
  proposal: ProposalEnvelope,
  record: TaskRunRecord,
  nonce: () => string,
): ExecutionResultEnvelope | undefined {
  if (record.status !== "succeeded") return undefined;
  if (record.audit?.appended === false) {
    throw new Error("system_status result has no durable audit record");
  }
  if (record.steps.length !== 1) {
    throw new Error("system_status result must contain exactly one step");
  }
  const step = record.steps[0]!;
  if (
    step.request.action !== "system_status" ||
    step.status !== "verified" ||
    step.verification.observed !== true ||
    step.execution.mode !== "observed"
  ) {
    throw new Error("system_status legacy execution was not verified as observed");
  }
  const output = strictSystemStatusOutput(step.execution.output);
  if (!record.completedAt) throw new Error("system_status result is incomplete");
  return executionResultEnvelope({
    schema_version: 1,
    execution_id: identifier("execution", nonce),
    proposal_id: proposal.proposal_id,
    status: "SUCCEEDED",
    observed_outcome: {
      mode: "observed",
      idempotency_key: step.idempotencyKey,
      system_status: output,
    },
    audit_reference: record.taskId,
    started_at: record.createdAt,
    finished_at: record.completedAt,
  });
}

function describeContractError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
export async function runSystemStatusContractBridge(options: {
  graph: TaskGraph;
  provenance: TrustProvenance;
  validation: ValidationResult;
  runLegacy: () => Promise<TaskRunRecord>;
  now?: () => Date;
  nonce?: () => string;
  onWarning?: (message: string) => void;
}): Promise<TaskRunRecord> {
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? randomUUID;

  let proposal: ProposalEnvelope | undefined;
  let decision: DecisionEnvelope | undefined;
  let contractError: string | undefined;
  try {
    proposal = buildProposal(options.graph, options.provenance, now(), nonce);
    decision = buildDecision(proposal, options.validation, now(), nonce);
  } catch (error) {
    contractError = describeContractError(error);
    proposal = undefined;
    decision = undefined;
  }

  // Runs unconditionally. A contract that could not be built is a reason to
  // record less, never a reason to execute less.
  const record = await options.runLegacy();

  let execution: ExecutionResultEnvelope | undefined;
  if (proposal !== undefined && contractError === undefined) {
    try {
      execution = buildExecution(proposal, record, nonce);
    } catch (error) {
      contractError = describeContractError(error);
    }
  }

  const evidence: SystemStatusContractEvidence = Object.freeze({
    ...(proposal !== undefined ? { proposal } : {}),
    ...(decision !== undefined ? { decision } : {}),
    ...(execution !== undefined ? { execution } : {}),
    ...(contractError !== undefined ? { contractError } : {}),
  });
  if (contractError !== undefined) {
    options.onWarning?.(
      `[orion-control] v2 system_status contract not certified: ${contractError}`,
    );
  }
  try {
    Object.defineProperty(record as ContractRecord, CONTRACT_EVIDENCE, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: evidence,
    });
  } catch {
    // A record that will not accept a hidden property is still a valid answer
    // to the user. Diagnostics are never worth failing the call for.
  }
  return record;
}

export function systemStatusContractEvidence(
  record: TaskRunRecord,
): SystemStatusContractEvidence | undefined {
  return (record as ContractRecord)[CONTRACT_EVIDENCE];
}
