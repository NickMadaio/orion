// A minimal READ-ONLY IMAP client (wave 17, 2026-11-03), just enough to watch an inbox: LOGIN, EXAMINE INBOX (read-only by protocol,
// so nothing can be changed even by mistake), UID SEARCH SINCE, UID FETCH with BODY.PEEK (never sets \Seen), LOGOUT. TLS by default.
// Every step has a deadline, and the whole session has one. The password is passed in and sent once; it is never in an error text.
// Test seam: `plain: true` uses an unencrypted socket and is refused for any host but localhost.
import net from "node:net";
import tls from "node:tls";

export const IMAP_TIMEOUT_MS = 20_000;
const HEADER_FIELDS = "FROM SUBJECT DATE MESSAGE-ID LIST-UNSUBSCRIBE LIST-ID PRECEDENCE";
const SNIPPET_BYTES = 600;
const quote = (s) => `"${String(s).replace(/[\\"]/g, "\\$&")}"`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const imapDate = (d) => `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

/** The end of the first complete response for `tag` in `buf` (honouring {n} literals), or -1. */
export function responseEnd(buf, tag) {
  let pos = 0;
  for (;;) {
    const lineStart = pos;
    let idx = buf.indexOf("\r\n", pos, "latin1");
    for (;;) {
      if (idx < 0) return -1;
      const lit = /\{(\d+)\}$/.exec(buf.toString("latin1", pos, idx));
      if (!lit) break;
      pos = idx + 2 + Number(lit[1]);
      if (pos > buf.length) return -1;
      idx = buf.indexOf("\r\n", pos, "latin1");
    }
    if (buf.toString("latin1", lineStart, lineStart + tag.length + 1) === `${tag} `) return idx + 2;
    pos = idx + 2;
  }
}

/** The untagged `* n FETCH (...)` messages in a response: { uid, literals: [Buffer] } each. */
export function parseFetch(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let text = ""; let literals = []; let lineStart = pos;
    for (;;) {
      const idx = buf.indexOf("\r\n", pos, "latin1");
      if (idx < 0) { pos = buf.length; break; }
      const line = buf.toString("latin1", pos, idx);
      text += line;
      const lit = /\{(\d+)\}$/.exec(line);
      if (!lit) { pos = idx + 2; break; }
      const n = Number(lit[1]);
      literals = [...literals, buf.subarray(idx + 2, idx + 2 + n)];
      pos = idx + 2 + n;
    }
    if (/^\* \d+ FETCH/.test(buf.toString("latin1", lineStart, lineStart + 30))) {
      const uid = /UID (\d+)/.exec(text.replace(/\{\d+\}$/g, ""))?.[1];
      if (uid) out.push({ uid: Number(uid), literals });
    }
  }
  return out;
}

/** Opens a session. Resolves to { run(command) → { ok, text: Buffer }, close() }. */
function connect({ host, port, plain, timeoutMs }) {
  if (plain && !/^(127\.0\.0\.1|localhost)$/.test(host)) throw new Error("plain IMAP is for localhost tests only");
  return new Promise((resolve, reject) => {
    const socket = plain ? net.connect({ host, port }) : tls.connect({ host, port, servername: host });
    let buf = Buffer.alloc(0);
    let waiter = null;
    const fail = (error) => { socket.destroy(); if (waiter) { const w = waiter; waiter = null; w.reject(error); } else reject(error); };
    socket.setTimeout(timeoutMs, () => fail(new Error(`the mail server didn't answer within ${Math.round(timeoutMs / 1000)} s`)));
    socket.on("error", (e) => fail(new Error(`could not reach the mail server: ${e.message}`)));
    socket.on("close", () => { if (waiter) fail(new Error("the mail server closed the connection")); });
    const settle = () => {
      if (!waiter) return;
      const end = waiter.tag ? responseEnd(buf, waiter.tag) : (buf.indexOf("\r\n") >= 0 ? buf.indexOf("\r\n") + 2 : -1);
      if (end < 0) return;
      const text = buf.subarray(0, end); buf = buf.subarray(end);
      const w = waiter; waiter = null; w.resolve(text);
    };
    socket.on("data", (chunk) => { buf = Buffer.concat([buf, chunk]); settle(); });
    const wait = (tag) => new Promise((res, rej) => { waiter = { tag, resolve: res, reject: rej }; settle(); });
    let n = 0;
    const run = async (command) => {
      n += 1; const tag = `O${n}`;
      const pending = wait(tag);
      socket.write(`${tag} ${command}\r\n`);
      const text = await pending;
      const status = /(?:^|\r\n)O\d+ (OK|NO|BAD)/.exec(text.toString("latin1", Math.max(0, text.length - 600)))?.[1];
      return { ok: status === "OK", text };
    };
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try { socket.end(`O${n + 1} LOGOUT\r\n`); } catch { /* gone */ }
      const t = setTimeout(() => socket.destroy(), 500); t.unref?.();
    };
    const onReady = () => wait(null).then(() => resolve({ run, close }), reject);
    socket.once(plain ? "connect" : "secureConnect", onReady);
  });
}

const withDeadline = (promise, ms, onTimeout) => { let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => { onTimeout(); rej(new Error(`the mail server didn't finish within ${Math.round(ms / 1000)} s`)); }, ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

/**
 * The newest messages since `since` as { uid, key, headers: Buffer, snippet: Buffer }.
 * `isSeen(key)` skips what ORION already has before any body is fetched; with `keysOnly` nothing but keys is fetched (the first poll).
 * Sign-in refusal throws "IMAP sign-in refused ..." so the watcher can say "needs an app password".
 */
export async function fetchRecent({ host, port = 993, user, password, since, max = 15, isSeen = () => false, keysOnly = false, plain = false, timeoutMs = IMAP_TIMEOUT_MS }) {
  let session = null;
  const job = (async () => {
    session = await connect({ host, port, plain, timeoutMs });
    const login = await session.run(`LOGIN ${quote(user)} ${quote(password)}`);
    if (!login.ok) throw new Error("IMAP sign-in refused: the app password was not accepted (authentication failed)");
    const sel = await session.run("EXAMINE INBOX");
    if (!sel.ok) throw new Error("the mail server would not open the inbox");
    const validity = /UIDVALIDITY (\d+)/.exec(sel.text.toString("latin1"))?.[1] ?? "0";
    const found = await session.run(`UID SEARCH SINCE ${imapDate(since)}`);
    if (!found.ok) throw new Error("the mail server could not search the inbox");
    const uids = (/\* SEARCH([\d ]*)/.exec(found.text.toString("latin1"))?.[1] ?? "").trim().split(/\s+/).filter(Boolean).map(Number).slice(-max);
    const fresh = uids.map((uid) => ({ uid, key: `${validity}.${uid}` })).filter((m) => !isSeen(m.key));
    if (keysOnly || !fresh.length) return fresh.map((m) => ({ ...m, headers: Buffer.alloc(0), snippet: Buffer.alloc(0) }));
    const got = await session.run(`UID FETCH ${fresh.map((m) => m.uid).join(",")} (UID BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS})] BODY.PEEK[TEXT]<0.${SNIPPET_BYTES}>)`);
    if (!got.ok) throw new Error("the mail server could not read the new messages");
    const byUid = new Map(parseFetch(got.text).map((f) => [f.uid, f]));
    return fresh.map((m) => ({ ...m, headers: byUid.get(m.uid)?.literals[0] ?? Buffer.alloc(0), snippet: byUid.get(m.uid)?.literals[1] ?? Buffer.alloc(0) }));
  })();
  try { return await withDeadline(job, timeoutMs * 2, () => session?.close()); }
  finally { session?.close(); job.catch(() => {}); }
}
