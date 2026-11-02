// After a sender (Discord, a banner, openclaw) has itself delivered a message, record it through `orion-reach --already-sent`,
// so it also lands in the phone chat line and the Mac chat and his reply is read against it. Never notifies a second time.
// Best effort and silent: a failure here must not turn a delivered message into a failed one.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export function logSent({ text, channel, kind = "update", why = null, env = process.env } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return false;
  const bin = env.ORION_REACH_BIN || join(HERE, "../../orion-reach");
  const args = [body, "--already-sent", channel || "other", "--kind", kind, ...(why ? ["--why", why] : [])];
  try {
    const r = spawnSync(bin, args, { timeout: 8000, stdio: "ignore", env });
    return r.status === 0;
  } catch { return false; }
}
