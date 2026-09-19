// Candidate dispatcher. Host adapters supply authority/context and execution;
// there is deliberately no scheduler entry point or production transport yet.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AUTOMATION_ACTIONS } from "../../plugin/orion-control/dist/automation.js";
import { initializeAutomationAdmission, reserveAutomationRun,
  initializeAutomationMessages, reserveAutomationMessage } from "./orion-automation-admission.mjs";

const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === "object"
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash("sha256").update(value).digest("hex");
function installation(value) {
  const record = JSON.parse(canonical(value));
  if (!record || !Object.hasOwn(AUTOMATION_ACTIONS, record.action) ||
      !["stop", "retry_once", "report_and_continue"].includes(record.failureBehavior) ||
      typeof record.installationId !== "string") throw new Error("invalid installation");
  const t = record.trigger;
  if (!t || !["daily", "hourly", "weekly"].includes(t.kind) || !integer(t.atMinute, 0, 59) ||
      (t.kind !== "hourly" && !integer(t.atHour, 0, 23)) ||
      (t.kind === "weekly" && !integer(t.weekday, 0, 6))) throw new Error("invalid trigger");
  if (record.delivery !== undefined && (!record.delivery || typeof record.delivery.targetId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(record.delivery.targetId) ||
      !integer(record.riskLimits?.maxMessagesPerDay, 0, 48))) throw new Error("invalid delivery policy");
  return { record, binding: digest(canonical(record)), key: digest(record.installationId) };
}
function scheduledSlot(record, at) {
  if (!Number.isSafeInteger(at) || at < 0 || at % 60000 !== 0) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: record.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(at).map(part => [part.type, part.value]));
  const t = record.trigger;
  if (Number(p.minute) !== t.atMinute || (t.kind !== "hourly" && Number(p.hour) !== t.atHour) ||
      (t.kind === "weekly" && ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) !== t.weekday)) return null;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
async function persist(root, file, value, initial = false) {
  const target = initial ? file : `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    if (!initial) await rename(target, file);
    const directory = await open(root, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { if (!initial) await unlink(target).catch(() => {}); }
}
export async function initializeAutomationDispatch(root, value) {
  const { record, binding, key } = installation(value);
  await initializeAutomationAdmission(join(root, "admission"), record);
  if (record.delivery) await initializeAutomationMessages(join(root, "messages"), record);
  await persist(root, join(root, `${key}.dispatch.json`), {
    version: 1, binding, phase: "ready", lastAt: null, lastSlot: null,
  }, true);
}

export async function dispatchAutomation(root, value, scheduledAt, adapters) {
  let installed, slot;
  try { installed = installation(value); slot = scheduledSlot(installed.record, scheduledAt); }
  catch { return { status: "refused", reason: "invalid_installation" }; }
  if (!slot) return { status: "refused", reason: "not_due" };
  const { record, binding, key } = installed;
  const file = join(root, `${key}.dispatch.json`), lock = `${file}.lock`;
  try { await mkdir(lock, { mode: 0o700 }); }
  catch { return { status: "refused", reason: "busy_or_unavailable" }; }
  let executedAttempts = 0;
  let actionCompleted = false, deliveryAttempted = false;
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    if (state.version !== 1 || state.binding !== binding ||
        !["ready", "pending", "stopped", "action_completed", "delivery_pending", "delivery_unknown"].includes(state.phase) ||
        (state.lastAt === null ? state.lastSlot !== null || state.phase !== "ready"
          : scheduledSlot(record, state.lastAt) !== state.lastSlot || !state.lastSlot)) {
      return { status: "refused", reason: "invalid_state" };
    }
    if (state.phase !== "ready") return { status: "refused",
      reason: state.phase === "pending" ? "outcome_unknown" : state.phase,
      actionCompleted: ["action_completed", "delivery_pending", "delivery_unknown"].includes(state.phase) };
    // Civil-slot comparison also suppresses the repeated hour at DST fall-back.
    if (state.lastAt !== null && (scheduledAt <= state.lastAt || slot <= state.lastSlot)) {
      return { status: "refused", reason: "duplicate_or_old_trigger" };
    }
    const action = Object.freeze({ name: record.action,
      argv: Object.freeze([...AUTOMATION_ACTIONS[record.action].argv]), installationId: record.installationId });
    const attempts = record.failureBehavior === "retry_once" ? 2 : 1;
    const abortAttempt = async reason => {
      if (executedAttempts > 0) {
        state.phase = "stopped";
        await persist(root, file, state);
      }
      return { status: executedAttempts > 0 ? "failed" : "refused", reason, attempts: executedAttempts };
    };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Re-read and re-authorize every attempt, including a retry. These are
      // trusted host adapters, never booleans or paths supplied by a model.
      const context = await adapters.readContext();
      if (!Number.isSafeInteger(context?.now) || context.now < scheduledAt || context.now - scheduledAt > 300000) {
        return await abortAttempt("stale_or_future_trigger");
      }
      if (await adapters.authorize(action) !== true) return await abortAttempt("not_authorized");
      const admission = await reserveAutomationRun(join(root, "admission"), record, context);
      if (!admission.admitted) return await abortAttempt(admission.reason);
      // A crash after reservation but before recording pending consumes quota;
      // execution starts only after this second durable boundary is complete.
      Object.assign(state, { phase: "pending", lastAt: scheduledAt, lastSlot: slot });
      await persist(root, file, state);
      let result;
      executedAttempts++;
      try { result = await adapters.execute(action); } catch { result = null; }
      // No inference from exit codes or error strings: retry requires a trusted
      // executor to certify that no side effect occurred. Unknown outcome stops.
      const known = result && typeof result.ok === "boolean";
      if (!known || (!result.ok && result.retrySafe !== true)) {
        state.phase = "stopped"; await persist(root, file, state);
        return { status: "outcome_unknown", attempts: attempt };
      }
      if (result.ok) {
        actionCompleted = true;
        state.phase = "action_completed"; await persist(root, file, state);
        const output = typeof result.output === "string" ? result.output.slice(0, 8192) : "";
        let delivery = { status: "not_requested" };
        if (record.delivery && output.trim()) {
          const message = Object.freeze({ installationId: record.installationId,
            targetId: record.delivery.targetId, body: output,
            idempotencyKey: digest(`${record.installationId}:${slot}`) });
          if (record.riskLimits.maxMessagesPerDay === 0) {
            delivery = { status: "withheld", reason: "daily_message_limit" };
          } else if (typeof adapters.authorizeDelivery !== "function" || typeof adapters.deliver !== "function") {
            delivery = { status: "withheld", reason: "delivery_adapter_unavailable" };
          } else if (await adapters.authorizeDelivery(message) !== true) {
            delivery = { status: "withheld", reason: "delivery_not_authorized" };
          } else {
            // Execution may have crossed midnight, expiry or quiet hours. Read
            // fresh conditions after checking authority for exact content+target.
            const current = await adapters.readContext();
            // Separate ledgers must share a clock floor: a fresh message ledger
            // cannot charge yesterday after today's action was already admitted.
            const budget = !Number.isSafeInteger(current?.now)
              ? { admitted: false, reason: "invalid_clock" }
              : current.now < context.now ? { admitted: false, reason: "clock_regressed" }
              : await reserveAutomationMessage(join(root, "messages"), record, current);
            if (!budget.admitted) delivery = { status: "withheld", reason: budget.reason };
            else {
              state.phase = "delivery_pending"; await persist(root, file, state);
              deliveryAttempted = true;
              let receipt;
              try { receipt = await adapters.deliver(message); } catch { receipt = null; }
              delivery = receipt?.delivered === true ? { status: "delivered" }
                : receipt?.delivered === false ? { status: "not_delivered" } : { status: "unknown" };
            }
          }
        } else if (record.delivery) delivery = { status: "withheld", reason: "empty_output" };
        // Outbound uncertainty is never retried, even under retry_once. It also
        // cannot turn a completed action into an action eligible for re-execution.
        state.phase = delivery.status === "unknown" ? "delivery_unknown" : "ready";
        state.lastDelivery = delivery.status; await persist(root, file, state);
        return { status: "succeeded", attempts: attempt, output, delivery };
      }
      // Keep retry decisions non-ready: losing context/authority between attempts
      // must not silently re-enable the next scheduled event after an error.
      state.phase = record.failureBehavior === "report_and_continue" ? "ready" : attempt < attempts ? "pending" : "stopped";
      await persist(root, file, state);
      if (attempt === attempts) return { status: "failed", attempts: attempt };
    }
  } catch {
    if (actionCompleted) return { status: "succeeded", attempts: executedAttempts,
      delivery: { status: deliveryAttempted ? "unknown" : "not_attempted", reason: "state_or_adapter_unavailable" } };
    return { status: executedAttempts > 0 ? "outcome_unknown" : "refused",
      reason: "state_or_adapter_unavailable", attempts: executedAttempts };
  }
  finally { await rmdir(lock); }
}
