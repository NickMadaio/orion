import { randomUUID } from "node:crypto";
import path from "node:path";
import { ACTION_CATALOG } from "./catalog.js";
import { ActionExecutionError, executeAction, verifyAction, } from "./executors.js";
import { TaskLedger } from "./ledger.js";
import { hash, validateTaskGraph } from "./validator.js";
export async function runTaskGraph(graph, options) {
    const now = options.now ?? (() => new Date());
    const enabledTiers = options.enabledTiers ?? new Set(["simulation"]);
    const execute = options.execute ?? executeAction;
    const verify = options.verify ?? verifyAction;
    const validation = validateTaskGraph(graph, { enabledTiers });
    const createdAt = now().toISOString();
    // A nonce keeps task ids unique: two identical graphs submitted inside the
    // same millisecond previously collided, so a status lookup could return the
    // wrong run.
    const nonce = options.nonce ?? randomUUID();
    const taskId = `orion-${hash({ planHash: validation.planHash, createdAt, nonce }).slice(0, 16)}`;
    const record = {
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
    const finish = async () => {
        record.completedAt = now().toISOString();
        const audit = await ledger.appendReporting(record);
        // Surface a failed audit write instead of throwing it over the run result.
        if (!audit.appended)
            record.audit = audit;
        return record;
    };
    if (validation.status !== "ready")
        return finish();
    const simulatedState = new Map();
    const writeMemo = new Map();
    const stepById = new Map(graph.steps.map((step) => [step.id, step]));
    for (const stepId of validation.executionOrder) {
        const step = stepById.get(stepId);
        const definition = ACTION_CATALOG[step.action];
        const executionContext = {
            roots: {
                test_workspace: options.testWorkspaceRoot ??
                    path.resolve(".orion-control", "test-workspace"),
                scratch_workspace: options.scratchWorkspaceRoot ??
                    path.resolve(".orion-control", "scratch-workspace"),
                desktop: options.desktopRoot ??
                    path.resolve(".orion-control", "disabled-desktop"),
            },
            workingContext: graph.workingContext,
            simulatedState,
            writeMemo,
        };
        let lastError = "Action failed without a diagnostic.";
        let stepStatus;
        for (let attempt = 1; attempt <= graph.retryBudget + 1; attempt += 1) {
            try {
                const execution = await execute(definition, step, executionContext);
                const verification = await verify(definition, step, execution, executionContext);
                if (!verification.observed) {
                    lastError = "Independent verification did not observe the expected state.";
                    if (attempt <= graph.retryBudget)
                        continue;
                }
                const stepRecord = {
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
                if (verification.observed)
                    break;
            }
            catch (error) {
                const controlled = error instanceof ActionExecutionError
                    ? error
                    : new ActionExecutionError("Unexpected executor failure.");
                lastError = controlled.message;
                if (controlled.retryable && attempt <= graph.retryBudget)
                    continue;
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
        // Judge this step, not whatever record happens to be last in the array.
        if (stepStatus !== "verified") {
            record.status = "failed";
            return finish();
        }
    }
    record.status = "succeeded";
    return finish();
}
export function defaultLedgerPath(configured) {
    return configured
        ? path.resolve(configured)
        : path.resolve(".orion-control", "task-ledger.jsonl");
}
