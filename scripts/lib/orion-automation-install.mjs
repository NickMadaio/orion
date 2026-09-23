// Pure disabled-schedule read-back verifier. No filesystem, network or scheduler effects.
export function verifyDisabledSchedule(expected, observed) {
  try {
    if (typeof expected !== "object" || expected === null ||
        typeof observed !== "object" || observed === null) return false;

    // id: nonempty string
    if (typeof observed.id !== "string" || observed.id.length === 0) return false;

    // name, timeZone, cron must equal the expected plan fields exactly
    if (observed.name !== expected.name) return false;
    if (observed.timeZone !== expected.timeZone) return false;
    if (observed.cron !== expected.cron) return false;

    // commandArgv: array with identical length and strict per-index equality
    if (!Array.isArray(observed.commandArgv)) return false;
    if (observed.commandArgv.length !== expected.commandArgv.length) return false;
    for (let i = 0; i < observed.commandArgv.length; i++) {
      if (observed.commandArgv[i] !== expected.commandArgv[i]) return false;
    }

    // cwd: must equal the value immediately after --command-cwd in schedulerArgs
    const args = expected.schedulerArgs;
    if (!Array.isArray(args)) return false;
    let cwdIndex = -1;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--command-cwd") { cwdIndex = i; break; }
    }
    if (cwdIndex === -1 || cwdIndex + 1 >= args.length) return false;
    const expectedCwd = args[cwdIndex + 1];
    if (observed.cwd !== expectedCwd) return false;

    // enabled must be exactly false, exact must be exactly true, noDeliver must be exactly true
    if (observed.enabled !== false) return false;
    if (observed.exact !== true) return false;
    if (observed.noDeliver !== true) return false;

    return true;
  } catch {
    return false;
  }
}

