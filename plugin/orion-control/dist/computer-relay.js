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
export const RELAY_ACTIONS = new Set([
    "screen_observe", "screen_click", "screen_type", "screen_key", "screen_press",
    "screen_set_value", "screen_menu", "screen_menu_items", "screen_ocr",
]);
export const RELAY_PAYLOAD_KEYS = new Set([
    "expected_bundle_id", "path", "role", "label", "ax_action", "value", "menu_path", "menu", "key", "text", "x", "y",
]);
export const RELAY_LIMITS = {
    maxPayloadKeys: 16, maxValueBytes: 8 * 1024, maxRequestBytes: 64 * 1024, maxResponseBytes: 4 * 1024 * 1024,
    heartbeatFreshMs: 15_000, timeoutMs: 20_000, pollMs: 100, keyBytes: 32,
};
export function relayPaths(controlledDir = process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled")) {
    const dir = join(controlledDir, "computer-relay");
    return { dir, keyPath: join(controlledDir, "computer-relay.key"), heartbeatPath: join(dir, "heartbeat.json") };
}
export class RelayError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = "RelayError";
    }
}
// ---------- canonical form and HMAC ----------
const lp = (s) => `${Buffer.byteLength(s, "utf8")}:${s}`;
function pairs(map) {
    const keys = Object.keys(map).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    return keys.reduce((acc, key) => acc + lp(key) + lp(map[key] ?? ""), lp(String(keys.length)));
}
export function canonicalRequest(r) {
    return `orion-computer-relay/v1/req\n${lp(r.id)}${lp(r.action)}${lp(String(r.createdAt))}${lp(r.nonce)}${pairs(r.payload)}`;
}
export function canonicalResponse(r) {
    return `orion-computer-relay/v1/res\n${lp(r.id)}${lp(r.nonce)}${lp(r.ok ? "true" : "false")}${lp(r.error ?? "")}${pairs(r.result ?? {})}`;
}
export function sign(key, canonical) {
    return createHmac("sha256", key).update(canonical, "utf8").digest("hex");
}
export function verifyMac(key, canonical, presented) {
    if (typeof presented !== "string" || !/^[0-9a-f]{64}$/.test(presented))
        return false;
    return timingSafeEqual(Buffer.from(sign(key, canonical), "hex"), Buffer.from(presented, "hex"));
}
const uid = () => (typeof process.getuid === "function" ? process.getuid() : null);
/** Creates the relay directory (0700) if missing and refuses one that is a symlink, someone else's, or loose. */
export function ensureRelayDir(paths, fs = nodeFs) {
    fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(paths.dir);
    if (!st.isDirectory())
        throw new RelayError("unsafe", "the computer relay directory is not a real directory");
    const me = uid();
    if (me !== null && st.uid !== me)
        throw new RelayError("unsafe", "the computer relay directory belongs to another user");
    if ((st.mode & 0o777) !== 0o700)
        throw new RelayError("unsafe", `the computer relay directory has mode ${(st.mode & 0o777).toString(8)}, not 700`);
}
/** The 32-byte HMAC key, generated once (0600, created atomically so two processes cannot both write it). */
export function ensureRelayKey(paths, fs = nodeFs, random = randomBytes) {
    if (!fs.existsSync(paths.keyPath)) {
        const temp = `${paths.keyPath}.${randomUUID()}.tmp`;
        fs.writeFileSync(temp, random(RELAY_LIMITS.keyBytes), { mode: 0o600, flag: "wx" });
        try {
            fs.linkSync(temp, paths.keyPath);
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        finally {
            fs.unlinkSync(temp);
        }
    }
    const st = fs.lstatSync(paths.keyPath);
    const me = uid();
    if (!st.isFile() || (me !== null && st.uid !== me) || (st.mode & 0o077) !== 0) {
        throw new RelayError("unsafe", "the computer relay key is not a private file of this user");
    }
    const key = fs.readFileSync(paths.keyPath);
    if (key.length !== RELAY_LIMITS.keyBytes)
        throw new RelayError("unsafe", "the computer relay key is the wrong size");
    return key;
}
function writeAtomic(fs, dir, name, body) {
    const temp = join(dir, `.tmp-${randomUUID()}`);
    fs.writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
    try {
        fs.renameSync(temp, join(dir, name));
    }
    catch (error) {
        try {
            fs.unlinkSync(temp);
        }
        catch { /* gone */ }
        throw error;
    }
}
const tryUnlink = (fs, path) => { try {
    fs.unlinkSync(path);
    return true;
}
catch {
    return false;
} };
/** Whether Orion.app is running the relay right now, from its heartbeat (written every 5 s). */
export function relayAppState(paths, now = Date.now(), fs = nodeFs) {
    let beat;
    try {
        beat = JSON.parse(String(fs.readFileSync(paths.heartbeatPath, "utf8")));
    }
    catch {
        return "down";
    }
    if (typeof beat.at !== "number" || now - beat.at > RELAY_LIMITS.heartbeatFreshMs || beat.at - now > 5_000)
        return "down";
    if (beat.accessibility !== true)
        return "untrusted";
    return beat.bridge === "ready" ? "ready" : "no_bridge";
}
function checkPayload(action, payload) {
    if (!RELAY_ACTIONS.has(action))
        throw new RelayError("refused", `the relay does not carry '${action}'`);
    const keys = Object.keys(payload);
    if (keys.length > RELAY_LIMITS.maxPayloadKeys)
        throw new RelayError("refused", "too many payload keys for the relay");
    for (const key of keys) {
        if (!RELAY_PAYLOAD_KEYS.has(key))
            throw new RelayError("refused", `payload key '${key}' is not carried by the relay`);
        if (typeof payload[key] !== "string" || Buffer.byteLength(payload[key], "utf8") > RELAY_LIMITS.maxValueBytes) {
            throw new RelayError("refused", `payload value '${key}' is too large for the relay`);
        }
    }
}
function readAnswer(raw, key, id, nonce) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new RelayError("bad_response", "the Orion app's answer was not JSON");
    }
    const resultRaw = parsed.result && typeof parsed.result === "object" ? parsed.result : {};
    const result = Object.fromEntries(Object.entries(resultRaw).filter((e) => typeof e[1] === "string"));
    const fields = {
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
export async function relayRequest(action, payload, options = {}) {
    const fs = options.fs ?? nodeFs;
    const paths = options.paths ?? relayPaths();
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const timeoutMs = options.timeoutMs ?? RELAY_LIMITS.timeoutMs;
    const pollMs = options.pollMs ?? RELAY_LIMITS.pollMs;
    checkPayload(action, payload);
    ensureRelayDir(paths, fs);
    const key = ensureRelayKey(paths, fs);
    const id = (options.newId ?? randomUUID)().toLowerCase();
    const nonce = (options.newNonce ?? (() => randomBytes(16).toString("hex")))();
    const fields = { id, action, createdAt: now(), nonce, payload: { ...payload } };
    const body = JSON.stringify({ ...fields, mac: sign(key, canonicalRequest(fields)) });
    if (Buffer.byteLength(body, "utf8") > RELAY_LIMITS.maxRequestBytes)
        throw new RelayError("refused", "the request is too large for the relay");
    const reqPath = join(paths.dir, `${id}.req.json`);
    const resPath = join(paths.dir, `${id}.res.json`);
    writeAtomic(fs, paths.dir, `${id}.req.json`, body);
    const started = now();
    try {
        for (;;) {
            if (fs.existsSync(resPath)) {
                const st = fs.lstatSync(resPath);
                if (!st.isFile() || st.size > RELAY_LIMITS.maxResponseBytes)
                    throw new RelayError("bad_response", "the Orion app's answer was not a readable file under the size cap");
                return readAnswer(String(fs.readFileSync(resPath, "utf8")), key, id, nonce);
            }
            if (now() - started >= timeoutMs)
                break;
            await sleep(pollMs);
        }
        const untaken = tryUnlink(fs, reqPath);
        throw new RelayError("timeout", untaken
            ? `the Orion app isn't answering screen requests (nothing picked this one up in ${Math.round(timeoutMs / 1000)} s)`
            : `the Orion app took the screen request but didn't answer within ${Math.round(timeoutMs / 1000)} s`);
    }
    finally {
        tryUnlink(fs, reqPath);
        tryUnlink(fs, resPath);
    }
}
