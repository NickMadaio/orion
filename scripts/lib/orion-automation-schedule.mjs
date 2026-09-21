// Pure scheduler preview. Does not install policy, initialize ledgers or create jobs.
import { join } from "node:path";
import { validateProposal, cronExpression, MAX_AUTOMATION_DAYS } from "../../plugin/orion-control/dist/automation.js";
import { checkAutomationConditions } from "./orion-automation-admission.mjs";

export function automationSchedulePlan(proposal, timeZone, repoRoot, now = Date.now()) {
  // The legacy validator uses host-local expiry. Validate other proposal fields
  // with a harmless future date, then validate the real date in the chosen zone.
  const issues = validateProposal({ ...proposal,
    expiresOn: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  if (issues.length) throw new Error(issues.join("; "));
  if (proposal.action !== "agenda_today" || proposal.delivery !== undefined) {
    throw new Error("Only agenda_today without outbound delivery is supported by this runtime");
  }
  const policy = { ...proposal, timeZone, installationId: "preview-only" };
  const conditions = checkAutomationConditions(policy,
    { now: 0, effectiveMode: proposal.permissions.expectsMode, focusActive: false });
  if (conditions.reason === "invalid_policy") throw new Error("An explicit IANA timezone and valid bounded policy are required");
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw new Error("Invalid current clock");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const days = (Date.parse(`${proposal.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  if (!Number.isInteger(days) || days < 0 || days > MAX_AUTOMATION_DAYS) throw new Error(`Expiry must be today through ${MAX_AUTOMATION_DAYS} calendar days ahead in ${timeZone}`);
  const cron = cronExpression(proposal.trigger);
  const commandArgv = [join(repoRoot, "scripts/orion-automation-run"), proposal.name];
  return {
    readyToInstall: false,
    nextGate: "Human installer must publish installation identity and durable ledgers, create disabled job, verify it, then enable it",
    name: `orion-auto-${proposal.name}`, timeZone, cron, commandArgv,
    policy: { action: proposal.action, intent: proposal.intent, expiresOn: proposal.expiresOn,
      conditions: structuredClone(proposal.conditions), permissions: structuredClone(proposal.permissions),
      riskLimits: structuredClone(proposal.riskLimits), failureBehavior: proposal.failureBehavior },
    // Native argv avoids shell quoting and never routes through an agent turn.
    schedulerArgs: ["cron", "add", "--name", `orion-auto-${proposal.name}`,
      "--cron", cron, "--tz", timeZone, "--command-argv", JSON.stringify(commandArgv),
      "--command-cwd", repoRoot, "--disabled", "--exact", "--no-deliver",
      "--timeout-seconds", "120", "--output-max-bytes", "4096", "--json"],
  };
}
