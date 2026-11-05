/*
 Carries out one turn of the save-a-place thread (place-save.ts reads it). The one writer is `orion-awareness place set <id> --here --name N`; the reply is built
 from reading the places back (`place list`), never from what was asked for.
*/
import { placeAskName, placeDeclined, placeFailed, placeId, placeSaved, type PlacePending, type PlaceReply } from "./place-save.js";

export type PlaceRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type PlaceOutcome = { text: string; calls: string[]; outputs: string[]; pending?: PlacePending };

async function save(name: string, run: PlaceRun): Promise<PlaceOutcome> {
  const id = placeId(name);
  const set = ["place", "set", id, "--here", "--name", name, "--kind", "other", "--source", "nick-confirmed"];
  const calls = [`exec orion-awareness ${set.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`], outputs: string[] = [];
  const r = await run(set).catch(() => ({ stdout: "", code: 1 }));
  outputs.push(r.stdout.trim().slice(0, 300));
  if (r.code !== 0) return { text: placeFailed(r.stdout.trim().split("\n").at(-1) || "the location is not available"), calls, outputs };
  const list = await run(["place", "list"]).catch(() => ({ stdout: "", code: 1 }));
  calls.push("exec orion-awareness place list"); outputs.push(list.stdout.trim().slice(0, 600));
  const saved = list.code === 0 && list.stdout.split("\n").some((l) => l.split("\t")[0] === id);
  return saved ? { text: placeSaved(name), calls, outputs } : { text: placeFailed("it did not show up when I read the places back"), calls, outputs };
}

/** His reply, the name already known (from the pending item or the question), and the runner. */
export async function runPlaceTurn(reply: PlaceReply, known: { name?: string; stage?: PlacePending["stage"] }, run: PlaceRun, now: number): Promise<PlaceOutcome> {
  if (reply.kind === "no") return { text: placeDeclined, calls: [], outputs: [] };
  if (reply.kind === "name") return save(reply.name, run);
  if (known.name) return save(known.name, run);
  return { text: placeAskName, calls: [], outputs: [], pending: { stage: "name", at: now } };
}
