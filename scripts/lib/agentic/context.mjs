/*
 The input-side context budget.

 WHY THIS EXISTS

 `num_ctx` is set explicitly (models.mjs) because Ollama's default silently
 truncates the FRONT of the prompt — which is exactly where the contract, the
 scope and the non-scope live. A worker that loses its constraints does not fail
 loudly; it works all night on the wrong problem, inside no boundary it can see.
 Setting the window does not prevent that on its own: something has to check the
 prompt actually fits inside it.

 ESTIMATING TOKENS FROM BYTES

 There is no tokenizer here, and shelling out to one per turn would cost more
 than it is worth. Three UTF-8 bytes per token is the divisor: real code
 tokenizes at roughly 3.5-4.5 bytes per token, so this over-estimates the token
 count by ~20% and errs toward leaving headroom. Counting one token per byte —
 as an earlier version did — is not "more conservative", it is wrong by 4x, and
 it evicts files that would have fitted comfortably.

 OVER-BUDGET IS AN ERROR, NOT A TRIM

 When the working set cannot be shrunk any further, this throws rather than
 sending a prompt that will be truncated. A refused turn is visible; a truncated
 contract is not.
*/

/** Bytes per token, conservative for source code. See the header. */
const BYTES_PER_TOKEN = 3;

/** Reserved for the chat template and the marker instructions around our text. */
const TEMPLATE_RESERVE_TOKENS = 1024;

export function estimateTokens(...parts) {
  const bytes = parts.reduce((total, part) => total + Buffer.byteLength(part ?? '', 'utf8'), 0);
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/**
 * How many INPUT tokens a role may use: the window, less what the model is
 * allowed to generate into it, less the template. Also serves as config
 * validation — a role whose output budget does not fit inside its own context
 * window can never produce anything, and that should fail at load, not at 02:00.
 */
export function promptBudget(spec = {}) {
  const context = spec.contextTokens ?? 65536;
  const output = spec.maxOutputTokens ?? 16000;
  if (!Number.isSafeInteger(context) || !Number.isSafeInteger(output) || output <= 0 ||
      context <= output + TEMPLATE_RESERVE_TOKENS) {
    throw new Error(`contextTokens (${context}) must exceed maxOutputTokens (${output}) plus ` +
      `${TEMPLATE_RESERVE_TOKENS} template tokens`);
  }
  return context - output - TEMPLATE_RESERVE_TOKENS;
}

export function assertPromptFits(system, prompt, spec) {
  const tokens = estimateTokens(system, prompt);
  const budget = promptBudget(spec);
  if (tokens > budget) {
    throw new Error(`context budget exceeded: ~${tokens} estimated input tokens against a budget of ` +
      `${budget}. Narrow the task contract or its scope; the model would otherwise lose the front ` +
      'of the prompt, which is the contract itself.');
  }
}

/**
 * Build a turn that fits, dropping the OLDEST working-set entries until it does.
 *
 * Oldest-first because the most recently read or written file is the one the
 * model is working on. Every eviction is reported so the journal records that
 * the model stopped being able to see something.
 *
 * `pinned` files go last. The files a task is WRITING are loaded first, so they
 * are the oldest, and plain oldest-first dropped them before any reference file:
 * a worker that had read a few modules lost sight of its own file and rewrote it
 * from nothing, taking an earlier task's code and tests with it.
 */
export function fitWorkingSet({ system, files, build, spec, onDrop = () => {}, pinned = () => false }) {
  let prompt = build();
  while (estimateTokens(system, prompt) > promptBudget(spec) && files.length) {
    const reference = files.findIndex(file => !pinned(file));
    const [removed] = files.splice(reference === -1 ? 0 : reference, 1);
    onDrop(removed.path);
    prompt = build();
  }
  assertPromptFits(system, prompt, spec);
  return prompt;
}
