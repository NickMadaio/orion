// Scoped writer for the existing Classes course folder. The refresh planner is
// pure; this layer owns optimistic conflict checks, backups and atomic writes.
import { readdirSync, readFileSync, lstatSync, existsSync, mkdirSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { COURSE_FOLDER, SCHOOL_NOTE, SOURCE_REGISTER } from './course-notes.mjs';

function ordinaryPath(vault, relative, allowMissing = false) {
  const root = resolve(vault), path = resolve(root, relative);
  if (!path.startsWith(`${root}/`)) throw new Error('Course path left the vault');
  let current = root;
  if (lstatSync(root).isSymbolicLink()) throw new Error('Vault root must not be a symlink');
  for (const part of relative.split('/')) {
    current = join(current, part);
    if (!existsSync(current)) {
      // A dangling symlink must not count as a safely missing file.
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('Refusing a symlink course path'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (allowMissing && current === path) return path;
      throw new Error('Required course folder or note is missing');
    }
    if (lstatSync(current).isSymbolicLink()) throw new Error('Refusing a symlink course path');
  }
  return path;
}

export function loadCourseVault(vault) {
  const folder = ordinaryPath(vault, COURSE_FOLDER), notes = new Map();
  for (const file of readdirSync(folder).filter(f => f.endsWith('.md'))) {
    const relative = `${COURSE_FOLDER}/${file}`;
    const path = ordinaryPath(vault, relative);
    if (!lstatSync(path).isFile()) throw new Error('Course note is not a regular file');
    notes.set(relative, readFileSync(path, 'utf8'));
  }
  const schoolNote = readFileSync(ordinaryPath(vault, SCHOOL_NOTE), 'utf8');
  notes.set(SOURCE_REGISTER, readFileSync(ordinaryPath(vault, SOURCE_REGISTER),'utf8'));
  return { notes, schoolNote };
}

export function applyCourseRefresh(vault, plan, backupRoot, expectedSchoolNote) {
  const lockPath = join(ordinaryPath(vault, COURSE_FOLDER), '.orion-canvas.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('A course refresh is already running; review stale lock manually if needed'); throw e; }
  const staged = [], applied = [], backup = join(backupRoot, `canvas-${plan.course_id}-${randomUUID()}`);
  try {
    if (readFileSync(ordinaryPath(vault, SCHOOL_NOTE), 'utf8') !== expectedSchoolNote) throw new Error('Course exclusions changed during retrieval; retry');
    mkdirSync(backup, { recursive:true, mode:0o700 });
    for (const change of plan.changes) {
      if (change.path !== SOURCE_REGISTER && (!change.path.startsWith(`${COURSE_FOLDER}/`) || change.path.slice(COURSE_FOLDER.length+1).includes('/'))) throw new Error('Only direct course notes and source register may be refreshed');
      const path = ordinaryPath(vault, change.path, change.before === null);
      const actual = existsSync(path) ? readFileSync(path,'utf8') : null;
      if (actual !== change.before) throw new Error('A course note changed during retrieval; no overwrite');
      if (actual !== null) copyFileSync(path, join(backup, change.path.split('/').at(-1)));
      const temporary = `${path}.canvas-${randomUUID()}.tmp`;
      writeFileSync(temporary, change.after, { flag:'wx', mode:0o600 });
      staged.push({ ...change, path, temporary });
    }
    writeFileSync(join(backup,'manifest.json'), JSON.stringify({ course_id:plan.course_id, retrieved_at:plan.retrieved_at, files:plan.changes.map(c => ({path:c.path, existed:c.before !== null})) }, null, 2), {mode:0o600});
    for (const change of staged) {
      if ((existsSync(change.path) ? readFileSync(change.path,'utf8') : null) !== change.before) throw new Error('A course note changed before commit; refusing overwrite');
      renameSync(change.temporary, change.path);
      applied.push(change);
    }
    for (const change of applied) if (readFileSync(change.path,'utf8') !== change.after) throw new Error('Course note verification failed');
    return { backup, files:plan.changes.map(c => c.path) };
  } catch (e) {
    for (const change of applied.reverse()) {
      // Never undo someone else's concurrent edit; a backup remains recoverable.
      if (readFileSync(change.path,'utf8') !== change.after) continue;
      if (change.before === null) unlinkSync(change.path);
      else writeFileSync(change.path, change.before, {mode:0o600});
    }
    throw e;
  } finally {
    for (const change of staged) if (existsSync(change.temporary)) unlinkSync(change.temporary);
    closeSync(lock); unlinkSync(lockPath);
  }
}
