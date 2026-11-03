// The watcher's read of Gmail through gog (wave 14, 2026-11-02). Read-only: every call goes through gmail-client.mjs, which appends
// --readonly and --gmail-no-send itself.
//
// One search for the inbox's newest threads, then one `thread get` per thread NOT seen before (never for the rest). The thread get is
// what carries the snippet, the List-Unsubscribe header and whether Nick wrote in the thread. getThreadMeta() drops the bodies inside
// gmail-client.mjs, before the payload reaches this module; mailItem() then keeps only what the watcher needs.
import { getThreadMeta, searchThreads } from "../gmail-client.mjs";
import { mailItem } from "./normalize.mjs";

export const INBOX_QUERY = "in:inbox newer_than:2d";
export const INBOX_MAX = 15;

/** A thread's key: its id plus its newest date, so a new reply in an old thread is new mail. */
export const threadKey = (thread) => `${thread.id}@${thread.date ?? thread.messageCount ?? ""}`;

/** fetchInbox for mailTick, bound to a repo root (for .env) and his addresses. Fetches threads in parallel; one failing thread is skipped. */
export const gogInbox = (orionRoot, { nickAddresses = [], account, search = searchThreads, thread = getThreadMeta } = {}) => async ({ isSeen, firstPoll = false }) => {
  const opts = account ? { account } : {};
  const threads = (await search(orionRoot, INBOX_QUERY, INBOX_MAX, opts)).filter((t) => t?.id);
  const unseen = threads.filter((t) => !isSeen(threadKey(t)));
  // The first poll (nothing seen yet) only needs the keys: no thread is read.
  if (firstPoll) return unseen.map((t) => ({ key: threadKey(t), threadId: String(t.id), messageId: "" }));
  const items = await Promise.all(unseen.map(async (t) => {
    try {
      const item = mailItem(await thread(orionRoot, t.id, opts), { nickAddresses });
      return item ? { ...item, key: threadKey(t) } : null;
    } catch { return null; }
  }));
  return items.filter(Boolean);
};
