/*
 The coder's window onto the plugin's own self-change policy.

 Same shape and same reasoning as `orion-repair-classify.mjs`, which says it
 best: a second source of truth is a lie with a delay fuse. `orion-code` must
 not answer "may this file be edited?" in Python when
 `self-development-authority.ts` already answers it. So this states no policy at
 all — it loads the compiled module and prints what that module says.

 WHICH compiled copy, and why it matters here even more than there. The
 INSTALLED plugin is preferred, because that is the policy in force. A local
 model editing this repository will, sooner or later, propose an edit to the
 policy tables themselves. Checking that edit against the repo build — the build
 it is about to change — is how it would authorise itself. Checking it against
 the installed copy means it cannot: to widen what it may touch, a human has to
 deploy first.

   node orion-selfdev-policy.mjs surfaces          list the forbidden patterns
   node orion-selfdev-policy.mjs check <path>...   exit 0 if every path is allowed
*/
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const INSTALLED = join(homedir(), ".openclaw/extensions/orion-control/dist");
const REPO = join(import.meta.dirname, "../../openclaw-plugins/orion-control/dist");

function load() {
  for (const [dir, source] of [[INSTALLED, "installed"], [REPO, "repo"]]) {
    const file = join(dir, "self-development-authority.js");
    if (existsSync(file)) return { module: require(file), source, dir };
  }
  console.error("orion-selfdev-policy: no compiled self-development-authority.js anywhere");
  process.exit(2);
}

const { module: policy, source, dir } = load();
const [command, ...rest] = process.argv.slice(2);

if (command === "surfaces") {
  console.log(JSON.stringify({
    source,
    dir,
    enabled: policy.GOVERNED_SELF_DEVELOPMENT_ENABLED,
    surfaces: policy.FORBIDDEN_SELF_CHANGE_SURFACES.map((s) => ({
      pattern: String(s.pattern),
      reason: s.reason,
    })),
  }, null, 2));
  process.exit(0);
}

if (command === "check") {
  if (rest.length === 0) {
    console.error("orion-selfdev-policy: check needs at least one path");
    process.exit(2);
  }
  try {
    policy.assertDiffAllowed(rest);
  } catch (error) {
    // The refusal names the file AND the surface, because "denied" alone is the
    // message that produced 26 retry loops elsewhere in this system.
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
  console.log(`allowed (${source} policy, ${rest.length} path(s))`);
  process.exit(0);
}

console.error("usage: orion-selfdev-policy.mjs surfaces | check <path>...");
process.exit(2);
