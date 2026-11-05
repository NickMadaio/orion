/*
 Runs a set of cases and sorts the verdicts. A case marked expectFail is allowed to fail (CI stays green, the count is printed);
 one that passes anyway is reported as "xpass" so the marker gets removed when somebody's fix lands.
*/
import { gradeOutcome } from "./grade.js";
import { playCase } from "./turn.js";
export function classify(c, failures, outcome) {
    if (c.skip)
        return { id: c.id, ...(c.audit ? { audit: c.audit } : {}), status: "skip", failures: [c.skip] };
    const broke = failures.length > 0;
    const status = c.expectFail ? (broke ? "xfail" : "xpass") : broke ? "fail" : "pass";
    return { id: c.id, ...(c.audit ? { audit: c.audit } : {}), status, failures, ...(outcome ? { outcome } : {}) };
}
export async function runDeterministic(cases) {
    const verdicts = [];
    for (const c of cases) {
        if (c.skip) {
            verdicts.push(classify(c, []));
            continue;
        }
        try {
            const outcome = await playCase(c);
            verdicts.push(classify(c, gradeOutcome(c.expect, outcome), outcome));
        }
        catch (error) {
            verdicts.push(classify(c, [`harness threw: ${error instanceof Error ? error.message : String(error)}`]));
        }
    }
    return verdicts;
}
export function summarize(verdicts) {
    const n = (s) => verdicts.filter((v) => v.status === s).length;
    return { total: verdicts.length, pass: n("pass"), fail: n("fail"), xfail: n("xfail"), xpass: n("xpass"), skip: n("skip") };
}
export const summaryLine = (s) => `${s.total} cases: ${s.pass} pass, ${s.fail} FAIL, ${s.xfail} expected-fail (known audit bugs), ${s.xpass} unexpectedly passing (remove expectFail), ${s.skip} skipped`;
/** A short report: every unexpected result in full, expected failures by audit id. */
export function report(verdicts) {
    const lines = [];
    for (const v of verdicts.filter((x) => x.status === "fail"))
        lines.push(`FAIL  ${v.id}${v.audit ? ` [${v.audit}]` : ""}\n        ${v.failures.join("\n        ")}\n        reply: ${JSON.stringify(v.outcome?.reply ?? "").slice(0, 160)}`);
    for (const v of verdicts.filter((x) => x.status === "xpass"))
        lines.push(`XPASS ${v.id}${v.audit ? ` [${v.audit}]` : ""}  passes now: remove its expectFail`);
    const known = verdicts.filter((x) => x.status === "xfail").map((x) => x.audit ?? x.id);
    if (known.length)
        lines.push(`XFAIL ${known.length} known: ${known.join(" ")}`);
    return lines.join("\n");
}
export const unreadable = (cases) => !Array.isArray(cases);
