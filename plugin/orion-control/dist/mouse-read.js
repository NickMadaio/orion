const flat = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const BTN = String.raw `(?:front|back|forward|rear)`;
const MOUSE = /\bmouse\b|\bbasilisk\b|\brazer\b/i;
const BUTTON_PHRASE = new RegExp(String.raw `\b(?:(?:mouse )?button\s*#?\d{1,2}|${BTN} side(?: button)?|side ${BTN}(?: button)?|${BTN}(?: thumb)? button|(?:side|thumb) button)\b`, "i");
const MOUSEISH = new RegExp(`${MOUSE.source}|${BUTTON_PHRASE.source}|\\bthumb\\b`, "i");
const KEYWORD = String.raw `(?:cmd|command|ctrl|control|opt|option|alt|shift)`;
const ACTION_PHRASE = new RegExp([
    String.raw `stage ?manager`, String.raw `mission ?control`, String.raw `app ?expos[eé]`, String.raw `show (?:the |my )?desktop`, String.raw `launch ?pad`,
    String.raw `notification ?(?:center|centre)`, String.raw `(?:left|right|previous|next|last) (?:desktop|space)`, String.raw `(?:desktop|space) (?:to the |on the )?(?:left|right)`,
    String.raw `(?:full |whole |entire )?screen ?(?:shot|capture)`, String.raw `spotlight`, String.raw `(?:summon|wake|call|bring up) orion`, String.raw `talk to orion`, String.raw `type to orion`, String.raw `(?:the )?(?:text|typing) (?:box|window|bar|input)`,
    String.raw `${KEYWORD}(?:\s*\+\s*|\s+)(?:${KEYWORD}(?:\s*\+\s*|\s+))*[a-z0-9]\b`, String.raw `(?:open|launch) [a-z0-9][a-z0-9 .'&-]{1,28}?(?=$|[.,!?]| (?:in|on|when|while|only|just)\b)`,
    String.raw `(?:its|it's) normal`,
].join("|"), "i");
const APP_TAIL = /\b(?:only |just )?(?:in|inside|when (?:i'?m |im |i am )?(?:in|using|on|playing)|while (?:i'?m |im |i am )?(?:in|using|on|playing))\s+(?:the )?([a-z0-9][a-z0-9 .'&-]{1,30}?)\s*[.!]?$/i;
const NOT_APP = /^(?:general|everything|every ?thing|every app|all apps|all of them|any app|everywhere|default|there|here)$/i;
const BIND_VERB = /\b(?:make|set|bind|map|assign|remap|rebind|change|put|have|let)\b/i;
const QUESTION = /^(?:what|which|how|is|are|does|do you|can you tell|tell me|show|list|check|read)\b|\?\s*$/i;
const STATUS_WORD = /\b(?:set to|bound|mapped|doing|does|do|settings?|bindings?|configured|assigned|currently|right now|status|each|all)\b/i;
const CLEAR_VERB = /\b(?:unbind|unmap|clear|reset|remove|unassign|disable|back to (?:normal|default)|normal again|default again|stock)\b/i;
const GAMES = /\bgames? (?:detection|mode)\b|\bauto[- ]?(?:ignore|passthrough|pass through)\b|\b(?:ignore|leave alone|pass through|dont touch|don'?t touch) (?:the |my )?(?:mouse|buttons?) (?:in|for|during) games\b/i;
const OFF = /\b(?:off|disable|stop|dont|don'?t|do not|no longer|without|never)\b/i;
const NEG = /\b(?:dont|don'?t|do not|never|stop|no|disable|ignore|leave|bypass|pass ?through|turn off)\b/i;
const REMOVE = /\b(?:stop ignoring|stop leaving|stop disabling|re-?enable|turn (?:it|them|the \w+) back on|(?:work|working|active|on) again|should work|start working|work normally)\b/i;
const SETUP = /\b(?:set ?up|setup|configure|customi[sz]e)\b[^?]*\b(?:my |the |this )?(?:new )?mouse\b|\bget\b[^?]*\bmouse\b[^?]*\bset ?up\b|\bnew mouse\b[^?]*\b(?:set ?up|configure)\b/i;
// "pull up the mouse button mapper again", "open the mouse thing", "show me the mouse setup", "bring back the button mapper": the popup, again.
const REOPEN_VERB = /\bpull\b[^.?!]*\bup\b|\b(?:bring(?: it| that)?(?: back)? up|bring(?: it| that)? back|bring\b[^.?!]*\bback|s[ua]m+[ou]n\w*|op[en]\w{0,2}(?: up)?|re-?open\w*|show(?: me)?|launch|display|fire up|load|pop up|put (?:it )?back|get(?: it)? back)\b/;
const MOUSEW = String.raw `(?:mouse|mous|mose|mice)`;
const BTNW = String.raw `(?:buttons?|butt?ons?|btns?)`;
const REOPEN_THING = new RegExp(String.raw `\bmapp?e?r\b|\b(?:${MOUSEW}|${BTNW})(?: ${BTNW})? (?:setup|set up|thing|popup|pop up|window|panel|screen|config(?:uration)?|mapping|settings|menu)\b|\b${MOUSEW} ${BTNW}\b`);
/** The popup named with no verb at all: "mouse settings", "button mapper", "mouse button settings". */
const REOPEN_BARE = new RegExp(String.raw `^(?:(?:yo|hey|ok|okay|orion|pls|please|the|my|that)\s+)*(?:${MOUSEW}|${BTNW})(?: ${BTNW})? (?:mapper|mappr|maper|settings|setup|mapping)(?:\s+(?:again|pls|please|thing))*$|^(?:(?:yo|hey|ok|okay|orion|pls|please|the|my|that)\s+)*mapper(?:\s+(?:again|pls|please))*$`);
const READING = /\b(?:set to|bound|mapped to|doing|currently|right now|assigned|configured)\b/;
const GAMEY = /\b(?:minecraft|fortnite|valorant|roblox|steam|league|overwatch|cs2|csgo|apex|genshin|game|games)\b/i;
const YES = /^(?:y|ye|ya|yea|yeah|yes|yep|yup|ok|okay|k|sure|alright|aight|do it|go ahead|sounds good|that works|perfect|fine|please|yes please|sure thing|lets do it|let'?s do it|set it up|set it|do that|go for it)(?: (?:please|orion|do it|thanks|thx|that'?s fine))?[.!]*$/;
const NO = /^(?:no|nah|nope|not now|later|not yet|skip|no thanks|nah im good|maybe later|not really|leave it|dont|don'?t)[.!]*$/;
const CANCEL = /^(?:cancel|never ?mind|nvm|forget it|leave it|dont bother|don'?t bother)[.!]*$/;
const APP_LEAD = /^(?:in|when (?:i'?m |im |i am )?(?:in|using|on|playing)|while (?:i'?m |im |i am )?(?:in|using|on|playing))\s+(?:the )?([a-z0-9][a-z0-9 .'&-]{1,30}?)[, ]+(?=make|set|have|let|put|bind|map|the|my)/i;
const lastIn = (said) => {
    const app = (APP_LEAD.exec(said) ?? APP_TAIL.exec(said))?.[1]?.trim();
    return app && !NOT_APP.test(app) ? app : undefined;
};
const buttonOf = (said) => (BUTTON_PHRASE.exec(said)?.[0] ?? "").replace(/^(?:the |my )/, "");
/** "nothing" is an action only as a binding ("make it do nothing", "set back button to nothing") or a bare reply, never in "my mouse does nothing". */
const actionOf = (said) => ACTION_PHRASE.exec(said)?.[0]?.trim()
    ?? (/^(?:do )?nothing$/.test(said) || (BIND_VERB.test(said) && /\b(?:do|to|be) nothing\b/.test(said)) ? "nothing" : "");
/** His reply to "which button?" / "what should it do?". */
function readAnswer(said, p) {
    if (said.split(" ").length > 8 || /\?/.test(said))
        return null;
    if (p.ask === "button") {
        const digit = /^(?:the )?(?:button )?#?(\d{1,2})$/.exec(said);
        const word = new RegExp(String.raw `^(?:the |my )?(${BTN})(?: one| side| button| side button)?$`).exec(said);
        const phrase = digit ? `button ${digit[1]}` : word ? word[1] : buttonOf(said);
        if (!phrase)
            return null;
        return p.clear ? { kind: "clear", button: phrase, ...(p.app ? { app: p.app } : {}) } : { kind: "set", button: phrase, action: p.action ?? "", ...(p.app ? { app: p.app } : {}) };
    }
    const action = actionOf(said);
    return action && p.button ? { kind: "set", button: p.button, action, ...(p.app ? { app: p.app } : {}) } : null;
}
const CLAUSE_SPLIT = new RegExp(String.raw `\s*(?:,|;|\band\b|\bthen\b|\balso\b)\s*(?=(?:the |my )?(?:mouse )?(?:${BTN}|side|thumb|button\s*#?\d))`, "i");
const BARE_PAIR = new RegExp(String.raw `^(?:the |my )?(${BTN})(?: side)?(?: button)?(?: should| to| do| does| is| =)*\s+(?:be |do |go to |open )?(.+)$`, "i");
/** "front stage manager, back mission control": two or more clauses that each name a button and an action. */
function readMany(said) {
    const clauses = said.split(CLAUSE_SPLIT).map((x) => x.trim()).filter(Boolean);
    if (clauses.length < 2 || clauses.length > 4)
        return null;
    const turns = [];
    for (const clause of clauses) {
        const one = readOne(clause, {});
        if (one?.kind === "set" && one.button && one.action) {
            turns.push(one);
            continue;
        }
        const bare = BARE_PAIR.exec(clause);
        const action = bare ? actionOf(bare[2].trim()) : "";
        if (!bare || !action)
            return null;
        turns.push({ kind: "set", button: bare[1].toLowerCase(), action: /^(?:open|launch)/i.test(bare[2].trim()) ? bare[2].trim() : action });
    }
    return { kind: "many", turns };
}
/** The mouse turn in his message, or null. */
export function readMouseTurn(message, c = {}) {
    const said = flat(message.trim().replace(/\s+/g, " "));
    if (!c.pending && !c.confirm && said.length <= 400) {
        const many = readMany(said);
        if (many)
            return many;
    }
    return readOne(message, c);
}
function readOne(message, c) {
    const m = message.trim().replace(/\s+/g, " ");
    const said = flat(m);
    if (!said || m.length > 400)
        return null;
    if (c.pending) {
        if (CANCEL.test(said))
            return { kind: "cancel" };
        const answer = readAnswer(said, c.pending);
        if (answer)
            return answer;
    }
    if (c.confirm || c.outreachAbout) {
        if (YES.test(said))
            return c.confirm ? { kind: "apply" } : { kind: "setup" };
        if (NO.test(said))
            return { kind: "decline" };
    }
    const mouseish = MOUSEISH.test(said);
    if (SETUP.test(said) && MOUSE.test(said) && !QUESTION.test(said))
        return { kind: "setup" };
    if (GAMES.test(said))
        return { kind: "games", state: OFF.test(said) ? "off" : "on" };
    const app = lastIn(said);
    const anything = /\bdo (?:anything|stuff|a thing)\b/.test(said);
    const buttons = /\b(?:mouse|buttons?|clicks?)\b/.test(said);
    if (app && REMOVE.test(said) && (buttons || GAMEY.test(app)))
        return { kind: "passthrough", op: "remove", app };
    if (app && NEG.test(said) && !BIND_VERB.test(said) && (buttons || (anything && GAMEY.test(app))))
        return { kind: "passthrough", op: "add", app };
    const asked = /^(?:what|which|how|why|is|are|does|do)\b/.test(said);
    if (!BIND_VERB.test(said) && !asked && ((REOPEN_VERB.test(said) && REOPEN_THING.test(said) && !READING.test(said)) || REOPEN_BARE.test(said)))
        return { kind: "setup", again: true };
    if (QUESTION.test(said))
        return mouseish && STATUS_WORD.test(said) || (MOUSE.test(said) && /\b(?:buttons?|settings?|bindings?)\b/.test(said)) ? { kind: "status" } : null;
    if (!mouseish)
        return null;
    if (CLEAR_VERB.test(said) && !actionOf(said).replace(/^nothing$/i, ""))
        return { kind: "clear", button: buttonOf(said), ...(app ? { app } : {}) };
    const action = actionOf(said);
    if (!action && !(BIND_VERB.test(said) && buttonOf(said)))
        return /\b(?:mouse (?:settings|buttons|bindings))\b/.test(said) ? { kind: "status" } : null;
    const scoped = app && action && !action.toLowerCase().includes(app.toLowerCase()) ? app : undefined;
    return { kind: "set", button: buttonOf(said), action, ...(scoped ? { app: scoped } : {}) };
}
