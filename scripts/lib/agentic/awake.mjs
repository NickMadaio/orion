/*
 Keeping the Mac able to work all night.

 WHY THIS EXISTS

 An unattended run is only unattended if the machine stays up for it. This Mac
 idle-sleeps after one minute and nothing on the launch path held a sleep
 assertion, so a night's run could stall a minute after Nick walked away. He had
 been covering that with Vorssaint, a separate app ORION cannot drive — it has
 no URL scheme and is not scriptable. So ORION does the unprivileged part
 itself, and reports honestly on the part it cannot do.

 WHAT AN UNPRIVILEGED PROCESS CAN AND CANNOT DO

   idle sleep       preventable: `caffeinate -i`, plus `-s`, which macOS honours
                    only on AC power
   display sleep    preventable: `caffeinate -d`
   "user is idle"   resettable: `caffeinate -u -t 1` DECLARES user activity. It
                    is the clean equivalent of "move the mouse every five
                    minutes": no synthetic input, no Accessibility permission.
                    Like a real mouse move, it also wakes the display.
   lid-close sleep  NOT preventable from here. It takes clamshell mode (AC power
                    and an external display), a privileged helper such as the
                    one Vorssaint installs, or `sudo pmset -a disablesleep 1` —
                    a system setting ORION must never change. So the lid is
                    PREFLIGHTED and warned about, never claimed as handled.

 BOUND TO A LIFETIME, NOT TO A CLEANUP

 The assertion is `caffeinate -w <pid>`: macOS drops it the moment the watched
 process exits, however it exits. A keep-awake released in a `finally` block
 would hold the Mac awake indefinitely after the one crash that skipped it.

 Both the caffeinate child and the nudge timer are unref'd. Without that Node
 would wait for caffeinate to exit before letting the run's process exit, while
 caffeinate waits for the run's process to exit — each keeping the other alive
 forever, which is the opposite of "ends when the run ends".
*/
import { execFile, spawn as spawnProcess } from 'node:child_process';

export const CAFFEINATE = '/usr/bin/caffeinate';
const PMSET = '/usr/bin/pmset';
const IOREG = '/usr/sbin/ioreg';
const SYSTEM_PROFILER = '/usr/sbin/system_profiler';
const PGREP = '/usr/bin/pgrep';

/** A short assertion that says "a person is here", then lets go by itself. */
export const NUDGE_ARGS = Object.freeze(['-u', '-t', '1']);

export const AWAKE_DEFAULTS = Object.freeze({ preventSleep: true, keepDisplayOn: false, nudgeMinutes: 0 });
const OPTION_KEYS = Object.keys(AWAKE_DEFAULTS);

/*
 Strict, because these are persisted in project.json and a hand-edited typo
 should be refused rather than silently read as "keep-awake off".

 Missing keys take the default so that a record written before a key existed
 still reads; UNKNOWN keys are refused, because a misspelt `keepDisplayOff`
 would otherwise be ignored while its author believed it was in force.
*/
export function validateAwakeOptions(value = AWAKE_DEFAULTS) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Keep-awake options must be an object');
  const unknown = Object.keys(value).find(key => !OPTION_KEYS.includes(key));
  if (unknown) throw new Error(`Unknown keep-awake option: ${unknown}`);
  const options = { ...AWAKE_DEFAULTS, ...value };
  for (const key of ['preventSleep', 'keepDisplayOn']) {
    if (typeof options[key] !== 'boolean') throw new Error(`${key} must be true or false`);
  }
  if (!Number.isInteger(options.nudgeMinutes) || options.nudgeMinutes < 0 || options.nudgeMinutes > 60) {
    throw new Error('nudgeMinutes must be a whole number from 0 to 60');
  }
  // With keep-awake off, a display assertion would still quietly hold the whole
  // Mac awake, and a nudge every N minutes cannot beat a one-minute idle sleep.
  // Either combination means something other than what it says, so refuse it.
  if (!options.preventSleep && (options.keepDisplayOn || options.nudgeMinutes > 0)) {
    throw new Error('Keeping the display on and nudging activity both need keep-awake on');
  }
  return Object.freeze(options);
}

/*
 Launch flags. They describe a launch COMPLETELY: a flag that is not given takes
 the built-in default, never "whatever was saved last time". Otherwise there
 would be no way to turn the display option back off, because there is no
 `--keep-display-off`. The caller saves the result as the project's options,
 which is what the desktop app shows as its starting toggles.
*/
const FLAGS = ['--keep-display-on', '--no-keep-awake', '--nudge-minutes'];

export function parseAwakeFlags(argv) {
  const options = { ...AWAKE_DEFAULTS };
  const seen = new Set();
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!FLAGS.includes(arg)) { rest.push(arg); continue; }
    if (seen.has(arg)) throw new Error(`${arg} was given twice`);
    seen.add(arg);
    if (arg === '--keep-display-on') options.keepDisplayOn = true;
    else if (arg === '--no-keep-awake') options.preventSleep = false;
    else {
      const value = argv[index + 1];
      index += 1;
      if (!/^\d{1,2}$/.test(value ?? '')) throw new Error('--nudge-minutes takes a whole number from 0 to 60');
      options.nudgeMinutes = Number(value);
    }
  }
  return { options: validateAwakeOptions(options), rest, given: seen.size > 0 };
}

/** caffeinate's argv for these options, or null when keep-awake is off. */
export function caffeinateArgs(input, pid) {
  const options = validateAwakeOptions(input);
  // pid 1 is launchd: binding to it would be a keep-awake that never ends.
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Keep-awake needs the pid of the process it lives for');
  if (!options.preventSleep) return null;
  return ['-i', '-s', ...(options.keepDisplayOn ? ['-d'] : []), '-w', String(pid)];
}

/** One line for the receipt, the run log and the app. */
export function describeKeepAwake(options) {
  if (!options.preventSleep) return 'Keep-awake off — this Mac follows its normal sleep settings';
  return ['Keeping this Mac awake',
    options.keepDisplayOn ? 'display kept on' : 'display may sleep',
    options.nudgeMinutes > 0 ? `activity nudged every ${options.nudgeMinutes} min` : 'no activity nudge',
  ].join(' · ');
}

/*
 Start keep-awake for the life of `pid`.

 `spawn`, `every` and `cancel` are injectable so tests drive a fake clock and a
 fake spawner: a test must never leave a real caffeinate behind it, and a real
 five-minute interval is not something a test can wait for.

 Nothing in here throws after validation. A caffeinate that fails to start is
 RECORDED — the receipt carries it as a warning — because refusing to run over a
 missing sleep assertion would turn "the Mac might sleep" into "the run
 certainly does not happen", which is strictly worse.
*/
export function startKeepAwake(input, { pid = process.pid, spawn = spawnProcess,
  every = setInterval, cancel = clearInterval, now = () => new Date() } = {}) {
  const options = validateAwakeOptions(input);
  const args = caffeinateArgs(options, pid);
  const record = { ...options, active: false, summary: describeKeepAwake(options), boundToPid: pid,
    command: null, caffeinatePid: null, exited: null, error: null, nudges: 0, lastNudgeAt: null, nudgeError: null };
  let child = null;
  let timer = null;

  if (args) {
    record.command = [CAFFEINATE, ...args].join(' ');
    try {
      child = spawn(CAFFEINATE, args, { stdio: 'ignore' });
      child.unref?.();
      record.active = true;
      record.caffeinatePid = child.pid ?? null;
      child.once?.('error', error => { record.active = false; record.error = `caffeinate could not start: ${error.message}`; });
      child.once?.('exit', (code, signal) => { record.active = false; record.exited = signal ?? code; });
    } catch (error) {
      record.error = `caffeinate could not start: ${error.message}`;
    }
  }

  // A nudge is fire-and-forget: its own 1-second timeout ends it, and a failed
  // one must never throw out of a timer callback, where it would kill the run.
  const nudge = () => {
    try {
      const declared = spawn(CAFFEINATE, [...NUDGE_ARGS], { stdio: 'ignore' });
      declared.once?.('error', error => { record.nudgeError = error.message; });
      declared.unref?.();
      record.nudges += 1;
      record.lastNudgeAt = now().toISOString();
    } catch (error) {
      record.nudgeError = error.message;
    }
  };
  if (record.active && options.nudgeMinutes > 0) {
    timer = every(nudge, options.nudgeMinutes * 60_000);
    timer?.unref?.();
  }

  return {
    options,
    status: () => ({ ...record }),
    nudge,
    // Not needed by a run — `-w` ends the assertion with the process — but a
    // test, or a caller that outlives its run, must be able to let go early.
    stop() {
      if (timer !== null) cancel(timer);
      timer = null;
      if (child && record.active) child.kill?.();
      record.active = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Preflight: READ-ONLY. It runs `pmset -g`, `pmset -g batt`, `ioreg`,
// `system_profiler` and `pgrep`, and changes nothing. Every reading that fails
// is null and reported as unknown — never guessed as safe.
// ---------------------------------------------------------------------------

export function parsePmsetSettings(text = '') {
  const number = name => {
    const match = text.match(new RegExp(`^[ \\t]*${name}[ \\t]+(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const disabled = number('SleepDisabled');
  // `sleep 0` means idle sleep is off; the parenthetical after the number
  // ("sleep prevented by …") is live assertion chatter, not the setting.
  return { idleSleepMinutes: number('sleep'), displaySleepMinutes: number('displaysleep'),
    sleepDisabled: disabled === null ? null : disabled === 1 };
}

export function parsePmsetBattery(text = '') {
  const source = text.match(/drawing from '([^']+)'/)?.[1];
  const sources = { 'AC Power': 'ac', 'Battery Power': 'battery', 'UPS Power': 'ups' };
  const battery = text.match(/(\d{1,3})%;\s*([^;]+);/);
  return {
    powerSource: source ? (sources[source] ?? 'unknown') : null,
    batteryPercent: battery ? Number(battery[1]) : null,
    batteryState: battery ? battery[2].trim() : null,
  };
}

/*
 The power root domain publishes the kernel's own answer to "would closing the
 lid sleep this Mac right now?" as AppleClamshellCausesSleep. It already folds
 in clamshell mode and any helper that disabled lid sleep (Vorssaint's does), so
 it beats inferring the answer from "is Vorssaint running" — Vorssaint can be
 running with its lid option off. A root domain with no AppleClamshellState at
 all is a Mac without a lid.
*/
export function parseRootDomain(text = '') {
  if (!/IOPMrootDomain/.test(text)) return { hasLid: null, lidClosed: null, lidCloseSleeps: null, sleepDisabled: null };
  const flag = key => {
    const match = text.match(new RegExp(`"${key}" = (Yes|No)`));
    return match ? match[1] === 'Yes' : null;
  };
  const lidClosed = flag('AppleClamshellState');
  return { hasLid: lidClosed !== null, lidClosed, lidCloseSleeps: flag('AppleClamshellCausesSleep'), sleepDisabled: flag('SleepDisabled') };
}

export function parseDisplays(json = '') {
  try {
    const gpus = JSON.parse(json).SPDisplaysDataType;
    if (!Array.isArray(gpus)) return { displays: null, externalDisplay: null };
    const online = gpus.flatMap(gpu => gpu.spdisplays_ndrvs ?? []).filter(display => display.spdisplays_online !== 'spdisplays_no');
    return { displays: online.length, externalDisplay: online.some(display => display.spdisplays_connection_type !== 'spdisplays_internal') };
  } catch {
    return { displays: null, externalDisplay: null };
  }
}

const readOnly = (file, args) => new Promise(resolve => {
  execFile(file, args, { timeout: 10_000, maxBuffer: 256_000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } },
    (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: String(stdout ?? '') }));
});

/** Gather the facts. `run(file, args)` resolves `{ code, stdout }` and never rejects. */
export async function preflight({ run = readOnly, platform = process.platform, now = () => new Date() } = {}) {
  const at = now().toISOString();
  if (platform !== 'darwin') {
    return { at, available: false, ...parsePmsetSettings(), ...parsePmsetBattery(), ...parseRootDomain(), ...parseDisplays(), vorssaintRunning: null };
  }
  const safely = (file, args) => Promise.resolve().then(() => run(file, args)).catch(() => ({ code: null, stdout: '' }));
  const [settings, battery, root, displays, vorssaint] = await Promise.all([
    safely(PMSET, ['-g']),
    safely(PMSET, ['-g', 'batt']),
    safely(IOREG, ['-r', '-c', 'IOPMrootDomain', '-d', '1']),
    safely(SYSTEM_PROFILER, ['SPDisplaysDataType', '-json']),
    safely(PGREP, ['-x', 'Vorssaint']),
  ]);
  const ok = result => (result.code === 0 ? result.stdout : '');
  const power = parsePmsetSettings(ok(settings));
  const domain = parseRootDomain(ok(root));
  // Either source saying sleep is disabled is enough; neither answering is unknown.
  const sleepDisabled = power.sleepDisabled === true || domain.sleepDisabled === true ? true
    : power.sleepDisabled === null && domain.sleepDisabled === null ? null : false;
  return {
    at, available: true, ...parsePmsetBattery(ok(battery)),
    idleSleepMinutes: power.idleSleepMinutes, displaySleepMinutes: power.displaySleepMinutes, sleepDisabled,
    hasLid: domain.hasLid, lidClosed: domain.lidClosed, lidCloseSleeps: domain.lidCloseSleeps,
    ...parseDisplays(ok(displays)),
    // pgrep exits 1 for "no match"; anything else is "could not tell".
    vorssaintRunning: vorssaint.code === 0 ? true : vorssaint.code === 1 ? false : null,
  };
}

export const LID_ADVICE = 'To keep it running with the lid closed, use one of: clamshell mode (plug in power and an external display), ' +
  "Vorssaint's lid option, or run `sudo pmset -a disablesleep 1` yourself (and `sudo pmset -a disablesleep 0` when the run is done).";

export function assessLid(facts) {
  const clamshell = facts.powerSource === 'ac' && facts.externalDisplay === true;
  if (facts.sleepDisabled === true) {
    return { risk: 'protected', reason: 'Sleep is disabled system-wide (pmset disablesleep), so closing the lid will not sleep this Mac. Turn it back on when you are done.' };
  }
  if (facts.hasLid === false) return { risk: 'no-lid', reason: 'This Mac has no lid to close.' };
  if (facts.lidCloseSleeps === false) {
    return { risk: 'protected', reason: clamshell
      ? 'Clamshell mode: on power with an external display, closing the lid will not sleep this Mac.'
      : facts.vorssaintRunning
        ? "macOS reports closing the lid will not sleep this Mac — most likely Vorssaint's lid option, so it holds only while Vorssaint keeps it on."
        : 'macOS reports closing the lid will not sleep this Mac.' };
  }
  const atRisk = { risk: 'at-risk', reason: 'Closing the lid will sleep this Mac, and the run will pause until it wakes.' +
    (facts.vorssaintRunning ? ' Vorssaint is running, but macOS still reports lid sleep on, so its lid option looks off.' : '') };
  if (facts.lidCloseSleeps === true) return atRisk;
  // macOS did not say. Fall back on what implies the answer, and be explicit
  // about it being an inference.
  if (clamshell) return { risk: 'protected', reason: 'On power with an external display, which is clamshell mode; closing the lid should not sleep this Mac.' };
  if (facts.hasLid === null || facts.vorssaintRunning === true) {
    return { risk: 'unknown', reason: 'Could not read whether closing the lid will sleep this Mac.' +
      (facts.vorssaintRunning ? " Vorssaint is running; if its lid option is on, the lid is covered." : '') };
  }
  return atRisk;
}

function summarize(facts, lid) {
  const power = facts.powerSource === 'ac' ? 'On power'
    : facts.powerSource === 'battery' ? `On battery${facts.batteryPercent === null ? '' : ` ${facts.batteryPercent}%`}`
      : facts.powerSource === 'ups' ? 'On UPS power' : 'Power source unknown';
  const idle = facts.idleSleepMinutes === null ? null
    : facts.idleSleepMinutes === 0 ? 'idle sleep off' : `idle-sleeps after ${facts.idleSleepMinutes} min`;
  const lidText = { protected: 'lid close covered', 'no-lid': 'no lid', 'at-risk': 'closing the lid will sleep it', unknown: 'lid behaviour unknown' }[lid.risk];
  return [power, idle, lidText].filter(Boolean).join(' · ');
}

/*
 Turn facts into what a person should be told. Warnings never block a launch:
 each one names a way the night could go wrong and what would prevent it, and
 the decision stays with Nick.
*/
export function assessPreflight(facts, options) {
  const lid = assessLid(facts);
  const warnings = [];
  if (facts.powerSource === 'battery' || facts.powerSource === 'ups') {
    const detail = [facts.batteryPercent === null ? null : `${facts.batteryPercent}%`, facts.batteryState].filter(Boolean).join(', ');
    warnings.push(`On ${facts.powerSource === 'ups' ? 'UPS' : 'battery'} power${detail ? ` (${detail})` : ''}. Keep-awake still works, but a flat battery ends the run — plug in for anything long.`);
  }
  if (lid.risk === 'at-risk' || lid.risk === 'unknown') warnings.push(`${lid.reason} ${LID_ADVICE}`);
  if (options && !options.preventSleep && facts.idleSleepMinutes > 0) {
    warnings.push(`Keep-awake is off and this Mac idle-sleeps after ${facts.idleSleepMinutes} min, so the run will stall when it sleeps.`);
  }
  return { ...facts, lid, summary: summarize(facts, lid), warnings };
}

/*
 What `serve` writes into every launch.json receipt. Computed at write time, so
 a caffeinate that died between "starting" and "running" shows up in the next
 receipt rather than being frozen as healthy.
*/
export function keepAwakeReceipt(keepAwake, checked) {
  const status = keepAwake.status();
  const failed = status.preventSleep && !status.active;
  const warnings = [
    ...(failed ? [`Keep-awake is not holding (${status.error ?? `caffeinate exited: ${status.exited}`}). ` +
      `This Mac may sleep${checked.idleSleepMinutes > 0 ? ` after ${checked.idleSleepMinutes} min idle` : ''}.`] : []),
    ...checked.warnings,
  ];
  return { keepAwake: status, preflight: checked, warnings };
}
