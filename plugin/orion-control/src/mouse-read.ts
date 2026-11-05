/*
 Which chat turns are about his mouse buttons (w18 mousechat, 2026-11-03). Pure: mouse-chat.ts carries them out through scripts/orion-mouse.

 Nick: "make my side button do stage manager", "back button should go to the left desktop", "dont do anything in minecraft",
 "what are my mouse buttons set to".

   status       "what are my mouse buttons set to"
   set          "<button> <action>" with an optional app ("only in safari"); a missing button or action is the script's question
   clear        "unbind the back button", "put the front button back to normal"
   passthrough  "dont do anything in minecraft", "leave the mouse alone in photoshop", "stop ignoring the mouse in minecraft"
   games        "turn off game detection"
   wheel        "make my scroll wheel normal" (always), "normal scrolling when gaming" (games), "leave my mouse wheel alone" (never)
   setup        "set up my new mouse", or a yes to ORION's own "I see a new mouse, want to set it up?"
   apply        a yes to the suggested defaults the setup listed
   decline      a no to either of those (answered here, nothing runs)
   cancel       "never mind" while ORION is waiting on a button or an action

 This file only picks the words out (a button phrase, an action phrase, an app phrase); the script is the one that resolves and validates them.
 A reply ("the front one", "stage manager") belongs to the follow-up only while that question is still the last thing said in this chat.
*/
import { normalizeSpoken } from "./spoken-numbers.js";

export type MousePending = { ask: "button" | "action"; button?: string; action?: string; app?: string; clear?: boolean };
export type MouseTurn =
  | { kind: "status" }
  | { kind: "set"; button: string; action: string; app?: string }
  | { kind: "many"; turns: MouseTurn[] }
  | { kind: "clear"; button: string; app?: string }
  | { kind: "passthrough"; op: "add" | "remove"; app: string }
  | { kind: "games"; state: "on" | "off" }
  | { kind: "shortcuts"; state: "on" | "off" }
  | { kind: "wheel"; mode: "games" | "always" | "never" }
  | { kind: "setup"; again?: true }
  | { kind: "learn" }
  | { kind: "apply" }
  | { kind: "decline" }
  | { kind: "cancel" };

export type MouseContext = {
  /** ORION asked for a button or an action and nothing else was said since (MouseMemory). */
  pending?: MousePending;
  /** ORION listed the suggested defaults and is waiting for a yes. */
  confirm?: boolean;
  /** The message answers an outreach about a new mouse. */
  outreachAbout?: boolean;
};

const flat = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const BTN = String.raw`(?:front|back|forward|rear)`;
const MOUSE = /\bmouse\b|\bbasilisk\b|\brazer\b/i;
const BUTTON_PHRASE = new RegExp(
  String.raw`\b(?:(?:mouse )?button\s*#?\d{1,2}|${BTN} side(?: button)?|side ${BTN}(?: button)?|${BTN}(?: thumb)? button|(?:side|thumb) button|(?:top|sensitivity|dpi) button|f(?:1[3-9]|20)(?: key)?(?: button)?)\b`, "i");
const MOUSEISH = new RegExp(`${MOUSE.source}|${BUTTON_PHRASE.source}|\\bthumb\\b`, "i");
const KEYWORD = String.raw`(?:cmd|command|ctrl|control|opt|option|alt|shift)`;
const ACTION_PHRASE = new RegExp([
  String.raw`stage ?manager`, String.raw`mission ?control`, String.raw`app ?expos[eé]`, String.raw`show (?:the |my )?desktop`, String.raw`launch ?pad`,
  String.raw`notification ?(?:center|centre)`, String.raw`(?:left|right|previous|next|last) (?:desktop|space)`, String.raw`(?:desktop|space) (?:to the |on the )?(?:left|right)`,
  String.raw`(?:full |whole |entire )?screen ?(?:shot|capture)`, String.raw`spotlight`, String.raw`(?:summon|wake|call|bring up) orion`, String.raw`talk to orion`, String.raw`type to orion`, String.raw`(?:the )?(?:text|typing) (?:box|window|bar|input)`,
  String.raw`${KEYWORD}(?:\s*\+\s*|\s+)(?:${KEYWORD}(?:\s*\+\s*|\s+))*[a-z0-9]\b`, String.raw`(?:open|launch) [a-z0-9][a-z0-9 .'&-]{1,28}?(?=$|[.,!?]| (?:in|on|when|while|only|just)\b)`,
  String.raw`(?:its|it's) normal`,
].join("|"), "i");
const APP_TAIL = /\b(?:only |just )?(?:in|inside|when (?:i'?m |im |i am )?(?:in|using|on|playing)|while (?:i'?m |im |i am )?(?:in|using|on|playing))\s+(?:the )?([a-z0-9][a-z0-9 .'&-]{1,30}?)\s*[.!]?$/i;
const NOT_APP = /^(?:general|everything|every ?thing|every app|all apps|all of them|any app|everywhere|default|there|here)$/i;

const BIND_VERB = /\b(?:make|set|bind|map|assign|remap|rebind|change|put|have|let)\b/i;
const QUESTION = /^(?:what|which|how|is|are|does|do you|can you tell|tell me|show|list|check|read)\b|\?\s*$/i;
const STATUS_WORD = /\b(?:set to|bound|mapped|doing|does|do|settings?|bindings?|configured|assigned|currently|right now|status|each|all)\b/i;
const CLEAR_VERB = /\b(?:unbind|unmap|clear|reset|remove|unassign|disable|back to (?:normal|default)|normal again|default again|stock)\b/i;
const GAMES = /\bgames? (?:detection|mode)\b|\bauto[- ]?(?:ignore|passthrough|pass through)\b|\b(?:ignore|leave alone|pass through|dont touch|don'?t touch) (?:the |my )?(?:mouse|buttons?) (?:in|for|during) games\b/i;
// The mouse wheel's direction (not the buttons): a wheel word, plus either "make it normal" or "leave it alone", and where (games or everywhere).
const WHEEL_NOUN = /\b(?:(?:mouse|mous|mose)'?s? ?(?:wheel|scroll\w*)|scroll ?wheel|wheel scroll\w*|scroll(?:ing)? (?:direction )?(?:on|with|using) (?:my|the) (?:mouse|mose))\b/;
const SCROLL_WORD = /\bscroll(?:ing)?\b/;
const GAMING = /\b(?:gam(?:e|es|ing|er)|playing|minecraft|fortnite|valorant|roblox|overwatch|cs2|csgo|apex|genshin)\b/;
const WHEEL_FIX = /\b(?:normal|natural|right way|correct|not (?:inverted|reversed|backwards?)|un-?invert\w*|invert\w*|revers\w*|flip\w*|backwards?|opposite|upside|weird|wrong way|wrong)\b/;
const WHEEL_LEAVE = /\b(?:leave|hands off|dont touch|don'?t touch|stop (?:touching|fixing|changing|messing)|back to (?:how|what|the normal mac|the mac|macos)|how it was|put (?:it |them |the \w+ \w+ )?back|go back|revert|undo)\b/;
const NOT_WHEEL = /\b(?:trackpad|touchpad|track pad|magic mouse|colou?rs?)\b/;
const WHEEL_TALK = /^(?:how|why|what|which|is|are|does|do|can you tell|tell me|show|list|check)\b|\?\s*$/;

/** "make my scroll wheel normal", "normal scrolling when gaming", "leave my mouse wheel alone": the wheel's mode, or null. */
function readWheel(said: string): MouseTurn | null {
  if (NOT_WHEEL.test(said) || WHEEL_TALK.test(said)) return null;
  const gaming = GAMING.test(said);
  if (!WHEEL_NOUN.test(said) && !(SCROLL_WORD.test(said) && gaming)) return null;
  if (WHEEL_LEAVE.test(said)) return { kind: "wheel", mode: "never" };
  if (!WHEEL_FIX.test(said)) return null;
  return { kind: "wheel", mode: gaming ? "games" : "always" };
}

// The master switch: "turn my mouse shortcuts off". Not a question, not scoped to an app or to games.
const SWITCH_NOUN = /\b(?:mouse|mose|mous) (?:shortcuts?|buttons?|remap\w*|bindings?)\b/;
const SWITCH_OFF = /\b(?:turn|switch|shut|flip|put)\b.*\boff\b|\boff\b.*\b(?:pls|please|for a (?:bit|while|sec))\b|\b(?:disable|pause)\b|\bshut off\b|\bshortcuts? off\b/;
const SWITCH_ON = /\b(?:turn|switch|flip|put)\b.*\bon\b|\b(?:enable|resume|unpause)\b|\bshortcuts? on\b/;
function readSwitch(said: string): MouseTurn | null {
  if (!SWITCH_NOUN.test(said) || QUESTION.test(said) || /\?\s*$/.test(said) || GAMING.test(said) || GAMES.test(said) || lastIn(said)) return null;
  if (SWITCH_OFF.test(said) && !/\bon\b/.test(said.replace(/\bturn on\b/, ""))) return { kind: "shortcuts", state: "off" };
  if (SWITCH_ON.test(said)) return { kind: "shortcuts", state: "on" };
  return null;
}

const OFF = /\b(?:off|disable|stop|dont|don'?t|do not|no longer|without|never)\b/i;
const NEG = /\b(?:dont|don'?t|do not|never|stop|no|disable|ignore|leave|bypass|pass ?through|turn off)\b/i;
const REMOVE = /\b(?:stop ignoring|stop leaving|stop disabling|re-?enable|turn (?:it|them|the \w+) back on|(?:work|working|active|on) again|should work|start working|work normally)\b/i;
// "learn a new mouse button", "listen for a button", "my mouse has an extra button it doesnt see", "add a button to the mapper".
const LEARN = /\b(?:learn|listen(?:ing)?|detect|find|add|register|teach (?:you|orion|me)|pick up|scan)\b[^.?!]*\b(?:new |another |extra |other |mystery |sixth |6th |top |that )?(?:mouse )?(?:button|btn|key)s?\b/i;
const LEARN_UNSEEN = /\b(?:new|extra|another|sixth|6th|mystery) (?:mouse )?(?:button|btn)\b[^.?!]*\b(?:dont|doesnt|isnt|cant|not|never)\b[^.?!]*\b(?:see|detect|show|find|pick|know|recogni[sz]e)\w*/i;
const LEARN_CTX = /\b(?:mouse|mous|mose|mice|mapper|mappr|maper|extra button|new button|another button|sixth|6th|f1[3-9]|f20)\b/i;
const SETUP = /\b(?:set ?up|setup|configure|customi[sz]e)\b[^?]*\b(?:my |the |this )?(?:new )?mouse\b|\bget\b[^?]*\bmouse\b[^?]*\bset ?up\b|\bnew mouse\b[^?]*\b(?:set ?up|configure)\b/i;
// "pull up the mouse button mapper again", "open the mouse thing", "show me the mouse setup", "bring back the button mapper": the popup, again.
const REOPEN_VERB = /\bpull\b[^.?!]*\bup\b|\b(?:bring(?: it| that)?(?: back)? up|bring(?: it| that)? back|bring\b[^.?!]*\bback|s[ua]m+[ou]n\w*|op[en]\w{0,2}(?: up)?|re-?open\w*|show(?: me)?|launch|display|fire up|load|pop up|put (?:it )?back|get(?: it)? back)\b/;
const MOUSEW = String.raw`(?:mouse|mous|mose|mice)`;
const BTNW = String.raw`(?:buttons?|butt?ons?|btns?)`;
const REOPEN_THING = new RegExp(String.raw`\bmapp?e?r\b|\b(?:${MOUSEW}|${BTNW})(?: ${BTNW})? (?:setup|set up|thing|popup|pop up|window|panel|screen|config(?:uration)?|mapping|settings|menu)\b|\b${MOUSEW} ${BTNW}\b`);
/** The popup named with no verb at all: "mouse settings", "button mapper", "mouse button settings". */
const REOPEN_BARE = new RegExp(String.raw`^(?:(?:yo|hey|ok|okay|orion|pls|please|the|my|that)\s+)*(?:${MOUSEW}|${BTNW})(?: ${BTNW})? (?:mapper|mappr|maper|settings|setup|mapping)(?:\s+(?:again|pls|please|thing))*$|^(?:(?:yo|hey|ok|okay|orion|pls|please|the|my|that)\s+)*mapper(?:\s+(?:again|pls|please))*$`);
const READING = /\b(?:set to|bound|mapped to|doing|currently|right now|assigned|configured)\b/;
const GAMEY = /\b(?:minecraft|fortnite|valorant|roblox|steam|league|overwatch|cs2|csgo|apex|genshin|game|games)\b/i;
const YES = /^(?:y|ye|ya|yea|yeah|yes|yep|yup|ok|okay|k|sure|alright|aight|do it|go ahead|sounds good|that works|perfect|fine|please|yes please|sure thing|lets do it|let'?s do it|set it up|set it|do that|go for it)(?: (?:please|orion|do it|thanks|thx|that'?s fine))?[.!]*$/;
const NO = /^(?:no|nah|nope|not now|later|not yet|skip|no thanks|nah im good|maybe later|not really|leave it|dont|don'?t)[.!]*$/;
const CANCEL = /^(?:cancel|never ?mind|nvm|forget it|leave it|dont bother|don'?t bother)[.!]*$/;

const APP_LEAD = /^(?:in|when (?:i'?m |im |i am )?(?:in|using|on|playing)|while (?:i'?m |im |i am )?(?:in|using|on|playing))\s+(?:the )?([a-z0-9][a-z0-9 .'&-]{1,30}?)[, ]+(?=make|set|have|let|put|bind|map|the|my)/i;
const lastIn = (said: string): string | undefined => {
  const app = (APP_LEAD.exec(said) ?? APP_TAIL.exec(said))?.[1]?.trim();
  return app && !NOT_APP.test(app) ? app : undefined;
};
const distinctButtons = (said: string): number => new Set([...said.matchAll(new RegExp(BUTTON_PHRASE.source, "gi"))].map((m) => m[0].replace(/^(?:the |my |mouse )/, "").replace(/(?: key| button)$/, "").replace(/\s+/g, ""))).size;
const buttonOf = (said: string): string => (BUTTON_PHRASE.exec(said)?.[0] ?? "").replace(/^(?:the |my )/, "");
const NUMBERED = /^(?:mouse )?button\s*#?\d{1,2}$/;
const KEYED = /^f(?:1[3-9]|20)(?: key)?(?: button)?$/;
const CONNECT_VERB = /\b(?:connect|link|tie|pair|join|hook|mapp?ed|mapping)\b/i;
/** "button 6 ... mapped to f13": the number he knew and the key it now sends are ONE button (the Mac sees the key). Its name, else null. */
const sameButtonKeyed = (said: string): string | null => {
  const names = [...new Set([...said.matchAll(new RegExp(BUTTON_PHRASE.source, "gi"))].map((m) => m[0].replace(/^(?:the |my )/, "").replace(/\s+/g, " ")))];
  const keyed = names.filter((n) => KEYED.test(n)), numbered = names.filter((n) => NUMBERED.test(n));
  return names.length === 2 && keyed.length === 1 && numbered.length === 1 ? keyed[0]!.replace(/ (?:key|button)$/, "").replace(/ (?:key|button)$/, "") : null;
};
/** "nothing" is an action only as a binding ("make it do nothing", "set back button to nothing") or a bare reply, never in "my mouse does nothing". */
const actionOf = (said: string): string => ACTION_PHRASE.exec(said)?.[0]?.trim()
  ?? (/^(?:do )?nothing$/.test(said) || (BIND_VERB.test(said) && /\b(?:do|to|be) nothing\b/.test(said)) ? "nothing" : "");

/** His reply to "which button?" / "what should it do?". */
function readAnswer(said: string, p: MousePending): MouseTurn | null {
  if (said.split(" ").length > 8 || /\?/.test(said)) return null;
  if (p.ask === "button") {
    const digit = /^(?:the )?(?:button )?#?(\d{1,2})$/.exec(said);
    const word = new RegExp(String.raw`^(?:the |my )?(${BTN})(?: one| side| button| side button)?$`).exec(said);
    const phrase = digit ? `button ${digit[1]}` : word ? word[1]! : buttonOf(said);
    if (!phrase) return null;
    return p.clear ? { kind: "clear", button: phrase, ...(p.app ? { app: p.app } : {}) } : { kind: "set", button: phrase, action: p.action ?? "", ...(p.app ? { app: p.app } : {}) };
  }
  const action = actionOf(said);
  return action && p.button ? { kind: "set", button: p.button, action, ...(p.app ? { app: p.app } : {}) } : null;
}

const CLAUSE_SPLIT = new RegExp(String.raw`\s*(?:,|;|\band\b|\bthen\b|\balso\b)\s*(?=(?:the |my )?(?:mouse )?(?:${BTN}|side|thumb|button\s*#?\d))`, "i");
const BARE_PAIR = new RegExp(String.raw`^(?:the |my )?(${BTN})(?: side)?(?: button)?(?: should| to| do| does| is| =)*\s+(?:be |do |go to |open )?(.+)$`, "i");

/** "front stage manager, back mission control": two or more clauses that each name a button and an action. */
function readMany(said: string): MouseTurn | null {
  const clauses = said.split(CLAUSE_SPLIT).map((x) => x.trim()).filter(Boolean);
  if (clauses.length < 2 || clauses.length > 4) return null;
  const turns: MouseTurn[] = [];
  for (const clause of clauses) {
    const one = readOne(clause, {});
    if (one?.kind === "set" && one.button && one.action) { turns.push(one); continue; }
    const bare = BARE_PAIR.exec(clause);
    const action = bare ? actionOf(bare[2]!.trim()) : "";
    if (!bare || !action) return null;
    turns.push({ kind: "set", button: bare[1]!.toLowerCase(), action: /^(?:open|launch)/i.test(bare[2]!.trim()) ? bare[2]!.trim() : action });
  }
  return { kind: "many", turns };
}

/** The mouse turn in his message, or null. */
export function readMouseTurn(rawMessage: string, c: MouseContext = {}): MouseTurn | null {
  const message = normalizeSpoken(rawMessage);   // "button six", "f thirteen": the one shared normaliser, ahead of every parser
  const said = flat(message.trim().replace(/\s+/g, " "));
  if (!c.pending && !c.confirm && said.length <= 400) { const many = readMany(said); if (many) return many; }
  return readOne(message, c);
}

function readOne(message: string, c: MouseContext): MouseTurn | null {
  const m = message.trim().replace(/\s+/g, " ");
  const said = flat(m);
  if (!said || m.length > 400) return null;
  if (c.pending) {
    if (CANCEL.test(said)) return { kind: "cancel" };
    const answer = readAnswer(said, c.pending);
    if (answer) return answer;
  }
  if (c.confirm || c.outreachAbout) {
    if (YES.test(said)) return c.confirm ? { kind: "apply" } : { kind: "setup" };
    if (NO.test(said)) return { kind: "decline" };
  }
  const mouseish = MOUSEISH.test(said);
  if (LEARN_UNSEEN.test(said) && LEARN_CTX.test(said) && !BIND_VERB.test(said)) return { kind: "learn" };
  if (LEARN.test(said) && LEARN_CTX.test(said) && !/^(?:what|which|how|is|are|does)\b/.test(said) && !BIND_VERB.test(said)) return { kind: "learn" };
  if (SETUP.test(said) && MOUSE.test(said) && !QUESTION.test(said)) return { kind: "setup" };
  const master = readSwitch(said);
  if (master) return master;
  const wheel = readWheel(said);
  if (wheel) return wheel;
  if (GAMES.test(said)) return { kind: "games", state: OFF.test(said) ? "off" : "on" };
  const app = lastIn(said);
  const anything = /\bdo (?:anything|stuff|a thing)\b/.test(said);
  const buttons = /\b(?:mouse|buttons?|clicks?)\b/.test(said);
  if (app && REMOVE.test(said) && (buttons || GAMEY.test(app))) return { kind: "passthrough", op: "remove", app };
  if (app && NEG.test(said) && !BIND_VERB.test(said) && (buttons || (anything && GAMEY.test(app)))) return { kind: "passthrough", op: "add", app };
  const asked = /^(?:what|which|how|why|is|are|does|do)\b/.test(said);
  if (!BIND_VERB.test(said) && !asked && ((REOPEN_VERB.test(said) && REOPEN_THING.test(said) && !READING.test(said)) || REOPEN_BARE.test(said))) return { kind: "setup", again: true };
  // A question about the settings gets the status. A REQUEST phrased as a question ("can you set button 6 to ...?") is not one:
  // it was dumped as a status paragraph when its button or action did not parse (A3 / A4, tube audit 2026-11-04).
  const asksStatus = /\b(?:what|whats|which|how)\b/.test(said) || (QUESTION.test(said) && !BIND_VERB.test(said) && !/\b(?:can|could|would|will)\s+you\b/.test(said) || /^(?:what|which|how|is|are|does|do you|tell me|show|list|check|read)\b/.test(said));
  if (QUESTION.test(said) && asksStatus) return mouseish && STATUS_WORD.test(said) || (MOUSE.test(said) && /\b(?:buttons?|settings?|bindings?)\b/.test(said)) ? { kind: "status" } : null;
  if (!mouseish) return null;
  const same = distinctButtons(said) === 2 ? sameButtonKeyed(said) : null;
  if (distinctButtons(said) > 1 && !same) return null;   // two buttons named and no way to tell which is meant: the model asks, code never guesses
  const button = same ?? buttonOf(said);
  if (CLEAR_VERB.test(said) && !actionOf(said).replace(/^nothing$/i, "")) return { kind: "clear", button, ...(app ? { app } : {}) };
  const action = actionOf(said);
  if (!action && !((BIND_VERB.test(said) || (same && CONNECT_VERB.test(said))) && button)) return /\b(?:show|list|check|status|tell me)\b/.test(said) && /\b(?:mouse (?:settings|buttons|bindings))\b/.test(said) ? { kind: "status" } : null;
  const scoped = app && action && !action.toLowerCase().includes(app.toLowerCase()) ? app : undefined;
  return { kind: "set", button, action, ...(scoped ? { app: scoped } : {}) };
}
