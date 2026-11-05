/*
 "open the mouse mapper and whats the weather tomorrow" (w20 round 6, live gate 4 #98): the mouse route owned the whole message, said "Here it is." and the
 weather was dropped. The mouse clause is run by code and said first; the question is what is left for the rest of ORION (the same split as an open).
 Only a mouse turn that needs nothing more from him: a button and an action both named, a popup, a status, a wheel / games / shortcuts switch.
*/
import { THEN_ASK } from "./chat-asks.js";
import { readMouseTurn, type MouseTurn } from "./mouse-read.js";

const COMPLETE = (t: MouseTurn): boolean => {
  switch (t.kind) {
    case "setup": return t.again === true;
    case "status": case "wheel": case "games": case "shortcuts": case "passthrough": return true;
    case "set": return !!t.button && !!t.action;
    case "clear": return !!t.button;
    default: return false;
  }
};

export function splitLeadMouse(message: string): { turn: MouseTurn; rest: string } | null {
  const text = message.trim();
  if (text.length > 240) return null;
  for (const m of text.matchAll(new RegExp(THEN_ASK.source, "gi"))) {
    const head = text.slice(0, m.index).trim().replace(/[.,;!]+$/, ""); const rest = text.slice((m.index ?? 0) + m[0].length).trim();
    const turn = rest.length >= 3 ? readMouseTurn(head) : null;
    if (turn && COMPLETE(turn) && !readMouseTurn(rest)) return { turn, rest };
  }
  return null;
}
