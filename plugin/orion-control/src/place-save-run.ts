/*
 Carries out one turn of the save-a-place thread (place-save.ts reads it). The one writer is `orion-awareness place set <id> --here --name N`; the reply is built
 from reading the places back (`place list`), never from what was asked for.
*/
import { placeAliased, placeAskName, placeDeclined, placeFailed, placeId, placeSaved, type PlacePending, type PlaceReply } from "./place-save.js";

export type PlaceRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type PlaceOutcome = { text: string; calls: string[]; outputs: string[]; pending?: PlacePending };

async function save(name: string, run: PlaceRun, alias?: string, now = 0): Promise<PlaceOutcome> {
  const id = placeId(name);
  const set = ["place", "set", id, "--here", "--name", name, "--kind", "other", "--source", "nick-confirmed", ...(alias ? ["--alias", alias] : [])];
  const calls = [`exec orion-awareness ${set.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`], outputs: string[] = [];
  const r = await run(set).catch(() => ({ stdout: "", code: 1 }));
  outputs.push(r.stdout.trim().slice(0, 300));
  if (r.code !== 0) return { text: placeFailed(r.stdout.trim().split("\n").at(-1) || "the location is not available"), calls, outputs };
  const list = await run(["place", "list"]).catch(() => ({ stdout: "", code: 1 }));
  calls.push("exec orion-awareness place list"); outputs.push(list.stdout.trim().slice(0, 600));
  const row = list.code === 0 ? list.stdout.split("\n").find((l) => l.split("\t")[0] === id) : undefined;
  // The read-back says what the file holds: the alias only when it is really there.
  const held = alias && (row?.split("\t")[5] ?? "").split(",").some((a) => a.trim().toLowerCase() === alias.toLowerCase()) ? alias : undefined;
  return row ? { text: placeSaved(name, held), calls, outputs, pending: { stage: "saved", name, id, at: now } } : { text: placeFailed("it did not show up when I read the places back"), calls, outputs };
}

/** His reply, the name already known (from the pending item or the question), and the runner. */
export async function runPlaceTurn(reply: PlaceReply, known: { name?: string; id?: string; stage?: PlacePending["stage"] }, run: PlaceRun, now: number): Promise<PlaceOutcome> {
  if (reply.kind === "no") return { text: placeDeclined, calls: [], outputs: [] };
  if (reply.kind === "alias") return addAlias(reply.alias, known, run, now);
  if (reply.kind === "name") return save(reply.name, run, reply.alias, now);
  if (known.name) return save(known.name, run, undefined, now);
  return { text: placeAskName, calls: [], outputs: [], pending: { stage: "name", at: now } };
}

/** "call it spit" after a save: `place alias <id> add X`, said only after the places file shows it. */
async function addAlias(alias: string, known: { name?: string; id?: string }, run: PlaceRun, now: number): Promise<PlaceOutcome> {
  if (!known.id || !known.name) return { text: placeFailed("I don't know which place you mean"), calls: [], outputs: [] };
  const add = ["place", "alias", known.id, "add", alias];
  const calls = [`exec orion-awareness ${add.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`], outputs: string[] = [];
  const r = await run(add).catch(() => ({ stdout: "", code: 1 }));
  outputs.push(r.stdout.trim().slice(0, 300));
  if (r.code !== 0) return { text: placeFailed(r.stdout.trim().split("\n").at(-1) || "it didn't take"), calls, outputs, pending: { stage: "saved", name: known.name, id: known.id, at: now } };
  const list = await run(["place", "list"]).catch(() => ({ stdout: "", code: 1 }));
  calls.push("exec orion-awareness place list"); outputs.push(list.stdout.trim().slice(0, 600));
  const row = list.stdout.split("\n").find((l) => l.split("\t")[0] === known.id);
  const held = (row?.split("\t")[5] ?? "").split(",").some((a) => a.trim().toLowerCase() === alias.toLowerCase());
  return held ? { text: placeAliased(known.name, alias), calls, outputs } : { text: placeFailed("it did not show up when I read the places back"), calls, outputs };
}
