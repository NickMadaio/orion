/** The catalog actions whose failure a user is most likely to be told about. */
function actionNoun(action) {
    if (action === "messages_send")
        return "NO MESSAGE WAS SENT";
    return "NOTHING WAS DONE";
}
/** Plain-language name for what was being attempted, for the spoken sentence. */
function attemptNoun(action) {
    if (action === "messages_send")
        return "send that message";
    return "do that";
}
/**
 * The step that stopped the run, and the issue that stopped it.
 *
 * A graph is usually one step here — the compact `{ action, arguments }` form
 * that the OpenClaw dispatcher forwards — so "the first blocking issue" and
 * "the reason" are the same thing in practice.
 */
function blockingIssue(record) {
    const issues = record.validation.issues;
    return (issues.find((issue) => issue.code === "approval_required") ?? issues.at(0));
}
export function describeOutcome(record, graph) {
    const issue = blockingIssue(record);
    const step = graph.steps.find((candidate) => candidate.id === issue?.stepId) ??
        graph.steps.at(0);
    const action = step?.action;
    if (record.status === "succeeded") {
        return {
            executed: true,
            outcome: "DONE — this really happened",
            reportToUser: "Done.",
        };
    }
    if (record.status === "needs_approval" && issue?.canonicalHash && step) {
        return {
            executed: false,
            outcome: `${actionNoun(action)}. NOT DONE. THIS IS NOT A SUCCESS.`,
            reportToUser: `I have NOT ${attemptNoun(action)} yet — I need you to confirm first. ` +
                `Do you want me to go ahead?`,
            nextStep: {
                instruction: "STOP. Do not tell Nick this is done, because it is not. Ask him to " +
                    "confirm, in this turn, using the sentence in reportToUser. If and " +
                    "ONLY IF he then says yes, call orion_task_run again with exactly " +
                    "the payload in afterNickSaysYes. Nothing happens until you make " +
                    "that second call. If he says no, or says nothing about it, do not " +
                    "make it.",
                // The graph form, filled in and valid, because that is the form the
                // tool description leads with and therefore the form the model is
                // already in. Handing back the SAME shape it just sent — with the one
                // missing field added — is a smaller edit than asking it to switch
                // call styles mid-approval, and a smaller edit is one it gets right.
                // Any spelling of the hash is accepted anyway (see
                // `approvalCanonicalHash`); this one is simply copy-pasteable.
                afterNickSaysYes: {
                    graph: {
                        goal: graph.goal,
                        steps: [
                            {
                                id: step.id,
                                action: step.action,
                                arguments: step.arguments,
                                approval: {
                                    status: "approved",
                                    canonicalHash: issue.canonicalHash,
                                },
                            },
                        ],
                    },
                },
            },
        };
    }
    if (record.status === "needs_clarification") {
        return {
            executed: false,
            outcome: `${actionNoun(action)}. NOT DONE — the request was ambiguous.`,
            reportToUser: "I need one more detail before I can do that.",
        };
    }
    // `rejected` and `failed`. A partially-run graph is reported as not done:
    // the honest summary of "step one wrote a file, step two failed" is that the
    // thing Nick asked for did not happen.
    const verified = record.steps.filter((entry) => entry.status === "verified");
    const reason = issue?.message ?? record.steps.at(-1)?.error;
    return {
        executed: false,
        outcome: `${actionNoun(action)}. NOT DONE. THIS IS NOT A SUCCESS.`,
        reportToUser: `I could not ${attemptNoun(action)}.` +
            (reason ? ` ${reason}` : "") +
            (verified.length > 0
                ? ` (${verified.length} earlier step(s) did complete.)`
                : ""),
    };
}
