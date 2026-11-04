// ORION reading his own recent turns (w19 selffix): what he was asked, what he answered, which route handled it and which tools ran.
// Sources, all read-only: the chat transcripts (chats/*.json), the local-routing shadow log and the task ledger. Nothing here
// writes, and everything that leaves this file has been through redact().
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+_-]{40,}={0,2}/g,
];

/** A copy of a value with every string in it redacted (keys and structure stay, so it can still be read as JSON). */
export function redactDeep(value, max = 160) {
  if (typeof value === "string") return redact(value, max);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, max));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /key|token|secret|password|authorization/i.test(k) ? "[redacted]" : redactDeep(v, max)]));
  return value;
}

/** Text with anything secret-shaped removed, collapsed to one line and cut to `max` characters. */
export function redact(value, max = 240) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const pattern of SECRETS) text = text.replace(pattern, (m) => (/^bearer/i.test(m) ? "Bearer [redacted]" : /[:=]/.test(m) ? `${m.split(/[:=]/)[0]}=[redacted]` : "[redacted]"));
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const readJsonl = (file) => {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
};
const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The raw material: chat messages (de-duplicated by id), shadow rows and ledger rows from `dir` that are not older than sinceMs. */
export function loadSources(dir, { sinceMs = 0 } = {}) {
  const messages = new Map();
  const chats = join(dir, "chats");
  if (existsSync(chats)) {
    for (const name of readdirSync(chats).filter((n) => n.endsWith(".json"))) {
      try {
        if (statSync(join(chats, name)).mtimeMs < sinceMs) continue;
        for (const m of JSON.parse(readFileSync(join(chats, name), "utf8")).messages ?? []) {
          const at = ms(m.at);
          if (at !== null && at >= sinceMs && typeof m.text === "string") messages.set(m.id ?? `${name}:${m.at}:${m.role}`, { role: m.role, text: m.text, at });
        }
      } catch { /* a half-written chat file is not worth failing the read */ }
    }
  }
  const shadow = readJsonl(join(dir, "local-routing", "shadow.jsonl")).filter((r) => (ms(r.at) ?? 0) >= sinceMs - 60_000);
  const ledger = readJsonl(join(dir, "task-ledger.jsonl")).filter((r) => (ms(r.createdAt) ?? 0) >= sinceMs - 60_000);
  return { messages: [...messages.values()].sort((a, b) => a.at - b.at), shadow, ledger };
}

const routeOf = (row) => {
  if (!row) return { move: null, flow: null, tool: null, findings: [], note: "no routing record for this turn" };
  const d = row.decision ?? {};
  return {
    move: d.move ?? null, flow: row.flow ?? null, tool: d.tool ?? null,
    args: d.args ? JSON.stringify(redactDeep(d.args)) : null,
    model: row.model ?? null,
    findings: (row.findings ?? []).flat().filter(Boolean).slice(0, 4),
    escalationNeeded: Boolean(row.escalationNeeded),
  };
};

/** One turn per message he sent: { at, message, reply, route, tools }. Ledger steps are the tools that really ran. */
export function buildTurns({ messages, shadow, ledger }) {
  const users = messages.filter((m) => m.role === "user" && m.text.trim() && !/^thinking$/i.test(m.text.trim()));
  return users.map((m, i) => {
    const until = users[i + 1]?.at ?? m.at + 10 * 60_000;
    const replies = messages.filter((x) => x.role !== "user" && x.at > m.at && x.at < until);
    const near = shadow.filter((r) => norm(r.message) === norm(m.text) && (ms(r.at) ?? 0) >= m.at - 60_000 && (ms(r.at) ?? 0) <= m.at + 120_000)
      .sort((a, b) => Math.abs(ms(a.at) - m.at) - Math.abs(ms(b.at) - m.at))[0];
    const tools = ledger.filter((r) => { const t = ms(r.createdAt) ?? 0; return t >= m.at - 15_000 && t < until; })
      .flatMap((r) => (r.steps ?? []).map((s) => ({
        action: s.request?.action ?? "unknown",
        args: JSON.stringify(redactDeep(s.request?.arguments ?? {})),
        status: s.status ?? r.status ?? "unknown",
        error: s.error ? redact(s.error, 200) : null,
      })));
    return { at: new Date(m.at).toISOString(), message: redact(m.text, 300), reply: redact(replies.map((r) => r.text).join(" / "), 400), route: routeOf(near), tools };
  });
}

/** The last n turns, leaving out a message (the "why did you do that" he is asking right now). */
export function recentTurns(turns, { n = 5, exclude } = {}) {
  const skip = exclude ? norm(exclude) : null;
  return turns.filter((t) => !skip || norm(t.message) !== skip).slice(-Math.max(1, n));
}
