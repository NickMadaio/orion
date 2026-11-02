// What ORION already knows that makes a sender matter (wave 14, 2026-11-02): the people and courses in his knowledge graph
// (orion-controlled/knowledge-graph.json, built by orion-knowledge from his notes and calendar). A professor or TA is a person node
// whose subtitle or facts say so, or a course's fact that names one ("taught by Prof. Smith"). Read-only and total: a missing or
// broken graph is no people.
import { join } from "node:path";
import { readJson } from "../awareness/io.mjs";
import { GMAIL_ACCOUNT } from "../gmail-status.mjs";

const ROLE = /\b(?:prof(?:essor)?|lecturer|instructor|teaching assistant|ta|tutor|module leader|course leader)\b/i;
const TAUGHT_BY = /\b(?:[Tt]aught by|[Pp]rofessor|[Pp]rof\.?|[Ll]ecturer|[Ii]nstructor|TA is|[Tt]utor is)\s+((?:Dr\.?\s+|Prof\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;

/** { people: [{ name, role? }], courses: ["CS2100", …] } from the graph. */
export function knowledgeContext(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const people = nodes.filter((n) => n?.type === "person" && n.id !== "person:self" && n.label).map((n) => {
    const text = [n.subtitle, ...(n.facts ?? []).map((f) => f?.text)].filter(Boolean).join(" ");
    return { name: String(n.label), ...(ROLE.test(text) ? { role: "teacher" } : {}) };
  });
  const teachers = nodes.filter((n) => n?.type === "course").flatMap((n) => (n.facts ?? []).flatMap((f) => [...String(f?.text ?? "").matchAll(TAUGHT_BY)].map((m) => m[1])))
    .map((name) => ({ name: name.replace(/^(?:dr|prof)\.?\s+/i, ""), role: "teacher" }));
  const courses = nodes.filter((n) => n?.type === "course" && /^[A-Za-z]{2,5}\s?\d{3,4}$/.test(String(n.label ?? "").trim())).map((n) => String(n.label).replace(/\s+/g, "").toUpperCase());
  return { people: [...people, ...teachers], courses: [...new Set(courses)] };
}

export const readKnowledgeContext = (dir) => knowledgeContext(readJson(join(dir, "knowledge-graph.json")));

/** His own addresses: the Gmail account plus any he added (mail-prefs.json "me"), so his own reply is never "from a person". */
export const nickAddresses = (extra = []) => [GMAIL_ACCOUNT, ...extra].map((a) => String(a).toLowerCase());
