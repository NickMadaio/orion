// An IMAP account as the watcher's fetchInbox (wave 17, 2026-11-03): the same item shape gogInbox gives, so score, sensitive and alert
// treat Yahoo like Gmail. Headers and a 600-byte body snippet only; bodies never leave this module (the item has no body field).
import { execFile } from "node:child_process";
import { decodeQuotedPrintable } from "../gmail-format.mjs";
import { mailItem } from "./normalize.mjs";
import { fetchRecent } from "./imap-client.mjs";
import { keychainService } from "./accounts.mjs";

export const IMAP_LOOKBACK_MS = 2 * 86_400_000;

/** The app password from the Keychain (`security find-generic-password -w`); no shell, never logged. Rejects with a sentence that names the step. */
export const keychainPassword = (address, { run = execFile } = {}) => new Promise((resolve, reject) => {
  run("security", ["find-generic-password", "-s", keychainService(address), "-w"], { timeout: 10_000 }, (error, stdout) => {
    const password = String(stdout ?? "").replace(/\r?\n$/, "");
    if (error || !password) reject(new Error(`no app password in the Keychain for ${address} (keychain item ${keychainService(address)})`));
    else resolve(password);
  });
});

/** =?UTF-8?B?...?= and =?UTF-8?Q?...?= words, joined across folded lines. */
export function decodeWords(text) {
  return String(text ?? "").replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(/utf-?8/i.test(charset) ? "utf-8" : "windows-1252").decode(bytes);
    } catch { return ""; }
  });
}

/** Header block → { lowercase-name: value }, unfolded and decoded. */
export function parseHeaders(buf) {
  const unfolded = buf.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  return Object.fromEntries(unfolded.split(/\r?\n/).flatMap((line) => { const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line); return m ? [[m[1].toLowerCase(), decodeWords(m[2]).trim()]] : []; }));
}

/** The first words of a body: MIME scaffolding, tags and encoded blobs dropped. The result is cleaned again by mailItem. */
export function snippetOf(buf) {
  const text = decodeQuotedPrintable(buf.toString("utf8")).replace(/<(style|script)[\s\S]*?(<\/\1>|$)/gi, " ").replace(/<[^>]*>/g, " ")
    .split(/\r?\n/).filter((l) => !/^--|^content-|^mime-/i.test(l) && !/^[A-Za-z0-9+/=]{60,}$/.test(l.trim())).join(" ");
  return text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

/**
 * fetchInbox for mailTick, for one IMAP account { address, host, port }.
 * deps (tests): password(address) → string, plain, now, fetch (replaces the socket client).
 */
export const imapInbox = (account, { nickAddresses = [], password = keychainPassword, plain = process.env.ORION_MAIL_IMAP_PLAIN === "1", now = () => new Date(), fetch = fetchRecent } = {}) => async ({ isSeen, firstPoll = false }) => {
  const rows = await fetch({ host: account.host, port: account.port, user: account.address, password: await password(account.address), plain,
    since: new Date(now().getTime() - IMAP_LOOKBACK_MS), isSeen, keysOnly: firstPoll });
  return rows.map((row) => {
    const base = { key: row.key, threadId: String(row.uid), messageId: String(row.uid) };
    if (firstPoll) return { ...base, messageId: "" };
    const h = parseHeaders(row.headers);
    const item = mailItem({ thread: { id: String(row.uid), messages: [{ id: String(row.uid), snippet: snippetOf(row.snippet), labelIds: [], headers: h }] } }, { nickAddresses });
    return item ? { ...item, ...base } : null;
  }).filter(Boolean);
};
