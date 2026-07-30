import type { Risk } from "./catalog.js";
import type { TrustBinding, TrustTurnSource } from "./provenance.js";

export type Trust = "trusted_user" | "trusted_policy" | "untrusted_external";

/**
 * An input to a TaskGraph.
 *
 * `trust` is assigned by `authorizeTaskGraph` from harness provenance. The
 * model-facing tool schema has no `trust` field, so a model-supplied value can
 * never reach here.
 */
export interface TaskInput {
  id: string;
  kind: "instruction" | "observation";
  trust: Trust;
  content?: string;
}

/** How the harness established trust for one tool call. */
export interface TrustProvenance {
  binding: TrustBinding;
  turnCount: number;
  sources: TrustTurnSource[];
  runId?: string;
  sessionKey?: string;
}

export interface Approval {
  status: "approved";
  canonicalHash: string;
}

export interface TaskStep {
  id: string;
  action: string;
  arguments: Record<string, unknown>;
  dependsOn: string[];
  risk: Risk;
  expectedEffect: string;
  verify: string;
  sourceRefs: string[];
  reversible: boolean;
  approval?: Approval;
}

export interface TaskGraph {
  version: "1";
  goal: string;
  workingContext?: string;
  inputs: TaskInput[];
  assumptions: string[];
  questions?: string[];
  retryBudget: number;
  steps: TaskStep[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  stepId?: string;
  canonicalHash?: string;
}

export interface ValidationResult {
  valid: boolean;
  status: "ready" | "needs_clarification" | "needs_approval" | "rejected";
  issues: ValidationIssue[];
  executionOrder: string[];
  planHash: string;
}

export interface StepRecord {
  stepId: string;
  status: "verified" | "failed_permanent";
  attempts: number;
  idempotencyKey: string;
  request: {
    action: string;
    arguments: Record<string, unknown>;
    sourceRefs: string[];
  };
  execution: {
    mode:
      | "simulated"
      | "created"
      | "appended"
      | "replaced"
      | "opened"
      | "quit"
      | "already_present"
      | "observed"
      | "failed";
    target?: string;
    output?: unknown;
  };
  verification: {
    method: string;
    observed: boolean;
    evidence?: string;
  };
  error?: string;
}

export interface TaskRunRecord {
  taskId: string;
  planHash: string;
  goal: string;
  status: ValidationResult["status"] | "succeeded" | "failed";
  createdAt: string;
  completedAt?: string;
  /** Harness-derived trust provenance for the tool call that produced this run. */
  authorization?: TrustProvenance;
  validation: ValidationResult;
  steps: StepRecord[];
  /** Durability of the append-only ledger write for this record. */
  audit?: { appended: boolean; error?: string };
}
