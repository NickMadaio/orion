/** Race only inference, never filesystem mutation. A late model reply has no effects. */
export async function cancellableGenerate(runtime, role, options) {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!signal) return runtime.generate(role, options);
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('generation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const response = await Promise.race([runtime.generate(role, options), cancelled]);
    signal.throwIfAborted();
    return response;
  } finally { signal.removeEventListener('abort', onAbort); }
}
