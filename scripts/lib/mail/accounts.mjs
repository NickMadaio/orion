// Which mailboxes the watcher reads (wave 17, 2026-11-03): mail-accounts.json in the controlled dir, a list of
// { id, kind: "gmail"|"imap", address, label } (an imap account also has host and port). Never a password: a Gmail account signs in
// through gog (`gog auth add <address>`), an IMAP one through an app password in the macOS Keychain (service orion-mail-imap:<address>).
// Pure: the CLI (orion-mail-accounts) owns the file. A missing file means the one original Gmail, so nothing changes until he adds one.
import { GMAIL_ACCOUNT } from "../gmail-status.mjs";

export const KINDS = Object.freeze(["gmail", "imap"]);
export const MAX_ACCOUNTS = 6;
const ORDINALS = ["", "second", "third", "fourth", "fifth", "sixth"];
const ADDRESS = /^[^\s@"'<>]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const KNOWN_HOSTS = Object.freeze({ "yahoo.com": "imap.mail.yahoo.com", "ymail.com": "imap.mail.yahoo.com", "rocketmail.com": "imap.mail.yahoo.com", "aol.com": "imap.aol.com", "outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com", "icloud.com": "imap.mail.me.com" });

export const defaultAccounts = () => [{ id: "gmail", kind: "gmail", address: GMAIL_ACCOUNT, label: "Gmail" }];
export const keychainService = (address) => `orion-mail-imap:${String(address).toLowerCase()}`;
export const keychainCommand = (address) => `security add-generic-password -s '${keychainService(address)}' -a '${String(address).toLowerCase()}' -w`;
export const imapHostFor = (address) => KNOWN_HOSTS[String(address).split("@")[1]?.toLowerCase()] ?? null;

/** The valid accounts in a parsed file, or the default when there is no usable file. Bad rows are dropped, never trusted. */
export function normalizeAccounts(raw) {
  if (!Array.isArray(raw)) return defaultAccounts();
  const seen = new Set();
  return raw.flatMap((a) => {
    const address = String(a?.address ?? "").trim().toLowerCase();
    const id = String(a?.id ?? "").toLowerCase();
    if (!KINDS.includes(a?.kind) || !ADDRESS.test(address) || !/^[a-z0-9-]{1,24}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    const label = String(a?.label ?? "").replace(/[^\w ().'-]/g, "").trim().slice(0, 30) || address;
    if (a.kind === "gmail") return [{ id, kind: "gmail", address, label }];
    const port = Number(a.port ?? 993);
    return HOST.test(String(a.host ?? "")) && Number.isInteger(port) && port > 0 && port < 65536 ? [{ id, kind: "imap", address, label, host: String(a.host).toLowerCase(), port }] : [];
  });
}

const uniqueId = (list, base) => { let id = base; for (let n = 2; list.some((a) => a.id === id); n += 1) id = `${base}-${n}`; return id; };

function addOne(list, account) {
  if (list.length >= MAX_ACCOUNTS) throw new TypeError(`at most ${MAX_ACCOUNTS} accounts`);
  if (list.some((a) => a.address === account.address)) throw new TypeError(`${account.address} is already added`);
  return [...list, account];
}

/** Adds a Gmail account (its sign-in is gog's). The first stays "Gmail"; later ones are "Gmail (second)", "Gmail (third)". */
export function addGmail(list, address, { label } = {}) {
  const a = String(address ?? "").trim().toLowerCase();
  if (!ADDRESS.test(a)) throw new TypeError("that doesn't look like an email address");
  const n = list.filter((x) => x.kind === "gmail").length;
  return addOne(list, { id: uniqueId(list, n ? `gmail-${n + 1}` : "gmail"), kind: "gmail", address: a, label: label || (n ? `Gmail (${ORDINALS[n] ?? n + 1})` : "Gmail") });
}

/** Adds an IMAP account over TLS. The host is guessed for the common providers; the password is the Keychain's, never this file's. */
export function addImap(list, address, { host, port = 993, label } = {}) {
  const a = String(address ?? "").trim().toLowerCase();
  if (!ADDRESS.test(a)) throw new TypeError("that doesn't look like an email address");
  const h = String(host ?? imapHostFor(a) ?? "").trim().toLowerCase();
  if (!HOST.test(h)) throw new TypeError("give the IMAP server with --host (for example imap.mail.yahoo.com)");
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new TypeError("the port must be 1 to 65535");
  const provider = a.split("@")[1].split(".")[0];
  return addOne(list, { id: uniqueId(list, provider), kind: "imap", address: a, label: label || provider.charAt(0).toUpperCase() + provider.slice(1), host: h, port: p });
}

/** Removes by id or address. */
export function removeAccount(list, idOrAddress) {
  const key = String(idOrAddress ?? "").trim().toLowerCase();
  const next = list.filter((a) => a.id !== key && a.address !== key);
  return { list: next, removed: list.length - next.length };
}

/** What he is told when this account's sign-in stops working (once a day each). */
export const reconnectText = (a) => a.kind === "imap"
  ? `${a.label} needs an app password, so I can't watch it right now. orion-mail-accounts status shows the one-time Keychain step.`
  : `${a.label} needs reconnecting, so I can't watch ${a.id === "gmail" ? "your inbox" : "it"} right now. Running gog auth add ${a.address} in Terminal fixes it.`;
