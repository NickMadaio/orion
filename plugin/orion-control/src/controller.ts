import { randomUUID } from "node:crypto";
import path from "node:path";
import { ACTION_CATALOG, TIMEOUT_RETRY_SAFE, type CapabilityTier } from "./catalog.js";
import {
  ActionExecutionError,
  executeAction,
  verifyAction,
} from "./executors.js";
import { TaskLedger } from "./ledger.js";
import { cancelRequested, clearRun, markRunning } from "./cancellation.js";
import type {
  StepRecord,
  TaskGraph,
  TaskRunRecord,
  TrustProvenance,
} from "./types.js";
import { hash, validateTaskGraph } from "./validator.js";
import type { GateLevel, StrictnessMode } from "./strictness.js";

export interface RunOptions {
  ledgerPath: string;
  testWorkspaceRoot?: string;
  scratchWorkspaceRoot?: string;
  desktopRoot?: string;
  /** Read-only root for the `home_read` tier. */
  homeRoot?: string;
  /** Overridable for tests; defaults to the user's ~/.Trash. */
  trashRoot?: string;
  /** Configured browser for the `browser_control` tier. */
  browserPreference?: string;
  /** Reject arguments an action does not accept. Default off; see PHASE_4_PLAN.md. */
  strictArguments?: boolean;
  remindersPath?: string;
  /** Shared supplement/workout store, also read by the Orion dashboard. */
  healthLogPath?: string;
  defaultLocation?: string;
  enabledTiers?: ReadonlySet<CapabilityTier>;
  /** Harness-derived trust provenance recorded on the durable run record. */
  authorization?: TrustProvenance;
  /** Paths Orion already wrote under an authenticated turn (see provenance). */
  isSelfAuthored?: (candidate: string) => boolean;
  /**
   * Which canonical hashes a person has approved.
   *
   * Threaded through to the AUTHORITATIVE validation below rather than only to
   * the entry point's evidence copy. That distinction has bitten this file
   * before -- see the note on `strictArguments`: a gate wired only into the
   * copy looks live in the record and changes nothing about what runs.
   */
  approvalGrants?: (canonicalHash: string) => boolean;
  /**
   * The strictness delegation in force. Threaded here for the same reason
   * `approvalGrants` and `strictArguments` are: this is the validation that
   * gates execution, and a mode wired only into the entry point's evidence
   * copy would be a mode that looks live and changes nothing — which is
   * precisely what it was until 2026-09-04.
   */
  strictness?: {
    mode: StrictnessMode;
    except?: Readonly<Record<string, GateLevel>>;
  };
  /**
   * Called with the resolved target of every step that executed AND verified.
   *
   * Placed after verification on purpose: an attempted write that failed or
   * could not be observed does not earn the file a place in the registry.
   */
  onArtifact?: (target: string) => void;
  /** Uniqueness source for the task id; defaults to a fresh UUID. */
  nonce?: string;
  now?: () => Date;
  execute?: typeof executeAction;
  verify?: typeof verifyAction;
}

/**
 * Execution modes that leave Orion holding a file he wrote.
 *
 * `observed` and `opened` are reads, `simulated` never touched a disk, and
 * `trashed` removed the thing — none of them should make a path self-authored.
 */
const AUTHORING_MODES = new Set([
  "created",
  "already_present",
  "rebuilt",
  "appended",
  "replaced",
  "moved",
]);

/**
 * How many times a step may be retried after an attempt, by why it failed.
 * The plan's budget applies to both; a timeout on an action that is safe to
 * repeat gets at least one retry from the host (see TIMEOUT_RETRY_SAFE).
 */
export function retriesAllowed(action: string, budget: number, cause: "timeout" | "unverified"): number {
  if (cause === "timeout" && TIMEOUT_RETRY_SAFE.has(action)) return Math.max(1, budget);
  // A critical action, or an irreversible one a person had to approve (a
  // send, a removal), is never repeated whatever the plan's budget: "did not
  // verify" there is an unknown outcome, and a second run is a second send
  // (review, 2026-09-26: a stopped terminal_run with retryBudget 2 ran three
  // times). Irreversible writes that need no approval stay retryable: they are
  // hash-guarded, and a retry finds "already_present" rather than writing twice.
  const definition = ACTION_CATALOG[action];
  if (!definition || definition.risk === "critical" || (!definition.reversible && definition.approvalRequired)) return 0;
  return budget;
}

export async function runTaskGraph(
  graph: TaskGraph,
  options: RunOptions,
): Promise<TaskRunRecord> {
  const now = options.now ?? (() => new Date());
  const enabledTiers =
    options.enabledTiers ?? new Set<CapabilityTier>(["simulation"]);
  const execute = options.execute ?? executeAction;
  const verify = options.verify ?? verifyAction;
  const validation = validateTaskGraph(graph, {
    enabledTiers,
    ...(options.isSelfAuthored ? { isSelfAuthored: options.isSelfAuthored } : {}),
    // This is the authoritative validation -- the one that actually gates
    // execution. Wiring the flag only into the entry point's evidence copy
    // would produce a setting that looks live and changes nothing.
    ...(options.strictArguments ? { strictArguments: true } : {}),
    ...(options.approvalGrants ? { approvalGrants: options.approvalGrants } : {}),
    ...(options.strictness ? { strictness: options.strictness } : {}),
  });
  const createdAt = now().toISOString();
  // A nonce keeps task ids unique: two identical graphs submitted inside the
  // same millisecond previously collided, so a status lookup could return the
  // wrong run.
  const nonce = options.nonce ?? randomUUID();
  const taskId = `orion-${hash({ planHash: validation.planHash, createdAt, nonce }).slice(0, 16)}`;
  const record: TaskRunRecord = {
    taskId,
    planHash: validation.planHash,
    goal: graph.goal,
    status: validation.status,
    createdAt,
    ...(options.authorization ? { authorization: options.authorization } : {}),
    validation,
    steps: [],
  };
  const ledger = new TaskLedger(options.ledgerPath);
  const finish = async (): Promise<TaskRunRecord> => {
    record.completedAt = now().toISOString();
    await clearRun(options.ledgerPath, taskId).catch(() => {});
    const audit = await ledger.appendReporting(record);
    // Surface a failed audit write instead of throwing it over the run result.
    if (!audit.appended) record.audit = audit;
    return record;
  };

  if (validation.status !== "ready") return finish();

  const simulatedState = new Map<string, unknown>();
  const writeMemo = new Map<string, string>();
  // The authenticated user text, passed to executors that need it to add a
  // refusal (never to grant one). Authorization has already been decided by
  // `validateTaskGraph` before any of this runs.
  const trustedInstruction = graph.inputs
    .filter(
      (input) =>
        input.kind === "instruction" &&
        input.trust === "trusted_user" &&
        typeof input.content === "string",
    )
    .map((input) => input.content)
    .join("\n");
  const stepById = new Map(graph.steps.map((step) => [step.id, step]));
  // Listed while it runs, so a phone can see it and ask for it to stop.
  await markRunning(options.ledgerPath, {
    taskId, goal: graph.goal, startedAt: createdAt,
    actions: validation.executionOrder.map((id) => stepById.get(id)!.action),
    // Phase 52: what a terminal step will run, so the Mac app can show it while it does.
    commands: validation.executionOrder.map((id) => stepById.get(id)!)
      .filter((step) => step.action === "terminal_run").map((step) => String(step.arguments.command).slice(0, 300)),
  }).catch(() => {});
  for (const [index, stepId] of validation.executionOrder.entries()) {
    const step = stepById.get(stepId)!;
    if (cancelRequested(options.ledgerPath, taskId)) {
      record.cancelled = {
        at: now().toISOString(),
        completedSteps: index,
        notStarted: validation.executionOrder.slice(index).map((id) => stepById.get(id)!.action),
      };
      record.status = "failed";
      return finish();
    }
    const definition = ACTION_CATALOG[step.action]!;
    const executionContext = {
      cancelRequested: () => cancelRequested(options.ledgerPath, taskId),
      roots: {
        test_workspace:
          options.testWorkspaceRoot ??
          path.resolve(".orion-control", "test-workspace"),
        scratch_workspace:
          options.scratchWorkspaceRoot ??
          path.resolve(".orion-control", "scratch-workspace"),
        desktop:
          options.desktopRoot ??
          path.resolve(".orion-control", "disabled-desktop"),
        home:
          options.homeRoot ??
          path.resolve(".orion-control", "disabled-home"),
      },
      workingContext: graph.workingContext,
      simulatedState,
      writeMemo,
      ...(trustedInstruction ? { trustedInstruction } : {}),
      ...(options.trashRoot ? { trashRoot: options.trashRoot } : {}),
      ...(options.healthLogPath
        ? { healthLogPath: options.healthLogPath }
        : {}),
      ...(options.remindersPath
        ? { remindersPath: options.remindersPath }
        : {}),
      ...(options.defaultLocation
        ? { defaultLocation: options.defaultLocation }
        : {}),
      ...(options.browserPreference
        ? { browserPreference: options.browserPreference }
        : {}),
    };
    let lastError = "Action failed without a diagnostic.";
    let stepStatus: StepRecord["status"] | undefined;
    const maxAttempts = retriesAllowed(step.action, graph.retryBudget, "timeout") + 1;
    // A retry never starts once Nick has asked the run to stop.
    const mayRetry = (attempt: number, allowed: number): boolean =>
      attempt <= allowed && !cancelRequested(options.ledgerPath, taskId);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const execution = await execute(
          definition,
          step,
          executionContext,
        );
        const verification = await verify(
          definition,
          step,
          execution,
          executionContext,
        );
        if (!verification.observed) {
          lastError = "Independent verification did not observe the expected state.";
          if (mayRetry(attempt, retriesAllowed(step.action, graph.retryBudget, "unverified"))) continue;
        }
        const stepRecord: StepRecord = {
          stepId,
          status: verification.observed ? "verified" : "failed_permanent",
          attempts: attempt,
          idempotencyKey: execution.idempotencyKey,
          request: {
            action: step.action,
            arguments: step.arguments,
            sourceRefs: step.sourceRefs,
          },
          execution: {
            mode: execution.mode,
            ...(execution.target ? { target: execution.target } : {}),
            ...(execution.output !== undefined
              ? { output: execution.output }
              : {}),
          },
          // The exact inverse, so the ledger alone is enough to undo a move,
          // rename, or trash by hand.
          ...(execution.undo ? { undo: execution.undo } : {}),
          verification: {
            method: step.verify,
            observed: verification.observed,
            ...(verification.evidence
              ? { evidence: verification.evidence }
              : {}),
          },
          ...(!verification.observed ? { error: lastError } : {}),
        };
        record.steps.push(stepRecord);
        stepStatus = stepRecord.status;
        // A file Orion just wrote on Nick's authority stops being "content he
        // merely read about". Registering it here is what lets the next turn
        // say "add a line to it" without naming the file again.
        if (
          verification.observed &&
          typeof execution.target === "string" &&
          AUTHORING_MODES.has(execution.mode)
        ) {
          options.onArtifact?.(execution.target);
        }
        // Recorded means final, verified or not: the loop can run past the
        // plan's budget for a timeout retry, and must not re-execute here.
        break;
      } catch (error) {
        const controlled =
          error instanceof ActionExecutionError
            ? error
            : new ActionExecutionError("Unexpected executor failure.");
        lastError = controlled.message;
        if (controlled.retryable && mayRetry(attempt, retriesAllowed(step.action, graph.retryBudget, "timeout"))) continue;
        record.steps.push({
          stepId,
          status: "failed_permanent",
          attempts: attempt,
          idempotencyKey: hash({
            action: step.action,
            arguments: step.arguments,
            workingContext: graph.workingContext ?? "",
          }),
          request: {
            action: step.action,
            arguments: step.arguments,
            sourceRefs: step.sourceRefs,
          },
          execution: { mode: "failed" },
          verification: {
            method: step.verify,
            observed: false,
          },
          error: lastError,
        });
        stepStatus = "failed_permanent";
        break;
      }
    }
    // A stop that arrived during this step (a killed terminal command, say)
    // is recorded as a cancellation, not as an ordinary failure.
    const moreToDo = stepStatus !== "verified" || index + 1 < validation.executionOrder.length;
    if (moreToDo && cancelRequested(options.ledgerPath, taskId)) {
      const done = stepStatus === "verified" ? index + 1 : index;
      record.cancelled = {
        at: now().toISOString(),
        completedSteps: done,
        notStarted: validation.executionOrder.slice(index + 1).map((id) => stepById.get(id)!.action),
      };
      record.status = "failed";
      return finish();
    }
    // Judge this step, not whatever record happens to be last in the array.
    if (stepStatus !== "verified") {
      record.status = "failed";
      return finish();
    }
  }

  record.status = "succeeded";
  return finish();
}

export function defaultLedgerPath(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.resolve(".orion-control", "task-ledger.jsonl");
}
