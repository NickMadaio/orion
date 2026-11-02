/*
 A person he names while answering ORION is kept (w16 a-reply, 2026-11-02 23:04 live: "im at Avery's place. shes a friend … that i went to
 wales with"). Only the fact readPersonMention builds (a name, a relation, a trip shared) goes through orion-brain learn --own, ORION's
 own provenance, so it can be edited or unlearned later. The reply says what was kept; a save that fails changes nothing and says nothing.
*/
import type { FlowResult } from "./schedule-flow.js";
import type { KnowledgeRun } from "./knowledge-run.js";
import { readPersonMention } from "./plan-check-story.js";

export type PersonLearned = { flow: FlowResult; call?: { canonical: string; stdout: string; exit: number } };

const withLine = (flow: FlowResult, line: string): FlowResult =>
  flow.outcome === "say" ? { ...flow, text: `${flow.text} ${line}` }
  : flow.outcome === "done" && flow.reply ? { ...flow, reply: `${flow.reply} ${line}` }
  : flow;

/** Keeps the person he named, if any, and adds one line to the reply saying so. */
export async function learnPersonAfter(flow: FlowResult, message: string, run: KnowledgeRun): Promise<PersonLearned> {
  const mention = readPersonMention(message);
  if (!mention) return { flow };
  const args = ["learn", "--own", mention.name, "people", mention.fact];
  const out = await run("orion-brain", args).catch(() => ({ stdout: "", code: 1 }));
  const call = { canonical: `exec orion-brain ${args.map((a) => JSON.stringify(a)).join(" ")}`, stdout: out.stdout, exit: out.code };
  return out.code === 0 ? { flow: withLine(flow, `I'll remember ${mention.echo}.`), call } : { flow, call };
}
