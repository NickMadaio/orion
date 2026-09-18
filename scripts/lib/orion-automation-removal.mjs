// A successful command is not proof that a schedule stopped. Require a complete
// scheduler reading before choosing a job and again before changing local state.
export async function removeAutomationSchedule(run, binary, name) {
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(name)) {
    throw new Error("invalid automation name");
  }
  const expected = `orion-auto-${name}`;
  const list = async () => {
    const result = await run(binary, ["cron", "list", "--all", "--json"], { timeout: 45000 });
    const value = JSON.parse(result.stdout);
    if (!value || !Array.isArray(value.jobs) || value.hasMore !== false ||
        value.offset !== 0 || value.total !== value.jobs.length ||
        value.jobs.some(job => !job || typeof job.id !== "string" || !job.id ||
          typeof job.name !== "string") ||
        new Set(value.jobs.map(job => job.id)).size !== value.jobs.length) {
      throw new Error("scheduler returned an incomplete or invalid job list");
    }
    return value.jobs;
  };
  const matches = (await list()).filter(job => job.name === expected);
  if (matches.length > 1) throw new Error("multiple schedules match; local installation retained");
  if (matches.length === 0) return { removed: false, alreadyAbsent: true };
  const id = matches[0].id;
  await run(binary, ["cron", "remove", id, "--json"], { timeout: 45000 });
  const after = await list();
  if (after.some(job => job.id === id || job.name === expected)) {
    throw new Error("schedule still present after removal; local installation retained");
  }
  return { removed: true, alreadyAbsent: false, id };
}
