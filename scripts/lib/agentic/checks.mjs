/*
 The check registry — the ONLY commands this runtime will ever run.

 WHY A REGISTRY AND NOT A COMMAND STRING

 The legacy coder took its check as a shell string from the task. The Astra
 handoff records that as a hazard and it is: a task description is data a model
 can influence, and "the check for this task is `rm -rf ~/Desktop`" is then a
 sentence that executes. A contract names a check; it does not carry one.

 Every entry below is a fixed argv array. No shell, no interpolation, no `sh -c`,
 and `spawn` without `shell: true` so a name containing a semicolon is a name
 containing a semicolon. Adding a check is a human edit to this file, reviewed
 like any other code, and this file is on the runtime deny-list so the agent
 cannot add one for itself.

 THE ANTI-GAMING CHECK

 `no-orphan-exports` is not a build step. It exists because of something this
 project already watched happen: a model optimising for "make the check green"
 added an exported function nothing called, and the build went green, and that
 was committed as progress. It was not progress; it was a function. So a check
 asks not only "does it build" but "is what you added actually reached".
*/
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NODE = process.execPath;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * `cwd` is relative to the worktree root. `argv[0]` is an absolute path or a
 * bare name resolved against the fixed PATH below — never a user-supplied one.
 */
export const CHECK_REGISTRY = Object.freeze({
  'node-syntax': {
    kind: 'per-file',
    description: 'every changed .mjs/.js file parses',
    extensions: ['.mjs', '.js'],
    argv: file => [NODE, '--check', file],
    timeoutMs: 60_000,
  },
  'agentic-tests': {
    kind: 'command',
    description: 'the local agentic runtime suites',
    argv: [NODE, '--test', 'tests/agentic-contract.test.mjs', 'tests/agentic-boundary.test.mjs',
      'tests/agentic-orchestrator.test.mjs', 'tests/agentic-supervisor.test.mjs'],
    timeoutMs: 5 * 60 * 1000,
  },
  'project-agent-tests': {
    kind: 'command',
    description: 'the durable controller suite',
    argv: [NODE, '--test', 'tests/project-agent.test.mjs'],
    timeoutMs: 5 * 60 * 1000,
  },
  'automation-tests': {
    kind: 'command',
    description: 'the Phase 57 automation suites',
    argv: [NODE, '--test', 'tests/automation-removal.test.mjs', 'tests/automation-admission.test.mjs',
      'tests/automation-dispatch.test.mjs', 'tests/automation-delivery.test.mjs',
      'tests/automation-host.test.mjs', 'tests/automation-runtime.test.mjs',
      'tests/automation-schedule.test.mjs'],
    timeoutMs: 10 * 60 * 1000,
  },
  'plugin-typecheck': {
    kind: 'command',
    description: 'TypeScript compiles with no emit',
    cwd: 'plugin/orion-control',
    argv: ['npx', 'tsc', '-p', 'tsconfig.json', '--noEmit'],
    timeoutMs: 10 * 60 * 1000,
  },
  'plugin-security': {
    kind: 'command',
    description: 'the adversarial gate and trust-boundary suites',
    cwd: 'plugin/orion-control',
    argv: ['npx', 'vitest', 'run', 'src/gate.test.ts', 'src/index.test.ts'],
    timeoutMs: 15 * 60 * 1000,
  },
  'plugin-tests': {
    kind: 'command',
    description: 'the full plugin suite',
    cwd: 'plugin/orion-control',
    argv: ['npx', 'vitest', 'run', '--config', './vitest.config.ts'],
    timeoutMs: 20 * 60 * 1000,
  },
  'secret-scan': {
    kind: 'command',
    description: 'no secrets in the tree',
    argv: ['/usr/bin/env', 'python3', 'scripts/orion_v2_secret_scan.py',
      '--allowlist', 'docs/planning/v2/secret-scan-allowlist.json'],
    timeoutMs: 10 * 60 * 1000,
  },
  'no-orphan-exports': {
    kind: 'builtin',
    description: 'every export added by this task is referenced somewhere else',
    timeoutMs: 5 * 60 * 1000,
  },
});

export function isRegisteredCheck(name) {
  return Object.hasOwn(CHECK_REGISTRY, name);
}

export function describeChecks(names) {
  return names.map(name => `${name}: ${CHECK_REGISTRY[name]?.description ?? 'unknown check'}`);
}

/*
 A fixed environment. Inheriting the operator's env would hand an unattended
 model whatever happened to be exported in the shell that launched it — tokens
 among them. `PATH` is fixed so `npx` resolves the same way every run.
*/
function checkEnvironment(worktree) {
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME ?? '',
    LANG: 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    CI: '1',
    ORION_AGENTIC_CHECK: '1',
    ORION_REPO_ROOT: worktree,
  };
}

const MAX_OUTPUT = 60_000;

function runArgv(argv, { cwd, timeoutMs, signal, worktree }) {
  return new Promise(resolve => {
    const started = Date.now();
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        env: checkEnvironment(worktree),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so a timeout can kill DESCENDANTS. `npx vitest`
        // is three processes deep; killing the parent leaves the suite running
        // and the next check then fights it for the same ports and files.
        detached: true,
      });
    } catch (error) {
      return resolve({ ok: false, exitCode: null, output: `could not start: ${error.message}`, ms: 0, startFailure: true });
    }
    let output = '', truncated = false, settled = false;
    const absorb = chunk => {
      if (output.length >= MAX_OUTPUT) { truncated = true; return; }
      output += chunk;
      if (output.length > MAX_OUTPUT) { output = output.slice(0, MAX_OUTPUT); truncated = true; }
    };
    child.stdout.on('data', absorb);
    child.stderr.on('data', absorb);

    const killTree = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ...result, ms: Date.now() - started, output: truncated ? `${output}\n[output truncated]` : output });
    };
    const timer = setTimeout(() => { killTree(); finish({ ok: false, exitCode: null, output, timedOut: true }); }, timeoutMs);
    const onAbort = () => { killTree(); finish({ ok: false, exitCode: null, output, cancelled: true }); };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', error => finish({ ok: false, exitCode: null, output: `${output}\n${error.message}`, startFailure: true }));
    child.on('close', code => finish({ ok: code === 0, exitCode: code }));
  });
}

/*
 A missing interpreter is not a failing test. 127 handed back to a model as if it
 were a compiler error asks it to fix something it did not break, and it will
 rewrite the file trying. The legacy coder learned this; it is kept.
*/
function environmentBroken(result) {
  return Boolean(result.startFailure) || result.exitCode === 127 ||
    /command not found|ENOENT|No such file or directory/i.test(result.output.slice(0, 2000));
}

const EXPORT_NAME = /^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm;

async function orphanExports({ worktree, changedFiles, baseline, signal }) {
  const orphans = [];
  for (const file of changedFiles) {
    if (!/\.(mjs|js|ts|tsx)$/.test(file)) continue;
    let after = '';
    try { after = await readFile(join(worktree, file), 'utf8'); } catch { continue; }
    const before = baseline.get(file) ?? '';
    const names = source => new Set([...source.matchAll(EXPORT_NAME)].map(match => match[1]));
    const added = [...names(after)].filter(name => !names(before).has(name));
    for (const name of added) {
      const found = await runArgv(['/usr/bin/git', 'grep', '-l', '-w', '--', name], {
        cwd: worktree, timeoutMs: 90_000, signal, worktree,
      });
      // git grep exits 1 for "no matches"; only the changed file itself is not
      // a reference, and a test file referencing it counts — being exercised by
      // a test is being reached.
      const referencing = found.output.split('\n').map(line => line.trim()).filter(Boolean)
        .filter(path => path !== file);
      if (!referencing.length) orphans.push(`${file}: exported "${name}" is referenced nowhere else`);
    }
  }
  return orphans.length
    ? { ok: false, exitCode: 1, output: orphans.join('\n'), ms: 0 }
    : { ok: true, exitCode: 0, output: 'no unreferenced new exports', ms: 0 };
}

/**
 * Run one registered check. Returns a structured result; never throws for a
 * check that merely failed, and distinguishes "your code is wrong" from "this
 * machine cannot run the check".
 */
export async function runCheck(name, { worktree, changedFiles = [], baseline = new Map(), signal } = {}) {
  const entry = CHECK_REGISTRY[name];
  if (!entry) return { name, ok: false, exitCode: null, output: `"${name}" is not a registered check`, ms: 0, unusable: true };
  const timeoutMs = Math.min(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (entry.kind === 'builtin') {
    const result = await orphanExports({ worktree, changedFiles, baseline, signal });
    return { name, ...result };
  }
  if (entry.kind === 'per-file') {
    const targets = changedFiles.filter(file => entry.extensions.some(extension => file.endsWith(extension)));
    if (!targets.length) return { name, ok: true, exitCode: 0, output: 'no matching changed files', ms: 0 };
    for (const file of targets) {
      const result = await runArgv(entry.argv(file), { cwd: worktree, timeoutMs, signal, worktree });
      if (!result.ok) return { name, ...result, unusable: environmentBroken(result), output: `${file}: ${result.output}` };
    }
    return { name, ok: true, exitCode: 0, output: `${targets.length} file(s) parse`, ms: 0 };
  }
  const cwd = entry.cwd ? join(worktree, entry.cwd) : worktree;
  const result = await runArgv(entry.argv, { cwd, timeoutMs, signal, worktree });
  return { name, ...result, unusable: environmentBroken(result) };
}

/** Run each named check in order, stopping at the first unusable environment. */
export async function runChecks(names, options) {
  const results = [];
  for (const name of names) {
    const result = await runCheck(name, options);
    results.push(result);
    if (result.unusable || result.cancelled) break;
  }
  return results;
}
