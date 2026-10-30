import { COMPONENTS } from "./config.mjs";

const LABEL = { ollama: "Ollama", app: "Orion app", link: "Phone link", gateway: "Gateway" };

function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d`;
}

/** Human-readable status: what is up, what is down, and since when. */
export function formatStatus(state, now) {
  const lines = COMPONENTS.map((c) => {
    const comp = state.components[c];
    const name = LABEL[c].padEnd(11);
    if (comp.status === "down") {
      const tail = comp.alertedDown ? ", alerted" : "";
      return `${name} DOWN  since ${new Date(comp.since).toISOString()} (${ago(now - comp.since)}); ${comp.attempts} relaunch attempt(s)${tail}`;
    }
    const since = comp.since ? `since ${new Date(comp.since).toISOString()} (${ago(now - comp.since)})` : "(no history yet)";
    return `${name} up    ${since}`;
  });
  return (state.pendingWarm ? [...lines, "Models      warm-up pending"] : lines).join("\n");
}
