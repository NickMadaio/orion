import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ActionDefinition,
  ControlledRoot,
  CreateOnlyTextPolicy,
  DesktopFileMutationPolicy,
  DesktopTextMutationPolicy,
  ExecutionPolicy,
} from "./catalog.js";
import { isVisibleNonSensitiveName } from "./catalog.js";
import type { TaskStep } from "./types.js";
import { canonicalActionHash, hash } from "./validator.js";

export interface ExecutionContext {
  roots: Record<ControlledRoot, string>;
  workingContext?: string;
  simulatedState: Map<string, unknown>;
  /**
   * Run-scoped idempotency memo: idempotencyKey -> hash of the bytes a prior
   * attempt in this same run already committed. Lets a retry after a failed
   * verification recognise its own completed write instead of appending twice.
   */
  writeMemo?: Map<string, string>;
}

export interface ExecutionResult {
  mode:
    | "simulated"
    | "created"
    | "appended"
    | "replaced"
    | "opened"
    | "quit"
    | "already_present"
    | "observed";
  idempotencyKey: string;
  target?: string;
  output?: unknown;
}

export interface VerificationResult {
  observed: boolean;
  evidence?: string;
}

export class ActionExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

const execFileAsync = promisify(execFile);

async function resolveApplication(application: string): Promise<{
  path: string;
  bundleId: string;
}> {
  let lastFailure: string | undefined;
  for (const root of ["/Applications", "/System/Applications"]) {
    const candidate = path.join(root, `${application}.app`);
    try {
      const stats = await lstat(candidate);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      const { stdout } = await execFileAsync(
        "/usr/bin/plutil",
        ["-extract", "CFBundleIdentifier", "raw", path.join(candidate, "Contents/Info.plist")],
        { timeout: 5000 },
      );
      const bundleId = stdout.trim();
      if (!/^[A-Za-z0-9.-]{3,200}$/.test(bundleId)) {
        throw new ActionExecutionError("Installed app has an invalid bundle identifier.");
      }
      return { path: candidate, bundleId };
    } catch (error) {
      if (error instanceof ActionExecutionError) throw error;
      // Keep the last diagnostic so a plutil/permission failure is not reported
      // as a plain "not installed".
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        lastFailure = code ?? (error as Error).message;
      }
    }
  }
  throw new ActionExecutionError(
    lastFailure
      ? `Application could not be resolved (${lastFailure}).`
      : "Application was not found in /Applications or /System/Applications.",
  );
}

async function applicationIsRunning(bundleId: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-e", `application id "${bundleId}" is running`],
    { timeout: 5000 },
  );
  return stdout.trim() === "true";
}

async function controlApplication(
  operation: "open" | "quit",
  application: string,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const target = await resolveApplication(application);
  if (operation === "open") {
    await execFileAsync("/usr/bin/open", [target.path], { timeout: 10000 });
    return { mode: "opened", idempotencyKey, target: target.path, output: target };
  }
  if (!(await applicationIsRunning(target.bundleId))) {
    return { mode: "already_present", idempotencyKey, target: target.path, output: target };
  }
  await execFileAsync(
    "/usr/bin/osascript",
    ["-e", `tell application id "${target.bundleId}" to quit`],
    { timeout: 10000 },
  );
  return { mode: "quit", idempotencyKey, target: target.path, output: target };
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function assertRealDirectory(directory: string): Promise<string> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ActionExecutionError(
      `Controlled root is not a real directory: ${directory}`,
    );
  }
  return realpath(directory);
}

async function prepareControlledDirectory(
  root: string,
  subdirectory: string,
): Promise<string> {
  const resolvedRoot = path.resolve(root);
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const realRoot = await assertRealDirectory(resolvedRoot);
  let current = realRoot;
  for (const segment of subdirectory.split("/")) {
    current = path.join(current, segment);
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    current = await assertRealDirectory(current);
    if (!isWithin(realRoot, current)) {
      throw new ActionExecutionError(
        "Controlled directory escaped its configured root.",
      );
    }
  }
  return current;
}

async function resolveExistingPath(
  root: string,
  relativePath: string,
): Promise<{ realRoot: string; target: string }> {
  const resolvedRoot = path.resolve(root);
  const realRoot = await assertRealDirectory(resolvedRoot);
  if (relativePath === ".") return { realRoot, target: realRoot };
  let current = realRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      // Surface a diagnosable message instead of a bare errno that the
      // controller would report as "Unexpected executor failure."
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ActionExecutionError(
          `Path does not exist inside the configured root: ${relativePath}`,
        );
      }
      throw new ActionExecutionError(
        `Path could not be inspected (${(error as NodeJS.ErrnoException).code ?? "unknown"}): ${relativePath}`,
      );
    }
    if (stats.isSymbolicLink()) {
      throw new ActionExecutionError("Symlink access is forbidden.");
    }
  }
  const target = await realpath(current);
  if (!isWithin(realRoot, target)) {
    throw new ActionExecutionError("Path escaped the configured root.");
  }
  return { realRoot, target };
}

async function readTextFile(target: string, maxBytes: number): Promise<string> {
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new ActionExecutionError(
      `Text target must be a regular file no larger than ${maxBytes} bytes.`,
    );
  }
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function contentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readFileBytes(target: string, maxBytes: number): Promise<Buffer> {
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new ActionExecutionError(
      `File target must be a regular file no larger than ${maxBytes} bytes.`,
    );
  }
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function createRequest(
  policy: CreateOnlyTextPolicy,
  step: TaskStep,
): { name: string; extension: string; content: string } {
  const name = step.arguments[policy.nameArgument];
  const content = step.arguments[policy.contentArgument];
  const extension = policy.fixedExtension
    ? policy.fixedExtension
    : policy.extensionArgument
      ? step.arguments[policy.extensionArgument]
      : undefined;
  if (
    typeof name !== "string" ||
    typeof extension !== "string" ||
    typeof content !== "string"
  ) {
    throw new ActionExecutionError("Validated text arguments are missing.");
  }
  return { name, extension, content };
}

async function createOnlyText(
  policy: CreateOnlyTextPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const requested = createRequest(policy, step);
  const directory = await prepareControlledDirectory(
    context.roots[policy.root],
    policy.subdirectory,
  );
  const target = path.join(
    directory,
    `${requested.name}.${requested.extension}`,
  );
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  let handle;
  let created = false;
  try {
    handle = await open(
      target,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    await handle.writeFile(requested.content, "utf8");
    await handle.sync();
    return { mode: "created", idempotencyKey, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      const code = (error as NodeJS.ErrnoException).code;
      // A partial write must not poison the name forever: a retry would
      // otherwise see EEXIST with different content and fail permanently.
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw new ActionExecutionError(
        `Text creation failed${code ? ` (${code})` : ""}.`,
        code === "EINTR" || code === "EBUSY",
      );
    }
    const existing = await readTextFile(target, policy.maxBytes);
    if (existing !== requested.content) {
      throw new ActionExecutionError(
        "Text artifact already exists with different content; overwrite is forbidden.",
      );
    }
    return { mode: "already_present", idempotencyKey, target };
  } finally {
    await handle?.close();
  }
}

/**
 * A caller-asserted hash. `undefined` means "derive it"; a present value is
 * enforced as an additional optimistic-concurrency assertion.
 */
type AssertedHash = string | undefined;

function assertedHash(value: unknown): AssertedHash {
  return typeof value === "string" ? value : undefined;
}

function mutationRequest(
  policy: DesktopTextMutationPolicy,
  step: TaskStep,
): {
  relativePath: string;
  content: string;
  expectedHash: AssertedHash;
  resultHash: AssertedHash;
} {
  const relativePath = step.arguments[policy.relativePathArgument];
  const content = step.arguments[policy.contentArgument];
  if (typeof relativePath !== "string" || typeof content !== "string") {
    throw new ActionExecutionError("Validated mutation arguments are missing.");
  }
  return {
    relativePath,
    content,
    expectedHash: assertedHash(step.arguments[policy.expectedHashArgument]),
    resultHash: assertedHash(step.arguments[policy.resultHashArgument]),
  };
}

async function atomicReplace(
  target: string,
  desired: string | Buffer,
  expectedCurrentHash: string,
  maxBytes: number,
): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.orion-control-${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(desired);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const currentStats = await lstat(target);
    const current = await readFileBytes(target, maxBytes);
    if (contentHash(current) !== expectedCurrentHash) {
      throw new ActionExecutionError(
        "Desktop text changed before commit; stale hash rejected.",
      );
    }
    // Preserve the original file mode: replace-by-rename must not silently
    // relax or tighten permissions on a file the user already owns.
    await chmod(temporary, currentStats.mode & 0o7777).catch(() => undefined);
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

function fileMutationRequest(
  policy: DesktopFileMutationPolicy,
  step: TaskStep,
): {
  relativePath: string;
  operation: "create" | "append" | "replace";
  content: Buffer;
  contentSource: string;
  expectedHash: AssertedHash;
  resultHash: AssertedHash;
} {
  const relativePath = step.arguments[policy.relativePathArgument];
  const operation = step.arguments[policy.operationArgument];
  const encoding = step.arguments[policy.encodingArgument];
  const encodedContent = step.arguments[policy.contentArgument];
  const contentSource = step.arguments[policy.contentSourceArgument];
  if (
    typeof relativePath !== "string" ||
    !["create", "append", "replace"].includes(String(operation)) ||
    typeof encodedContent !== "string"
  ) {
    throw new ActionExecutionError("Validated file mutation arguments are missing.");
  }
  return {
    relativePath,
    operation: operation as "create" | "append" | "replace",
    content:
      encoding === "base64"
        ? Buffer.from(encodedContent, "base64")
        : Buffer.from(encodedContent, "utf8"),
    contentSource:
      typeof contentSource === "string" ? contentSource : "inline_user_request",
    expectedHash: assertedHash(step.arguments[policy.expectedHashArgument]),
    resultHash: assertedHash(step.arguments[policy.resultHashArgument]),
  };
}

/**
 * Resolve the idempotency token for an append/replace: a caller-asserted
 * resultHash if present, otherwise the hash a previous attempt in this same run
 * already committed. Without either, a fresh write proceeds.
 */
function idempotencyToken(
  asserted: AssertedHash,
  context: ExecutionContext,
  idempotencyKey: string,
): string | undefined {
  return asserted ?? context.writeMemo?.get(idempotencyKey);
}

function rememberWrite(
  context: ExecutionContext,
  idempotencyKey: string,
  resultHash: string,
): void {
  context.writeMemo?.set(idempotencyKey, resultHash);
}

async function mutateFile(
  policy: DesktopFileMutationPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const request = fileMutationRequest(policy, step);
  const parentRelative = path.posix.dirname(request.relativePath);
  const parent = await resolveExistingPath(
    context.roots[policy.root],
    parentRelative === "." ? "." : parentRelative,
  );
  if (!(await lstat(parent.target)).isDirectory()) {
    throw new ActionExecutionError("Desktop file parent is not a directory.");
  }
  const target = path.join(
    parent.target,
    path.posix.basename(request.relativePath),
  );
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop file target escaped its root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  const describe = (resultHash: string) => ({
    operation: request.operation,
    contentSource: request.contentSource,
    resultHash,
    resultHashSource: request.resultHash ? "asserted" : "derived",
  });
  if (request.operation === "create") {
    // Derived from the exact bytes we are about to write. A caller-asserted
    // resultHash, when present, must agree with it.
    const resultHash = contentHash(request.content);
    if (request.resultHash && request.resultHash !== resultHash) {
      throw new ActionExecutionError(
        "Declared resultHash does not match the requested bytes.",
      );
    }
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new ActionExecutionError(
          "Desktop file target is not a regular file.",
        );
      }
      const existing = await readFileBytes(target, policy.maxResultBytes);
      if (contentHash(existing) === resultHash) {
        return {
          mode: "already_present",
          idempotencyKey,
          target,
          output: describe(resultHash),
        };
      }
      throw new ActionExecutionError(
        "Create target collides with an existing different file.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let handle;
    let created = false;
    try {
      handle = await open(
        target,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      await handle.writeFile(request.content);
      await handle.sync();
      rememberWrite(context, idempotencyKey, resultHash);
      return {
        mode: "created",
        idempotencyKey,
        target,
        output: describe(resultHash),
      };
    } catch (error) {
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  const resolved = await resolveExistingPath(
    context.roots[policy.root],
    request.relativePath,
  );
  const current = await readFileBytes(resolved.target, policy.maxResultBytes);
  const currentHash = contentHash(current);
  const token = idempotencyToken(request.resultHash, context, idempotencyKey);
  if (token && currentHash === token) {
    return {
      mode: "already_present",
      idempotencyKey,
      target: resolved.target,
      output: describe(currentHash),
    };
  }
  if (request.expectedHash && currentHash !== request.expectedHash) {
    throw new ActionExecutionError(
      "Desktop file expectedHash is stale; modification rejected.",
    );
  }
  const desired =
    request.operation === "append"
      ? Buffer.concat([current, request.content])
      : request.content;
  if (desired.byteLength > policy.maxResultBytes) {
    throw new ActionExecutionError(
      `Result exceeds the ${policy.maxResultBytes}-byte limit.`,
    );
  }
  const resultHash = contentHash(desired);
  if (request.resultHash && request.resultHash !== resultHash) {
    throw new ActionExecutionError(
      "Declared resultHash does not match the exact resulting bytes.",
    );
  }
  rememberWrite(context, idempotencyKey, resultHash);
  await atomicReplace(
    resolved.target,
    desired,
    currentHash,
    policy.maxResultBytes,
  );
  return {
    mode: request.operation === "append" ? "appended" : "replaced",
    idempotencyKey,
    target: resolved.target,
    output: describe(resultHash),
  };
}

async function createDirectory(
  root: ControlledRoot,
  relativePath: string,
  context: ExecutionContext,
  step: TaskStep,
): Promise<ExecutionResult> {
  const parentRelative = path.posix.dirname(relativePath);
  const parent = await resolveExistingPath(
    context.roots[root],
    parentRelative === "." ? "." : parentRelative,
  );
  if (!(await lstat(parent.target)).isDirectory()) {
    throw new ActionExecutionError("Desktop folder parent is not a directory.");
  }
  const target = path.join(parent.target, path.posix.basename(relativePath));
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop folder escaped its root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  try {
    await mkdir(target, { mode: 0o700 });
    return { mode: "created", idempotencyKey, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stats = await lstat(target);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ActionExecutionError(
        "Desktop folder target collides with a non-directory or symlink.",
      );
    }
    return { mode: "already_present", idempotencyKey, target };
  }
}

async function mutateText(
  policy: DesktopTextMutationPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const request = mutationRequest(policy, step);
  const root = context.roots.desktop;
  const parentRelative = path.posix.dirname(request.relativePath);
  const parent = await resolveExistingPath(
    root,
    parentRelative === "." ? "." : parentRelative,
  );
  const parentStats = await lstat(parent.target);
  if (!parentStats.isDirectory()) {
    throw new ActionExecutionError("Desktop mutation parent is not a directory.");
  }
  const target = path.join(parent.target, path.posix.basename(request.relativePath));
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop mutation escaped its configured root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);

  const describe = (resultHash: string) => ({
    resultHash,
    resultHashSource: request.resultHash ? "asserted" : "derived",
  });

  if (policy.operation === "create") {
    const resultHash = contentHash(request.content);
    if (request.resultHash && request.resultHash !== resultHash) {
      throw new ActionExecutionError(
        "Declared resultHash does not match the requested content.",
      );
    }
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new ActionExecutionError(
          "Desktop mutation target is not a regular file.",
        );
      }
      const existing = await readTextFile(target, policy.maxResultBytes);
      if (contentHash(existing) === resultHash) {
        return {
          mode: "already_present",
          idempotencyKey,
          target,
          output: describe(resultHash),
        };
      }
      throw new ActionExecutionError(
        "Create target already exists with different content.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let handle;
    let created = false;
    try {
      handle = await open(
        target,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      await handle.writeFile(request.content, "utf8");
      await handle.sync();
      rememberWrite(context, idempotencyKey, resultHash);
      return {
        mode: "created",
        idempotencyKey,
        target,
        output: describe(resultHash),
      };
    } catch (error) {
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  const resolved = await resolveExistingPath(root, request.relativePath);
  const current = await readTextFile(resolved.target, policy.maxResultBytes);
  const currentHash = contentHash(current);
  const token = idempotencyToken(request.resultHash, context, idempotencyKey);
  if (token && currentHash === token) {
    return {
      mode: "already_present",
      idempotencyKey,
      target: resolved.target,
      output: describe(currentHash),
    };
  }
  if (request.expectedHash && currentHash !== request.expectedHash) {
    throw new ActionExecutionError(
      "Desktop text expectedHash is stale; modification rejected.",
    );
  }
  const desired =
    policy.operation === "append" ? `${current}${request.content}` : request.content;
  if (Buffer.byteLength(desired, "utf8") > policy.maxResultBytes) {
    throw new ActionExecutionError(
      `Result exceeds the ${policy.maxResultBytes}-byte limit.`,
    );
  }
  const resultHash = contentHash(desired);
  if (request.resultHash && request.resultHash !== resultHash) {
    throw new ActionExecutionError(
      "Declared resultHash does not match the exact resulting content.",
    );
  }
  rememberWrite(context, idempotencyKey, resultHash);
  await atomicReplace(resolved.target, desired, currentHash, policy.maxResultBytes);
  return {
    mode: policy.operation === "append" ? "appended" : "replaced",
    idempotencyKey,
    target: resolved.target,
    output: describe(resultHash),
  };
}

async function observe(
  policy: Exclude<
    ExecutionPolicy,
    {
      kind:
        | "simulate"
        | "app_control"
        | "create_only_text"
        | "mutate_text"
        | "mutate_file"
        | "create_directory";
    }
  >,
  step: TaskStep,
  context: ExecutionContext,
): Promise<{ target: string; output: unknown }> {
  const relativePath = step.arguments[policy.relativePathArgument];
  if (typeof relativePath !== "string") {
    throw new ActionExecutionError("Validated relativePath is missing.");
  }
  const { target } = await resolveExistingPath(
    context.roots[policy.root],
    relativePath,
  );
  if (policy.kind === "list_directory") {
    const stats = await lstat(target);
    if (!stats.isDirectory()) {
      throw new ActionExecutionError("Listing target is not a directory.");
    }
    const names = (await readdir(target))
      .filter(isVisibleNonSensitiveName)
      .sort()
      .slice(0, policy.maxEntries);
    // An entry that disappears between readdir and lstat must not reject the
    // whole listing; skip it instead of failing the step.
    const entries = (
      await Promise.all(
        names.map(async (name) => {
          try {
            const entry = await lstat(path.join(target, name));
            return {
              name,
              type: entry.isSymbolicLink()
                ? "symlink"
                : entry.isDirectory()
                  ? "directory"
                  : entry.isFile()
                    ? "file"
                    : "other",
              size: entry.size,
              modifiedAt: entry.mtime.toISOString(),
            };
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((entry) => entry !== undefined);
    return { target, output: { relativePath, entries } };
  }
  if (policy.kind === "path_metadata") {
    const stats = await lstat(target);
    return {
      target,
      output: {
        relativePath,
        type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    };
  }
  const content = await readTextFile(target, policy.maxBytes);
  return {
    target,
    output: {
      relativePath,
      content,
      size: Buffer.byteLength(content, "utf8"),
    },
  };
}

export async function executeAction(
  definition: ActionDefinition,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  if (definition.execution.kind === "simulate") {
    context.simulatedState.set(idempotencyKey, true);
    return { mode: "simulated", idempotencyKey };
  }
  if (definition.execution.kind === "app_control") {
    const application = step.arguments[definition.execution.applicationArgument];
    if (typeof application !== "string") {
      throw new ActionExecutionError("Validated application name is missing.");
    }
    return controlApplication(
      definition.execution.operation,
      application,
      idempotencyKey,
    );
  }
  if (definition.execution.kind === "create_only_text") {
    return createOnlyText(definition.execution, step, context);
  }
  if (definition.execution.kind === "mutate_text") {
    return mutateText(definition.execution, step, context);
  }
  if (definition.execution.kind === "mutate_file") {
    return mutateFile(definition.execution, step, context);
  }
  if (definition.execution.kind === "create_directory") {
    const relativePath =
      step.arguments[definition.execution.relativePathArgument];
    if (typeof relativePath !== "string") {
      throw new ActionExecutionError("Validated relativePath is missing.");
    }
    return createDirectory(definition.execution.root, relativePath, context, step);
  }
  const observation = await observe(definition.execution, step, context);
  return { mode: "observed", idempotencyKey, ...observation };
}

/** The result hash the executor committed, as recorded in the execution output. */
function committedResultHash(output: unknown): string | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const value = (output as { resultHash?: unknown }).resultHash;
  return typeof value === "string" ? value : undefined;
}

export async function verifyAction(
  definition: ActionDefinition,
  step: TaskStep,
  execution: ExecutionResult,
  context: ExecutionContext,
): Promise<VerificationResult> {
  if (definition.execution.kind === "simulate") {
    return {
      observed: context.simulatedState.has(execution.idempotencyKey),
      evidence: `simulated:${execution.idempotencyKey}`,
    };
  }
  if (definition.execution.kind === "app_control") {
    const application = step.arguments[definition.execution.applicationArgument];
    if (typeof application !== "string") return { observed: false };
    const target = await resolveApplication(application);
    const running = await applicationIsRunning(target.bundleId);
    return {
      observed:
        definition.execution.operation === "open" ? running : !running,
      evidence: `${target.bundleId}:${running ? "running" : "not_running"}`,
    };
  }
  if (definition.execution.kind === "create_only_text" && execution.target) {
    const expected = createRequest(definition.execution, step).content;
    const observed = await readTextFile(
      execution.target,
      definition.execution.maxBytes,
    );
    return { observed: observed === expected, evidence: execution.target };
  }
  if (definition.execution.kind === "mutate_text" && execution.target) {
    // Compare against the hash the executor derived from the bytes it wrote,
    // never against a caller-supplied value.
    const committed = committedResultHash(execution.output);
    const observed = await readTextFile(
      execution.target,
      definition.execution.maxResultBytes,
    );
    const observedHash = contentHash(observed);
    return {
      observed: committed !== undefined && observedHash === committed,
      evidence: `sha256:${observedHash}`,
    };
  }
  if (definition.execution.kind === "mutate_file" && execution.target) {
    const committed = committedResultHash(execution.output);
    const observed = await readFileBytes(
      execution.target,
      definition.execution.maxResultBytes,
    );
    const observedHash = contentHash(observed);
    return {
      observed: committed !== undefined && observedHash === committed,
      evidence: `sha256:${observedHash}`,
    };
  }
  if (definition.execution.kind === "create_directory" && execution.target) {
    const stats = await lstat(execution.target);
    return {
      observed: stats.isDirectory() && !stats.isSymbolicLink(),
      evidence: execution.target,
    };
  }
  if (
    definition.execution.kind !== "create_only_text" &&
    definition.execution.kind !== "mutate_text" &&
    definition.execution.kind !== "mutate_file" &&
    definition.execution.kind !== "create_directory" &&
    execution.output !== undefined
  ) {
    const independentlyObserved = await observe(
      definition.execution,
      step,
      context,
    );
    const expectedHash = hash(execution.output);
    const observedHash = hash(independentlyObserved.output);
    return {
      observed: observedHash === expectedHash,
      evidence: `sha256:${observedHash}`,
    };
  }
  return { observed: false };
}
