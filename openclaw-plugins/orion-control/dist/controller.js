import { randomUUID } from "node:crypto";
import path from "node:path";
import { ACTION_CATALOG } from "./catalog.js";
import { ActionExecutionError, executeAction, verifyAction, } from "./executors.js";
import { TaskLedger } from "./ledger.js";
import { hash, validateTaskGraph } from "./validator.js";
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
export async function runTaskGraph(graph, options) {
    const now = options.now ?? (() => new Date());
    const enabledTiers = options.enabledTiers ?? new Set(["simulation"]);
    const execute = options.execute ?? executeAction;
    const verify = options.verify ?? verifyAction;
    const validation = validateTaskGraph(graph, {
        enabledTiers,
        ...(options.isSelfAuthored ? { isSelfAuthored: options.isSelfAuthored } : {}),
    });
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
    // The authenticated user text, passed to executors that need it to add a
    // refusal (never to grant one). Authorization has already been decided by
    // `validateTaskGraph` before any of this runs.
    const trustedInstruction = graph.inputs
        .filter((input) => input.kind === "instruction" &&
        input.trust === "trusted_user" &&
        typeof input.content === "string")
        .map((input) => input.content)
        .join("\n");
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
                home: options.homeRoot ??
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
                if (verification.observed &&
                    typeof execution.target === "string" &&
                    AUTHORING_MODES.has(execution.mode)) {
                    options.onArtifact?.(execution.target);
                }
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
