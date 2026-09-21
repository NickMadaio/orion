/*
 Git safety for unattended work.

 WHAT THIS FIXES

 The legacy coder's `do_task` ignored the exit codes of `git add` and `git
 commit` and logged a checkpoint success anyway. The Astra handoff records it,
 and it is the worst class of bug this system can have: a run that reports eight
 accepted checkpoints and has committed nothing, discovered in the morning. So
 every git invocation here is checked, and a checkpoint is not a checkpoint until
 the SHA has been resolved, confirmed to exist as a commit object, and confirmed
 to be HEAD.

 IT ALSO DOES NOT REUSE ONE WORKTREE FOREVER

 The legacy coder created its worktree with `git worktree add -B`, which moves a
 branch that may already have work on it. This creates a run-scoped branch, never
 forces one, and refuses outright if the path exists but belongs to some other
 branch — the Astra handoff is explicit that existing worktrees are to be
 preserved, not reset or recreated.

 AND IT NEVER PUSHES.

 Landing work is a human decision. Everything here is local: a branch, commits,
 and a tree Nick can read in the morning. Ten hours of autonomous change stays
 reversible because every accepted task is its own commit with the task id in
 the subject, not one mystery diff.
*/
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertWritable, unreadableSurface } from './boundary.mjs';

const run = promisify(execFile);
const GIT = '/usr/bin/git';

export class GitError extends Error {
  constructor(argv, result) {
    super(`git ${argv.join(' ')} failed: ${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
    this.name = 'GitError';
    this.argv = argv;
  }
}

async function git(cwd, argv, { timeoutMs = 120_000, allowFailure = false, trim = true } = {}) {
  try {
    const { stdout, stderr } = await run(GIT, argv, {
      cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
      // A fixed environment: no inherited credentials helper, no askpass, and
      // nothing that could make a local operation reach the network.
      env: { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: process.env.HOME ?? '',
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo', GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' },
    });
    return { ok: true, stdout: trim ? stdout.trim() : stdout, stderr: stderr.trim() };
  } catch (error) {
    const result = { ok: false, stdout: trim ? (error.stdout ?? '').trim() : (error.stdout ?? ''), stderr: (error.stderr ?? error.message ?? '').trim(), code: error.code };
    if (allowFailure) return result;
    throw new GitError(argv, result);
  }
}

const SHA = /^[a-f0-9]{40}$/;

export async function currentHead(worktree) {
  const result = await git(worktree, ['rev-parse', 'HEAD']);
  if (!SHA.test(result.stdout)) throw new GitError(['rev-parse', 'HEAD'], result);
  return result.stdout;
}

/** Paths git reports as modified, added or untracked, repository-relative. */
export async function changedFiles(worktree) {
  // `trim: false` is load-bearing. Porcelain v1 is `XY PATH`, and an unstaged
  // modification's X is a SPACE -- so trimming stdout eats the first entry's
  // leading character and every path in the first record loses a letter. That
  // silently turned "sandbox/widget.mjs" into "andbox/widget.mjs", which made
  // `node --check` fail on a file that was fine, which blocked a correct task.
  const result = await git(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { trim: false });
  const entries = result.stdout.split('\0').filter(Boolean);
  const files = [];
  for (const entry of entries) {
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path) continue;
    // A rename's second path arrives as its own NUL-separated record; both
    // halves matter, so neither is skipped.
    files.push({ path, status: status.trim() });
  }
  return files;
}

export async function isClean(worktree) {
  return (await changedFiles(worktree)).length === 0;
}

/**
 * Create or adopt the run's worktree. Refuses to touch a path that exists and is
 * not ours, and never uses `-B`.
 */
export async function ensureWorkspace(repoRoot, { worktree, branch, baseRef = 'HEAD' }) {
  const listed = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  const blocks = listed.stdout.split('\n\n').map(block => Object.fromEntries(
    block.split('\n').filter(Boolean).map(line => {
      const index = line.indexOf(' ');
      return index === -1 ? [line, true] : [line.slice(0, index), line.slice(index + 1)];
    })));
  const existing = blocks.find(block => block.worktree === worktree);
  if (existing) {
    const head = existing.branch ? existing.branch.replace(/^refs\/heads\//, '') : null;
    if (head !== branch) {
      throw new Error(
        `${worktree} already exists on "${head ?? 'a detached HEAD'}", not "${branch}". ` +
        'Existing worktrees are preserved, never reset or recreated; remove it deliberately or choose another run.');
    }
    return { worktree, branch, created: false, head: await currentHead(worktree) };
  }
  const branchExists = (await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true })).ok;
  if (branchExists) {
    throw new Error(`branch "${branch}" already exists without a worktree; refusing to reuse it for a new run`);
  }
  await mkdir(dirname(worktree), { recursive: true, mode: 0o700 });
  await git(repoRoot, ['worktree', 'add', '-b', branch, worktree, baseRef], { timeoutMs: 300_000 });
  return { worktree, branch, created: true, head: await currentHead(worktree) };
}

/** Read files before the worker edits them, for the orphan-export comparison. */
export async function snapshotBaseline(worktree, paths) {
  const baseline = new Map();
  for (const path of paths) {
    try { baseline.set(path, await readFile(join(worktree, path), 'utf8')); }
    catch { baseline.set(path, ''); }
  }
  return baseline;
}

/**
 * The only write path into the repository. Every write passes the boundary, so
 * a model that decides a neighbouring file would be easier to fix simply cannot
 * reach it — the refusal happens before any bytes are written.
 */
export async function writeScoped(worktree, contract, relativePath, contents) {
  const effective = assertWritable(worktree, relativePath, contract);
  if (typeof contents !== 'string') throw new Error('file contents must be a string');
  if (contents.length > 2 * 1024 * 1024) throw new Error('refusing to write a file larger than 2 MiB');
  const absolute = join(worktree, effective);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, { mode: 0o644 });
  return effective;
}

/**
 * Read a file from the worktree.
 *
 * Reads are NOT scope-limited, because a worker that cannot read the caller of
 * the function it is changing writes the wrong function. They are deny-listed:
 * anything the worker can read it can copy into a file it is allowed to write,
 * so personal material and key material stay out of its context entirely.
 */
export async function readScoped(worktree, relativePath, { maxBytes = 400_000 } = {}) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || relativePath.startsWith('/') ||
      relativePath.includes('..')) throw new Error('unusable path');
  const forbidden = unreadableSurface(relativePath);
  if (forbidden) throw new Error(`refusing to read "${relativePath}": that is ${forbidden.reason}`);
  const text = await readFile(join(worktree, relativePath), 'utf8');
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…[truncated, ${text.length} chars total]` : text;
}

/**
 * Stage exactly `paths` and commit. Returns a SHA only when git actually made
 * one; every step's exit code is checked and the result is verified against
 * HEAD afterwards.
 */
export async function commitCheckpoint(worktree, { paths, message, author = 'Orion local agent <orion@localhost>' }) {
  if (!Array.isArray(paths) || !paths.length) return { committed: false, reason: 'nothing to commit', commit: null };
  const before = await currentHead(worktree);
  // Deliberate staging, never `git add -A`: this tree is shared with whatever
  // else the run touched, and AGENTS.md is explicit that the dirty tree is
  // usually not yours.
  await git(worktree, ['add', '--', ...paths]);
  const staged = await git(worktree, ['diff', '--cached', '--name-only'], { allowFailure: true });
  if (!staged.ok || !staged.stdout) return { committed: false, reason: 'staging produced no change', commit: null };

  const name = author.replace(/\s*<.*>$/, '');
  const email = author.match(/<(.+)>/)?.[1] ?? 'orion@localhost';
  const commit = await git(worktree, ['-c', `user.name=${name}`, '-c', `user.email=${email}`,
    'commit', '--no-verify', '--no-gpg-sign', '-m', message.slice(0, 4000)], { allowFailure: true });
  if (!commit.ok) return { committed: false, reason: `commit refused: ${commit.stderr || commit.stdout}`, commit: null };

  const after = await currentHead(worktree);
  if (after === before) return { committed: false, reason: 'HEAD did not move', commit: null };
  // The SHA must name a real commit object. A 40-hex string that parses is not
  // a checkpoint; this is what makes "verified checkpoint" mean something.
  const kind = await git(worktree, ['cat-file', '-t', after], { allowFailure: true });
  if (!kind.ok || kind.stdout !== 'commit') return { committed: false, reason: 'HEAD does not resolve to a commit object', commit: null };
  const files = await git(worktree, ['show', '--pretty=', '--name-only', after], { allowFailure: true });
  return { committed: true, commit: after, previous: before, files: files.ok ? files.stdout.split('\n').filter(Boolean) : [] };
}

/**
 * Discard uncommitted work back to HEAD. Used when an attempt failed or when a
 * crash left a half-written mutation: the last ACCEPTED commit is the only state
 * this system treats as real, so returning to it is always safe.
 */
export async function discardToHead(worktree) {
  const dirty = await changedFiles(worktree);
  if (!dirty.length) return { discarded: [], head: await currentHead(worktree) };
  await git(worktree, ['checkout', '--', '.'], { allowFailure: true });
  await git(worktree, ['clean', '-fd'], { allowFailure: true });
  const remaining = await changedFiles(worktree);
  if (remaining.length) {
    throw new Error(`could not return the worktree to HEAD; still dirty: ${remaining.map(item => item.path).join(', ').slice(0, 300)}`);
  }
  return { discarded: dirty.map(item => item.path), head: await currentHead(worktree) };
}

/** A compact diff for a review or a handoff — never the whole ten-hour history. */
export async function diffSince(worktree, ref, { maxChars = 60_000, paths = [] } = {}) {
  const argv = ['diff', '--no-color', '--stat=200', ref, '--'];
  const stat = await git(worktree, paths.length ? [...argv, ...paths] : argv.slice(0, -1), { allowFailure: true });
  const body = await git(worktree, ['diff', '--no-color', '-U3', ref, ...(paths.length ? ['--', ...paths] : [])], { allowFailure: true });
  const text = body.ok ? body.stdout : '';
  return {
    stat: stat.ok ? stat.stdout : '',
    patch: text.length > maxChars ? `${text.slice(0, maxChars)}\n…[diff truncated at ${maxChars} characters]` : text,
    truncated: text.length > maxChars,
  };
}

/**
 * Find where a name is used. `git grep` rather than a directory listing: a model
 * asked to choose from nine hundred paths picks a plausible one, and a plausible
 * path is the expensive kind of wrong. The pattern is passed as a literal
 * (`-F`), so a search term containing regex metacharacters is a search term.
 */
export async function searchRepo(worktree, pattern, { maxMatches = 40 } = {}) {
  if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 200) return [];
  const result = await git(worktree, ['grep', '-n', '-I', '-F', '--max-count=3', '--', pattern.trim()],
    { allowFailure: true, timeoutMs: 60_000 });
  if (!result.ok && !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean).slice(0, maxMatches).map(line => line.slice(0, 300));
}

/** Commits on this run's branch that are not on its base — what the run did. */
export async function runLog(worktree, baseRef) {
  const result = await git(worktree, ['log', '--no-color', '--format=%H %s', `${baseRef}..HEAD`], { allowFailure: true });
  if (!result.ok) return [];
  return result.stdout.split('\n').filter(Boolean).map(line => ({
    commit: line.slice(0, 40), subject: line.slice(41),
  }));
}
