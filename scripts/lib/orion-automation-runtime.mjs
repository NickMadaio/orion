// Candidate host runtime: loads existing human-installed policy and initialized
// ledgers only. No installer, scheduler entry point, delivery or state repair.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchAutomation } from "./orion-automation-dispatch.mjs";
import { checkAutomationConditions } from "./orion-automation-admission.mjs";
import { createAutomationHostChecks } from "./orion-automation-host.mjs";
import { appendAutomationHistory } from "./orion-automation-history.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executeFile = promisify(execFile);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export async function runInstalledAutomation(name, scheduledAt, {
  automationRoot = join(homedir(), ".openclaw/orion-controlled/automations"),
  repoRoot = repo, checks = createAutomationHostChecks({ repoRoot }), run = executeFile,
} = {}) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(name)) {
    return { status: "refused", reason: "invalid_name" };
  }
  const file = join(automationRoot, "installed", `${name}.json`);
  let record, identity;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
    if (record?.name !== name || record.action !== "agenda_today" || record.delivery !== undefined ||
        typeof record.installedAt !== "string" || !Number.isFinite(Date.parse(record.installedAt))) {
      throw new Error("unsupported installation");
    }
    identity = canonical(record);
  } catch { return { status: "refused", reason: "installation_unavailable_or_unsupported" }; }
  const unchanged = async () => {
    try { return canonical(JSON.parse(await readFile(file, "utf8"))) === identity; }
    catch { return false; }
  };
  let admittedContext;
  const adapters = {
    async readContext() {
      const context = await checks.readContext();
      admittedContext = context;
      return context;
    },
    async authorize(action) { return await unchanged() && await checks.authorize(action) === true; },
    async execute(action) {
      // Only this no-launch branch may certify a failure as safe to retry.
      const refused = { ok: false, retrySafe: true };
      try {
        if (action.name !== "agenda_today" || action.installationId !== record.installationId ||
            action.argv.length !== 2 || action.argv[0] !== "orion-agenda" || action.argv[1] !== "today" ||
            !await unchanged()) return refused;
        const context = await checks.readContext();
        const current = checkAutomationConditions(record, context);
        const earlier = checkAutomationConditions(record, admittedContext);
        if (!current.admitted || !earlier.admitted || current.day !== earlier.day || context.now < admittedContext.now ||
            context.now < scheduledAt || context.now - scheduledAt > 300000 || !await unchanged()) return refused;
        // Context probes may wait on the app. Recheck authority after that wait,
        // not before it: a revoked allowlist/tier can leave mode unchanged.
        if (await checks.authorize(action) !== true) return refused;
      } catch { return refused; }
      try {
        const result = await run(join(repoRoot, "scripts/orion-agenda"), ["today"], {
          timeout: 35000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8",
          env: { ...process.env, TZ: record.timeZone },
        });
        if (typeof result?.stdout !== "string") return { ok: false };
        return { ok: true, output: result.stdout.slice(0, 8192) };
      } catch {
        // Exit failure, timeout and output overflow cannot establish what a
        // launched process did. Never infer retry safety or expose stderr.
        return { ok: false };
      }
    },
  };
  const result = await dispatchAutomation(join(automationRoot, "runtime"), record, scheduledAt, adapters);
  if (result.reason !== "not_due") {
    try {
      await appendAutomationHistory(join(automationRoot, "history", `${name}.jsonl`), {
        at: scheduledAt,
        name,
        status: result.status,
        reason: typeof result.reason === "string" ? result.reason : null,
        delivery: typeof result.delivery?.status === "string" ? result.delivery.status : null,
      });
    } catch { /* recording failure must not change the result */ }
  }
  return result;
}
