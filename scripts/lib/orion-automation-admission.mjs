// Candidate runtime admission guard. This does not grant action authority or
// install schedules. Its state directory must be supplied by the trusted host.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";

const MODES = new Set(["contained", "guarded", "open", "sovereign"]);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function binding(record, budget = "runs") {
  if (!record || typeof record.name !== "string" || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(record.name) ||
      typeof record.installationId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(record.installationId) ||
      !validDay(record.expiresOn) || !integer(record.riskLimits?.maxRunsPerDay, 1, 1440) ||
      !MODES.has(record.permissions?.expectsMode) || !record.conditions ||
      typeof record.conditions !== "object" || Array.isArray(record.conditions) ||
      (record.conditions.skipDuringFocus !== undefined && typeof record.conditions.skipDuringFocus !== "boolean")) {
    throw new Error("invalid installation policy");
  }
  const quiet = record.conditions.quietHours;
  if (quiet !== undefined && (!Array.isArray(quiet) || quiet.length !== 2 ||
      !quiet.every(hour => integer(hour, 0, 23)))) throw new Error("invalid quiet hours");
  if (typeof record.timeZone !== "string" ||
      !(record.timeZone === "UTC" || Intl.supportedValuesOf("timeZone").includes(record.timeZone))) {
    throw new Error("an explicit supported IANA timezone is required");
  }
  const policy = { name: record.name, installationId: record.installationId,
    timeZone: record.timeZone, expiresOn: record.expiresOn,
    maxRunsPerDay: record.riskLimits.maxRunsPerDay,
    expectsMode: record.permissions.expectsMode,
    quietHours: quiet ?? null, skipDuringFocus: record.conditions.skipDuringFocus ?? false };
  if (budget === "messages") {
    if (!integer(record.riskLimits.maxMessagesPerDay, 0, 48)) throw new Error("invalid message limit");
    policy.maxMessagesPerDay = record.riskLimits.maxMessagesPerDay;
  }
  return { policy, limit: budget === "messages" ? policy.maxMessagesPerDay : policy.maxRunsPerDay,
    hash: createHash("sha256").update(JSON.stringify(policy)).digest("hex") };
}
function paths(root, installationId, budget = "runs") {
  const key = createHash("sha256").update(budget === "messages" ? `messages:${installationId}` : installationId).digest("hex");
  return { state: join(root, `${key}.json`), lock: join(root, `${key}.lock`) };
}
async function writeNew(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(root) {
  const handle = await open(root, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
function localClock(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
// Only the human installation path may initialize. Runtime never recreates a
// missing file: doing so would turn deletion or storage loss into a quota reset.
async function initializeBudget(root, record, budget) {
  const { hash } = binding(record, budget);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeNew(paths(root, record.installationId, budget).state,
    { version: 1, binding: hash, day: null, runs: 0, lastAt: 0 });
  await syncDirectory(root);
}
export const initializeAutomationAdmission = (root, record) => initializeBudget(root, record, "runs");
export const initializeAutomationMessages = (root, record) => initializeBudget(root, record, "messages");
export const reserveAutomationRun = (root, record, context) => reserveBudget(root, record, context, "runs");
export const reserveAutomationMessage = (root, record, context) => reserveBudget(root, record, context, "messages");

async function reserveBudget(root, record, context, budget) {
  let bound;
  try { bound = binding(record, budget); } catch { return { admitted: false, reason: "invalid_policy" }; }
  const { policy, hash, limit } = bound;
  const now = context?.now;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    return { admitted: false, reason: "invalid_clock" };
  }
  // Effective mode must already include delegation expiry. Equality records
  // expectations; it is never an authority grant for the action itself.
  if (!MODES.has(context.effectiveMode) || context.effectiveMode !== policy.expectsMode) {
    return { admitted: false, reason: "mode_mismatch" };
  }
  const { day, hour } = localClock(now, policy.timeZone);
  if (!validDay(day)) return { admitted: false, reason: "invalid_clock" };
  if (day > policy.expiresOn) return { admitted: false, reason: "expired" };
  const quiet = policy.quietHours;
  if (quiet && (quiet[0] < quiet[1] ? hour >= quiet[0] && hour < quiet[1]
    : quiet[0] > quiet[1] && (hour >= quiet[0] || hour < quiet[1]))) {
    return { admitted: false, reason: "quiet_hours" };
  }
  if (policy.skipDuringFocus && context.focusActive !== false) {
    return { admitted: false, reason: context.focusActive === true ? "focus_active" : "focus_unknown" };
  }
  const file = paths(root, record.installationId, budget);
  try { await mkdir(file.lock, { mode: 0o700 }); }
  catch (error) { return { admitted: false, reason: error.code === "EEXIST" ? "busy" : "state_unavailable" }; }
  let temporary;
  try {
    const state = JSON.parse(await readFile(file.state, "utf8"));
    if (state.version !== 1 || state.binding !== hash ||
        !integer(state.runs, 0, budget === "messages" ? 48 : 1440) || !Number.isSafeInteger(state.lastAt) || state.lastAt < 0 ||
        (state.day !== null && (!validDay(state.day) || state.runs < 1 ||
          !Number.isFinite(new Date(state.lastAt).getTime()) ||
          localClock(state.lastAt, policy.timeZone).day !== state.day)) ||
        (state.day === null && (state.runs !== 0 || state.lastAt !== 0))) {
      return { admitted: false, reason: "invalid_state" };
    }
    if (now < state.lastAt || (state.day !== null && day < state.day)) {
      return { admitted: false, reason: "clock_regressed" };
    }
    const runs = state.day === day ? state.runs : 0;
    if (runs >= limit) return { admitted: false, reason: budget === "messages" ? "daily_message_limit" : "daily_limit" };
    temporary = `${file.state}.${randomUUID()}.tmp`;
    await writeNew(temporary, { version: 1, binding: hash, day, runs: runs + 1, lastAt: now });
    await rename(temporary, file.state);
    temporary = undefined;
    await syncDirectory(root);
    // No refunds: failure or process death after this point still consumes an
    // attempt. A failed durable write never returns admission.
    return budget === "messages" ? { admitted: true, day, messageNumber: runs + 1 }
      : { admitted: true, day, runNumber: runs + 1 };
  } catch { return { admitted: false, reason: "state_unavailable" }; }
  finally {
    if (temporary) await unlink(temporary).catch(() => {});
    // Never guess that another process's lock is stale. A crash leaves a
    // visible refusal until an operator establishes it is safe to recover.
    await rmdir(file.lock);
  }
}
