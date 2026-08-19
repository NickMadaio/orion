import type { TaskGraph, TaskRunRecord } from "./types.js";

/**
 * Say what actually happened, in words a small model cannot skim past.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 2026-08-13 Nick asked Orion to text someone. The validator correctly
 * returned `needs_approval` and NOTHING WAS SENT. Orion then told him it had
 * been sent. That is the worst failure this system can have: an assistant that
 * cannot send a message is a limitation, and an assistant that says it sent one
 * when it did not is a liar, and Nick has no way to tell the two apart until
 * the consequence arrives.
 *
 * The tool result he was reading looked like this:
 *
 *     { "taskId": "orion-b7c9…", "planHash": "7dfab…", "goal": "Run messages_send",
 *       "status": "needs_approval", "createdAt": "…",
 *       "validation": { "valid": false, "status": "needs_approval",
 *         "issues": [ { "code": "approval_required", "message": "…", … } ] },
 *       "steps": [] }
 *
 * Every fact needed to know the send did not happen is in there. But the word
 * "rejected" never appears, `steps: []` is an ABSENCE rather than a statement,
 * the only human sentence is buried two levels down inside an array, and the
 * top-level key that reads most like an outcome is `"goal"` — which names the
 * thing he was asked to do, not the thing that happened. A 4.5-class model
 * reading that at the end of a long turn concludes it worked.
 *
 * So this is not a prompt fix. The result itself now leads with the outcome:
 * a boolean, a shouted phrase, and the exact sentence to say to Nick. Those
 * four keys are emitted FIRST, before `taskId` and before `goal`, because key
 * order is what a skimming reader actually reads.
 *
 * `executed` is emitted on EVERY outcome including success, deliberately. A
 * field that only appears on failure teaches the reader that absence means
 * success, and absence is exactly what it misread the first time.
 */

export interface RunOutcome {
  /** Did anything actually change in the world? */
  executed: boolean;
  /** Shouted, unmissable, first key in the object. */
  outcome: string;
  /** The sentence to say to Nick. Copy it; do not improve on it. */
  reportToUser: string;
  /** Present only when the run can be completed by re-running it. */
  nextStep?: {
    instruction: string;
    afterNickSaysYes: Record<string, unknown>;
  };
}

/** The catalog actions whose failure a user is most likely to be told about. */
function actionNoun(action: string | undefined): string {
  if (action === "messages_send") return "NO MESSAGE WAS SENT";
  return "NOTHING WAS DONE";
}

/** Plain-language name for what was being attempted, for the spoken sentence. */
function attemptNoun(action: string | undefined): string {
  if (action === "messages_send") return "send that message";
  return "do that";
}

/**
 * The step that stopped the run, and the issue that stopped it.
 *
 * A graph is usually one step here — the compact `{ action, arguments }` form
 * that the OpenClaw dispatcher forwards — so "the first blocking issue" and
 * "the reason" are the same thing in practice.
 */
function blockingIssue(
  record: TaskRunRecord,
): { code: string; message: string; stepId?: string; canonicalHash?: string } | undefined {
  const issues = record.validation.issues;
  return (
    issues.find((issue) => issue.code === "approval_required") ?? issues.at(0)
  );
}

export function describeOutcome(
  record: TaskRunRecord,
  graph: TaskGraph,
): RunOutcome {
  const issue = blockingIssue(record);
  const step =
    graph.steps.find((candidate) => candidate.id === issue?.stepId) ??
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
      reportToUser:
        `I have NOT ${attemptNoun(action)} yet — I need you to confirm first. ` +
        `Do you want me to go ahead?`,
      nextStep: {
        instruction:
          "STOP. Do not tell Nick this is done, because it is not. Ask him to " +
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
    reportToUser:
      `I could not ${attemptNoun(action)}.` +
      (reason ? ` ${reason}` : "") +
      (verified.length > 0
        ? ` (${verified.length} earlier step(s) did complete.)`
        : ""),
  };
}
