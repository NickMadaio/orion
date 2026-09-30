/*
 Turning ### EDIT actions into whole-file writes.

 Every write still goes through `writeScoped` as a complete file, so scope,
 protected surfaces and the diff the reviewer sees are exactly what they were
 for ### FILE. Only what the model has to TYPE changes. See `parseEditHunks` in
 prompts.mjs for why.
*/
import { readScoped } from './workspace.mjs';

/**
 * Apply SEARCH/REPLACE hunks in order. Each SEARCH must occur exactly once;
 * trailing whitespace on each line is forgiven, nothing else is. Throws with a
 * reason the model can act on, and changes nothing unless every hunk applies.
 */
export function applyEdits(contents, hunks) {
  let text = String(contents);
  for (const [index, { search, replace }] of hunks.entries()) {
    const label = `SEARCH block ${index + 1} of ${hunks.length}`;
    if (!search.trim()) throw new Error(`${label} is empty; to add code, SEARCH for the line it goes after and repeat it in REPLACE`);
    const count = needle => needle ? text.split(needle).length - 1 : 0;
    let found = count(search);
    let target = search;
    if (found === 0) {
      // Forgive trailing whitespace only: map each line of the search onto the
      // file's own lines, so the replacement lands where the model meant.
      const strip = line => line.replace(/[ \t]+$/, '');
      const want = search.split('\n').map(strip);
      const lines = text.split('\n');
      const starts = [];
      for (let i = 0; i + want.length <= lines.length; i += 1) {
        if (want.every((line, j) => strip(lines[i + j]) === line)) starts.push(i);
      }
      if (starts.length === 1) { target = lines.slice(starts[0], starts[0] + want.length).join('\n'); found = 1; }
      else found = starts.length;
    }
    if (found === 0) throw new Error(`${label} does not match the file. Copy the lines exactly as they appear under FILES, including indentation`);
    if (found > 1) throw new Error(`${label} matches ${found} places. Include more surrounding lines so it matches exactly one`);
    const at = text.indexOf(target);
    text = text.slice(0, at) + replace + text.slice(at + target.length);
  }
  return text;
}

/**
 * Replace each EDIT in `actions` with the FILE it produces. An edit that does
 * not apply is dropped and reported; the file on disk is left as it was.
 */
export async function materializeEdits(worktree, actions, { maxBytes = 400_000 } = {}) {
  const resolved = [];
  const failures = [];
  // Several EDITs to one file in one reply apply in order, each to the result
  // of the one before.
  const pending = new Map();
  for (const action of actions) {
    if (action.kind !== 'EDIT') { resolved.push(action); continue; }
    try {
      const current = pending.has(action.path) ? pending.get(action.path)
        : await readScoped(worktree, action.path, { maxBytes });
      if (current.includes('\n…[truncated,')) throw new Error('the file is too large to edit safely');
      const contents = applyEdits(current, action.hunks);
      pending.set(action.path, contents);
      const earlier = resolved.findIndex(item => item.kind === 'FILE' && item.path === action.path && item.fromEdit);
      if (earlier !== -1) resolved.splice(earlier, 1);
      resolved.push({ kind: 'FILE', path: action.path, contents, fromEdit: true });
    } catch (error) {
      failures.push({ path: action.path, reason: error.code === 'ENOENT'
        ? 'the file does not exist yet; create it with ### FILE' : error.message });
    }
  }
  return { actions: resolved, failures };
}
