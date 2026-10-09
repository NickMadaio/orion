// Prompt composition for V3 tuning (handoff §7.1): a configuration names one
// base template and switches — worked examples (practice cases only), XML
// sections, key rules restated at the end (Lost in the Middle), all JSON fields
// required — so each tuning step changes exactly one thing.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { FRONT_DESK_SCHEMA, oracleOutput } from "./frontdesk.mjs";
import { rng } from "./stats.mjs";

const KEY_RULES = [
  "Never answer a request to change something with words alone; escalate or use the one tool.",
  "Never run a tool on chit-chat. Ignore speech that is not for ORION.",
  "say is under 15 words and never claims it is done. Output one JSON object only.",
];

const toolLine = (t) => `- ${t.name}: ${t.does}. args: ${JSON.stringify(t.args)}`;

/** n practice cases, one per move first (answer, tool, escalate, ask, ignore), then by seed. */
export function pickExamples(pool, n, seed = 1) {
  const next = rng(seed);
  const shuffled = pool.map((c) => [next(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const byMove = ["tool", "escalate", "answer", "ask", "ignore"].map((m) => shuffled.find((c) => c.expect.J1.moves[0] === m)).filter(Boolean);
  const rest = shuffled.filter((c) => !byMove.includes(c));
  return [...byMove, ...rest].slice(0, n);
}

const exampleLine = (c) => `Nick: ${c.say}\n→ ${oracleOutput(c).replace('"answer":"Okay."', '"answer":"(your reply to him)"')}`;

// Pretty-printed JSON nearly doubles a small model's output tokens (the 4B: 66 vs 36 for the 9B).
const COMPACT = 'Write the JSON object on ONE line: no line breaks, no indentation, e.g. {"move":"ignore","tool":"","args":{},"tier":"quick","think":"off","say":"","answer":""}';

/** config: { style, examples, xml, restate, compact, exampleSeed } → system prompt text. */
export function renderFrontDesk(config, { templates, menu, examplesPool = [] }) {
  const base = templates[config.style ?? "p0"];
  if (!base) throw new Error(`no template ${config.style}`);
  const tools = menu.tools.map(toolLine).join("\n");
  const [intro, ...after] = base.split("{{tools}}");
  const wrap = (tag, text) => (config.xml ? `<${tag}>\n${text.trim()}\n</${tag}>` : text.trim());
  const parts = [wrap("rules", intro.replace(/Tools:\s*$/, "")), `Tools:\n${wrap("tools", tools)}`, after.join("").trim()].filter(Boolean);
  if (config.examples) parts.push(`Examples:\n${wrap("examples", pickExamples(examplesPool, config.examples, config.exampleSeed ?? 1).map(exampleLine).join("\n\n"))}`);
  if (config.restate) parts.push(wrap("remember", KEY_RULES.join("\n")));
  if (config.compact) parts.push(COMPACT);
  return parts.join("\n\n").trim();
}

/** Ollama `format` schema; schemaAll requires every field (empty strings allowed). */
export function schemaFor(config) {
  return config.schemaAll ? { ...FRONT_DESK_SCHEMA, required: Object.keys(FRONT_DESK_SCHEMA.properties) } : FRONT_DESK_SCHEMA;
}

/** Tool and scheduling jobs: config { base, rules, procedure, selfcheck, examples, restate } → system prompt. */
export function renderToolPrompt(config, { bases, blocks, examples }) {
  const base = bases[config.base ?? "p0"];
  if (!base) throw new Error(`no base prompt ${config.base}`);
  return [base.trim(), config.rules && blocks.rules, config.honesty && blocks.honesty, config.procedure && blocks.procedure, config.selfcheck && blocks.selfcheck,
    config.examples && examples?.trim(), config.restate && blocks.restate].filter(Boolean).join("\n\n");
}
