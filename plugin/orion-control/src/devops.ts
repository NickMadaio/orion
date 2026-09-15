import os from "node:os";
import path from "node:path";

/*
 PHASE 51 — structured development operations, and the raw shell they replace.

 The manifest opens this phase with four words: "Do not begin with raw shell."
 Orion began with raw shell. `git` is on his exec allowlist as a bare command
 name, which `orion-authority` already reports honestly as an ESCAPE HATCH:

     reads at AUTO, but this entry can also launch other work (env CMD,
     find -exec, git push) — when used that way it takes the level of the
     effect, not of the command

 One allowlist line covers `git status` and `git push --force`, and the exec
 layer cannot tell them apart because it matches the command NAME and never the
 arguments. That is the situation this phase exists to end.

 ## What "tightly validated" means here, field by field

 The manifest names six things to restrict. Each is restricted by construction
 rather than by checking:

   REPOSITORY         The model names a repo by KEY, never by path. There is no
                      path argument to traverse, no `..` to escape with, and a
                      key that is not in this table does not resolve.
   WORKING DIRECTORY  The repo's own root, always. Not an argument.
   ARGUMENTS          There are almost none. Every operation is a fixed argv
                      written down below; the two that take anything take a
                      bounded integer and a boolean. A model cannot append a
                      flag, because there is nowhere to put one.
   ENVIRONMENT        Built from an ALLOWLIST of variable names, not filtered
                      by a denylist. A new secret in Nick's shell profile is
                      absent here on the day he adds it, without anyone
                      remembering to exclude it.
   TIME               Per operation, and killed with SIGKILL rather than
                      SIGTERM, because a test runner that traps SIGTERM is a
                      test runner that ignores a timeout.
   OUTPUT SIZE        Capped, and truncated in the MIDDLE. A test run that
                      fails prints its summary at the end, so keeping only the
                      head would throw away the answer.

 ## The honest part, which is not small

 `tests_run`, `build_run` and `package_install` execute code out of the
 repository, and `git_pull` can bring in a hook that runs on checkout. No
 amount of argv discipline changes that: `npm test` runs whatever
 `package.json` says, and `npm ci` runs a package's install scripts.

 This is not a new class of power. Orion could already edit his own plugin and
 his own scripts, and `orion-repair` already builds, tests and health-checks a
 change before installing it. What this phase changes is that the capability
 stops arriving through a bare `git` on an allowlist that cannot see arguments,
 and starts arriving through actions with a tier, a risk, a timeout and a
 ledger entry.

 It is also why the tier is off by default, sits at `consequential_local` and
 above, and is listed there EXPLICITLY rather than folded into the filesystem
 tiers — for the same reason `self_modification` is. Running a repository's
 build is not a filesystem operation and must not arrive as a side effect of
 widening filesystem access.
*/

export interface DevRepository {
  /** Absolute path to the repository root. */
  readonly root: string;
  /** What this repo is, for a person reading an approval or a ledger line. */
  readonly describe: string;
  /**
   * The commands, as fixed argv. Absent means the operation does not exist for
   * this repository and is refused rather than guessed at.
   */
  readonly test?: readonly string[];
  readonly build?: readonly string[];
  readonly install?: readonly string[];
}

/**
 * Every repository Orion may operate on, keyed by the short name he uses.
 *
 * A closed table on purpose. The alternative -- a root plus a path argument --
 * is one traversal bug away from being every repository on the machine, and
 * this program has already paid for one of those.
 *
 * `orion-plugin` is a subdirectory of `orion` and is listed separately rather
 * than reached with a path, because its test and build commands differ and
 * because "run the plugin's tests" should not be spelled as "run the repo's
 * tests, but over there".
 */
export const DEV_REPOSITORIES: ReadonlyMap<string, DevRepository> = new Map([
  [
    "orion",
    {
      root: path.join(os.homedir(), "Desktop/ORION"),
      describe: "Orion's own repository",
    },
  ],
  [
    "orion-plugin",
    {
      root: path.join(os.homedir(), "Desktop/ORION/plugin/orion-control"),
      describe: "the plugin that gives Orion his tools",
      test: ["npx", "vitest", "run"],
      build: ["npm", "run", "build"],
      // `ci`, never `install`. `npm install <package>` reaches the network for
      // something nobody wrote down; `npm ci` installs exactly the committed
      // lockfile and fails if the lockfile and package.json disagree.
      install: ["npm", "ci"],
    },
  ],
]);

export type DevOperation =
  | "git_status"
  | "git_log"
  | "git_diff"
  | "git_pull"
  | "tests_run"
  | "build_run"
  | "package_install";

/** Half a test log. Enough to see a failure, small enough not to be a transcript. */
export const MAX_OUTPUT_BYTES = 20_000;

interface OperationSpec {
  /** Fixed argv, or the repository field holding it. */
  readonly argv: readonly string[] | keyof Pick<DevRepository, "test" | "build" | "install">;
  readonly timeoutMs: number;
  /** Does this reach the network? Recorded so a ledger line can say so. */
  readonly network: boolean;
  /** Does it change the working tree or run repository code? */
  readonly writes: boolean;
  readonly describe: string;
}

export const DEV_OPERATIONS: Readonly<Record<DevOperation, OperationSpec>> = {
  git_status: {
    argv: ["git", "status", "--short", "--branch"],
    timeoutMs: 15_000,
    network: false,
    writes: false,
    describe: "what has changed and which branch it is on",
  },
  git_log: {
    // `--` terminates the revision list, so a limit that somehow arrived as
    // text could not be read as a path or a ref.
    argv: ["git", "log", "--oneline", "--no-decorate"],
    timeoutMs: 15_000,
    network: false,
    writes: false,
    describe: "recent commits, subject lines only",
  },
  git_diff: {
    argv: ["git", "diff", "--stat"],
    timeoutMs: 20_000,
    network: false,
    writes: false,
    describe: "which files changed and by how much",
  },
  git_pull: {
    // `--ff-only`: a pull that cannot fast-forward stops rather than opening a
    // merge Orion would then have to resolve. There is no argument that turns
    // this off, which is the entire point of a fixed argv.
    argv: ["git", "pull", "--ff-only"],
    timeoutMs: 120_000,
    network: true,
    writes: true,
    describe: "fetch and fast-forward; refuses anything needing a merge",
  },
  tests_run: {
    argv: "test",
    timeoutMs: 300_000,
    network: false,
    writes: true,
    describe: "run the repository's test suite",
  },
  build_run: {
    argv: "build",
    timeoutMs: 300_000,
    network: false,
    writes: true,
    describe: "build the repository",
  },
  package_install: {
    argv: "install",
    timeoutMs: 300_000,
    network: true,
    writes: true,
    describe: "install exactly the committed lockfile",
  },
};

/**
 * The environment, built up rather than filtered down.
 *
 * A denylist of secret-looking variable names is wrong in the direction that
 * matters: it is correct only until somebody exports a new one. This starts
 * from nothing and adds the five things a build genuinely needs, so a token
 * added to Nick's shell profile tomorrow is absent here today.
 *
 * `PATH` is pinned rather than inherited for the same reason: an inherited
 * PATH is a list of directories any of which might contain a `git` that is not
 * git.
 */
export function devEnvironment(): Record<string, string> {
  const home = os.homedir();
  return {
    HOME: home,
    PATH: [
      path.join(home, ".openclaw/tools/node-v24.15.0/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":"),
    LANG: "en_US.UTF-8",
    // npm and vitest both write here; without it they fall back to something
    // under `/` and fail in a way that reads like a permissions bug.
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    // Non-interactive, so a prompt becomes an error instead of a hang that
    // burns the whole timeout.
    CI: "1",
  };
}

/** Resolve one operation against one repository, or say why it cannot be. */
export function resolveDevCommand(
  repository: string,
  operation: DevOperation,
  options: { limit?: number; staged?: boolean } = {},
): { argv: readonly string[]; cwd: string; spec: OperationSpec } | { error: string } {
  const repo = DEV_REPOSITORIES.get(repository);
  if (!repo) {
    return {
      error: `'${String(repository).slice(0, 40)}' is not a repository I work on. They are: ${[...DEV_REPOSITORIES.keys()].join(", ")}`,
    };
  }
  const spec = DEV_OPERATIONS[operation];
  if (!spec) return { error: `'${String(operation).slice(0, 40)}' is not an operation` };

  let argv: readonly string[];
  if (typeof spec.argv === "string") {
    const configured = repo[spec.argv];
    if (!configured) {
      return {
        error: `${repository} has no ${spec.argv} command, so there is nothing to run. ${repo.describe} is not set up for it.`,
      };
    }
    argv = configured;
  } else {
    argv = spec.argv;
  }

  // The only two arguments in the whole phase, both bounded, both appended to
  // a fixed prefix rather than merged into it.
  if (operation === "git_log") {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { error: "limit must be a whole number from 1 to 100" };
    }
    argv = [...argv, `-${limit}`];
  }
  if (operation === "git_diff" && options.staged === true) {
    argv = [...argv, "--staged"];
  }

  return { argv, cwd: repo.root, spec };
}

/**
 * Truncate in the middle.
 *
 * A failing test suite prints its summary last and its noise first, so keeping
 * the head is keeping the wrong half. Both ends are kept and the cut is
 * labelled with how much went, because output that was silently shortened is
 * output nobody can reason about.
 */
export function boundOutput(text: string, limit: number = MAX_OUTPUT_BYTES): string {
  const raw = Buffer.from(text, "utf8");
  if (raw.byteLength <= limit) return text;
  const half = Math.floor((limit - 80) / 2);
  const head = raw.subarray(0, half).toString("utf8");
  const tail = raw.subarray(raw.byteLength - half).toString("utf8");
  const dropped = raw.byteLength - half * 2;
  return `${head}\n\n… ${dropped} bytes cut from the middle …\n\n${tail}`;
}
