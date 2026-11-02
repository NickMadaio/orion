/*
 The `gog` plumbing both mail wrappers need.

 Extracted because the two scripts carried a byte-identical copy of it -- the
 .env parse, the keyring environment, the spawn wrapper -- and a fix applied to
 one of them silently did not apply to the other. That is exactly how
 `orion-gmail-latest` and `orion-gmail-search` came to behave differently.

 Every call here is read-only and non-sending, enforced twice: `--readonly` and
 `--gmail-no-send` are appended to every invocation in `gog()`, not passed in by
 callers, so a caller cannot forget them or opt out.
*/

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { GMAIL_EXPIRED, classifyGmailError } from "./gmail-status.mjs";

const ACCOUNT = "nmadaio08@gmail.com";

/** Flags no caller may drop. Appended in `gog`, never taken as arguments. */
const SAFETY_FLAGS = ["--readonly", "--gmail-no-send"];

/**
 * The vault password, out of ORION/.env.
 *
 * Read at call time rather than import time so that a missing .env produces a
 * sentence Nick can act on instead of a stack trace at module load.
 */
async function keyringEnvironment(orionRoot) {
  let raw;
  try {
    raw = await readFile(`${orionRoot}/.env`, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${orionRoot}/.env, so Gmail's vault password is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const [key, value] = line.split("=", 2);
    values[key.trim()] = value.trim().replace(/^['"]|['"]$/g, "");
  }

  if (!values.GOG_KEYRING_PASSWORD) {
    throw new Error("Orion's Gmail vault password is not set in local configuration.");
  }

  return {
    ...process.env,
    GOG_KEYRING_BACKEND: "file",
    GOG_KEYRING_PASSWORD: values.GOG_KEYRING_PASSWORD,
  };
}

/** How long one gog call may take. A hung OAuth refresh once held the mail watcher's tick forever (wave 14 review). */
export const GOG_TIMEOUT_MS = 20_000;

/** Kills the child and everything it started: gog is spawned as its own process group, so -pid reaches the whole group. */
function killGroup(child) {
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
}

/**
 * Run one gog command and parse its JSON.
 *
 * The query reaches gog as an argv entry, never through a shell, so Gmail
 * search syntax cannot become shell syntax no matter what Nick dictates.
 *
 * options: { timeoutMs } (default 20 s; the group is killed and the call
 * rejects with one plain sentence), { env } extra environment (tests).
 */
export async function gog(orionRoot, args, { timeoutMs = GOG_TIMEOUT_MS, env = {} } = {}) {
  const environment = { ...(await keyringEnvironment(orionRoot)), ...env };
  const argv = [...args, "--account", ACCOUNT, ...SAFETY_FLAGS, "--json"];

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn("gog", argv, { env: environment, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      killGroup(child);
      reject(new Error(`gog didn't answer within ${Math.round(timeoutMs / 1000)} s, so it was stopped`));
    }, timeoutMs);
    timer.unref?.();
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(new Error(`Could not run gog: ${error.message}`)); }
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(out);
      // Pass gog's own words through. "Report its actual error, never claim
      // setup is missing" is a standing rule, and it needs the actual error.
      else reject(new Error(classifyGmailError(err) === "expired" ? GMAIL_EXPIRED : err.trim() || `gog exited ${code}`));
    });
  });

  try {
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch {
    throw new Error(`gog returned something that is not JSON: ${stdout.slice(0, 200)}`);
  }
}

/** Thread summaries for a Gmail query. Cheap: one call, no bodies. */
export async function searchThreads(orionRoot, query, max) {
  const result = await gog(orionRoot, ["gmail", "search", query, "--max", String(max)]);
  return Array.isArray(result?.threads) ? result.threads : [];
}

/**
 * One thread in full.
 *
 * `--sanitize-content` is not optional: it strips links and active content out
 * of mail before it ever reaches the model. Email is untrusted data, and this
 * is the point where that stops being a policy and becomes a mechanism.
 */
export async function getThread(orionRoot, threadId) {
  return gog(orionRoot, ["gmail", "thread", "get", threadId, "--sanitize-content"]);
}

/** The headers the mail watcher may read. Everything else (Received, DKIM, X-*) is dropped with the bodies. */
const META_HEADERS = ["from", "to", "subject", "date", "list-unsubscribe", "list-id", "precedence"];

function metaHeaders(message) {
  const raw = message?.headers ?? message?.payload?.headers ?? {};
  const pairs = Array.isArray(raw) ? raw.filter((h) => h?.name).map((h) => [String(h.name), h.value]) : raw && typeof raw === "object" ? Object.entries(raw) : [];
  return Object.fromEntries(pairs.map(([k, v]) => [k.toLowerCase(), String(v ?? "")]).filter(([k]) => META_HEADERS.includes(k)));
}

/**
 * A thread reduced to metadata and Gmail's snippet: ids, labels, snippet, the
 * few headers above. gog 0.34 has no metadata format for `thread get` (only
 * `gmail get <messageId> --format metadata`, per message, which cannot see who
 * wrote earlier in the thread), so the body is fetched and dropped HERE, at the
 * parse boundary, before the payload leaves this module.
 */
export function slimThread(payload) {
  const thread = payload?.thread ?? payload;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  return { thread: { id: String(thread?.id ?? ""), ...(thread?.date ? { date: String(thread.date) } : {}),
    messages: messages.map((m) => ({ id: String(m?.id ?? ""), threadId: String(m?.threadId ?? thread?.id ?? ""), labelIds: Array.isArray(m?.labelIds) ? m.labelIds.map(String) : [],
      snippet: String(m?.snippet ?? ""), headers: metaHeaders(m) })) } };
}

/** One thread as metadata and snippet only (slimThread): what the mail watcher reads. */
export async function getThreadMeta(orionRoot, threadId) {
  return slimThread(await getThread(orionRoot, threadId));
}

/**
 * Snippets for several threads at once.
 *
 * Gmail's search result has no snippet field, so a preview costs one `thread
 * get` per result. Run together rather than in sequence -- five sequential
 * round trips was most of the wait on a search. One failing thread yields a
 * summary without a preview instead of failing the whole search.
 */
export async function withSnippets(orionRoot, threads) {
  return Promise.all(
    threads.map(async (thread) => {
      if (!thread?.id) return thread;
      try {
        const full = await getThread(orionRoot, thread.id);
        const messages = full?.thread?.messages ?? [];
        const newest = messages[messages.length - 1];
        return { ...thread, messages: newest ? [newest] : [], messageCount: messages.length };
      } catch {
        return thread;
      }
    }),
  );
}
