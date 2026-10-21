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

/**
 * Run one gog command and parse its JSON.
 *
 * The query reaches gog as an argv entry, never through a shell, so Gmail
 * search syntax cannot become shell syntax no matter what Nick dictates.
 */
export async function gog(orionRoot, args) {
  const environment = await keyringEnvironment(orionRoot);
  const argv = [...args, "--account", ACCOUNT, ...SAFETY_FLAGS, "--json"];

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn("gog", argv, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.once("error", (error) =>
      reject(new Error(`Could not run gog: ${error.message}`)),
    );
    child.once("close", (code) => {
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
