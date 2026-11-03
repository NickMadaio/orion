// What Nick has taught ORION about his mail (wave 14, 2026-11-02): "not important" / "stop telling me about X" mutes, "always tell me
// when Y emails" / "this matters" boosts. Pure: a prefs object in, a new prefs object out; the CLI (orion-mail-prefs) owns the file.
//
// A rule is { id, action: "mute"|"boost", kind: "sender"|"domain"|"topic", value, added, via }.
//   sender  matches the sender's address, or a word-bounded part of their display name ("smith" matches "Prof. Jane Smith")
//   domain  matches the sender's domain or any subdomain of it ("linkedin.com" matches "e.linkedin.com")
//   topic   matches whole words in the subject or snippet ("job alerts", "cs2100")
// The scorer applies these before any other signal, and a boost beats a mute on the same message: being told about something he
// said always matters is cheaper than missing it.
import { createHash } from "node:crypto";
import { PROTECTED_DOMAINS, onDomain } from "./domains.mjs";

export const ACTIONS = Object.freeze(["mute", "boost"]);
export const KINDS = Object.freeze(["sender", "domain", "topic"]);
const MAX_RULES = 200;

export const emptyPrefs = () => ({ rules: [] });

const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9@.+\- ]+/g, " ").replace(/\s+/g, " ").trim();

/** Which kind a bare value is: an address is a sender, a dotted word a domain, anything else the caller decides. */
export function kindOfValue(value, fallback = "topic") {
  const v = norm(value);
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return "sender";
  if (/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return "domain";
  return fallback;
}

const ruleId = (action, kind, value, account = "") => `m-${createHash("sha1").update(`${action}|${kind}|${value}${account ? `|${account}` : ""}`).digest("hex").slice(0, 6)}`;

/** Validates and normalises a rule; throws a TypeError naming what is wrong. */
export function makeRule({ action, kind, value, via = "cli", now = new Date(), account = "" }) {
  if (!ACTIONS.includes(action)) throw new TypeError(`action must be ${ACTIONS.join(" or ")}`);
  if (!KINDS.includes(kind)) throw new TypeError(`kind must be ${KINDS.join(", ")}`);
  const v = norm(value).replace(/^@/, "");
  if (v.length < 2 || v.length > 80) throw new TypeError("value must be 2 to 80 characters");
  // His school and the freemail providers are never ruled on as a whole: muting northeastern.edu mutes every professor (wave 14 review).
  if (kind === "domain" && onDomain(v, PROTECTED_DOMAINS)) throw new TypeError(`${v} is protected: a rule on the whole domain would cover everyone who writes from it; name the sender instead`);
  const acct = String(account ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);   // an account id from mail-accounts.json; empty = every account
  return { id: ruleId(action, kind, v, acct), action, kind, value: v, ...(acct ? { account: acct } : {}), added: now.toISOString(), via: String(via).slice(0, 20) };
}

/** Adds a rule. The opposite rule on the same thing is replaced (he changed his mind); the same rule is kept once. */
export function addRule(prefs, rule) {
  const rules = (prefs?.rules ?? []).filter((r) => !(r.kind === rule.kind && r.value === rule.value && (r.account ?? "") === (rule.account ?? "")));
  const existing = (prefs?.rules ?? []).find((r) => r.id === rule.id);
  return { ...prefs, rules: [...rules, existing ?? rule].slice(-MAX_RULES) };
}

/** Removes by id, or by value (every rule on that value). */
export function removeRule(prefs, idOrValue) {
  const key = norm(idOrValue);
  const rules = (prefs?.rules ?? []).filter((r) => r.id !== String(idOrValue) && r.value !== key);
  return { prefs: { ...prefs, rules }, removed: (prefs?.rules ?? []).length - rules.length };
}

const wordIn = (needle, hay) => {
  const n = norm(needle);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(norm(hay));
};

/** Does this rule match the mail item? */
export function ruleMatches(rule, item) {
  if (rule.account && rule.account !== item.accountId) return false;   // an account-specific rule (wave 17); the rest are global
  if (rule.kind === "sender") return item.fromAddress === rule.value || wordIn(rule.value, item.fromName) || (!rule.value.includes("@") && wordIn(rule.value, item.fromAddress.split("@")[0]));
  if (rule.kind === "domain") return item.domain === rule.value || item.domain.endsWith(`.${rule.value}`);
  const byDomainName = !onDomain(item.domain, PROTECTED_DOMAINS) && item.domain.split(".").includes(rule.value);
  return wordIn(rule.value, `${item.subject} ${item.snippet}`) || wordIn(rule.value, item.fromName) || byDomainName;
}

/** The rule that decides this item, boost first; null when he has said nothing about it. */
export function prefVerdict(prefs, item) {
  const rules = prefs?.rules ?? [];
  return rules.find((r) => r.action === "boost" && ruleMatches(r, item)) ?? rules.find((r) => r.action === "mute" && ruleMatches(r, item)) ?? null;
}

/** "mute sender linkedin" for the list. */
export const ruleLine = (r) => `${r.id}  ${r.action === "mute" ? "not important" : "always tell"}  ${r.kind}: ${r.value}${r.account ? `  [${r.account} only]` : ""}  (${String(r.added).slice(0, 10)}, via ${r.via})`;
