/*
 Replay cases (w20 replay). A case is one of Nick's real turns (or a paraphrase of one) plus the PROPERTIES a good handling has:
 which route took it, which script ran with what arguments, whether every ask in the message was addressed, and which reply
 shapes must never come back. Never exact text: wording is allowed to improve, these are not.

 The repo carries anonymised paraphrases (scripts/eval/replay/cases.json). The real turns live outside the repo
 (~/.openclaw/orion-controlled/evals/replay/) and use the same shape.
*/
import type { Decision } from "../front-desk.js";
import type { Day, Intent } from "../schedule-flow.js";

/** A script that ran: what the harness's recorder saw (the real scripts never run in the deterministic layer). */
export type ScriptCall = { script: string; args: string[] };

/** What a script prints when it runs with these arguments (matched as a substring of the joined arguments). */
export type RecordedScript = { match: string; stdout: string; code?: number };

/** A tool the worker model ran during the turn (recorded from a real session). */
export type RecordedTool = { toolName: string; params: Record<string, unknown>; result: string };

/** The model outputs recorded for one turn. The deterministic layer replays these; the live layer ignores them. */
export type Recorded = {
  /** The front desk's (4B) decision. */
  desk?: Decision;
  /** The schedule form the worker (9B) filled, one entry per call it was asked, in order. */
  form?: Array<{ steps: Intent[] } | null>;
  /** The worker's final reply, and the tools it ran before it. A second entry answers a revise retry. */
  worker?: string | string[];
  tools?: RecordedTool[];
  /** An obedient worker: it made the tool call the prompt told it to (read from the prompt), and the tool answered with this text. */
  obey?: string;
  /** What the scripts print. Anything unmatched is a refusal: nothing is ever written by accident. */
  scripts?: RecordedScript[];
  /** The day the scheduler reads (show --json). */
  day?: Day;
};

/** An earlier turn in the same chat (the router keeps per-chat memory: repeats, pending questions, "undo"). */
export type PriorTurn = { say: string; recorded?: Recorded; at?: string; /** ORION spoke first (a push): the line he is replying to. */ outreach?: string };

export type Surface = "mac" | "phone";

/** One ask inside a message, and what addresses it: a phrase in the reply, or a script call. Either is enough. */
export type Ask = {
  id: string;
  /** Case-insensitive regex sources; any one matching the reply addresses the ask. */
  reply?: string[];
  /** A script call that addresses the ask: script name and regex source tested against the joined arguments. */
  call?: { script: string; args: string };
};

export type Expect = {
  /** Which handler took the turn: "schedule", "workout", "mouse", "wake", "food", "selffix", "desk-answer", "worker", "quiet", ... */
  route?: string;
  routeNot?: string[];
  /** The route class that handled this turn when it worked (private corpus): a code route must still take it. A "worker" class asks nothing. */
  routeLike?: string;
  /** Script calls that must have happened (args tested as regex sources against the joined arguments)... */
  calls?: Array<{ script: string; args?: string }>;
  /** ...and ones that must not (a script with any args, or a script whose args match). */
  noCalls?: Array<{ script: string; args?: string }>;
  /** Every ask in the message, each addressed. */
  asks?: Ask[];
  /** Regex sources that must / must not appear in the final reply. */
  replyHas?: string[];
  replyLacks?: string[];
  /** Extra banned reply shapes for this case only (the global list in shapes.ts always applies). */
  banned?: string[];
  /** The reply must say a reason (a non-empty explanation) when nothing was done. */
  /** The turn must change nothing (no write-looking call). */
  readOnly?: boolean;
  /** Regex sources the worker's prompt must / must not carry (it is where a front-desk argument such as an empty browser reaches the tool call). */
  promptHas?: string[];
  promptLacks?: string[];
};

export type ReplayCase = {
  id: string;
  /** The tube-audit id (E4, M3, ...) when this case came from a bad turn. */
  audit?: string;
  /** Free text: what Nick meant, in a line. */
  intent?: string;
  say: string;
  /** What happened when it worked, for the record (private corpus). */
  observed?: { reply?: string; route?: string };
  /** ORION spoke first (a push): the line this message answers. */
  outreach?: string;
  surface?: Surface;
  spoken?: boolean;
  /** Local time the turn happened, "YYYY-MM-DDTHH:MM" (pins the clock). */
  now?: string;
  prior?: PriorTurn[];
  recorded?: Recorded;
  expect: Expect;
  /** Files seeded into the sandbox state directory before the turns (name -> JSON value). */
  seed?: Record<string, unknown>;
  /** Cannot run in this harness (say why: a Swift or phone-side path). Counted, never silently dropped. */
  skip?: string;
  /** Needs the live models (a private-corpus turn with no recorded worker output): the deterministic layer counts it as skipped. */
  liveOnly?: boolean;
  /** Known to fail today: the audit id or reason. CI stays green; the count is printed; a surprise pass is reported. */
  expectFail?: { audit?: string; why: string };
  /** The day the live layer seeds the sandbox calendar with (live only; the deterministic layer uses recorded.day). */
  day?: Day;
};

export type Outcome = {
  route: string;
  /** The words Nick would have seen. */
  reply: string;
  decision?: Decision;
  flow?: { outcome: string; calls?: string[]; reason?: string };
  scripts: ScriptCall[];
  /** Scripts, flow calls and worker tools as one list of "script arg arg" strings. */
  calls: string[];
  revised: number;
  /** The prompt the worker would have been given (first 4000 characters), for the live layer. */
  workerPrompt?: string;
  ms?: number;
};

export type Verdict = { id: string; audit?: string; status: "pass" | "fail" | "xfail" | "xpass" | "skip"; failures: string[]; outcome?: Outcome };
