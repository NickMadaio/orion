import { ACTION_CATALOG } from "./catalog.js";
/*
 PHASES 63 AND 64 — why, and how sure.

 One file because they are one question. "Why did you do that" and "how do you
 know" have the same answer shape and the same failure mode, which is a fluent
 sentence with nothing underneath it.

 ## The rule that decides the whole design

 Phase 63: "Do not expose private hidden chain-of-thought. Expose: inputs;
 evidence; policy; provenance; relevant constraints."

 The strongest possible reading of that is not a filter over what the model
 says. It is that the explanation is not produced by the model AT ALL. Every
 sentence below is assembled from a durable record that was written when the
 thing happened -- the task ledger, the catalog's own metadata, the trust
 provenance -- by code that has no reasoning to leak because it does no
 reasoning.

 That also fixes the failure this program keeps hitting from a different angle.
 Orion has answered questions about himself from memory and been confidently
 wrong; SOUL.md now tells him to call a tool instead. An explanation narrated
 by the model is the same defect wearing a different hat: it would be a
 plausible story about what happened rather than a report of it.

 ## Confidence is derived, never claimed

 Phase 64 names five levels. The temptation is a field the model fills in, and
 a model that can write `confidence: "known"` will. So every level here is
 derived from what the record actually contains:

   known             the catalog defines it. It is a fact about Orion's own
                     shape and cannot be wrong without the code being wrong.
   observed          an independent verifier looked and reported evidence.
                     This is the strongest thing that can be said about an
                     effect in the world.
   inferred          it ran and reported success, and nothing checked. True
                     more often than not, and not the same as observed.
   uncertain         it was attempted and the outcome is genuinely unclear --
                     a retry, a partial, a timeout.
   unable_to_verify  the check itself could not run. Distinct from `uncertain`
                     on purpose: "I looked and cannot tell" and "I could not
                     look" are different sentences, and collapsing them is how
                     "no access" becomes "nothing scheduled".

 The last distinction is not theoretical. `orion-standing` was built around it
 after reporting a clear day when the truth was that Reminders had never been
 granted.
*/
export const CONFIDENCE_LEVELS = [
    "known",
    "observed",
    "inferred",
    "uncertain",
    "unable_to_verify",
];
/** How to say it out loud, which is the only form Nick ever hears. */
export const CONFIDENCE_PHRASE = {
    known: "I know this",
    observed: "I checked and saw it",
    inferred: "it reported success and nothing checked",
    uncertain: "I am not sure",
    unable_to_verify: "I could not check",
};
/**
 * The vocabulary `orion-note` already uses, mapped rather than replaced.
 *
 * The brain has had an `--epistemic` field since 2026-09-02 with four values,
 * and rewriting them would orphan every note already written. They map cleanly
 * onto four of the five levels; `unable_to_verify` has no note equivalent
 * because a note that could not be verified does not get written.
 */
export const EPISTEMIC_TO_CONFIDENCE = {
    "user-stated": "known",
    observed: "observed",
    "source-derived": "observed",
    inference: "inferred",
};
/** Is this a claim Nick should act on without checking? Only the top two. */
export const isActionable = (confidence) => confidence === "known" || confidence === "observed";
/**
 * One step's confidence, from what the record holds and nothing else.
 *
 * Order matters and is a decision. `verified` outranks `succeeded` because an
 * independent check ran; `succeeded` is `inferred` rather than `observed`
 * however cleanly it exited, because "the tool did not throw" and "the thing
 * is true" are different claims and this program has confused them before.
 */
export function confidenceOfStep(step) {
    const status = String(step.status ?? "");
    const verification = step.verification;
    if (status === "verified" && verification?.observed === true)
        return "observed";
    if (status === "verified") {
        // Marked verified with nothing observed: the verifier ran and could not
        // see. That is the case `unable_to_verify` exists for.
        return "unable_to_verify";
    }
    if (status === "succeeded")
        return "inferred";
    if (status === "failed" || status === "rejected")
        return "known";
    return "uncertain";
}
export function explainRun(record) {
    const raw = record;
    const steps = raw.steps ?? [];
    const validation = raw.validation ?? {};
    const issues = validation.issues ?? [];
    const explained = steps.map((step) => {
        const request = step.request ?? {};
        const action = String(request.action ?? step.stepId ?? "unknown");
        const definition = ACTION_CATALOG[action];
        const verification = step.verification;
        return {
            step: String(step.stepId ?? "?"),
            action,
            status: String(step.status ?? "unknown"),
            confidence: confidenceOfStep(step),
            // Verbatim. A paraphrased piece of evidence is a claim about evidence.
            evidence: typeof verification?.evidence === "string" ? verification.evidence : null,
            policy: definition
                ? `tier ${definition.capabilityTier}, risk ${definition.risk}, ` +
                    `${definition.reversible ? "reversible" : "NOT reversible"}` +
                    `${definition.approvalRequired ? ", approval required" : ""}`
                : "no catalog entry — this action is not one Orion defines",
        };
    });
    const authorization = raw.authorization;
    return {
        taskId: String(raw.taskId ?? "?"),
        goal: String(raw.goal ?? ""),
        status: String(raw.status ?? "unknown"),
        when: String(raw.createdAt ?? ""),
        provenance: authorization
            ? {
                authorized: true,
                detail: `bound to a real user turn (${String(authorization.source ?? "harness")})` +
                    (authorization.boundAt ? ` at ${String(authorization.boundAt)}` : ""),
            }
            : {
                authorized: false,
                detail: "no trust anchor recorded on this run. Either it predates provenance " +
                    "recording or no authenticated turn was bound to it, and in the second " +
                    "case nothing would have been allowed to run.",
            },
        policy: [...new Set(explained.map((step) => step.policy))],
        // Verbatim messages, in the order the validator produced them.
        constraints: issues.map((issue) => `${String(issue.code)}: ${String(issue.message ?? "")}`),
        steps: explained,
        // The WEAKEST, not the average. A run is only as trustworthy as the part
        // of it nobody checked, and averaging would let one verified read carry an
        // unverified write.
        confidence: explained.length
            ? CONFIDENCE_LEVELS.filter((level) => explained.some((step) => step.confidence === level)).pop()
            : "unable_to_verify",
    };
}
/**
 * The spoken answer to "why?".
 *
 * Assembled, never narrated. Every clause below points at a recorded fact, and
 * when a fact is missing the sentence says it is missing rather than filling
 * the gap.
 */
export function speakExplanation(explanation) {
    const lines = [];
    lines.push(`You asked: ${explanation.goal || "(no goal recorded)"}`);
    lines.push(`It ${explanation.status === "succeeded" ? "ran" : `came back ${explanation.status}`}.`);
    for (const step of explanation.steps) {
        const evidence = step.evidence ? ` Evidence: ${step.evidence}.` : "";
        lines.push(`- ${step.action}: ${step.status}. ${CONFIDENCE_PHRASE[step.confidence]}.${evidence}`);
        lines.push(`  Governed by: ${step.policy}.`);
    }
    if (explanation.constraints.length > 0) {
        lines.push("What stopped it:");
        for (const constraint of explanation.constraints)
            lines.push(`- ${constraint}`);
    }
    lines.push(`Authorization: ${explanation.provenance.detail}`);
    lines.push(`Overall: ${CONFIDENCE_PHRASE[explanation.confidence]} — that is the weakest part of the run, not an average.`);
    return lines.join("\n");
}
