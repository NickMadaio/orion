/*
 Model backends, roles, and exclusive residency.

 ROLES, NOT NAMES

 Nothing outside this file names a model. The rest of the runtime asks for the
 `worker` role or the `reviewer` role and gets whatever configuration binds to
 it, so swapping qwen3.6:27b for something else — or a local model for a paid
 API — is a config edit or a new backend, never a change to the orchestrator.
 The mission is explicit that models will be benchmarked and replaced, and a
 system with a model name threaded through it cannot be benchmarked honestly.

 THE 48 GB CONSTRAINT IS LOAD-BEARING

 This Mac has 48 GiB of unified memory. A ~27B worker is roughly 17 GiB resident
 and an ~80B-class reviewer is 36-48 GiB depending on quantisation. They do not
 both fit, and discovering that at 02:00 looks like the machine hanging, not like
 a configuration error. So residency is EXCLUSIVE by construction: before a role
 generates, every other model is unloaded and the unload is verified against
 Ollama's own process list, not assumed from having asked.

 `keep_alive: 0` is the unload. Ollama otherwise holds a model resident for five
 minutes after a request, which is exactly long enough for the reviewer to load
 on top of a worker that has not left yet.
*/
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertPromptFits, promptBudget } from './context.mjs';
import { guardResources } from './resources.mjs';

function recoverableRuntimeError(message, cause = null) {
  const error = new Error(message);
  error.name = 'RecoverableRuntimeError';
  error.code = 'ORION_INFERENCE_RUNTIME';
  error.recoverableRuntime = true;
  if (cause) error.cause = cause;
  return error;
}

export const CONFIG_PATH = join(homedir(), '.openclaw/orion-controlled/agentic-config.json');

/*
 Defaults, chosen from what is actually installed on this machine and from
 measurements already recorded in this repository (scripts/orion-code documents
 qwen3.6:27b at 48-61s on a real TypeScript task, correct, with thinking off).

 The reviewer default is NOT an 80B model, because no 80B model is installed and
 a default that names an absent model fails at 02:00 instead of at startup. It
 is the largest installed model; `agentic-config.json` overrides it the moment
 an 80B-class model is pulled and benchmarked.
*/
export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  endpoint: 'http://127.0.0.1:11434',
  memoryBudgetGiB: 40,
  roles: {
    worker: {
      // 20.7 GiB MEASURED on this Mac via /api/ps at the 65536 context below,
      // not the ~17 the file size suggests: the KV cache for a 64k window is the
      // difference, and it grows with the context setting. A residency estimate
      // taken from `ollama list` is the kind of wrong that only shows up as
      // swapping during a reviewer handoff at 02:00.
      backend: 'ollama', model: 'qwen3.6:27b', approxResidentGiB: 21,
      // 32768 is Ollama's default for this model, not the 262144 it supports,
      // and it silently truncates the FRONT of the prompt — which is where the
      // contract and the constraints live. Stated explicitly, always.
      contextTokens: 65536,
      // `num_predict` covers thinking AND the answer together. Too small and the
      // model spends the whole allowance reasoning and returns an empty string,
      // which reads as "the model failed" and is really "the budget was wrong".
      maxOutputTokens: 16000,
      temperature: 0.2, think: true, timeoutMs: 30 * 60 * 1000,
    },
    reviewer: {
      // The SAME model as the worker, deliberately. Measured 2026-09-21 across
      // eight candidates on two evals: qwen3.6:27b caught 3/3 planted defects
      // with zero false positives in every run, and is the only model that is
      // top-ranked on BOTH published benchmarks (77.2% SWE-bench Verified) and
      // the local eval. gemma4:31b matched its accuracy but is 44% slower.
      //
      // One model for both roles means residency never changes: no eviction,
      // no reload, no swap. That is worth more than the marginal speed of a
      // faster worker, because a plan of a dozen contracts finishes overnight
      // either way and accuracy is what decides how much of it Astra accepts.
      backend: 'ollama', model: 'qwen3.6:27b', approxResidentGiB: 21,
      contextTokens: 65536, maxOutputTokens: 12000,
      // Lower than the worker: a reviewer that improvises is a reviewer that
      // invents findings, and local time is cheap enough to afford determinism.
      temperature: 0.1, think: true, timeoutMs: 45 * 60 * 1000,
    },
  },
  limits: {
    maxAttempts: 3,
    repairAfterAttempts: 3,
    // Bounded and surgical is architecture; these numbers are not. The mission
    // (§4A, corrected 2026-09-22) is explicit that they are starting values to
    // be measured and tuned, so they are configuration rather than constants.
    // Exchanges that write nothing new and fix no check before the worker is
    // declared stuck and the problem is handed up a rung.
    stuckAfterTurns: 4,
    // How long a stopped or timed-out worker has to actually stop before its
    // outcome is treated as uncertain. It normally stops within moments; the
    // bound is for the one that does not.
    settleGraceMs: 60_000,
    repairMaxFiles: 2,
    repairsPerTask: 1,
    // Worker attempts after a reviewer repair, whether or not the repair made
    // the checks pass. Raised from 1 (2026-09-25): a single try after a repair
    // turned most repairs into a 3am escalation for work that was one fix away.
    repairRetryAttempts: 3,
    maxCorrectionDepth: 2,
    // The FIRST budget for a task, not a wall: a worker that is progressing
    // may be granted more (extension.mjs) up to the hard ceiling below.
    taskTimeoutMs: 60 * 60 * 1000,
    taskHardTimeoutMs: 4 * 60 * 60 * 1000,
    extensionMaxGrantMs: 45 * 60 * 1000,
    extensionDefaultGrantMs: 20 * 60 * 1000,
    maxTurnsHard: 40,
    iterationStallLimit: 3,
    maxConsecutiveFailures: 3,
    runtimeRecoveriesPerPhase: 2,
    runtimeRecoveriesPerRun: 6,
    escalationAlertAttempts: 3,
    escalationAlertRetryMs: 60_000,
  },
});

function mergeRole(base, override) {
  return { ...base, ...(override ?? {}) };
}

/** Load config from `~/.openclaw/`, which is deliberately outside every task scope. */
export async function loadAgenticConfig({ path = CONFIG_PATH } = {}) {
  let raw = {};
  try { raw = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`agentic config at ${path} is unreadable: ${error.message}`); }
  const config = {
    // The enablement gate. Absent means off: a system that runs unattended
    // because nobody wrote "false" has defaulted in the dangerous direction.
    enabled: raw.enabled === true,
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : DEFAULT_CONFIG.endpoint,
    memoryBudgetGiB: Number.isFinite(raw.memoryBudgetGiB) ? raw.memoryBudgetGiB : DEFAULT_CONFIG.memoryBudgetGiB,
    roles: {
      worker: mergeRole(DEFAULT_CONFIG.roles.worker, raw.roles?.worker),
      reviewer: mergeRole(DEFAULT_CONFIG.roles.reviewer, raw.roles?.reviewer),
    },
    limits: { ...DEFAULT_CONFIG.limits, ...(raw.limits ?? {}) },
    source: raw && Object.keys(raw).length ? path : 'defaults',
  };
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.endpoint)) {
    // Loopback only. An unattended model endpoint that can be pointed at a
    // remote host is an exfiltration channel with a config file for a key.
    throw new Error(`agentic endpoint must be loopback, got "${config.endpoint}"`);
  }
  // A repair threshold above the attempt ceiling is a silent misconfiguration:
  // `attempts` can never reach it, so the reviewer-repair rung of the ladder
  // never fires and tasks escalate that the local loop could have unblocked.
  for (const [name, minimum] of [['runtimeRecoveriesPerPhase', 0], ['runtimeRecoveriesPerRun', 0], ['repairMaxFiles', 1], ['repairsPerTask', 0], ['repairRetryAttempts', 1], ['stuckAfterTurns', 2]]) {
    const value = config.limits[name];
    if (!Number.isInteger(value) || value < minimum || value > 20) {
      throw new Error(`limits.${name} must be an integer between ${minimum} and 20, got ${value}`);
    }
  }
  if (!Number.isInteger(config.limits.escalationAlertAttempts) || config.limits.escalationAlertAttempts < 1 || config.limits.escalationAlertAttempts > 5) {
    throw new Error('limits.escalationAlertAttempts must be an integer between 1 and 5');
  }
  if (!Number.isInteger(config.limits.escalationAlertRetryMs) || config.limits.escalationAlertRetryMs < 0 || config.limits.escalationAlertRetryMs > 10 * 60_000) {
    throw new Error('limits.escalationAlertRetryMs must be an integer between 0 and 600000');
  }
  const { taskTimeoutMs, taskHardTimeoutMs, extensionMaxGrantMs, extensionDefaultGrantMs, maxTurnsHard } = config.limits;
  if (![taskTimeoutMs, taskHardTimeoutMs, extensionMaxGrantMs, extensionDefaultGrantMs].every(Number.isSafeInteger) ||
      taskHardTimeoutMs < taskTimeoutMs || taskHardTimeoutMs > 10 * 3600_000 ||
      extensionDefaultGrantMs > extensionMaxGrantMs || extensionMaxGrantMs < 0) {
    throw new Error('limits: need taskTimeoutMs <= taskHardTimeoutMs <= 10h and extensionDefaultGrantMs <= extensionMaxGrantMs');
  }
  if (!Number.isInteger(maxTurnsHard) || maxTurnsHard < 1 || maxTurnsHard > 100) throw new Error('limits.maxTurnsHard must be 1-100');
  if (config.limits.repairAfterAttempts > config.limits.maxAttempts) {
    throw new Error(`repairAfterAttempts (${config.limits.repairAfterAttempts}) exceeds maxAttempts ` +
      `(${config.limits.maxAttempts}); reviewer repair could never trigger`);
  }
  for (const [role, spec] of Object.entries(config.roles)) {
    promptBudget(spec);
    if (typeof spec.model !== 'string' || !spec.model.trim()) throw new Error(`role ${role} has no model`);
    if (!Number.isFinite(spec.approxResidentGiB) || spec.approxResidentGiB <= 0) throw new Error(`role ${role} has no memory estimate`);
    if (spec.approxResidentGiB > config.memoryBudgetGiB) {
      throw new Error(`role ${role} (${spec.model}, ~${spec.approxResidentGiB} GiB) exceeds the ${config.memoryBudgetGiB} GiB budget`);
    }
  }
  return config;
}

/*
 Stream a generation, calling `onDelta` per chunk.

 Streaming rather than waiting for the whole reply, for one reason that is not
 about speed: a 27B thinking for nine minutes behind a non-streaming request is
 indistinguishable, from outside, from a dead inference runtime. Streaming makes
 "it is thinking" an observed fact rather than an inference from elapsed time,
 and it is what feeds the live thinking channel.

 Ollama streams newline-delimited JSON. Chunks can split across TCP reads, so
 the tail of a read is carried into the next one; parsing a half object and
 silently dropping it is how a trace quietly loses every other token.
*/
async function streamGenerate(endpoint, body, { signal, timeoutMs, onDelta }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(recoverableRuntimeError('inference timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!response.ok) {
      // The body carries the actual reason — "model does not support thinking",
      // a bad option name, an unloadable model. A bare status code sends
      // whoever reads it at 02:00 looking in the wrong place.
      const detail = await response.text().catch(() => '');
      const message = `ollama /api/generate returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`;
      if (response.status >= 500) throw recoverableRuntimeError(message);
      throw new Error(message);
    }

    const decoder = new TextDecoder();
    let carry = '', text = '', thinking = '', final = {};
    for await (const chunk of response.body) {
      carry += decoder.decode(chunk, { stream: true });
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let payload;
        try { payload = JSON.parse(line); } catch { continue; }
        if (payload.error) throw recoverableRuntimeError(`ollama: ${String(payload.error).slice(0, 300)}`);
        const deltaThinking = payload.thinking ?? '';
        const deltaResponse = payload.response ?? '';
        if (deltaThinking) thinking += deltaThinking;
        if (deltaResponse) text += deltaResponse;
        if (deltaThinking || deltaResponse) onDelta?.({ thinking: deltaThinking, response: deltaResponse });
        if (payload.done) final = payload;
      }
    }
    return { text, thinking, final };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error?.recoverableRuntime === true) throw error;
    if (error instanceof TypeError || ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(error?.code)) {
      throw recoverableRuntimeError(`inference transport failed: ${String(error?.message ?? error).slice(0, 300)}`, error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function request(endpoint, path, body, { signal, timeoutMs }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(recoverableRuntimeError('inference timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`ollama ${path} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Models Ollama currently holds in memory. */
export async function residentModels(endpoint, { signal } = {}) {
  const response = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error(`ollama /api/ps returned ${response.status}`);
  const body = await response.json();
  return (body.models ?? []).map(entry => ({ model: entry.name ?? entry.model, sizeBytes: entry.size ?? 0 }));
}

/** Models Ollama has on disk. Probed at startup so an absent model fails early. */
export async function installedModels(endpoint) {
  const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ollama /api/tags returned ${response.status}`);
  const body = await response.json();
  return (body.models ?? []).map(entry => entry.name ?? entry.model);
}

async function unload(endpoint, model, signal) {
  // An empty prompt with keep_alive 0 evicts without generating anything.
  await request(endpoint, '/api/generate', { model, prompt: '', keep_alive: 0, stream: false },
    { timeoutMs: 120_000, signal }).catch(error => { if (signal) throw error; });
}

/** Tokens per minute from a count and a nanosecond duration. */
function rate(count, nanoseconds) {
  if (!Number.isFinite(count) || !Number.isFinite(nanoseconds) || nanoseconds <= 0) return null;
  return Math.round((count / (nanoseconds / 1e9)) * 60);
}

export class ModelUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'ModelUnavailableError'; }
}

/**
 * Owns which model is resident. One instance per supervisor process; the
 * supervisor lease guarantees there is only one such process.
 */
export class ModelRuntime {
  #config;
  #resident = null;
  #observer = () => {};
  setObserver(emit) { this.#observer = emit; }

  constructor(config) { this.#config = config; }

  get config() { return this.#config; }
  get resident() { return this.#resident; }
  spec(role) {
    const spec = this.#config.roles[role];
    if (!spec) throw new ModelUnavailableError(`no model is configured for the "${role}" role`);
    return spec;
  }

  /** Verify, before a run starts, that every configured model exists locally. */
  async probe() {
    let installed;
    try { installed = await installedModels(this.#config.endpoint); }
    catch (error) {
      throw new ModelUnavailableError(
        `the local inference runtime at ${this.#config.endpoint} is not answering (${error.message}). ` +
        'Start Ollama before starting an unattended run.');
    }
    const missing = Object.entries(this.#config.roles)
      .filter(([, spec]) => !installed.includes(spec.model))
      .map(([role, spec]) => `${role} needs "${spec.model}"`);
    if (missing.length) {
      throw new ModelUnavailableError(
        `${missing.join('; ')}. Installed: ${installed.join(', ') || 'none'}. ` +
        'Pull the model or point agentic-config.json at one that exists.');
    }
    // Installed is not the same as usable. `think: true` against a model that
    // does not support thinking is a 400 on EVERY generation — discovered at
    // 02:00, as a run that does nothing, unless it is discovered here. One
    // one-token generation per role is a cheap way to find out now.
    const capability = {};
    for (const [role, spec] of Object.entries(this.#config.roles)) {
      // Residency is settled OUTSIDE the capability try, and deliberately so:
      // an eviction or /api/ps failure is a memory or daemon problem, and
      // reporting it as "this model may not support thinking" sends whoever
      // reads it at 02:00 to change a setting that was never the cause.
      await this.ensureExclusive(role);
      try {
        await streamGenerate(this.#config.endpoint, {
          // At the REAL context size, and held for 5 minutes. Probing at 512
          // tokens meant the first real generation reloaded the model to build
          // its 65k-token cache — measured as a 1.84 GiB swap step inside the
          // resource guard's window, 0.16 short of aborting it. Loading once,
          // here, before any guard is watching, removes the reload entirely.
          model: spec.model, prompt: 'ok', think: spec.think, keep_alive: '5m',
          options: { num_predict: 1, num_ctx: spec.contextTokens },
        }, { timeoutMs: 120_000 });
        capability[role] = { model: spec.model, think: spec.think, usable: true };
      } catch (error) {
        throw new ModelUnavailableError(
          `the ${role} model "${spec.model}" is installed but not usable as configured: ${error.message}. ` +
          `If it does not support thinking, set roles.${role}.think to false in the agentic config.`);
      }
    }
    return { endpoint: this.#config.endpoint, installed, capability, roles: Object.fromEntries(
      Object.entries(this.#config.roles).map(([role, spec]) => [role, spec.model])) };
  }

  /**
   * Make `role`'s model the only resident one. Returns what was evicted, so the
   * journal records the handoff — a reviewer pass that began by evicting a 17
   * GiB worker explains its own first ninety seconds.
   */
  async ensureExclusive(role) {
    const spec = this.spec(role);
    const current = await residentModels(this.#config.endpoint);
    const strangers = current.filter(entry => entry.model !== spec.model);
    for (const stranger of strangers) await unload(this.#config.endpoint, stranger.model);
    if (strangers.length) {
      // Verify rather than assume. An unload that did not take is how two large
      // models end up resident and the machine starts swapping.
      const after = await residentModels(this.#config.endpoint);
      const remaining = after.filter(entry => entry.model !== spec.model);
      if (remaining.length) {
        throw new ModelUnavailableError(
          `could not evict ${remaining.map(entry => entry.model).join(', ')} before loading ${spec.model}; ` +
          'refusing to hold two large models on a 48 GiB machine');
      }
    }
    this.#resident = spec.model;
    return { evicted: strangers.map(entry => entry.model), resident: spec.model };
  }

  /**
   * One generation. Returns the text plus the metadata a failure needs: without
   * `doneReason` and the thinking length, "no usable output" is a symptom whose
   * three different causes need three different fixes.
   */
  async generate(role, { system, prompt, signal, maxOutputTokens, temperature, onDelta, think } = {}) {
    const spec = this.spec(role);
    assertPromptFits(system, prompt, { ...spec, maxOutputTokens: maxOutputTokens ?? spec.maxOutputTokens });
    const handoff = await this.ensureExclusive(role);
    const started = Date.now();
    const body = {
      model: spec.model,
      prompt,
      system,
      // A caller may switch thinking off for one generation (worker.mjs does,
      // after a reply that spent the whole output budget thinking).
      think: think ?? spec.think,
      keep_alive: '5m',
      options: {
        temperature: temperature ?? spec.temperature,
        num_predict: maxOutputTokens ?? spec.maxOutputTokens,
        num_ctx: spec.contextTokens,
      },
    };
    const guard = await guardResources({ signal, emit: this.#observer });
    let generation;
    try {
      generation = await streamGenerate(this.#config.endpoint, body,
        { signal: guard.signal, timeoutMs: spec.timeoutMs, onDelta });
      if (guard.failure) throw guard.failure;
    } catch (error) { throw guard.failure ?? error; }
    finally { guard.close(); }
    const { text, thinking, final } = generation;
    return {
      role,
      model: spec.model,
      text,
      thinking,
      ms: Date.now() - started,
      handoff,
      meta: {
        thinkingChars: thinking.length,
        doneReason: final.done_reason ?? null,
        evalCount: final.eval_count ?? null,
        promptEvalCount: final.prompt_eval_count ?? null,
        // Throughput, from Ollama's own nanosecond counters rather than wall
        // clock, so model loading and our own parsing are not charged to the
        // model. Recorded as a DIAGNOSTIC, never as the headline: the mission
        // is explicit that accepted work per hour beats tokens per second, and
        // a fast model that needs three correction cycles has lost. What this
        // explains is WHY a candidate was slow — prefill or generation.
        //
        // For a thinking model `eval_count` includes the reasoning tokens, so
        // this is total output throughput, not answer throughput.
        outputTokens: final.eval_count ?? null,
        promptTokens: final.prompt_eval_count ?? null,
        outputTokensPerMinute: rate(final.eval_count, final.eval_duration),
        promptTokensPerMinute: rate(final.prompt_eval_count, final.prompt_eval_duration),
        loadMs: final.load_duration ? Math.round(final.load_duration / 1e6) : null,
      },
    };
  }

  /** Release memory at the end of a run rather than leaving 17 GiB pinned. */
  async releaseAll({ signal } = {}) {
    signal?.throwIfAborted();
    let current = [];
    try { current = await residentModels(this.#config.endpoint, { signal }); } catch (error) { if (signal) throw error; return; }
    for (const entry of current) await unload(this.#config.endpoint, entry.model, signal);
    this.#resident = null;
  }
}
