/*
 Turn a Gmail thread into something worth putting in Orion's context.

 WHY THIS FILE EXISTS

 Both mail wrappers used to print `gog gmail thread get --json` verbatim: the
 whole thread, every message, entire bodies, headers, label ids, size estimates.
 One `in:inbox` search returned roughly FIFTEEN THOUSAND characters across five
 emails, and the large majority of it was legal footer -- unsubscribe blocks,
 privacy policies, "this message is intended only for", and quoted-printable
 artefacts (`=C2=A0`, `=E2=80=99`) left over from the transport encoding.

 That is not a formatting complaint. Orion's whole instruction file is capped at
 20,000 characters. A single mail search could therefore push more than his
 entire set of standing instructions out of the window, and the thing it evicted
 them for was a Staples job alert's unsubscribe link. Checking his email made him
 worse at his job.

 What a person wants when they say "who emailed me" is: who, about what, when,
 roughly what it says. That is what `summarise` returns. A full body is still
 available, but it has to be ASKED for -- `--full`, or a fetch by thread id --
 because the cost of returning it by default is paid out of his memory.
*/

/** Bodies are capped even when explicitly requested. See CAP_NOTE. */
const BODY_CAP = 2000;

/**
 * Footer markers. The first one that appears past `MIN_BODY` ends the body.
 *
 * Ordered by nothing in particular -- the earliest MATCH wins, not the first
 * pattern. The offset floor matters: "unsubscribe" occasionally appears in the
 * first line of a genuinely short message, and cutting there would leave
 * nothing at all.
 */
const FOOTER_MARKERS = [
  /\bunsubscribe\b/i,
  /\bmanage (your )?(email )?(preferences|settings|subscriptions?)\b/i,
  /\bprivacy (policy|notice)\b/i,
  /\bterms of (service|use)\b/i,
  /\byou (are|'re) receiving this\b/i,
  /\bto stop receiving\b/i,
  /\bthis (e-?mail|message) (was sent to|is intended (only )?for)\b/i,
  /\bdo not (forward|reply to) this (e-?mail|message)\b/i,
  /\ball rights reserved\b/i,
  /\bview (this )?(e-?mail )?in (your )?browser\b/i,
  /\bhelp cent(er|re)\b/i,
  /©\s*\d{4}/,
  /\bsent from my i(phone|pad)\b/i,
];

/**
 * A footer marker this close to the start is part of the message, not a footer.
 *
 * Set low on purpose. The floor exists only to stop "can you unsubscribe me
 * from that list?" being cut down to nothing; it is not a minimum message
 * length. At 160 it swallowed the footer of every short newsletter and every
 * brief personal note that happened to carry one, which is most of them.
 */
const MIN_BODY = 40;

const CAP_NOTE = "… [body truncated]";

/**
 * Undo quoted-printable.
 *
 * gog decodes most of it, but not all -- forwarded mail and some senders arrive
 * with the raw form intact, and `it=E2=80=99s` reaching Nick as literal text is
 * how this was noticed. Soft line breaks (`=` at end of line) come first,
 * because they can split an escape sequence across two lines.
 *
 * Decoded as a byte sequence rather than per-escape: `=E2=80=99` is one UTF-8
 * character in three escapes, and decoding them individually produces three
 * pieces of mojibake instead of an apostrophe.
 */
export function decodeQuotedPrintable(text) {
  if (typeof text !== "string" || !text.includes("=")) return text ?? "";

  /*
   Only decode text that shows evidence of being quoted-printable at all.

   gog decodes most bodies before we see them, so the usual input here is
   ORDINARY TEXT — and ordinary text contains equals signs. `=50` is valid
   quoted-printable for "P", so decoding unconditionally turned a price list
   reading "the total =50 units" into "the total P units". Silently changing the
   content of his mail is exactly the class of bug being fixed elsewhere in this
   pass, so it does not get introduced here.

   Real quoted-printable always carries one of these: a soft line break, an
   escape for a byte above 0x7F (every accented character and every smart quote
   needs one), or `=3D` for a literal equals. None of the three appears by
   accident in decoded prose.
  */
  if (!/=\r?\n|=[89A-Fa-f][0-9A-Fa-f]|=3D/.test(text)) return text;

  const unfolded = text.replace(/=\r?\n/g, "");
  if (!/=[0-9A-Fa-f]{2}/.test(unfolded)) return unfolded;

  return unfolded.replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Buffer.from(
      run
        .split("=")
        .filter(Boolean)
        .map((pair) => Number.parseInt(pair, 16)),
    );
    const decoded = bytes.toString("utf8");
    // A run that does not decode cleanly was probably not quoted-printable at
    // all (a literal "=3" in a formula, say). Leave it exactly as it was.
    return decoded.includes("�") ? run : decoded;
  });
}

/**
 * Strip the parts of a body that no human reads.
 *
 * Truncating at a footer marker rather than deleting matched lines: a footer is
 * a TAIL, and everything after the first marker is reliably more footer. Line
 * matching left orphaned fragments of address blocks behind.
 */
export function stripBoilerplate(body) {
  const decoded = decodeQuotedPrintable(body ?? "");

  const cutAt = FOOTER_MARKERS.reduce((earliest, marker) => {
    const found = decoded.search(marker);
    if (found < MIN_BODY) return earliest;
    return earliest === -1 ? found : Math.min(earliest, found);
  }, -1);

  const trimmed = cutAt === -1 ? decoded : decoded.slice(0, cutAt);

  return trimmed
    // `--sanitize-content` replaces every link with this. A paragraph that is
    // nothing but removed links is not information.
    .replace(/(\[url removed\]\s*)+/gi, " ")
    /*
     Preview padding. Marketing senders append hundreds of invisible characters
     -- combining grapheme joiners, zero-width spaces, soft hyphens -- after the
     first line, to push their own copy out of the inbox preview. Gmail’s snippet
     keeps them, so a two-line ad arrived as two lines followed by eighty
     repetitions of nothing. Invisible on screen, pure cost in context.
    */
    .replace(/[\u00AD\u034F\u200B-\u200F\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Cap a cleaned body, saying so rather than trailing off silently. */
export function capBody(body, cap = BODY_CAP) {
  if (body.length <= cap) return body;
  return `${body.slice(0, cap).trimEnd()}${CAP_NOTE}`;
}

/** `Indeed <donotreply@match.indeed.com>` -> `Indeed (donotreply@…)`. */
function readableSender(from) {
  const raw = String(from ?? "").trim();
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (!match) return raw || "unknown sender";
  const name = match[1].replace(/^["']|["']$/g, "").trim();
  return name ? `${name} (${match[2]})` : match[2];
}

/**
 * One thread, reduced to the five things a person asked for.
 *
 * Accepts either shape gog hands back: the search result (already flat) or a
 * `thread get` payload (nested, and the only one carrying a snippet).
 */
export function summarise(payload) {
  const thread = payload?.thread ?? payload;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  // The newest message is what "what about?" means for a thread with a reply
  // chain; the first is the one Gmail's own search result describes.
  const newest = messages.length > 0 ? messages[messages.length - 1] : null;
  const headers = newest?.headers ?? {};

  const labels = newest?.labelIds ?? thread?.labels ?? [];

  return {
    threadId: thread?.id ?? payload?.id ?? null,
    from: readableSender(headers.from ?? thread?.from ?? payload?.from),
    subject: String(headers.subject ?? thread?.subject ?? payload?.subject ?? "(no subject)").trim(),
    date: String(thread?.date ?? payload?.date ?? headers.date ?? "").trim(),
    snippet: stripBoilerplate(newest?.snippet ?? "").slice(0, 220),
    unread: Array.isArray(labels) && labels.includes("UNREAD"),
    messageCount: thread?.messageCount ?? messages.length ?? 1,
  };
}

/** The default answer: a few lines per thread, nothing a footer put there. */
export function renderSummaries(summaries, { query } = {}) {
  if (summaries.length === 0) {
    return query ? `No mail matched ${JSON.stringify(query)}.` : "No mail found.";
  }

  const header = query
    ? `${summaries.length} result${summaries.length === 1 ? "" : "s"} for ${JSON.stringify(query)}`
    : `${summaries.length} message${summaries.length === 1 ? "" : "s"}`;

  const blocks = summaries.map((item, index) => {
    const flags = [item.unread ? "unread" : null, item.messageCount > 1 ? `${item.messageCount} messages` : null]
      .filter(Boolean)
      .join(", ");
    return [
      `${index + 1}. ${item.subject}`,
      `   from ${item.from}`,
      `   ${item.date}${flags ? `  (${flags})` : ""}`,
      item.snippet ? `   ${item.snippet}` : null,
      `   thread: ${item.threadId}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    header,
    "",
    ...blocks,
    "",
    "Full text of one of these: orion-gmail-search --thread <thread id>",
  ].join("\n");
}

/** Everything, when Nick actually asked for everything. */
export function renderFull(payload) {
  const thread = payload?.thread ?? payload;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  if (messages.length === 0) return "That thread has no readable messages.";

  const parts = messages.map((message, index) => {
    const headers = message?.headers ?? {};
    const body = capBody(stripBoilerplate(message?.body ?? ""));
    return [
      messages.length > 1 ? `--- message ${index + 1} of ${messages.length} ---` : null,
      `From:    ${readableSender(headers.from)}`,
      `Subject: ${String(headers.subject ?? "(no subject)").trim()}`,
      `Date:    ${String(headers.date ?? "").trim()}`,
      "",
      body || "(no readable body)",
    ]
      .filter((line) => line !== null)
      .join("\n");
  });

  return [`thread: ${thread?.id ?? "?"}`, "", parts.join("\n\n")].join("\n");
}
