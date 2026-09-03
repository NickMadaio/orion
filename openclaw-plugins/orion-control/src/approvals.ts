import { randomBytes, randomInt } from "node:crypto";
import { hostname } from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 THE HUMAN, PUT BACK INTO THE APPROVAL GATE.

 ## What was actually happening

 `validator.ts` refuses an action marked `approvalRequired` unless the step
 carries `approval.canonicalHash` equal to a hash the validator computes from
 the action, its arguments and the working context. That binding is real and
 worth keeping: it means an approval for one message cannot be replayed against
 a different one.

 It is also, on its own, satisfiable by the thing it is meant to restrain. The
 first call returns `needs_approval` together with the canonical hash. The
 model copies that hash into a second call. The gate opens. No person is
 consulted at any point, and the transcript reads exactly like a real approval:
 a refusal, then a grant, then the action. Phase 49 names this in one line --
 "the agent must not be able to satisfy an approval gate by supplying the hash
 itself" -- and it was true of this system when that line was written.

 The same hole existed a second time, in `orion-remote`: its `approve` verb
 resolves a pending item, `orion-remote` is on Orion's exec allowlist, and a
 direct `orion-remote handle` call defaults its sender to `local`, which is an
 allowed sender. Orion could answer his own approval requests over the channel
 built for Nick to answer them.

 ## The shape of the fix

 Two files in two places, and the whole argument is which process may write
 which one:

   TICKET   minted by the plugin when a gate stops. Says what is waiting, in
            words, with an id a person can read out. Orion may read these --
            he has to, to tell Nick the id.
   GRANT    written ONLY by `orion-approve`, or by `orion-remote` acting on a
            message from a non-local allowlisted sender. Says that a person
            said yes to one exact canonical hash, once.

 ## Where the boundary really is, stated honestly

 Orion runs as Nick's user. There is no kernel privilege boundary here and
 pretending otherwise would be worse than having none. The boundary is that
 NOTHING ORION CAN INVOKE WRITES TO THE GRANT DIRECTORY:

   · no `ACTION_CATALOG` execution kind can produce a path there -- the mutable
     roots are the two workspaces and the Desktop, and this is under
     `~/.openclaw`;
   · `orion-approve` is deliberately absent from the exec allowlist, so the
     call is denied rather than prompted (`ask: off`, `askFallback: deny`);
   · `orion-approve` is in `FORBIDDEN_SCRIPTS`, so the self-repair engine will
     not edit it -- the thing that vouches for changes cannot vouch for a
     change to itself;
   · `orion-remote` refuses `approve` from the `local` sender, which is the
     only sender an exec call can present.

 Each of those is checked by a test, because a boundary made of four claims is
 only as good as the one nobody re-checks.

 ## Single use, bound, and short

 A grant carries the canonical hash AND the nonce from its ticket, and is moved
 to `used/` the moment it is spent. Phase 45 already learned this on the remote
 job gate: a resent identifier is indistinguishable from a captured one, so the
 gate must never have to guess which it is holding.
*/

/** Unambiguous when read aloud or typed: no 0/O, no 1/I/L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TICKET_RE = /^A-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/**
 * How a person may write the id back.
 *
 * Phase 49: "make every authorization check satisfiable by the name a person
 * would actually type". So `a-7f3k`, `A-7F3K` and a bare `7F3K` are the same
 * ticket, and nothing here invents a token nobody would write.
 */
export function normalizeTicketId(raw: string): string | null {
  const compact = String(raw ?? "").trim().toUpperCase().replace(/^A-/, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(compact) ? `A-${compact}` : null;
}

const mintId = (): string =>
  `A-${Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

export interface ApprovalTicket {
  id: string;
  canonicalHash: string;
  /** A random value the grant must echo, so a grant cannot be pre-written. */
  nonce: string;
  action: string;
  /** What Nick is being asked to allow, in his language rather than JSON. */
  summary: string;
  context: string;
  mintedAt: string;
  expiresAt: string;
  /**
   * Which Mac this approval is for.
   *
   * Phase 49 lists target device alongside capability, arguments hash,
   * expiration and nonce, and it is not ceremony: the approval directory is
   * syncable, and an approval that followed a file to another machine would be
   * an approval for an action nobody there asked for.
   */
  deviceId: string;
}

export interface ApprovalGrant {
  id: string;
  canonicalHash: string;
  nonce: string;
  grantedAt: string;
  /** Which human channel carried the yes. Never "orion", never "local". */
  grantedBy: string;
}

/** Long enough to walk to a terminal, short enough that a stale yes is gone. */
export const TICKET_TTL_MS = 15 * 60 * 1000;

export interface ApprovalPaths {
  tickets: string;
  grants: string;
  used: string;
}

export function approvalPaths(root: string): ApprovalPaths {
  return {
    tickets: path.join(root, "tickets"),
    grants: path.join(root, "grants"),
    used: path.join(root, "used"),
  };
}

const readJsonFile = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

const listJson = (directory: string): string[] => {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
};

/**
 * Live tickets, newest first. Synchronous so callers that must stay pure can
 * use it; the directory holds at most a handful of files by construction.
 */
export function readTickets(
  paths: ApprovalPaths,
  now: Date = new Date(),
): ApprovalTicket[] {
  return listJson(paths.tickets)
    .map((name) => readJsonFile<ApprovalTicket>(path.join(paths.tickets, name)))
    .filter((ticket): ticket is ApprovalTicket => ticket !== null)
    .filter((ticket) => Date.parse(ticket.expiresAt) > now.getTime())
    // A ticket minted on another Mac is not this Mac's to answer. Tickets
    // written before this field existed carry no deviceId and are still
    // honoured here rather than silently dropped.
    .filter((ticket) => !ticket.deviceId || ticket.deviceId === hostname())
    .sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
}

/**
 * Which canonical hashes a person has actually approved.
 *
 * A grant counts only when its ticket still exists, has not expired, and
 * carries the same nonce. That is what makes a grant unforgeable without also
 * forging the plugin's own mint: writing a grant for a hash you can compute is
 * not enough, you need the nonce that only the ticket has.
 */
export function grantedHashes(
  paths: ApprovalPaths,
  now: Date = new Date(),
): Map<string, { grant: ApprovalGrant; ticket: ApprovalTicket }> {
  const tickets = new Map(readTickets(paths, now).map((ticket) => [ticket.id, ticket]));
  const resolved = new Map<string, { grant: ApprovalGrant; ticket: ApprovalTicket }>();
  for (const name of listJson(paths.grants)) {
    const grant = readJsonFile<ApprovalGrant>(path.join(paths.grants, name));
    if (!grant) continue;
    const ticket = tickets.get(grant.id);
    if (!ticket) continue;
    if (ticket.nonce !== grant.nonce) continue;
    if (ticket.canonicalHash !== grant.canonicalHash) continue;
    resolved.set(grant.canonicalHash, { grant, ticket });
  }
  return resolved;
}

/**
 * Mint a ticket, or return the one already waiting for this exact hash.
 *
 * Deduplication is a safety property rather than a nicety. Without it a model
 * that retries produces a new id per attempt, Nick's phone fills with codes
 * that all mean the same thing, and the one he eventually types is whichever
 * he happened to read -- which is how a person ends up approving something
 * they have stopped reading.
 */
export async function mintTicket(
  paths: ApprovalPaths,
  request: { canonicalHash: string; action: string; summary: string; context: string },
  now: Date = new Date(),
): Promise<ApprovalTicket> {
  const existing = readTickets(paths, now).find(
    (ticket) => ticket.canonicalHash === request.canonicalHash,
  );
  if (existing) return existing;

  await mkdir(paths.tickets, { recursive: true, mode: 0o700 });
  const ticket: ApprovalTicket = {
    id: mintId(),
    canonicalHash: request.canonicalHash,
    // 128 bits from the CSPRNG, not a hash of a timestamp. The nonce is the
    // one value a forger cannot compute from the ticket's public contents, so
    // it must not be derivable from them.
    nonce: randomBytes(16).toString("hex"),
    action: request.action,
    summary: request.summary,
    context: request.context,
    mintedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TICKET_TTL_MS).toISOString(),
    deviceId: hostname(),
  };
  // `wx`: a collision on the four-character id must fail rather than overwrite
  // a ticket somebody is about to approve.
  await writeFile(
    path.join(paths.tickets, `${ticket.id}.json`),
    `${JSON.stringify(ticket, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return ticket;
}

/**
 * Spend a grant. Called once the gate has been satisfied and BEFORE the action
 * runs, so a failed action costs the approval rather than leaving one lying
 * around that a later attempt could pick up.
 */
export async function consumeGrant(
  paths: ApprovalPaths,
  canonicalHash: string,
  now: Date = new Date(),
): Promise<boolean> {
  const match = grantedHashes(paths, now).get(canonicalHash);
  if (!match) return false;
  await mkdir(paths.used, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  await rename(
    path.join(paths.grants, `${match.grant.id}.json`),
    path.join(paths.used, `${match.grant.id}-${stamp}.json`),
  ).catch(() => undefined);
  await rename(
    path.join(paths.tickets, `${match.ticket.id}.json`),
    path.join(paths.used, `${match.ticket.id}-${stamp}.ticket.json`),
  ).catch(() => undefined);
  return true;
}

/**
 * Write the grant. The one function in this file that represents a person
 * having said yes, and it is exported only for `orion-approve` and the
 * non-local branch of `orion-remote` -- nothing in the plugin's tool surface
 * calls it.
 */
export async function grant(
  paths: ApprovalPaths,
  ticketId: string,
  grantedBy: string,
  now: Date = new Date(),
): Promise<{ ok: true; ticket: ApprovalTicket } | { ok: false; reason: string }> {
  const id = normalizeTicketId(ticketId);
  if (!id) return { ok: false, reason: `"${String(ticketId).slice(0, 20)}" is not an approval id` };
  if (!grantedBy || grantedBy.toLowerCase() === "local" || grantedBy.toLowerCase() === "orion") {
    // The whole point. An approval has to be attributable to a person, and
    // `local` is what an exec call from Orion himself presents.
    return { ok: false, reason: "an approval must come from a named person, not from the local process" };
  }
  const ticket = readTickets(paths, now).find((candidate) => candidate.id === id);
  if (!ticket) return { ok: false, reason: `no approval ${id} is waiting (it may have expired)` };

  await mkdir(paths.grants, { recursive: true, mode: 0o700 });
  const record: ApprovalGrant = {
    id: ticket.id,
    canonicalHash: ticket.canonicalHash,
    nonce: ticket.nonce,
    grantedAt: now.toISOString(),
    grantedBy,
  };
  await writeFile(
    path.join(paths.grants, `${ticket.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  ).catch(() => undefined);
  return { ok: true, ticket };
}

/** Withdraw a waiting request without approving it. */
export async function deny(
  paths: ApprovalPaths,
  ticketId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const id = normalizeTicketId(ticketId);
  if (!id) return false;
  const ticket = readTickets(paths, now).find((candidate) => candidate.id === id);
  if (!ticket) return false;
  await mkdir(paths.used, { recursive: true, mode: 0o700 });
  await rename(
    path.join(paths.tickets, `${ticket.id}.json`),
    path.join(paths.used, `${ticket.id}-denied-${now.toISOString().replace(/[:.]/g, "-")}.json`),
  ).catch(() => undefined);
  return true;
}

// MARK: - Saying yes out loud

/*
 THE VOICE PATH, and why it is not a voice feature.

 `orion-approve` and the Discord verb both work because they are acts Orion
 cannot perform. Speech looked like it had no equivalent: the microphone feeds
 a transcript to the model, and the model is precisely what was removed from
 the loop.

 The first design was speaker verification -- accept "approve A-7F3K" when the
 voice matches Nick's enrolled profile. `SpeakerVerifier.swift` forbids it in
 its own header, and it is right to:

     IT IS NOT AUTHENTICATION. It filters the television and the room. A
     recording of his voice defeats it, and nothing security-relevant should
     ever be conditioned on it.

 It also fails OPEN by design, so building an approval on it would mean an
 approval that succeeds when the daemon is down.

 The mechanism that does work was already here, already tested, and already
 trusted for a decision of the same weight. `authorizeTaskGraph` mints
 `trusted_user` inputs from OpenClaw host provenance; a model-supplied input
 becomes `untrusted_external` and a forged `trusted_user` tag is discarded
 (`ignores a model-forged trusted_user tag and fails closed`). That is the same
 proof `argumentNotFromUser` leans on to decide whether Nick named the person a
 message is going to.

 So: if NICK'S OWN TURN says approve, that is a person saying yes. It works for
 speech, for a typed message and for the Discord DM identically, because none
 of them is special -- what matters is that the words came from the harness and
 not from the model.

 WHAT THIS DOES NOT DEFEND. Anyone standing in the room can say it. That is
 the same exposure as anyone standing at the keyboard, and it is the honest
 ceiling for a hands-free assistant. It is why `sovereign` exists: the answer
 to approvals being inconvenient is to need fewer of them, not to make the ones
 that remain easier to forge.
*/

/** Affirmatives, negations, and the words that turn a question into a request. */
const AFFIRM = /\b(?:approve[ds]?|approving|confirm(?:ed)?|authorise[d]?|authorize[d]?|yes|go\s+ahead|do\s+it|send\s+it)\b/i;
const NEGATE = /\b(?:don'?t|do\s+not|never|cancel(?:led)?|denie[ds]?|deny|refuse[d]?|reject(?:ed)?|hold\s+off|not)\b/i;
const REFUSE = /\b(?:denie[ds]?|deny|refuse[d]?|reject(?:ed)?|no\s+to)\b/i;

/**
 * The id as a person says it.
 *
 * Speech-to-text renders `A-7F3K` as "A-7F3K", "a 7 f 3 k", "A7F3K" or
 * "A. 7 F 3 K" depending on the engine and the day. Each character is allowed
 * up to two separators after it, and the `A-` prefix is optional because Nick
 * drops it about half the time.
 */
function spokenIdPattern(id: string): RegExp {
  const body = id.replace(/^A-/, "");
  const loose = body.split("").join("[\\s.,-]{0,2}");
  return new RegExp(`(?:\\bA[\\s.,-]{0,2})?${loose}\\b`, "i");
}

export type SpokenDecision = { id: string; decision: "approved" | "denied" };

/**
 * What Nick's own words decided, if anything.
 *
 * Deliberately silent rather than clever when a turn is ambiguous. "Should I
 * approve A-7F3K?" and "don't approve A-7F3K yet" both return nothing, and the
 * model then has to ask -- which costs one turn and is the right answer, where
 * guessing costs a message that cannot be unsent.
 *
 * @param userText concatenated `trusted_user` instruction inputs. Passing
 *   anything else here -- page text, a file, a message Orion read -- would
 *   hand the approval to whoever wrote it.
 */
export function decisionsInUserTurn(
  userText: string,
  tickets: readonly ApprovalTicket[],
): SpokenDecision[] {
  const text = String(userText ?? "");
  if (text.trim().length === 0) return [];
  const decisions: SpokenDecision[] = [];
  for (const ticket of tickets) {
    const found = spokenIdPattern(ticket.id).exec(text);
    if (!found) continue;
    /*
     Only the clause the id is in, and the id is taken OUT before splitting.

     "Cancel the alarm, and approve A-7F3K" is two instructions and only the
     second is an approval, so the sentence is cut at clause boundaries and
     just the containing clause is read. The subtlety, which cost one failing
     test: a transcriber writes the id as "A. 7 F 3 K", so splitting on `.`
     first tore the id in half and left a clause with no verb in it. Replacing
     the match with a punctuation-free marker before splitting means the id
     cannot be a boundary.
    */
    const MARK = "\u0000ID\u0000";
    const clause =
      text
        .replace(found[0], MARK)
        .split(/[.!?;\n]|,\s*(?=and\b|then\b|also\b|but\b)/)
        .find((part) => part.includes(MARK)) ?? "";
    if (REFUSE.test(clause)) {
      decisions.push({ id: ticket.id, decision: "denied" });
      continue;
    }
    // An affirmative must be present AND unnegated. Absence of both is a
    // mention, not a decision: "what does A-7F3K do" changes nothing.
    if (AFFIRM.test(clause) && !NEGATE.test(clause)) {
      decisions.push({ id: ticket.id, decision: "approved" });
    }
  }
  return decisions;
}

/**
 * Apply what the turn said. Returns what it acted on, for the run record.
 *
 * `grantedBy` says `user-turn` rather than naming a channel, because this code
 * genuinely does not know which one it was -- and the claim it can make
 * honestly is the one that matters: these words came from the harness, not
 * from the model.
 */
export async function applyUserTurnDecisions(
  paths: ApprovalPaths,
  userText: string,
  now: Date = new Date(),
): Promise<SpokenDecision[]> {
  const decisions = decisionsInUserTurn(userText, readTickets(paths, now));
  for (const decision of decisions) {
    if (decision.decision === "approved") await grant(paths, decision.id, "user-turn", now);
    else await deny(paths, decision.id, now);
  }
  return decisions;
}
