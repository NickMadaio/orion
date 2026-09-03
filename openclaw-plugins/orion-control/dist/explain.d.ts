import type { TaskRunRecord } from "./types.js";
export declare const CONFIDENCE_LEVELS: readonly ["known", "observed", "inferred", "uncertain", "unable_to_verify"];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
/** How to say it out loud, which is the only form Nick ever hears. */
export declare const CONFIDENCE_PHRASE: Record<Confidence, string>;
/**
 * The vocabulary `orion-note` already uses, mapped rather than replaced.
 *
 * The brain has had an `--epistemic` field since 2026-09-02 with four values,
 * and rewriting them would orphan every note already written. They map cleanly
 * onto four of the five levels; `unable_to_verify` has no note equivalent
 * because a note that could not be verified does not get written.
 */
export declare const EPISTEMIC_TO_CONFIDENCE: Record<string, Confidence>;
/** Is this a claim Nick should act on without checking? Only the top two. */
export declare const isActionable: (confidence: Confidence) => boolean;
export interface StepExplanation {
    step: string;
    action: string;
    status: string;
    confidence: Confidence;
    /** What was actually observed, verbatim from the record. Never paraphrased. */
    evidence: string | null;
    /** The catalog rule that governed it. */
    policy: string;
}
/**
 * One step's confidence, from what the record holds and nothing else.
 *
 * Order matters and is a decision. `verified` outranks `succeeded` because an
 * independent check ran; `succeeded` is `inferred` rather than `observed`
 * however cleanly it exited, because "the tool did not throw" and "the thing
 * is true" are different claims and this program has confused them before.
 */
export declare function confidenceOfStep(step: Record<string, unknown>): Confidence;
/**
 * Everything Phase 63 asks to expose, and nothing it asks to withhold.
 *
 * Returns a structure rather than prose, so the caller decides whether it is
 * spoken, printed or serialised, and so that a missing field is visibly
 * missing instead of being smoothed over by a sentence.
 */
export interface RunExplanation {
    taskId: string;
    goal: string;
    status: string;
    when: string;
    /** PROVENANCE: whether a real user turn was bound to this run, and how. */
    provenance: {
        authorized: boolean;
        detail: string;
    };
    /** POLICY: the rules that applied, named. */
    policy: string[];
    /** CONSTRAINTS: what stopped it, or would have. */
    constraints: string[];
    /** INPUTS and EVIDENCE, per step. */
    steps: StepExplanation[];
    /** The weakest confidence in the run, because that is what bounds the whole. */
    confidence: Confidence;
}
export declare function explainRun(record: TaskRunRecord): RunExplanation;
/**
 * The spoken answer to "why?".
 *
 * Assembled, never narrated. Every clause below points at a recorded fact, and
 * when a fact is missing the sentence says it is missing rather than filling
 * the gap.
 */
export declare function speakExplanation(explanation: RunExplanation): string;
