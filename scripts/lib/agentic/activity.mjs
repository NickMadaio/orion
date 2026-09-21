/*
 The live activity channel — what the model is thinking, right now.

 WHY THIS IS SEPARATE FROM THE JOURNAL

 The journal is the audit record: append-only, durable, fsynced, and read months
 later to answer "what did it do while nobody was watching". Reasoning traces do
 not belong in it — they are enormous, they are not evidence, and the mission is
 explicit that structured summaries beat dumping them.

 But a panel that says "running" for nine minutes while a 27B thinks is a panel
 that looks broken. So this is the opposite kind of file: ONE snapshot,
 overwritten in place, bounded, disposable, and never fsynced. Losing it costs
 nothing; the journal is the record.

 WHY IT IS THROTTLED

 Tokens arrive faster than any UI can read and far faster than a disk should be
 written. The channel coalesces: at most one write every `INTERVAL_MS`, plus one
 final write when a generation ends so the last thought is never stranded
 mid-sentence behind the throttle.

 WHY `thinking` IS A FACT AND NOT A GUESS

 It is set from actual streamed tokens arriving and cleared when the stream ends.
 A spinner driven by "status is running" spins just as convincingly when the
 inference runtime has died.
*/
import { writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const INTERVAL_MS = 400;
const MAX_TRACE = 6000;
const MAX_OUTPUT = 3000;

export class ActivityChannel {
  #path;
  #tmp;
  #state;
  #timer = null;
  #dirty = false;
  #writing = false;
  #pending = Promise.resolve();

  constructor(root) {
    this.#path = join(root, 'activity.json');
    this.#tmp = join(root, 'activity.json.tmp');
    this.#state = this.#empty();
  }

  #empty() {
    return {
      at: new Date().toISOString(), role: 'idle', model: null, phase: 'idle',
      taskId: null, thinking: false, streaming: false,
      thinkingChars: 0, outputChars: 0, startedAt: null,
      trace: '', output: '', note: null,
    };
  }

  /** A generation has begun. Clears the previous trace so two runs never blend. */
  begin({ role, model, phase, taskId, note = null }) {
    this.#state = {
      ...this.#empty(),
      role, model, phase, taskId, note,
      streaming: true, startedAt: new Date().toISOString(),
    };
    return this.#schedule(true);
  }

  /**
   * One streamed chunk. Called per token, so it must stay cheap.
   *
   * TRANSITIONS are written immediately; steady-state token flow is throttled.
   * Throttling the transition too would mean the "thinking" indicator lit up to
   * 400ms after the model actually started, and — worse — stayed lit for up to
   * 400ms after it stopped. The indicator is the one thing on the panel that
   * must not lag, because its whole job is to distinguish working from hung.
   */
  delta({ thinking = '', response = '' }) {
    const was = this.#state.thinking;
    if (thinking) {
      this.#state.thinking = true;
      this.#state.thinkingChars += thinking.length;
      // The TAIL is what a reader wants: where the reasoning got to, not where
      // it started nine minutes ago.
      this.#state.trace = (this.#state.trace + thinking).slice(-MAX_TRACE);
    }
    if (response) {
      // Output arriving means thinking has finished, whatever came before.
      this.#state.thinking = false;
      this.#state.outputChars += response.length;
      this.#state.output = (this.#state.output + response).slice(-MAX_OUTPUT);
    }
    return this.#schedule(was !== this.#state.thinking);
  }

  /** The generation ended. Always writes, so the last thought is not stranded. */
  end(note = null) {
    this.#state.thinking = false;
    this.#state.streaming = false;
    if (note) this.#state.note = note;
    return this.#schedule(true);
  }

  /** Nothing is running. */
  idle(note = null) {
    this.#state = { ...this.#empty(), note };
    return this.#schedule(true);
  }

  /*
   Coalescing write, and an AWAITABLE one.

   Two bugs lived here, both with the same symptom: a finished generation whose
   panel still said "thinking", forever — exactly the lie this channel exists to
   prevent.

     1. A flush that returned early while another write was in flight dropped
        the update instead of queueing it.
     2. Returning early ALSO returned no promise, so `await end()` resolved
        without anything having been written.

   So: one drain at a time, a `while (dirty)` loop inside it so nothing is lost,
   and callers get the in-flight promise plus a re-check afterwards.
  */
  #schedule(immediate) {
    this.#dirty = true;
    if (!immediate) {
      if (!this.#timer) this.#timer = setTimeout(() => { this.#timer = null; this.#flush(); }, INTERVAL_MS);
      return Promise.resolve();
    }
    return this.#flush();
  }

  async #flush() {
    if (this.#writing) {
      await this.#pending;
      // The in-flight drain may have exited just before this update arrived.
      if (this.#dirty) await this.#flush();
      return;
    }
    this.#pending = this.#drain();
    await this.#pending;
  }

  async #drain() {
    this.#writing = true;
    try {
      while (this.#dirty) {
        this.#dirty = false;
        const snapshot = { ...this.#state, at: new Date().toISOString() };
        try {
          // Temp + rename so a reader polling this file never sees a
          // half-written JSON object. No fsync: this is disposable by design.
          await writeFile(this.#tmp, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(this.#tmp, this.#path);
        } catch { /* the channel is cosmetic; never let it break a run */ }
      }
    } finally { this.#writing = false; }
  }

  /** Stop the timer so a finished process does not linger. */
  close() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    return this.#flush();
  }
}

/** Read the channel. Used by the CLI; the Swift app reads the same file. */
export async function readActivity(root) {
  try { return JSON.parse(await readFile(join(root, 'activity.json'), 'utf8')); }
  catch { return null; }
}
