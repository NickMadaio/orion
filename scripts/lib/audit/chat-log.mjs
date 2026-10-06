// Recurring failures in real ORION conversations (6 Oct 2026, backlog #35).
// Reads OpenClaw session transcripts and flags what Nick had to fight with:
// refusals, tool errors, repeated tool calls, rephrased requests, frustration,
// slow replies. Pure: lines in, findings out. orion-log-audit does the files.

const CANNOT = /\b(I can(?:'|no)t|I(?:'m| am) (?:not able|unable)|I don'?t have (?:access|the ability)|isn'?t something I can|not allowed to|is protected|blocked by)\b/i;
const PROTECTED = /protected|allowlist|not permitted|sandbox/i;
const FAILED = /^\s*(error|failed|refused|NOTHING WAS CHANGED)/i;
const FRUSTRATED = /\b(again|still (?:not|doesn'?t|isn'?t)|why (?:did|didn'?t|is|isn'?t)|that'?s wrong|no[, ]+i said|i said)\b/i;
const CATEGORY = { "cannot-do": "missing-capability", "protected-refusal": "integration-issue", "tool-error": "tool-issue",
  "repeat-tool": "reasoning-issue", "rephrase": "ux-issue", "user-frustration": "ux-issue", "slow-turn": "latency" };

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter(c => c && c.type === "text").map(c => c.text ?? "").join("\n") : "";

// The Mac and phone wrap what Nick said in app context; keep only his words.
const MARKERS = ["--- Nick's message follows ---\n", "User message:\n"];
const spoken = text => {
  for (const marker of MARKERS) {
    const at = text.lastIndexOf(marker);
    if (at !== -1) return text.slice(at + marker.length).trim();
  }
  return text.trim();
};
// ORION's own nudges to itself arrive as user turns; they are not Nick.
const SYNTHETIC = /^\[orion-remote check\]/;

function toolNames(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(c => c && c.type === "toolCall").map(c => {
    const command = c.name === "exec" && c.arguments && typeof c.arguments.command === "string" ? c.arguments.command : "";
    const script = command.trim().split(/\s+/)[0]?.split("/").pop();
    return script ? `exec:${script}` : String(c.name ?? "tool");
  });
}

export function readTurns(lines, { file } = {}) {
  if (!Array.isArray(lines)) throw new TypeError("lines must be a list of strings");
  let model = null;
  return lines.flatMap((line, index) => {
    let entry;
    try { entry = JSON.parse(line); } catch { return []; }
    if (entry?.type === "model_change") { model = entry.modelId ?? model; return []; }
    if (entry?.type === "custom" && entry.customType === "model-snapshot") { model = entry.data?.modelId ?? model; return []; }
    const message = entry?.type === "message" ? entry.message : null;
    if (!message || !["user", "assistant", "toolResult"].includes(message.role)) return [];
    const raw = textOf(message.content);
    if (message.role === "user" && SYNTHETIC.test(raw.trim())) return [];
    const exitCode = message.details?.exitCode;
    return [{ file, index, at: entry.timestamp ?? message.timestamp ?? null, role: message.role,
      text: message.role === "user" ? spoken(raw) : raw, tools: toolNames(message.content),
      isError: message.isError === true || (Number.isInteger(exitCode) && exitCode !== 0), model }];
  });
}

const excerpt = text => text.replace(/\s+/g, " ").trim().slice(0, 200);
const millis = at => (typeof at === "number" ? at : Date.parse(at));
const words = text => new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
function jaccard(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter(w => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

export function findIssues(turns) {
  if (!Array.isArray(turns)) throw new TypeError("turns must be a list");
  const issues = [];
  const flag = (kind, turn, text = turn.text) => issues.push({ category: CATEGORY[kind], kind, file: turn.file, at: turn.at, excerpt: excerpt(text), model: turn.model });
  let lastUser = null, answered = true, toolCounts = new Map();
  for (const turn of turns) {
    if (turn.role === "user") {
      if (lastUser && lastUser.file === turn.file && Math.abs(millis(turn.at) - millis(lastUser.at)) <= 600_000
          && jaccard(turn.text, lastUser.text) >= 0.6) flag("rephrase", turn);
      if (FRUSTRATED.test(turn.text)) flag("user-frustration", turn);
      lastUser = turn; answered = false; toolCounts = new Map();
    } else if (turn.role === "assistant") {
      if (!answered && lastUser && turn.text.trim()) {
        if (millis(turn.at) - millis(lastUser.at) > 120_000) flag("slow-turn", turn, `${Math.round((millis(turn.at) - millis(lastUser.at)) / 1000)}s: ${turn.text}`);
        answered = true;
      }
      if (CANNOT.test(turn.text)) flag(PROTECTED.test(turn.text) ? "protected-refusal" : "cannot-do", turn);
      for (const tool of turn.tools) {
        const count = (toolCounts.get(tool) ?? 0) + 1;
        toolCounts = new Map(toolCounts).set(tool, count);
        if (count === 3) flag("repeat-tool", turn, `${tool} called 3+ times for: ${lastUser?.text ?? ""}`);
      }
    } else if (turn.isError || FAILED.test(turn.text)) {
      flag("tool-error", turn);
    }
  }
  return issues;
}

export function summarize(issues) {
  const byCategory = {}, byKind = {}, examples = {};
  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1;
    examples[issue.kind] = [...(examples[issue.kind] ?? []), issue].slice(0, 5);
  }
  return { byCategory, byKind, examples };
}
