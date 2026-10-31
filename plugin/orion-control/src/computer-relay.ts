/**
 * The plugin side of the computer relay (2026-10-31).
 *
 * The gateway's node process has no Accessibility grant; Orion.app does. A screen request is written as a signed
 * file into ~/.openclaw/orion-controlled/computer-relay/ (mode 0700); the app (native/Orion ComputerRelay) checks
 * the HMAC, freshness, nonce and allowlist, runs orion-mac-bridge as its own child, and writes a signed answer.
 *
 * The canonical strings are a cross-language contract pinned by golden vectors shared with the Swift side
 * (native/Orion/Tests/ComputerRelayTests/Fixtures/golden-vectors.json). This file only carries requests; it does
 * not decide what may run, and what comes back off the screen is still data for the loop's taint rules.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RELAY_ACTIONS: ReadonlySet<string> = new Set([
  "screen_observe", "screen_click", "screen_type", "screen_key", "screen_press",
  "screen_set_value", "screen_menu", "screen_menu_items", "screen_ocr",
]);
export const RELAY_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "expected_bundle_id", "path", "role", "label", "ax_action", "value", "menu_path", "menu", "key", "text", "x", "y",
]);
export const RELAY_LIMITS = {
  maxPayloadKeys: 16, maxValueBytes: 8 * 1024, maxRequestBytes: 64 * 1024, maxResponseBytes: 4 * 1024 * 1024,
  heartbeatFreshMs: 15_000, timeoutMs: 20_000, pollMs: 100, keyBytes: 32,
} as const;

export type RelayPaths = { readonly dir: string; readonly keyPath: string; readonly heartbeatPath: string };

export function relayPaths(controlledDir = process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled")): RelayPaths {
  const dir = join(controlledDir, "computer-relay");
  return { dir, keyPath: join(controlledDir, "computer-relay.key"), heartbeatPath: join(dir, "heartbeat.json") };
}

export type RelayErrorKind = "app_down" | "app_untrusted" | "no_bridge" | "unsafe" | "refused" | "timeout" | "bad_response";

export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, message: string) {
    super(message);
    this.name = "RelayError";
  }
}

// ---------- canonical form and HMAC ----------

const lp = (s: string): string => `${Buffer.byteLength(s, "utf8")}:${s}`;

function pairs(map: Readonly<Record<string, string>>): string {
  const keys = Object.keys(map).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return keys.reduce((acc, key) => acc + lp(key) + lp(map[key] ?? ""), lp(String(keys.length)));
}

export type RelayRequestFields = {
  readonly id: string; readonly action: string; readonly createdAt: number; readonly nonce: string;
  readonly payload: Readonly<Record<string, string>>;
};
export type RelayResponseFields = {
  readonly id: string; readonly nonce: string; readonly ok: boolean; readonly error?: string | null;
  readonly result?: Readonly<Record<string, string>>;
};

export function canonicalRequest(r: RelayRequestFields): string {
  return `orion-computer-relay/v1/req\n${lp(r.id)}${lp(r.action)}${lp(String(r.createdAt))}${lp(r.nonce)}${pairs(r.payload)}`;
}

export function canonicalResponse(r: RelayResponseFields): string {
  return `orion-computer-relay/v1/res\n${lp(r.id)}${lp(r.nonce)}${lp(r.ok ? "true" : "false")}${lp(r.error ?? "")}${pairs(r.result ?? {})}`;
}

export function sign(key: Buffer, canonical: string): string {
  return createHmac("sha256", key).update(canonical, "utf8").digest("hex");
}

export function verifyMac(key: Buffer, canonical: string, presented: unknown): boolean {
  if (typeof presented !== "string" || !/^[0-9a-f]{64}$/.test(presented)) return false;
  return timingSafeEqual(Buffer.from(sign(key, canonical), "hex"), Buffer.from(presented, "hex"));
}

// ---------- files ----------

type Fs = Pick<typeof nodeFs, "mkdirSync" | "lstatSync" | "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "linkSync" | "existsSync">;

const uid = (): number | null => (typeof process.getuid === "function" ? process.getuid() : null);

/** Creates the relay directory (0700) if missing and refuses one that is a symlink, someone else's, or loose. */
export function ensureRelayDir(paths: RelayPaths, fs: Fs = nodeFs): void {
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(paths.dir);
  if (!st.isDirectory()) throw new RelayError("unsafe", "the computer relay directory is not a real directory");
  const me = uid();
  if (me !== null && st.uid !== me) throw new RelayError("unsafe", "the computer relay directory belongs to another user");
  if ((st.mode & 0o777) !== 0o700) throw new RelayError("unsafe", `the computer relay directory has mode ${(st.mode & 0o777).toString(8)}, not 700`);
}

/** The 32-byte HMAC key, generated once (0600, created atomically so two processes cannot both write it). */
export function ensureRelayKey(paths: RelayPaths, fs: Fs = nodeFs, random: (n: number) => Buffer = randomBytes): Buffer {
  if (!fs.existsSync(paths.keyPath)) {
    const temp = `${paths.keyPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, random(RELAY_LIMITS.keyBytes), { mode: 0o600, flag: "wx" });
    try { fs.linkSync(temp, paths.keyPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally { fs.unlinkSync(temp); }
  }
  const st = fs.lstatSync(paths.keyPath);
  const me = uid();
  if (!st.isFile() || (me !== null && st.uid !== me) || (st.mode & 0o077) !== 0) {
    throw new RelayError("unsafe", "the computer relay key is not a private file of this user");
  }
  const key = fs.readFileSync(paths.keyPath);
  if (key.length !== RELAY_LIMITS.keyBytes) throw new RelayError("unsafe", "the computer relay key is the wrong size");
  return key;
}

function writeAtomic(fs: Fs, dir: string, name: string, body: string): void {
  const temp = join(dir, `.tmp-${randomUUID()}`);
  fs.writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temp, join(dir, name)); } catch (error) { try { fs.unlinkSync(temp); } catch { /* gone */ } throw error; }
}

const tryUnlink = (fs: Fs, path: string): boolean => { try { fs.unlinkSync(path); return true; } catch { return false; } };

// ---------- heartbeat ----------

export type AppState = "ready" | "untrusted" | "no_bridge" | "down";

/** Whether Orion.app is running the relay right now, from its heartbeat (written every 5 s). */
export function relayAppState(paths: RelayPaths, now: number = Date.now(), fs: Fs = nodeFs): AppState {
  let beat: { at?: unknown; accessibility?: unknown; bridge?: unknown };
  try { beat = JSON.parse(String(fs.readFileSync(paths.heartbeatPath, "utf8"))); } catch { return "down"; }
  if (typeof beat.at !== "number" || now - beat.at > RELAY_LIMITS.heartbeatFreshMs || beat.at - now > 5_000) return "down";
  if (beat.accessibility !== true) return "untrusted";
  return beat.bridge === "ready" ? "ready" : "no_bridge";
}

// ---------- the request ----------

export type RelayOptions = {
  readonly paths?: RelayPaths;
  readonly fs?: Fs;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly newId?: () => string;
  readonly newNonce?: () => string;
};

export type BridgeAnswer = { readonly ok: boolean; readonly error?: string; readonly result: Record<string, string> };

function checkPayload(action: string, payload: Readonly<Record<string, string>>): void {
  if (!RELAY_ACTIONS.has(action)) throw new RelayError("refused", `the relay does not carry '${action}'`);
  const keys = Object.keys(payload);
  if (keys.length > RELAY_LIMITS.maxPayloadKeys) throw new RelayError("refused", "too many payload keys for the relay");
  for (const key of keys) {
    if (!RELAY_PAYLOAD_KEYS.has(key)) throw new RelayError("refused", `payload key '${key}' is not carried by the relay`);
    if (typeof payload[key] !== "string" || Buffer.byteLength(payload[key]!, "utf8") > RELAY_LIMITS.maxValueBytes) {
      throw new RelayError("refused", `payload value '${key}' is too large for the relay`);
    }
  }
}

function readAnswer(raw: string, key: Buffer, id: string, nonce: string): BridgeAnswer {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { throw new RelayError("bad_response", "the Orion app's answer was not JSON"); }
  const resultRaw = parsed.result && typeof parsed.result === "object" ? parsed.result as Record<string, unknown> : {};
  const result = Object.fromEntries(Object.entries(resultRaw).filter((e): e is [string, string] => typeof e[1] === "string"));
  const fields: RelayResponseFields = {
    id: String(parsed.id ?? ""), nonce: String(parsed.nonce ?? ""), ok: parsed.ok === true,
    error: typeof parsed.error === "string" ? parsed.error : null, result,
  };
  if (fields.id !== id || fields.nonce !== nonce || !verifyMac(key, canonicalResponse(fields), parsed.mac)) {
    throw new RelayError("bad_response", "the Orion app's answer failed verification");
  }
  return { ok: fields.ok, ...(fields.error ? { error: fields.error } : {}), result };
}

/**
 * Sends one allowlisted bridge request through Orion.app and returns the bridge's answer (ok or not).
 * Throws RelayError only for the relay itself: refused locally, nobody answering, or an answer that doesn't verify.
 */
export async function relayRequest(action: string, payload: Readonly<Record<string, string>>, options: RelayOptions = {}): Promise<BridgeAnswer> {
  const fs = options.fs ?? nodeFs;
  const paths = options.paths ?? relayPaths();
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? RELAY_LIMITS.timeoutMs;
  const pollMs = options.pollMs ?? RELAY_LIMITS.pollMs;
  checkPayload(action, payload);
  ensureRelayDir(paths, fs);
  const key = ensureRelayKey(paths, fs);
  const id = (options.newId ?? randomUUID)().toLowerCase();
  const nonce = (options.newNonce ?? (() => randomBytes(16).toString("hex")))();
  const fields: RelayRequestFields = { id, action, createdAt: now(), nonce, payload: { ...payload } };
  const body = JSON.stringify({ ...fields, mac: sign(key, canonicalRequest(fields)) });
  if (Buffer.byteLength(body, "utf8") > RELAY_LIMITS.maxRequestBytes) throw new RelayError("refused", "the request is too large for the relay");

  const reqPath = join(paths.dir, `${id}.req.json`);
  const resPath = join(paths.dir, `${id}.res.json`);
  writeAtomic(fs, paths.dir, `${id}.req.json`, body);
  const started = now();
  try {
    for (;;) {
      if (fs.existsSync(resPath)) {
        const st = fs.lstatSync(resPath);
        if (!st.isFile() || st.size > RELAY_LIMITS.maxResponseBytes) throw new RelayError("bad_response", "the Orion app's answer was not a readable file under the size cap");
        return readAnswer(String(fs.readFileSync(resPath, "utf8")), key, id, nonce);
      }
      if (now() - started >= timeoutMs) break;
      await sleep(pollMs);
    }
    const untaken = tryUnlink(fs, reqPath);
    throw new RelayError("timeout", untaken
      ? `the Orion app isn't answering screen requests (nothing picked this one up in ${Math.round(timeoutMs / 1000)} s)`
      : `the Orion app took the screen request but didn't answer within ${Math.round(timeoutMs / 1000)} s`);
  } finally {
    tryUnlink(fs, reqPath);
    tryUnlink(fs, resPath);
  }
}
