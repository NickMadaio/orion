import { createHash } from "node:crypto";
import path from "node:path";
import {
  ACTION_CATALOG,
  type CapabilityTier,
} from "./catalog.js";
import type {
  TaskGraph,
  TaskStep,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function canonicalActionHash(
  step: TaskStep,
  workingContext = "",
): string {
  return hash({
    action: step.action,
    arguments: step.arguments,
    workingContext,
  });
}

function topologicalOrder(
  graph: TaskGraph,
  issues: ValidationIssue[],
): string[] {
  const stepIds = new Set(graph.steps.map((step) => step.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const step of graph.steps) {
    incoming.set(step.id, 0);
    outgoing.set(step.id, []);
  }
  for (const step of graph.steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        issues.push({
          code: "missing_dependency",
          message: `Dependency '${dependency}' does not exist.`,
          stepId: step.id,
        });
        continue;
      }
      incoming.set(step.id, (incoming.get(step.id) ?? 0) + 1);
      outgoing.get(dependency)?.push(step.id);
    }
  }

  const queue = graph.steps
    .filter((step) => incoming.get(step.id) === 0)
    .map((step) => step.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const count = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, count);
      if (count === 0) queue.push(next);
    }
  }
  if (order.length !== graph.steps.length && !issues.some((issue) => issue.code === "missing_dependency")) {
    issues.push({
      code: "dependency_cycle",
      message: "The task graph contains a dependency cycle.",
    });
  }
  return order;
}

function validateNestedFolders(
  graph: TaskGraph,
  issues: ValidationIssue[],
): void {
  const folderSteps = graph.steps.filter(
    (step) => step.action === "folder_create" && typeof step.arguments.path === "string",
  );
  for (const child of folderSteps) {
    const childPath = path.resolve(child.arguments.path as string);
    for (const parent of folderSteps) {
      if (parent.id === child.id) continue;
      const parentPath = path.resolve(parent.arguments.path as string);
      if (path.dirname(childPath) === parentPath && !child.dependsOn.includes(parent.id)) {
        issues.push({
          code: "missing_parent_dependency",
          message: `Folder '${child.arguments.path}' must depend on parent step '${parent.id}'.`,
          stepId: child.id,
        });
      }
    }
  }
}

export interface ValidationOptions {
  enabledTiers?: ReadonlySet<CapabilityTier>;
}

/** Hard structural caps so a malformed graph fails validation, not the runtime. */
export const MAX_STEPS = 32;
export const MAX_INPUTS = 64;

export function validateTaskGraph(
  graph: TaskGraph,
  options: ValidationOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const planHash = hash(graph);
  const inputById = new Map(graph.inputs.map((input) => [input.id, input]));
  const ids = new Set<string>();
  const enabledTiers =
    options.enabledTiers ?? new Set<CapabilityTier>(["simulation"]);

  if (graph.retryBudget < 0 || graph.retryBudget > 2) {
    issues.push({
      code: "invalid_retry_budget",
      message: "retryBudget must be between 0 and 2.",
    });
  }
  if (graph.steps.length > MAX_STEPS) {
    issues.push({
      code: "graph_too_large",
      message: `A task graph may declare at most ${MAX_STEPS} steps.`,
    });
  }
  if (graph.inputs.length > MAX_INPUTS) {
    issues.push({
      code: "graph_too_large",
      message: `A task graph may declare at most ${MAX_INPUTS} inputs.`,
    });
  }
  // Structural trust gate: trust is minted only by `authorizeTaskGraph` from
  // harness provenance. If no trusted instruction input exists, no authenticated
  // user turn was bound to this tool call and every action must fail closed.
  if (
    graph.steps.length > 0 &&
    !graph.inputs.some(
      (input) =>
        input.kind === "instruction" && input.trust !== "untrusted_external",
    )
  ) {
    issues.push({
      code: "no_authenticated_user_turn",
      message:
        "No authenticated user turn was bound to this tool call, so no action can be authorized. Trust is derived from OpenClaw host provenance (message_received / llm_input / before_tool_call), never from the task graph.",
    });
  }
  for (const step of graph.steps) {
    if (ids.has(step.id)) {
      issues.push({
        code: "duplicate_step_id",
        message: `Step id '${step.id}' is duplicated.`,
        stepId: step.id,
      });
    }
    ids.add(step.id);

    const definition = ACTION_CATALOG[step.action];
    if (!definition) {
      issues.push({
        code: "unknown_action",
        message: `Action '${step.action}' is not in the Orion action catalog.`,
        stepId: step.id,
      });
      continue;
    }
    for (const argument of definition.requiredArguments) {
      if (!(argument in step.arguments) || step.arguments[argument] === "") {
        issues.push({
          code: "missing_argument",
          message: `Action '${step.action}' requires argument '${argument}'.`,
          stepId: step.id,
        });
      }
    }
    if (!enabledTiers.has(definition.capabilityTier)) {
      issues.push({
        code: "capability_disabled",
        message: `Action '${step.action}' belongs to disabled capability tier '${definition.capabilityTier}'.`,
        stepId: step.id,
      });
    }
    for (const message of definition.validateArguments?.(step.arguments) ?? []) {
      issues.push({
        code: "invalid_argument",
        message: `Action '${step.action}': ${message}.`,
        stepId: step.id,
      });
    }
    if (step.risk !== definition.risk) {
      issues.push({
        code: "risk_mismatch",
        message: `Action '${step.action}' must declare risk '${definition.risk}'.`,
        stepId: step.id,
      });
    }
    if (step.verify !== definition.verification) {
      issues.push({
        code: "verification_mismatch",
        message: `Action '${step.action}' must use verifier '${definition.verification}'.`,
        stepId: step.id,
      });
    }
    if (step.reversible !== definition.reversible) {
      issues.push({
        code: "reversibility_mismatch",
        message: `Action '${step.action}' must declare reversible '${definition.reversible}'.`,
        stepId: step.id,
      });
    }

    const sources = step.sourceRefs.map((source) => inputById.get(source));
    if (sources.some((source) => source === undefined)) {
      issues.push({
        code: "unknown_source",
        message: "Every sourceRefs entry must name an input.",
        stepId: step.id,
      });
    }
    if (!sources.some((source) => source?.kind === "instruction" && source.trust !== "untrusted_external")) {
      issues.push({
        code: "untrusted_instruction",
        message: "An action requires a trusted user or policy instruction source.",
        stepId: step.id,
      });
    }
    if (definition.directUserAuthorizationRequired) {
      const relativePath =
        definition.execution.kind === "app_control"
          ? step.arguments[definition.execution.applicationArgument]
          : "relativePathArgument" in definition.execution
          ? step.arguments[definition.execution.relativePathArgument]
          : undefined;
      const operation =
        definition.execution.kind === "app_control"
          ? definition.execution.operation
          : definition.execution.kind === "create_directory"
          ? "create"
          : definition.execution.kind === "mutate_text"
            ? definition.execution.operation
            : definition.execution.kind === "mutate_file"
              ? step.arguments[definition.execution.operationArgument]
              : undefined;
      const authorized = sources.some((source) => {
        if (
          source?.kind !== "instruction" ||
          source.trust !== "trusted_user" ||
          typeof source.content !== "string" ||
          typeof relativePath !== "string" ||
          typeof operation !== "string"
        ) {
          return false;
        }
        return (
          source.content.includes(relativePath) &&
          source.content.toLowerCase().includes(operation.toLowerCase())
        );
      });
      if (!authorized) {
        issues.push({
          code: "direct_user_authorization_required",
          message:
            "A direct trusted_user instruction must explicitly name the operation and exact target.",
          stepId: step.id,
        });
      }
    }

    if (definition.approvalRequired) {
      const canonicalHash = canonicalActionHash(step, graph.workingContext);
      if (step.approval?.status !== "approved" || step.approval.canonicalHash !== canonicalHash) {
        issues.push({
          code: "approval_required",
          message: `Action '${step.action}' requires approval bound to its canonical arguments and context.`,
          stepId: step.id,
          canonicalHash,
        });
      }
    }
  }

  validateNestedFolders(graph, issues);
  const executionOrder = topologicalOrder(graph, issues);
  const rejectionCodes = new Set([
    "invalid_retry_budget",
    "graph_too_large",
    "no_authenticated_user_turn",
    "duplicate_step_id",
    "unknown_action",
    "missing_argument",
    "invalid_argument",
    "capability_disabled",
    "risk_mismatch",
    "verification_mismatch",
    "reversibility_mismatch",
    "unknown_source",
    "untrusted_instruction",
    "direct_user_authorization_required",
    "missing_parent_dependency",
    "missing_dependency",
    "dependency_cycle",
  ]);
  const rejected = issues.some((issue) => rejectionCodes.has(issue.code));
  const needsApproval = issues.some((issue) => issue.code === "approval_required");
  const needsClarification = graph.steps.length === 0 && (graph.questions?.length ?? 0) > 0;
  const status = rejected
    ? "rejected"
    : needsApproval
      ? "needs_approval"
      : needsClarification
        ? "needs_clarification"
        : "ready";

  return {
    valid: status === "ready" || status === "needs_clarification",
    status,
    issues,
    executionOrder,
    planHash,
  };
}
