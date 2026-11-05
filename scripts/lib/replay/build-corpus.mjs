#!/usr/bin/env node
/*
 build-corpus: Nick's REAL turns into the private replay corpus (never the repo).

   node scripts/lib/replay/build-corpus.mjs [--days 14] [--audit PATH] [--out DIR]

 Writes <out>/real.cases.json (default ~/.openclaw/orion-controlled/evals/replay/):
   - "audit" cases: the exact words from the tube audit's table, each with the properties of the matching anonymised case in
     scripts/eval/replay/cases.json (same audit id), so the live layer grades the real sentence on the same properties;
   - "good" cases: his other turns from the last N days whose ORION reply had no banned shape (so they worked), graded on
     "no banned shape" plus the route class that handled them then (from local-routing/shadow.jsonl), so a change that sends
     them somewhere else is a regression.
 Reads the chats and shadow log read-only. Needs no network and no model.
*/
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const root = join(homedir(), ".openclaw", "orion-controlled");
const days = Number(val("--days", "14"));
const out = val("--out", join(root, "evals", "replay"));
const auditCandidates = [join(here, "..", "..", "..", ".builds", "w20", "tube-audit.md"), join(homedir(), "Desktop", "ORION", ".builds", "w20", "tube-audit.md")];
const auditPath = val("--audit", auditCandidates.find(existsSync) ?? auditCandidates[0]);
const repoCases = JSON.parse(readFileSync(join(here, "..", "..", "eval", "replay", "cases.json"), "utf8"));

const BANNED = [/say (?:it|that) again|can you rephrase|tell me differently|didn'?t actually do that/i, /^\s*(?:…|\.{3})\s*$/, /couldn'?t run that lookup/i, /\bORION (?:refused|is|has|can'?t|cannot)\b/, /degrees Fahrenheit/i, /Same problem as a moment ago/i];
const id = (s) => createHash("sha1").update(s).digest("hex").slice(0, 8);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---- shadow log: message -> how it was routed then
const shadow = new Map();
try {
  for (const line of readFileSync(join(root, "local-routing", "shadow.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.message && !r.stage) shadow.set(norm(String(r.message).replace(/^\[Retry[^\]]*\]\s*/, "")), r); } catch { /* skip a torn line */ }
  }
} catch { /* no shadow log: route classes are simply absent */ }

const routeClass = (row) => {
  if (!row) return undefined;
  const d = row.decision ?? {};
  if (row.flow && row.flow.outcome && row.flow.outcome !== "fallback") return row.flow.calls?.some((c) => /orion-reschedule/.test(c)) ? "schedule" : "code-flow";
  if (d.move === "tool") return `desk-tool:${d.tool}`;
  if (d.move === "answer") return "desk-answer";
  return "worker";
};

// ---- audit cases: real words + the anonymised case's properties
const audit = [];
if (existsSync(auditPath)) {
  const byAudit = new Map(repoCases.filter((c) => c.audit).map((c) => [c.audit, c]));
  for (const line of readFileSync(auditPath, "utf8").split("\n")) {
    const cells = line.split(/\s\|\s/);
    const key = cells[0]?.match(/^\|\s*([ELAM]\d+)\s*$/)?.[1];
    const twin = key && byAudit.get(key);
    if (!twin || cells.length < 4) continue;
    const raw = cells[2].trim();
    const quoted = raw.match(/^"(.*)"(?:\s*\(.*\))?$/s)?.[1];
    const after = raw.match(/^\(after "(.*?)"/)?.[1];   // M2: the turn he sent was the one before the logged reply
    const said = quoted ?? (/^same text/i.test(raw) ? audit.at(-1)?.say : after);   // "same text again": the sentence he resent
    if (!said) continue;
    audit.push({ ...twin, id: `real-audit-${key.toLowerCase()}`, say: said.replace(/\\"/g, '"'), intent: `real words of tube audit ${key}` });
  }
}

// ---- good turns from the chats
const cut = new Date(Date.now() - days * 86_400_000).toISOString();
const auditText = new Set(audit.map((c) => norm(c.say)));
const good = [];
const chatDir = join(root, "chats");
for (const f of existsSync(chatDir) ? readdirSync(chatDir).filter((x) => x.endsWith(".json")) : []) {
  let chat;
  try { chat = JSON.parse(readFileSync(join(chatDir, f), "utf8")); } catch { continue; }
  const ms = chat.messages ?? [];
  ms.forEach((m, i) => {
    if (m.role !== "user" || (m.at ?? "") < cut || !m.text || m.text.length > 400) return;
    const reply = ms.slice(i + 1).find((x) => x.role === "orion");
    if (!reply?.text || BANNED.some((re) => re.test(reply.text)) || auditText.has(norm(m.text))) return;
    if (/^Use the tool_search|^\[Retry/.test(m.text)) return;
    const row = shadow.get(norm(m.text));
    const route = routeClass(row);
    good.push({ id: `real-good-${id(`${m.id ?? m.at}${m.text}`)}`, say: m.text, surface: m.device === "phone" ? "phone" : "mac", now: String(m.at ?? "").slice(0, 16),
      liveOnly: true, intent: "a real turn that worked", observed: { reply: reply.text.slice(0, 300), ...(route ? { route } : {}) },
      expect: { ...(route && route !== "worker" ? { routeLike: route } : {}) } });
  });
}
const seen = new Set();
const uniqueGood = good.filter((c) => { const k = norm(c.say); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.now.localeCompare(b.now));

mkdirSync(out, { recursive: true });
const file = join(out, "real.cases.json");
writeFileSync(file, JSON.stringify([...audit, ...uniqueGood], null, 1), { mode: 0o600 });
console.log(`build-corpus: ${audit.length} audit turns + ${uniqueGood.length} good turns -> ${file}`);
