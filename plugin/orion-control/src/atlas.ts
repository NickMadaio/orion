import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROTOCOL_VERSION = 1;
const MAX_RESPONSE_BYTES = 1_100_000;
const ATLAS_APP = "/Applications/Atlas.app";
const BUNDLE_IDS = [
  "com.nickmadaio.atlas",
  "com.nickmadaio.atlas.local",
  "com.nickmadaio.atlas.staging",
] as const;

export type AtlasOperation =
  | "health"
  | "collections.list"
  | "notes.search"
  | "notes.read"
  | "notes.create"
  | "notes.update";

export interface AtlasArguments {
  collectionID?: string;
  noteID?: string;
  query?: string;
  title?: string;
  summary?: string;
  category?: string;
  markdown?: string;
  expectedUpdatedAt?: string;
  limit?: number;
}

export interface AtlasCollection {
  id: string;
  title: string;
  summary: string;
  icon: string;
  accent: string;
  sortOrder: number;
}

export interface AtlasNote {
  id: string;
  collectionID: string;
  title: string;
  summary: string;
  category: string;
  updatedAt: string;
  accent: string;
  bodyMarkdown: string;
  isFavorite: boolean;
}

export interface AtlasPayload {
  message?: string;
  collections?: AtlasCollection[];
  notes?: AtlasNote[];
  note?: AtlasNote;
  noteID?: string;
}

interface AtlasResponse {
  version: number;
  id: string;
  ok: boolean;
  payload?: AtlasPayload;
  error?: string;
}

interface BridgeMetadata {
  protocolVersion: number;
  bundleIdentifier: string;
  pendingDirectory: string;
  responsesDirectory: string;
}

interface BridgeLocation {
  root: string;
  pending: string;
  responses: string;
}

export class AtlasBridgeError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "AtlasBridgeError";
  }
}

function bridgeRoot(bundleID: string): string {
  return path.join(
    os.homedir(),
    "Library",
    "Containers",
    bundleID,
    "Data",
    "Library",
    "Application Support",
    "Atlas",
    "AgentBridge",
  );
}

async function regularFile(candidate: string): Promise<boolean> {
  try {
    const stats = await lstat(candidate);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function discoverBridge(): Promise<BridgeLocation | undefined> {
  for (const bundleID of BUNDLE_IDS) {
    const root = bridgeRoot(bundleID);
    const metadataPath = path.join(root, "bridge.json");
    if (!(await regularFile(metadataPath))) continue;
    try {
      const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as BridgeMetadata;
      const pending = path.resolve(String(parsed.pendingDirectory ?? ""));
      const responses = path.resolve(String(parsed.responsesDirectory ?? ""));
      if (
        parsed.protocolVersion === PROTOCOL_VERSION &&
        parsed.bundleIdentifier === bundleID &&
        inside(root, pending) &&
        inside(root, responses)
      ) {
        return { root, pending, responses };
      }
    } catch {
      // Ignore a malformed or half-written candidate and try the next known bundle.
    }
  }
  return undefined;
}

async function launchAtlas(): Promise<void> {
  const stats = await lstat(ATLAS_APP).catch(() => undefined);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new AtlasBridgeError("Atlas is not installed in Applications.");
  }
  try {
    await execFileAsync("/usr/bin/open", [ATLAS_APP], { timeout: 5_000 });
  } catch (error) {
    throw new AtlasBridgeError(
      `Atlas could not be opened: ${error instanceof Error ? error.message : "open failed"}`,
      true,
    );
  }
}

async function waitForBridge(timeoutMs = 8_000): Promise<BridgeLocation> {
  let location = await discoverBridge();
  if (location) return location;
  await launchAtlas();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    location = await discoverBridge();
    if (location) return location;
  }
  throw new AtlasBridgeError(
    "Atlas opened, but its agent connection did not become ready.",
    true,
  );
}

function requestUUID(idempotencyKey: string): string {
  const source = idempotencyKey.replace(/[^a-f0-9]/gi, "").padEnd(32, "0").slice(0, 32);
  return `${source.slice(0, 8)}-${source.slice(8, 12)}-${source.slice(12, 16)}-${source.slice(16, 20)}-${source.slice(20, 32)}`.toLowerCase();
}

async function readResponse(responsePath: string, expectedID: string): Promise<AtlasResponse> {
  const stats = await lstat(responsePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_RESPONSE_BYTES) {
    throw new AtlasBridgeError("Atlas returned an unsafe response file.");
  }
  const handle = await open(
    responsePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let raw: string;
  try {
    raw = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  const response = JSON.parse(raw) as AtlasResponse;
  if (response.version !== PROTOCOL_VERSION || response.id !== expectedID) {
    throw new AtlasBridgeError("Atlas returned a response for a different request.");
  }
  if (!response.ok) {
    throw new AtlasBridgeError(response.error ?? "Atlas refused the request.");
  }
  return response;
}

export async function requestAtlas(
  operation: AtlasOperation,
  arguments_: AtlasArguments,
  idempotencyKey: string,
): Promise<AtlasPayload> {
  const location = await waitForBridge();
  const id = requestUUID(idempotencyKey);
  const requestPath = path.join(location.pending, `${id}.json`);
  const responsePath = path.join(location.responses, `${id}.json`);

  if (await regularFile(responsePath)) {
    return (await readResponse(responsePath, id)).payload ?? {};
  }

  const temporaryPath = path.join(location.pending, `.${id}.${process.pid}.tmp`);
  const request = JSON.stringify({
    version: PROTOCOL_VERSION,
    id,
    operation,
    arguments: arguments_,
  });
  try {
    await writeFile(temporaryPath, request, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, requestPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new AtlasBridgeError(
        `Atlas request could not be queued: ${error instanceof Error ? error.message : "write failed"}`,
        true,
      );
    }
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await regularFile(responsePath)) {
      return (await readResponse(responsePath, id)).payload ?? {};
    }
  }
  throw new AtlasBridgeError("Atlas did not answer the request in time.", true);
}

export function atlasBridgeCandidatesForTests(): readonly string[] {
  return BUNDLE_IDS.map(bridgeRoot);
}
