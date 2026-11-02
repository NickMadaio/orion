// A gog thread, reduced to what the watcher may look at: headers and Gmail's snippet (wave 14, 2026-11-02).
// Bodies never leave this function. gog's `thread get` carries them, but the item it returns has no body field, so nothing
// downstream (the scorer, the local model, the alert) can read past the snippet.
//
// Tolerant of both header shapes gog has used: an object keyed by name (any case) and Gmail's own [{ name, value }] list,
// at the message level or under `payload`.
import { decodeQuotedPrintable } from "../gmail-format.mjs";

const lowerKeys = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));

/** One message's headers as { lowercase-name: value }. */
export function headersOf(message) {
  const raw = message?.headers ?? message?.payload?.headers ?? {};
  if (Array.isArray(raw)) return Object.fromEntries(raw.filter((h) => h?.name).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")]));
  return raw && typeof raw === "object" ? lowerKeys(raw) : {};
}

/** `"Prof. Jane Smith" <j.smith@northeastern.edu>` → { name: "Prof. Jane Smith", address: "j.smith@northeastern.edu" }. */
export function parseAddress(from) {
  const raw = String(from ?? "").trim();
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  const address = (angled ? angled[2] : raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").trim().toLowerCase();
  const name = (angled ? angled[1] : "").replace(/^["']|["']$/g, "").replace(/\s+via\s+.+$/i, "").trim();
  return { name, address };
}

export const domainOf = (address) => String(address ?? "").split("@")[1]?.toLowerCase() ?? "";

/** Snippets arrive HTML-escaped and padded with invisible characters; neither is information. */
export function cleanSnippet(text) {
  return decodeQuotedPrintable(String(text ?? ""))
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\[url removed\]/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[­͏​-‏⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * The newest message of a thread as a mail item, or null when the payload has no message.
 * nickAddresses: his own addresses, so a reply in a thread he wrote in is recognised.
 */
export function mailItem(payload, { nickAddresses = [] } = {}) {
  const thread = payload?.thread ?? payload;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const newest = messages.at(-1);
  if (!newest) return null;
  const h = headersOf(newest);
  const { name, address } = parseAddress(h.from);
  const mine = new Set(nickAddresses.map((a) => a.toLowerCase()));
  const nickWrote = messages.slice(0, -1).some((m) => mine.has(parseAddress(headersOf(m).from).address));
  return {
    threadId: String(thread?.id ?? newest.threadId ?? ""),
    messageId: String(newest.id ?? `${thread?.id ?? "?"}:${messages.length}`),
    fromName: name,
    fromAddress: address,
    domain: domainOf(address),
    subject: String(h.subject ?? "").replace(/\s+/g, " ").trim(),
    snippet: cleanSnippet(newest.snippet ?? ""),
    labels: Array.isArray(newest.labelIds) ? newest.labelIds : Array.isArray(thread?.labels) ? thread.labels : [],
    listUnsubscribe: Boolean(h["list-unsubscribe"] || h["list-id"]),
    precedenceBulk: /bulk|list|junk/i.test(String(h.precedence ?? "")),
    nickInThread: nickWrote,
    fromNick: mine.has(address),
    date: String(h.date ?? thread?.date ?? ""),
  };
}
