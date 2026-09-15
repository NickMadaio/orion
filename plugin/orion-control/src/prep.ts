/*
 PHASE 61 — prep cards, and the sentence that shapes them.

     Use temporary context when possible.
     Do not convert every relevant document into permanent ORION memory.

 That is the whole design constraint and it is the right one. The obvious way
 to build "assemble everything relevant before a meeting" is to read a pile of
 material and remember it, and an assistant that does that has, after a month,
 a memory full of other people's half-relevant email. Recall then returns it
 forever, weighted the same as things Nick actually told it.

 So a prep card WRITES NOTHING. It reads four sources that are already gated
 and already read-only, returns their answers into one turn, and ends. If
 something in it is worth keeping, that is a separate deliberate act through
 `orion-note`, which requires an `--epistemic` value and so cannot happen by
 accident.

 ## Why the search terms come from the event and not from a model

 The keywords are extracted mechanically from the event's own title and
 attendees. Letting the model choose them would make the card's contents depend
 on a guess nobody can audit, and would open a small injection surface: an
 event title is attacker-controllable if anyone can put something on the
 calendar, and "search my mail for X" chosen by a model reading that title is a
 worse position than a fixed extraction from it.

 ## What is deliberately absent

 The manifest lists six ingredients: threads, notes, tasks, documents, people,
 open questions. Five are built. DOCUMENTS is not, and it is not an oversight:
 there is no document store on this machine to search, and the nearest thing --
 an unbounded filesystem scan for filenames matching an event title -- is both
 useless and a way to read whatever Orion happens to be pointed at. Recorded
 rather than faked.
*/

/** Words too common to search on. Kept short: a long list is a tuning problem. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "to", "on", "at", "in",
  "meeting", "call", "sync", "chat", "catch", "up", "review", "session", "1:1",
  "weekly", "monthly", "daily", "standup", "check", "check-in", "re", "fwd",
]);

/**
 * Search terms from an event, mechanically.
 *
 * Longest words first, because a long word is a more specific search than a
 * short one, and bounded to three because a four-term search of somebody's
 * mail is a search that returns everything.
 */
export function termsFromEvent(title: string, attendees: readonly string[] = []): string[] {
  const words = String(title ?? "")
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const names = attendees
    .map((attendee) => String(attendee).split("@")[0]?.replace(/[._-]+/g, " ") ?? "")
    .flatMap((name) => name.split(/\s+/))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word.toLowerCase()));
  return [...new Set([...words, ...names.map((n) => n.toLowerCase())])]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

export interface PrepSection {
  label: string;
  /** ok | empty | unavailable. An unavailable source is never shown as empty. */
  status: "ok" | "empty" | "unavailable";
  lines: string[];
  reason?: string;
}

/**
 * Render the card.
 *
 * A section that could not be read says so. That is the same rule
 * `orion-standing` is built around, and it exists because "no relevant email"
 * and "I could not search your email" look identical to a reader and mean
 * opposite things — one is reassuring and one means the card is incomplete.
 */
export function renderCard(
  event: { title: string; when: string; attendees: readonly string[] },
  sections: readonly PrepSection[],
): string {
  const out: string[] = [
    `${event.title} — ${event.when}`,
    event.attendees.length ? `with ${event.attendees.join(", ")}` : "",
    "",
  ].filter((line, index) => line !== "" || index === 2);

  for (const section of sections) {
    if (section.status === "unavailable") {
      out.push(`${section.label}: could not read — ${section.reason ?? "unknown"}`);
      out.push("  (that is a blind spot in this card, not an absence of material)");
    } else if (section.status === "empty") {
      out.push(`${section.label}: nothing found`);
    } else {
      out.push(`${section.label}:`);
      for (const line of section.lines.slice(0, 6)) out.push(`  ${line}`);
      if (section.lines.length > 6) out.push(`  (+${section.lines.length - 6} more)`);
    }
    out.push("");
  }

  out.push(
    "Nothing here was saved. If something is worth keeping, say so and I will write it down deliberately.",
  );
  return out.join("\n");
}
