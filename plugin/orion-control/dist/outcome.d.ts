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
export declare function describeOutcome(record: TaskRunRecord, graph: TaskGraph): RunOutcome;
