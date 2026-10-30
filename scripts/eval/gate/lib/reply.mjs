// Port of GatewayClient's output handling: stripANSI, the forgiving JSON payload search, extractReply.
// The app shows exactly extractReply's trimmed text (AppState.append does no further cleaning).
import { trimAll } from "./text.mjs";

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
export const stripANSI = (s) => s.replace(ANSI, "");

const blank = (s) => typeof s === "string" && trimAll(s) === "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function extractReply(payload) {
  const scopes = [];
  if (isObj(payload.result)) scopes.push(payload.result);
  scopes.push(payload);
  if (isObj(payload.data)) scopes.push(payload.data);
  for (const scope of scopes) {
    const parts = [];
    for (const key of ["payloads", "messages", "outputs"]) {
      if (!Array.isArray(scope[key])) continue;
      for (const item of scope[key]) {
        if (isObj(item) && typeof item.text === "string" && !blank(item.text)) parts.push(item.text);
        else if (typeof item === "string" && !blank(item)) parts.push(item);
      }
      if (parts.length) break;
    }
    if (parts.length) return trimAll(parts.join("\n\n"));
    for (const key of ["text", "reply", "message", "content", "output"]) {
      const v = scope[key];
      if (typeof v === "string" && !blank(v)) return trimAll(v);
      if (isObj(v) && typeof v.text === "string" && !blank(v.text)) return trimAll(v.text);
    }
  }
  return "";
}

/** The payload from raw stdout, the way `ask` finds it (whole text first, then lines from the last). */
export function findPayload(stdoutRaw) {
  const stdout = trimAll(stripANSI(stdoutRaw));
  for (const candidate of [stdout, ...stdout.split("\n").reverse()]) {
    const t = trimAll(candidate);
    if (!t.startsWith("{")) continue;
    try { const o = JSON.parse(t); if (isObj(o)) return { payload: o, stdout }; } catch { /* next */ }
  }
  return { payload: null, stdout };
}
