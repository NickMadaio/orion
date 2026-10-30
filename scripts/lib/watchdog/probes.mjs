import { GATEWAY_URL, OLLAMA_URL, PROBE_TIMEOUT_MS } from "./config.mjs";

async function httpOk(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** deps: { fetch, run(cmd, args) -> {code, stdout} }. Read-only; never throws. */
export async function probeAll({ fetch, run }) {
  const safe = async (cmd, args) => {
    try { return await run(cmd, args); } catch { return { code: 1, stdout: "" }; }
  };
  const [ollama, gateway, app, link] = await Promise.all([
    httpOk(fetch, `${OLLAMA_URL}/api/version`),
    httpOk(fetch, GATEWAY_URL),
    safe("/usr/bin/pgrep", ["-f", "Orion.app/Contents/MacOS/Orion"]).then((r) => r.code === 0),
    safe("/bin/launchctl", ["print", "gui/{uid}/com.nickmadaio.orion.link"])
      .then((r) => r.code === 0 && /state = running/.test(r.stdout)),
  ]);
  return { ollama, gateway, app, link };
}
