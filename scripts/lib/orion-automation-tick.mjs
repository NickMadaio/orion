import { runInstalledAutomation } from "./orion-automation-runtime.mjs";

// A scheduler wake-up is evaluated in its current minute. Missed slots are not
// reconstructed or caught up; the dispatcher validates the installed trigger.
export async function automationTick(args, { now = Date.now, run = runInstalledAutomation } = {}) {
  if (args.length !== 1 || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(args[0])) {
    return { exitCode: 2, summary: { status: "refused", reason: "invalid_arguments" } };
  }
  try {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("invalid clock");
    const result = await run(args[0], Math.floor(at / 60000) * 60000);
    // Scheduler history must not contain calendar text, stderr or arbitrary
    // adapter fields. Keep only closed status values and a bounded reason code.
    const statuses = ["succeeded", "refused", "failed", "outcome_unknown"];
    if (!statuses.includes(result?.status)) throw new Error("invalid result");
    const summary = { status: result.status };
    if (typeof result.reason === "string" && /^[a-z_]{1,80}$/.test(result.reason)) summary.reason = result.reason;
    return { exitCode: result.status === "succeeded" ? 0 : 1, summary };
  } catch { return { exitCode: 1, summary: { status: "refused", reason: "runtime_unavailable" } }; }
}
