/**
 * The plugin's relay client: shared golden vectors with the Swift side, atomic request files, waiting for the
 * answer, the timeout, cleanup, and local refusals. A tiny in-test "app" plays Orion.app's part.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RelayError, canonicalRequest, canonicalResponse, ensureRelayKey, relayAppState, relayPaths, relayRequest, sign,
  type RelayPaths,
} from "./computer-relay.js";

const VECTORS = JSON.parse(fs.readFileSync(fileURLToPath(new URL(
  "../../../native/Orion/Tests/ComputerRelayTests/Fixtures/golden-vectors.json", import.meta.url)), "utf8"));
const KEY = Buffer.from(VECTORS.keyHex, "hex");

let root: string;
let paths: RelayPaths;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "relay-"));
  paths = relayPaths(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Plays Orion.app: verifies the request with the shared key and answers it, signed. */
function fakeApp(answer: (req: Record<string, any>) => { ok: boolean; result?: Record<string, string>; error?: string }, tamper = false) {
  const key = fs.readFileSync(paths.keyPath);
  const timer = setInterval(() => {
    for (const name of fs.readdirSync(paths.dir).filter((n) => n.endsWith(".req.json"))) {
      const req = JSON.parse(fs.readFileSync(join(paths.dir, name), "utf8"));
      fs.unlinkSync(join(paths.dir, name));
      if (req.mac !== sign(key, canonicalRequest(req))) throw new Error("fake app: bad request mac");
      const a = answer(req);
      const res = { id: req.id, nonce: req.nonce, ok: a.ok, result: a.result ?? {}, ...(a.error ? { error: a.error } : {}) };
      const mac = sign(key, canonicalResponse(res));
      fs.writeFileSync(join(paths.dir, `${req.id}.res.json`), JSON.stringify({ ...res, mac: tamper ? mac.replace(/^./, mac[0] === "0" ? "1" : "0") : mac }));
    }
  }, 10);
  return () => clearInterval(timer);
}

describe("golden vectors shared with native/Orion", () => {
  it("reproduces every request canonical string and MAC", () => {
    expect(VECTORS.requests).toHaveLength(3);
    for (const c of VECTORS.requests) {
      expect(canonicalRequest(c.request)).toBe(c.canonical);
      expect(sign(KEY, c.canonical)).toBe(c.mac);
    }
  });
  it("reproduces every response canonical string and MAC", () => {
    for (const c of VECTORS.responses) {
      expect(canonicalResponse(c.response)).toBe(c.canonical);
      expect(sign(KEY, c.canonical)).toBe(c.mac);
    }
  });
});

describe("relayRequest", () => {
  it("round-trips through the app and cleans both files up", async () => {
    ensureRelayKey(paths);
    fs.mkdirSync(paths.dir, { mode: 0o700, recursive: true });
    const stop = fakeApp((req) => ({ ok: true, result: { typed: req.payload.text } }));
    try {
      const answer = await relayRequest("screen_type", { expected_bundle_id: "com.apple.TextEdit", text: "orion test" }, { paths, pollMs: 5 });
      expect(answer).toEqual({ ok: true, result: { typed: "orion test" } });
    } finally { stop(); }
    expect(fs.readdirSync(paths.dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  });

  it("passes the bridge's own failure through as data, not as a relay error", async () => {
    ensureRelayKey(paths);
    fs.mkdirSync(paths.dir, { mode: 0o700, recursive: true });
    const stop = fakeApp(() => ({ ok: false, error: "Accessibility is not granted." }));
    try {
      expect(await relayRequest("screen_observe", {}, { paths, pollMs: 5 })).toEqual({ ok: false, error: "Accessibility is not granted.", result: {} });
    } finally { stop(); }
  });

  it("writes the request atomically: a temp file renamed into place", async () => {
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    const spy = {
      ...fs,
      writeFileSync: ((p: string, ...rest: any[]) => { writes.push(p); return (fs.writeFileSync as any)(p, ...rest); }) as typeof fs.writeFileSync,
      renameSync: ((a: string, b: string) => { renames.push([a, b]); return fs.renameSync(a, b); }) as typeof fs.renameSync,
    };
    let t = 0;
    await expect(relayRequest("screen_ocr", {}, { paths, fs: spy, now: () => t, sleep: async () => { t += 100; }, timeoutMs: 300, newId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }))
      .rejects.toBeInstanceOf(RelayError);
    const reqWrite = renames.find(([, to]) => to.endsWith("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.req.json"));
    expect(reqWrite?.[0]).toMatch(/\/\.tmp-[0-9a-f-]+$/);
    expect(writes).not.toContain(join(paths.dir, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.req.json"));
  });

  it("times out honestly when nothing picks the request up, and removes it", async () => {
    let t = 0;
    const error = await relayRequest("screen_observe", {}, { paths, now: () => t, sleep: async () => { t += 1000; }, timeoutMs: 20_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(RelayError);
    expect(error.kind).toBe("timeout");
    expect(error.message).toMatch(/Orion app isn't answering.*20 s/);
    expect(fs.readdirSync(paths.dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  });

  it("says so when the app took the request but never answered", async () => {
    let t = 0;
    const sleep = async () => {
      t += 1000;
      for (const n of fs.readdirSync(paths.dir).filter((x) => x.endsWith(".req.json"))) fs.unlinkSync(join(paths.dir, n));
    };
    const error = await relayRequest("screen_observe", {}, { paths, now: () => t, sleep, timeoutMs: 5000 }).catch((e) => e);
    expect(error.message).toMatch(/took the screen request but didn't answer within 5 s/);
  });

  it("rejects an answer whose signature does not verify, and still cleans up", async () => {
    ensureRelayKey(paths);
    fs.mkdirSync(paths.dir, { mode: 0o700, recursive: true });
    const stop = fakeApp(() => ({ ok: true, result: { app_name: "Fake" } }), true);
    try {
      await expect(relayRequest("screen_observe", {}, { paths, pollMs: 5 })).rejects.toMatchObject({ kind: "bad_response" });
    } finally { stop(); }
    expect(fs.readdirSync(paths.dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  });

  it("refuses non-screen actions, unknown keys and oversized values before writing anything", async () => {
    for (const [action, payload] of [
      ["create_calendar_event", {}], ["status", {}], ["screen_capture", {}],
      ["screen_type", { expected_bundle_id: "x", command: "ls" }],
      ["screen_type", { expected_bundle_id: "x", text: "a".repeat(8 * 1024 + 1) }],
    ] as Array<[string, Record<string, string>]>) {
      await expect(relayRequest(action, payload, { paths })).rejects.toMatchObject({ kind: "refused" });
    }
    expect(fs.existsSync(paths.dir)).toBe(false);
  });
});

describe("relay files", () => {
  it("generates a private 32-byte key once and reuses it", () => {
    const first = ensureRelayKey(paths);
    expect(first).toHaveLength(32);
    expect(fs.statSync(paths.keyPath).mode & 0o777).toBe(0o600);
    expect(ensureRelayKey(paths).equals(first)).toBe(true);
    expect(fs.readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a key others can read, and a loose relay directory", async () => {
    ensureRelayKey(paths);
    fs.chmodSync(paths.keyPath, 0o644);
    expect(() => ensureRelayKey(paths)).toThrow(/private file/);
    fs.chmodSync(paths.keyPath, 0o600);
    fs.mkdirSync(paths.dir, { mode: 0o755 });
    fs.chmodSync(paths.dir, 0o755);
    await expect(relayRequest("screen_observe", {}, { paths })).rejects.toMatchObject({ kind: "unsafe" });
  });
});

describe("relayAppState", () => {
  const beat = (o: Record<string, unknown>) => {
    fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths.heartbeatPath, JSON.stringify({ pid: 1, ...o }));
  };
  it("reads the app's heartbeat", () => {
    expect(relayAppState(paths, 1000)).toBe("down");
    beat({ at: 100_000, accessibility: true, bridge: "ready" });
    expect(relayAppState(paths, 110_000)).toBe("ready");
    expect(relayAppState(paths, 116_000)).toBe("down");
    beat({ at: 100_000, accessibility: false, bridge: "ready" });
    expect(relayAppState(paths, 101_000)).toBe("untrusted");
    beat({ at: 100_000, accessibility: true, bridge: "missing" });
    expect(relayAppState(paths, 101_000)).toBe("no_bridge");
  });
});
