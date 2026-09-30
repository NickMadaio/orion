import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AWAKE_DEFAULTS, CAFFEINATE, LID_ADVICE, NUDGE_ARGS, assessLid, assessPreflight, caffeinateArgs, describeKeepAwake,
  keepAwakeReceipt, parseAwakeFlags, parseDisplays, parsePmsetBattery, parsePmsetSettings, parseRootDomain,
  preflight, startKeepAwake, validateAwakeOptions,
} from '../scripts/lib/agentic/awake.mjs';
import { readProject, registerProject, saveProjectLaunchOptions } from '../scripts/lib/agentic/projects.mjs';
import { acquireLease } from '../scripts/lib/agentic/lease.mjs';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Captured from this Mac (pmset -g, pmset -g batt, ioreg, system_profiler),
// trimmed to the lines the parsers read plus neighbours that could confuse them.
// ---------------------------------------------------------------------------
const PMSET_SETTINGS = `System-wide power settings:
 SleepDisabled\t\t0
Currently in use:
 standby              1
 Sleep On Power Button 1
 hibernatefile        /var/vm/sleepimage
 powernap             1
 networkoversleep     0
 disksleep            10
 sleep                1 (sleep prevented by sharingd, Claude, bluetoothd, coreaudiod, coreaudiod, powerd)
 hibernatemode        3
 ttyskeepawake        1
 displaysleep         10
 tcpkeepalive         1
`;
const PMSET_SLEEP_DISABLED = PMSET_SETTINGS.replace('SleepDisabled\t\t0', 'SleepDisabled\t\t1').replace(/ sleep {16}1 .*/, ' sleep                0');
const BATT_BATTERY = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=23003235)\t44%; discharging; 2:00 remaining present: true
`;
const BATT_AC = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=23003235)\t100%; charged; 0:00 remaining present: true
`;
const BATT_DESKTOP = `Now drawing from 'AC Power'
`;
const rootDomain = (causes, state = 'No', disabled = 'No') => `+-o IOPMrootDomain  <class IOPMrootDomain, id 0x100000381, registered, matched, active, busy 0 (9001 ms), retain 237>
    {
      "Wake Reason" = "smc.sysState.Wake(0x70070000) lid SMC.OutboxNotEmpty RTP.multi-touch"
      "IOSleepSupported" = Yes
${causes === null ? '' : `      "AppleClamshellCausesSleep" = ${causes}\n`}      "Last Sleep Reason" = "Maintenance Sleep"
${state === null ? '' : `      "AppleClamshellState" = ${state}\n`}      "SleepDisabled" = ${disabled}
      "Standby Enabled" = Yes
    }
`;
const DESKTOP_ROOT = rootDomain(null, null);
const displays = (...types) => JSON.stringify({ SPDisplaysDataType: [{ _name: 'Apple M5 Pro',
  spdisplays_ndrvs: types.map((type, index) => ({ _name: `Display ${index}`, spdisplays_connection_type: type, spdisplays_online: 'spdisplays_yes' })) }] });
const INTERNAL_ONLY = displays('spdisplays_internal');
const WITH_EXTERNAL = displays('spdisplays_internal', 'spdisplays_displayport');

// A fake child process: an EventEmitter that records unref/kill.
function fakeSpawner({ throwOn = () => false } = {}) {
  const calls = [];
  const spawnFake = (file, args, options) => {
    if (throwOn(args)) throw new Error('spawn EAGAIN');
    const child = Object.assign(new EventEmitter(), { pid: 9000 + calls.length, unrefs: 0, kills: 0 });
    child.unref = () => { child.unrefs += 1; };
    child.kill = () => { child.kills += 1; };
    calls.push({ file, args, options, child });
    return child;
  };
  return { calls, spawn: spawnFake };
}
function fakeClock() {
  const timers = [];
  return {
    timers,
    every: (fn, ms) => { const timer = { fn, ms, unrefs: 0, cancelled: false, unref() { this.unrefs += 1; } }; timers.push(timer); return timer; },
    cancel: timer => { timer.cancelled = true; },
    now: () => new Date('2026-09-23T02:00:00.000Z'),
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
test('options: defaults keep the Mac awake with the display free to sleep and no nudge', () => {
  assert.deepEqual({ ...validateAwakeOptions() }, { preventSleep: true, keepDisplayOn: false, nudgeMinutes: 0 });
  assert.deepEqual({ ...validateAwakeOptions({ nudgeMinutes: 5 }) }, { ...AWAKE_DEFAULTS, nudgeMinutes: 5 });
  assert.equal(Object.isFrozen(validateAwakeOptions({})), true);
  for (const minutes of [0, 1, 60]) assert.equal(validateAwakeOptions({ nudgeMinutes: minutes }).nudgeMinutes, minutes);
});

test('options: refuse out-of-range, fractional, stringly and unknown values rather than guessing', () => {
  for (const nudgeMinutes of [-1, 61, 2.5, '5', null, Number.NaN]) {
    assert.throws(() => validateAwakeOptions({ nudgeMinutes }), /whole number from 0 to 60/, String(nudgeMinutes));
  }
  assert.throws(() => validateAwakeOptions({ preventSleep: 'yes' }), /preventSleep must be true or false/);
  assert.throws(() => validateAwakeOptions({ keepDisplayOff: true }), /Unknown keep-awake option: keepDisplayOff/);
  assert.throws(() => validateAwakeOptions(null), /must be an object/);
  assert.throws(() => validateAwakeOptions([]), /must be an object/);
  // Keep-awake off with a display assertion would still hold the Mac awake.
  assert.throws(() => validateAwakeOptions({ preventSleep: false, keepDisplayOn: true }), /need keep-awake on/);
  assert.throws(() => validateAwakeOptions({ preventSleep: false, nudgeMinutes: 5 }), /need keep-awake on/);
  assert.equal(validateAwakeOptions({ preventSleep: false }).preventSleep, false);
});

test('flags: describe the launch completely and leave the other arguments untouched', () => {
  assert.deepEqual(parseAwakeFlags(['2', '--enable']), { options: validateAwakeOptions(), rest: ['2', '--enable'], given: false });
  const parsed = parseAwakeFlags(['4', '--keep-display-on', '--nudge-minutes', '5', '--enable']);
  assert.deepEqual({ ...parsed.options }, { preventSleep: true, keepDisplayOn: true, nudgeMinutes: 5 });
  assert.deepEqual(parsed.rest, ['4', '--enable']);
  assert.equal(parsed.given, true);
  assert.equal(parseAwakeFlags(['--no-keep-awake']).options.preventSleep, false);
  assert.equal(parseAwakeFlags(['--nudge-minutes', '0']).options.nudgeMinutes, 0);
});

test('flags: refuse duplicates, missing or malformed minutes and contradictions', () => {
  assert.throws(() => parseAwakeFlags(['--keep-display-on', '--keep-display-on']), /given twice/);
  assert.throws(() => parseAwakeFlags(['--nudge-minutes']), /whole number/);
  assert.throws(() => parseAwakeFlags(['--nudge-minutes', '--enable']), /whole number/);
  assert.throws(() => parseAwakeFlags(['--nudge-minutes', '5.5']), /whole number/);
  assert.throws(() => parseAwakeFlags(['--nudge-minutes', '-5']), /whole number/);
  assert.throws(() => parseAwakeFlags(['--nudge-minutes', '99']), /0 to 60/);
  assert.throws(() => parseAwakeFlags(['--no-keep-awake', '--keep-display-on']), /need keep-awake on/);
});

// ---------------------------------------------------------------------------
// caffeinate argv
// ---------------------------------------------------------------------------
test('argv: -i -s bound to the pid with -w, -d only when the display is kept on, nothing when off', () => {
  assert.deepEqual(caffeinateArgs({}, 4242), ['-i', '-s', '-w', '4242']);
  assert.deepEqual(caffeinateArgs({ keepDisplayOn: true }, 4242), ['-i', '-s', '-d', '-w', '4242']);
  // The nudge is a timer, not a flag on the long-lived assertion.
  assert.deepEqual(caffeinateArgs({ nudgeMinutes: 5 }, 4242), ['-i', '-s', '-w', '4242']);
  assert.equal(caffeinateArgs({ preventSleep: false }, 4242), null);
  assert.deepEqual([...NUDGE_ARGS], ['-u', '-t', '1']);
  // pid 1 is launchd: a keep-awake bound to it would never end.
  for (const pid of [undefined, 0, 1, -5, 3.5, '4242']) assert.throws(() => caffeinateArgs({}, pid), /pid/);
});

test('describe: one plain line for each combination', () => {
  assert.equal(describeKeepAwake(validateAwakeOptions()), 'Keeping this Mac awake · display may sleep · no activity nudge');
  assert.equal(describeKeepAwake(validateAwakeOptions({ keepDisplayOn: true, nudgeMinutes: 5 })),
    'Keeping this Mac awake · display kept on · activity nudged every 5 min');
  assert.match(describeKeepAwake(validateAwakeOptions({ preventSleep: false })), /^Keep-awake off/);
});

// ---------------------------------------------------------------------------
// Starting keep-awake, with a fake spawner and a fake clock
// ---------------------------------------------------------------------------
test('start: spawns one caffeinate bound to the pid, unref\'d so it cannot hold the run open', () => {
  const spawner = fakeSpawner(); const clock = fakeClock();
  const handle = startKeepAwake({}, { pid: 4242, spawn: spawner.spawn, ...clock });
  assert.equal(spawner.calls.length, 1);
  const [call] = spawner.calls;
  assert.equal(call.file, CAFFEINATE);
  assert.deepEqual(call.args, ['-i', '-s', '-w', '4242']);
  assert.deepEqual(call.options, { stdio: 'ignore' });
  assert.equal(call.child.unrefs, 1);
  assert.equal(clock.timers.length, 0, 'no nudge timer unless asked for');
  const status = handle.status();
  assert.equal(status.active, true);
  assert.equal(status.boundToPid, 4242);
  assert.equal(status.caffeinatePid, call.child.pid);
  assert.equal(status.command, '/usr/bin/caffeinate -i -s -w 4242');
});

test('start: keep-awake off spawns nothing and starts no timer', () => {
  const spawner = fakeSpawner(); const clock = fakeClock();
  const handle = startKeepAwake({ preventSleep: false }, { pid: 4242, spawn: spawner.spawn, ...clock });
  assert.equal(spawner.calls.length, 0);
  assert.equal(clock.timers.length, 0);
  assert.equal(handle.status().active, false);
  assert.equal(handle.status().command, null);
  handle.stop();
});

test('nudge: every N minutes declares user activity with a 1-second assertion, on an unref\'d timer', () => {
  const spawner = fakeSpawner(); const clock = fakeClock();
  const handle = startKeepAwake({ nudgeMinutes: 5 }, { pid: 4242, spawn: spawner.spawn, ...clock });
  assert.equal(clock.timers.length, 1);
  const [timer] = clock.timers;
  assert.equal(timer.ms, 5 * 60_000);
  assert.equal(timer.unrefs, 1);
  timer.fn(); timer.fn(); timer.fn();
  const nudges = spawner.calls.slice(1);
  assert.equal(nudges.length, 3);
  for (const nudge of nudges) {
    assert.equal(nudge.file, CAFFEINATE);
    assert.deepEqual(nudge.args, ['-u', '-t', '1']);
    assert.equal(nudge.child.unrefs, 1);
  }
  assert.equal(handle.status().nudges, 3);
  assert.equal(handle.status().lastNudgeAt, '2026-09-23T02:00:00.000Z');
});

test('nudge: a failed nudge is recorded, never thrown out of the timer where it would kill the run', () => {
  const spawner = fakeSpawner({ throwOn: args => args.includes('-u') });
  const clock = fakeClock();
  const handle = startKeepAwake({ nudgeMinutes: 1 }, { pid: 4242, spawn: spawner.spawn, ...clock });
  assert.doesNotThrow(() => clock.timers[0].fn());
  assert.equal(handle.status().nudges, 0);
  assert.equal(handle.status().nudgeError, 'spawn EAGAIN');
  assert.equal(handle.status().active, true, 'the main assertion is unaffected');
});

test('stop: clears the nudge timer and releases the assertion early', () => {
  const spawner = fakeSpawner(); const clock = fakeClock();
  const handle = startKeepAwake({ nudgeMinutes: 5 }, { pid: 4242, spawn: spawner.spawn, ...clock });
  handle.stop();
  assert.equal(clock.timers[0].cancelled, true);
  assert.equal(spawner.calls[0].child.kills, 1);
  assert.equal(handle.status().active, false);
  handle.stop();
  assert.equal(spawner.calls[0].child.kills, 1, 'stopping twice does not signal twice');
});

test('failure: a caffeinate that cannot start or dies is reported in the receipt, not thrown', () => {
  const checked = assessPreflight({ powerSource: 'ac', idleSleepMinutes: 1, sleepDisabled: false, hasLid: false });
  // Asynchronous spawn failure (ENOENT arrives as an event).
  const late = fakeSpawner(); const clock = fakeClock();
  const handle = startKeepAwake({}, { pid: 4242, spawn: late.spawn, ...clock });
  late.calls[0].child.emit('error', new Error('spawn /usr/bin/caffeinate ENOENT'));
  const receipt = keepAwakeReceipt(handle, checked);
  assert.equal(receipt.keepAwake.active, false);
  assert.match(receipt.warnings[0], /Keep-awake is not holding \(caffeinate could not start: spawn \/usr\/bin\/caffeinate ENOENT\)\. This Mac may sleep after 1 min idle\./);
  // Synchronous spawn failure.
  const early = fakeSpawner({ throwOn: () => true });
  const failed = startKeepAwake({}, { pid: 4242, spawn: early.spawn, ...clock });
  assert.equal(failed.status().active, false);
  assert.match(keepAwakeReceipt(failed, checked).warnings[0], /could not start: spawn EAGAIN/);
  // Killed from outside while the run is still alive.
  const killed = fakeSpawner();
  const dying = startKeepAwake({}, { pid: 4242, spawn: killed.spawn, ...clock });
  killed.calls[0].child.emit('exit', null, 'SIGTERM');
  assert.match(keepAwakeReceipt(dying, checked).warnings[0], /caffeinate exited: SIGTERM/);
  // Keep-awake deliberately off is not a failure.
  const off = startKeepAwake({ preventSleep: false }, { pid: 4242, spawn: killed.spawn, ...clock });
  assert.equal(keepAwakeReceipt(off, checked).warnings.length, 0);
});

test('lifetime: a real caffeinate -w exits by itself when the process it is bound to exits', { skip: process.platform !== 'darwin' }, async t => {
  await access(CAFFEINATE);
  // The watched process lives ~0.4 s, so even a broken binding cannot keep this
  // test's caffeinate alive for long; t.after kills it outright regardless.
  const watched = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'ignore' });
  await new Promise(resolve => watched.once('spawn', resolve));
  const handle = startKeepAwake({}, { pid: watched.pid });
  const { caffeinatePid } = handle.status();
  t.after(() => { handle.stop(); try { process.kill(caffeinatePid); } catch { /* already gone, as intended */ } });
  assert.ok(caffeinatePid > 1);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(caffeinatePid), true, 'caffeinate is holding while the watched process lives');
  await new Promise(resolve => watched.once('exit', resolve));
  const deadline = Date.now() + 5000;
  while (alive(caffeinatePid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(caffeinatePid), false, 'caffeinate released its assertion when the watched process exited');
});

// ---------------------------------------------------------------------------
// Preflight parsing, from captured text
// ---------------------------------------------------------------------------
test('pmset -g: idle and display sleep minutes and SleepDisabled, not confused by disksleep or "Sleep On Power Button"', () => {
  assert.deepEqual(parsePmsetSettings(PMSET_SETTINGS), { idleSleepMinutes: 1, displaySleepMinutes: 10, sleepDisabled: false });
  assert.deepEqual(parsePmsetSettings(PMSET_SLEEP_DISABLED), { idleSleepMinutes: 0, displaySleepMinutes: 10, sleepDisabled: true });
  assert.deepEqual(parsePmsetSettings(''), { idleSleepMinutes: null, displaySleepMinutes: null, sleepDisabled: null });
});

test('pmset -g batt: power source, percent and charge state; a desktop has no battery line', () => {
  assert.deepEqual(parsePmsetBattery(BATT_BATTERY), { powerSource: 'battery', batteryPercent: 44, batteryState: 'discharging' });
  assert.deepEqual(parsePmsetBattery(BATT_AC), { powerSource: 'ac', batteryPercent: 100, batteryState: 'charged' });
  assert.deepEqual(parsePmsetBattery(BATT_DESKTOP), { powerSource: 'ac', batteryPercent: null, batteryState: null });
  assert.deepEqual(parsePmsetBattery(''), { powerSource: null, batteryPercent: null, batteryState: null });
  assert.equal(parsePmsetBattery("Now drawing from 'UPS Power'\n").powerSource, 'ups');
});

test('ioreg: lid state and the kernel\'s own "would the lid sleep it" answer; no clamshell key means no lid', () => {
  assert.deepEqual(parseRootDomain(rootDomain('No')), { hasLid: true, lidClosed: false, lidCloseSleeps: false, sleepDisabled: false });
  assert.deepEqual(parseRootDomain(rootDomain('Yes', 'Yes', 'Yes')), { hasLid: true, lidClosed: true, lidCloseSleeps: true, sleepDisabled: true });
  assert.deepEqual(parseRootDomain(rootDomain(null)), { hasLid: true, lidClosed: false, lidCloseSleeps: null, sleepDisabled: false });
  assert.deepEqual(parseRootDomain(DESKTOP_ROOT), { hasLid: false, lidClosed: null, lidCloseSleeps: null, sleepDisabled: false });
  // Unreadable is unknown, never "no lid".
  assert.deepEqual(parseRootDomain(''), { hasLid: null, lidClosed: null, lidCloseSleeps: null, sleepDisabled: null });
});

test('system_profiler: an external display is any online display that is not the built-in one', () => {
  assert.deepEqual(parseDisplays(INTERNAL_ONLY), { displays: 1, externalDisplay: false });
  assert.deepEqual(parseDisplays(WITH_EXTERNAL), { displays: 2, externalDisplay: true });
  const offline = JSON.stringify({ SPDisplaysDataType: [{ spdisplays_ndrvs: [
    { spdisplays_connection_type: 'spdisplays_internal' }, { spdisplays_connection_type: 'spdisplays_hdmi', spdisplays_online: 'spdisplays_no' }] }] });
  assert.deepEqual(parseDisplays(offline), { displays: 1, externalDisplay: false });
  assert.deepEqual(parseDisplays('not json'), { displays: null, externalDisplay: null });
  assert.deepEqual(parseDisplays('{}'), { displays: null, externalDisplay: null });
});

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------
const facts = overrides => ({ powerSource: 'battery', batteryPercent: 44, batteryState: 'discharging', idleSleepMinutes: 1,
  displaySleepMinutes: 10, sleepDisabled: false, hasLid: true, lidClosed: false, lidCloseSleeps: true,
  displays: 1, externalDisplay: false, vorssaintRunning: false, ...overrides });

test('lid: at risk when macOS says the lid sleeps it, with all three ways out named', () => {
  const assessed = assessPreflight(facts());
  assert.equal(assessed.lid.risk, 'at-risk');
  const lidWarning = assessed.warnings.find(warning => warning.includes('lid'));
  assert.ok(lidWarning.includes(LID_ADVICE));
  assert.match(lidWarning, /clamshell mode/);
  assert.match(lidWarning, /Vorssaint's lid option/);
  assert.match(lidWarning, /sudo pmset -a disablesleep 1/);
  // Vorssaint running does not mean its lid option is on.
  assert.match(assessLid(facts({ vorssaintRunning: true })).reason, /its lid option looks off/);
});

test('lid: protected by the kernel\'s answer, clamshell mode, SleepDisabled, or having no lid', () => {
  assert.equal(assessLid(facts({ lidCloseSleeps: false, vorssaintRunning: true })).risk, 'protected');
  assert.match(assessLid(facts({ lidCloseSleeps: false, vorssaintRunning: true })).reason, /Vorssaint's lid option/);
  assert.match(assessLid(facts({ lidCloseSleeps: false, powerSource: 'ac', externalDisplay: true })).reason, /^Clamshell mode/);
  assert.equal(assessLid(facts({ sleepDisabled: true })).risk, 'protected');
  assert.equal(assessLid(facts({ hasLid: false, lidCloseSleeps: null })).risk, 'no-lid');
  // The kernel is trusted over the inference: power + display but it still says "sleeps".
  assert.equal(assessLid(facts({ powerSource: 'ac', externalDisplay: true })).risk, 'at-risk');
});

test('lid: without the kernel\'s answer, fall back to the task\'s rule and say when it is a guess', () => {
  const unknownKernel = { lidCloseSleeps: null };
  assert.equal(assessLid(facts({ ...unknownKernel })).risk, 'at-risk', 'no clamshell, no SleepDisabled, no Vorssaint');
  assert.equal(assessLid(facts({ ...unknownKernel, powerSource: 'ac', externalDisplay: true })).risk, 'protected');
  assert.equal(assessLid(facts({ ...unknownKernel, vorssaintRunning: true })).risk, 'unknown');
  assert.equal(assessLid(facts({ ...unknownKernel, hasLid: null })).risk, 'unknown');
  assert.ok(assessPreflight(facts({ ...unknownKernel, hasLid: null })).warnings.some(warning => warning.includes(LID_ADVICE)));
});

test('warnings: battery and keep-awake-off are named; a plugged-in, covered Mac has none', () => {
  const battery = assessPreflight(facts({ lidCloseSleeps: false }));
  assert.deepEqual(battery.warnings, ['On battery power (44%, discharging). Keep-awake still works, but a flat battery ends the run — plug in for anything long.']);
  assert.equal(battery.summary, 'On battery 44% · idle-sleeps after 1 min · lid close covered');
  const clean = assessPreflight(facts({ powerSource: 'ac', batteryPercent: 100, batteryState: 'charged', lidCloseSleeps: false }));
  assert.deepEqual(clean.warnings, []);
  const off = assessPreflight(facts({ powerSource: 'ac', lidCloseSleeps: false }), validateAwakeOptions({ preventSleep: false }));
  assert.deepEqual(off.warnings, ['Keep-awake is off and this Mac idle-sleeps after 1 min, so the run will stall when it sleeps.']);
  assert.deepEqual(assessPreflight(facts({ powerSource: 'ac', lidCloseSleeps: false, idleSleepMinutes: 0 }), validateAwakeOptions({ preventSleep: false })).warnings, []);
});

// ---------------------------------------------------------------------------
// preflight() with an injected, read-only runner
// ---------------------------------------------------------------------------
test('preflight: runs only read-only commands and assembles the facts from their output', async () => {
  const ran = [];
  const outputs = {
    '/usr/bin/pmset -g': PMSET_SETTINGS,
    '/usr/bin/pmset -g batt': BATT_BATTERY,
    '/usr/sbin/ioreg -r -c IOPMrootDomain -d 1': rootDomain('No'),
    '/usr/sbin/system_profiler SPDisplaysDataType -json': INTERNAL_ONLY,
  };
  const run = async (file, args) => {
    const key = [file, ...args].join(' ');
    ran.push(key);
    if (key === '/usr/bin/pgrep -x Vorssaint') return { code: 0, stdout: '2195\n' };
    return { code: 0, stdout: outputs[key] };
  };
  const result = await preflight({ run, platform: 'darwin', now: () => new Date('2026-09-23T02:00:00.000Z') });
  assert.deepEqual(ran.sort(), [...Object.keys(outputs), '/usr/bin/pgrep -x Vorssaint'].sort());
  assert.deepEqual(result, { at: '2026-09-23T02:00:00.000Z', available: true, powerSource: 'battery', batteryPercent: 44,
    batteryState: 'discharging', idleSleepMinutes: 1, displaySleepMinutes: 10, sleepDisabled: false, hasLid: true,
    lidClosed: false, lidCloseSleeps: false, displays: 1, externalDisplay: false, vorssaintRunning: true });
  assert.equal(assessPreflight(result).lid.risk, 'protected');
});

test('preflight: failing, throwing or absent commands become unknowns, never an exception or a false "safe"', async () => {
  const failing = await preflight({ run: async () => ({ code: null, stdout: 'garbage' }), platform: 'darwin' });
  assert.equal(failing.powerSource, null);
  assert.equal(failing.hasLid, null);
  assert.equal(failing.sleepDisabled, null);
  assert.equal(failing.vorssaintRunning, null);
  assert.equal(assessPreflight(failing).lid.risk, 'unknown');
  const throwing = await preflight({ run: () => { throw new Error('boom'); }, platform: 'darwin' });
  assert.equal(throwing.idleSleepMinutes, null);
  const notRunning = await preflight({ run: async (file) => (file.endsWith('pgrep') ? { code: 1, stdout: '' } : { code: 0, stdout: '' }), platform: 'darwin' });
  assert.equal(notRunning.vorssaintRunning, false);
  const linux = await preflight({ run: () => assert.fail('must not run anything off macOS'), platform: 'linux' });
  assert.equal(linux.available, false);
});

// ---------------------------------------------------------------------------
// Per-project launch options in project.json
// ---------------------------------------------------------------------------
const task = { id: 'project-task', title: 'Project task', objective: 'Do one thing', weight: 1,
  scope: ['tests/workspace/example.mjs'], checks: ['node-syntax'], acceptance: ['It works'] };
async function library(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'orion-awake-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const base = join(home, '.openclaw/orion-controlled/project-agent');
  const file = join(home, 'plan.json');
  await writeFile(file, JSON.stringify({ project: 'Example', tasks: [task] }));
  return { home, base, project: await registerProject(file, { id: 'project-one', home: base }) };
}

test('project: an existing record with no launchOptions still reads, as the defaults', async t => {
  const { base, project } = await library(t);
  const raw = JSON.parse(await readFile(join(project.root, 'project.json'), 'utf8'));
  assert.equal('launchOptions' in raw, false);
  assert.deepEqual({ ...(await readProject('project-one', base)).launchOptions }, { ...AWAKE_DEFAULTS });
});

test('project: launch options round-trip, preserve the rest of the record, and write atomically', async t => {
  const { base, project } = await library(t);
  const before = JSON.parse(await readFile(join(project.root, 'project.json'), 'utf8'));
  const saved = await saveProjectLaunchOptions('project-one', { keepDisplayOn: true, nudgeMinutes: 5 }, base);
  assert.deepEqual({ ...saved.launchOptions }, { preventSleep: true, keepDisplayOn: true, nudgeMinutes: 5 });
  const after = JSON.parse(await readFile(join(project.root, 'project.json'), 'utf8'));
  assert.deepEqual({ ...after, launchOptions: undefined }, { ...before, launchOptions: undefined });
  assert.deepEqual(after.launchOptions, { preventSleep: true, keepDisplayOn: true, nudgeMinutes: 5 });
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual((await readdir(project.root)).filter(name => name.includes('.tmp-')), [], 'no temporary file left behind');
  await saveProjectLaunchOptions('project-one', { preventSleep: false }, base);
  assert.equal((await readProject('project-one', base)).launchOptions.preventSleep, false);
});

test('project: invalid options are refused on save without touching the record, and refused by name on read', async t => {
  const { base, project } = await library(t);
  const file = join(project.root, 'project.json');
  const before = await readFile(file, 'utf8');
  await assert.rejects(saveProjectLaunchOptions('project-one', { nudgeMinutes: 61 }, base), /0 to 60/);
  assert.equal(await readFile(file, 'utf8'), before);
  await writeFile(file, JSON.stringify({ ...JSON.parse(before), launchOptions: { nudgeMinutes: 'often' } }));
  await assert.rejects(readProject('project-one', base), /Invalid project launch options: nudgeMinutes/);
  await writeFile(file, JSON.stringify({ ...JSON.parse(before), launchOptions: { preventSleep: true, sleepy: true } }));
  await assert.rejects(readProject('project-one', base), /Invalid project launch options: Unknown keep-awake option: sleepy/);
  // The existing version/field checks still apply.
  await writeFile(file, JSON.stringify({ ...JSON.parse(before), version: 2 }));
  await assert.rejects(readProject('project-one', base), /Invalid project record/);
});

// ---------------------------------------------------------------------------
// The CLI. Every case here is a REFUSAL, and none passes --enable, so even a
// broken guard cannot reach `serve` (whose failure path sends a live Discord
// alert): with a fresh HOME there is no config, and absent config is disabled.
// ---------------------------------------------------------------------------
const cli = (home, ...args) => exec(process.execPath, ['scripts/orion-projects', ...args], { env: { ...process.env, HOME: home } });

test('cli: malformed keep-awake flags are refused before anything is written', async t => {
  const { home, project } = await library(t);
  const before = await readFile(join(project.root, 'project.json'), 'utf8');
  for (const flags of [['--nudge-minutes', '99'], ['--nudge-minutes'], ['--no-keep-awake', '--keep-display-on'], ['--keep-display-on', '--keep-display-on']]) {
    const error = await cli(home, 'launch', project.id, '1', ...flags).catch(e => e);
    assert.equal(error.code, 1, flags.join(' '));
  }
  assert.equal(await readFile(join(project.root, 'project.json'), 'utf8'), before);
  await assert.rejects(readFile(join(home, '.openclaw/orion-controlled/agentic-config.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(project.root, 'launch.json')), { code: 'ENOENT' });
});

test('cli: a refused launch does not save its options (disabled execution, or a live writer)', async t => {
  const { home, base, project } = await library(t);
  const before = await readFile(join(project.root, 'project.json'), 'utf8');
  const disabled = await cli(home, 'launch', project.id, '1', '--keep-display-on', '--nudge-minutes', '5').catch(e => e);
  assert.equal(disabled.code, 1);
  assert.match(disabled.stderr, /Execution is disabled/);
  await acquireLease(join(base, 'active-project.lock'));
  const busy = await cli(home, 'launch', project.id, '1', '--no-keep-awake').catch(e => e);
  assert.equal(busy.code, 1);
  assert.match(busy.stderr, /running|uncertain/);
  assert.equal(await readFile(join(project.root, 'project.json'), 'utf8'), before);
  await assert.rejects(readFile(join(project.root, 'state.json')), { code: 'ENOENT' });
});

test('cli: wall-clock and until-stopped limits parse before the enablement gate; past times are refused', async t => {
  const { home, project } = await library(t);
  const future = new Date(Date.now() + 3600_000).toISOString();
  for (const limit of [['--until-stopped'], ['--until', future]]) {
    const error = await cli(home, 'launch', project.id, ...limit).catch(e => e);
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Execution is disabled/);
    assert.doesNotMatch(error.stderr, /Choose --until/);
  }
  const past = await cli(home, 'launch', project.id, '--until', '2020-01-01T08:00:00Z').catch(e => e);
  assert.equal(past.code, 1);
  assert.match(past.stderr, /future ISO-8601/);
  await assert.rejects(readFile(join(project.root, 'launch.json')), { code: 'ENOENT' });
});

test('cli: serve refuses keep-awake flags, because it runs with what launch saved', async t => {
  const { home, project } = await library(t);
  // Refused during argument parsing — before keep-awake, the lease, or init.
  // The 99-hour budget is a second guard: were the flag check ever broken, the
  // budget check would still refuse (and this assertion would fail) long
  // before `serve` could reach init, run or its alerting failure path.
  const error = await cli(home, 'serve', project.id, '99', '--keep-display-on').catch(e => e);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /saved project/);
  await assert.rejects(readFile(join(project.root, 'launch.json')), { code: 'ENOENT' });
});

test('cli: preflight is read-only JSON with a summary line and warnings', { skip: process.platform !== 'darwin' }, async t => {
  const { home, project } = await library(t);
  const before = await readFile(join(project.root, 'project.json'), 'utf8');
  const { stdout } = await cli(home, 'preflight');
  const result = JSON.parse(stdout);
  assert.equal(result.available, true);
  assert.equal(typeof result.summary, 'string');
  assert.ok(Array.isArray(result.warnings));
  assert.ok(['protected', 'at-risk', 'unknown', 'no-lid'].includes(result.lid.risk));
  assert.equal(await readFile(join(project.root, 'project.json'), 'utf8'), before);
  const refused = await cli(home, 'preflight', 'extra').catch(e => e);
  assert.equal(refused.code, 1);
});
