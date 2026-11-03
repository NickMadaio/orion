// `orion-mail-accounts status`: a real read-only check of each account (wave 17), never "a token exists". Gmail: one cheap gog search for
// that account. IMAP: the Keychain item, then a login and EXAMINE. Plus what the watcher last saw (its per-account problem).
import { classifyGmailError, GMAIL_EXPIRED } from "../gmail-status.mjs";
import { searchThreads } from "../gmail-client.mjs";
import { keychainCommand } from "./accounts.mjs";
import { fetchRecent } from "./imap-client.mjs";
import { keychainPassword } from "./imap-inbox.mjs";

const oneLine = (error) => (error instanceof Error ? error.message : String(error)).trim().split("\n").at(-1).slice(0, 140);

async function gmailRow(a, { root, search }) {
  try { await search(root, "in:inbox", 1, { account: a.address }); return { state: "connected", say: "working (read-only)" }; }
  catch (error) {
    const state = classifyGmailError(oneLine(error));
    return { state, say: state === "expired" ? GMAIL_EXPIRED.replace(/gog auth add \S+/, `gog auth add ${a.address}`) : state === "unreachable" ? "couldn't be reached just now (network), so its status is unknown." : `NOT working: ${oneLine(error)}` };
  }
}

async function imapRow(a, { password, fetch, plain }) {
  let secret;
  try { secret = await password(a.address); } catch { return { state: "no-password", say: `no app password yet. Run this yourself, then it works:\n  ${keychainCommand(a.address)}` }; }
  try { await fetch({ host: a.host, port: a.port, user: a.address, password: secret, since: new Date(), max: 1, keysOnly: true, plain }); return { state: "connected", say: "working (read-only)" }; }
  catch (error) { const t = oneLine(error); return { state: /sign-in refused/.test(t) ? "expired" : "error", say: /sign-in refused/.test(t) ? "the app password was refused. Make a new one in Yahoo Account Security and store it again with the Keychain command above." : `NOT working: ${t}` }; }
}

/** One row per account: { id, label, kind, address, state, say, lastProblem }. */
export async function accountStatuses(accounts, { root, state = {}, search = searchThreads, password = keychainPassword, fetch = fetchRecent, plain = process.env.ORION_MAIL_IMAP_PLAIN === "1" } = {}) {
  return Promise.all(accounts.map(async (a) => {
    const row = a.kind === "gmail" ? await gmailRow(a, { root, search }) : await imapRow(a, { password, fetch, plain });
    const slice = a.id === "gmail" ? state : state.accounts?.[a.id] ?? {};
    return { id: a.id, label: a.label, kind: a.kind, address: a.address, ...row, lastProblem: slice.problem ?? null };
  }));
}
