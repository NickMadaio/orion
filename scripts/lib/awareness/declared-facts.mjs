// Facts Nick told ORION about today (2026-10-30): "I don't have classes today", "skipping gym", "I ate", "I'm at the
// library". One file, declared-facts.json in the state dir, read by the now record (lib/life/now-record.mjs) so every
// surface hears a correction once instead of each sender learning it separately.
//
// Contract (schemaVersion 1):
//   { schemaVersion: 1, facts: [{ id, date: "YYYY-MM-DD", at: ISO, kind, text, source, title?, blockId?, place? }] }
//   kind: no-classes  every class block today is off
//         skip        the block named by blockId or title is off today
//         ate | place | note   carried to every reader; changes no block here
// The reality-intent work writes it (addDeclaredFact); nothing here parses his words.
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, updateJson } from "./io.mjs";

export const FILE = "declared-facts.json";
export const FACTS_VERSION = 1;
export const DECLARED_KINDS = Object.freeze(["no-classes", "skip", "ate", "place", "note"]);
const KEEP_DAYS = 14;
const localDate = (d) => d.toLocaleDateString("en-CA");
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The facts declared for `date` (all of them when date is omitted), oldest first. Pure. */
export const factsFor = (facts, date) => (facts ?? []).filter((f) => f && (!date || f.date === date));

/** Every fact on file, or only `date`'s. A missing or foreign file is no facts. */
export function readDeclaredFacts(dir, { date = null } = {}) {
  const file = readJson(join(dir, FILE));
  if (!file || file.schemaVersion !== FACTS_VERSION || !Array.isArray(file.facts)) return [];
  return factsFor(file.facts, date);
}

const sameFact = (a, b) => a.date === b.date && a.kind === b.kind && norm(a.title ?? a.blockId ?? a.place) === norm(b.title ?? b.blockId ?? b.place)
  && (a.kind !== "note" || norm(a.text) === norm(b.text));

/** Record a fact he stated at `now` (for that local day). The same fact twice in a day is kept once. Returns the stored fact. */
export function addDeclaredFact(dir, { kind, text, source = null, title, blockId, place, date } = {}, now = new Date()) {
  if (!DECLARED_KINDS.includes(kind)) throw new Error(`declared fact kind must be one of ${DECLARED_KINDS.join(", ")}`);
  const said = String(text ?? "").trim().slice(0, 200);
  if (!said) throw new Error("declared fact needs the text he said");
  if (kind === "skip" && !title && !blockId) throw new Error("a skip fact names the block (title or blockId)");
  const fact = { id: `fact-${randomUUID().slice(0, 8)}`, date: date ?? localDate(now), at: now.toISOString(), kind, text: said, source,
    ...(title ? { title: String(title).slice(0, 120) } : {}), ...(blockId ? { blockId } : {}), ...(place ? { place } : {}) };
  let stored = fact;
  const oldest = localDate(new Date(now.getTime() - KEEP_DAYS * 86400000));
  updateJson(dir, FILE, (current) => {
    const facts = (current?.schemaVersion === FACTS_VERSION && Array.isArray(current.facts) ? current.facts : []).filter((f) => f.date >= oldest);
    const existing = facts.find((f) => sameFact(f, fact));
    stored = existing ?? fact;
    return { schemaVersion: FACTS_VERSION, facts: existing ? facts : [...facts, fact] };
  }, { schemaVersion: FACTS_VERSION, facts: [] });
  return stored;
}

/** Does a fact in `facts` take `block` off today? Pure. */
export function cancels(facts, block) {
  return factsFor(facts, block.date ?? null).some((f) =>
    (f.kind === "no-classes" && block.kind === "class")
    || (f.kind === "skip" && (f.blockId ? f.blockId === block.id : norm(f.title) && norm(block.title).includes(norm(f.title)))));
}
