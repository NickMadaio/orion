/*
 Which chat turns are about the apps open on his Mac (w18 apps, 2026-11-03). Pure: apps-chat.ts carries them out through scripts/orion-apps.

 Nick, after ORION said "I can't quit apps directly": "he should have these abilities, why are we limiting him."

   list     "what apps do i have open", "whats running"
   unused   "close the apps im not using", "clean up my open apps", "close some of the apps that are open that im not using. things like epic games"
            (apps named after "like"/"such as" are closed too: they are the examples he meant)
   except   "close everything except chrome", "quit all apps but spotify and discord"
   quit     "quit spotify and discord", "close epic games", "kill teamviewer"
   hide     "hide chrome"

 Not about apps: "quit smoking", "close the door", "close this tab", "close it" (nothing to name), a question about how to close something.
 An unclear which-apps request is the sensible quit-unused, never a question: these actions are pre-approved and harmless.
*/
export type AppsTurn =
  | { kind: "list" }
  | { kind: "unused"; also: string[] }
  | { kind: "except"; keep: string[] }
  | { kind: "quit"; names: string[] }
  | { kind: "hide"; name: string }
  | { kind: "gameMode"; on: boolean }
  | { kind: "gameReady"; game?: string }
  | { kind: "gameKeep"; op: "add" | "remove"; names: string[] }
  | { kind: "gameLast" };

const flat = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const VERB = String.raw`(?:close|quit|shut ?down|shut|kill|exit|force quit|force close|get rid of|ditch|clear out|clean up|cleanup)`;
const FILLER = /^(?:the|my|all|some|these|those|that|this|app|apps|application|applications|program|programs|please|pls|for me|real quick|rn|now|out|off)$/;
// Words that make "close X" / "quit X" something other than an app.
const NOT_APP = /\b(?:smoking|vaping|job|school|work|uni|class|tab|tabs|window|windows|door|deal|eyes|chat|conversation|loop|account|day|gap|issue|ticket|pr|file|folder|document|doc|it|that|this|them|one|everything|anything|something|stuff|apps?|programs?|processes|session|focus|call|meeting|ring|rings|bar|menu|popup|pop up|notification|notifications|dock|screen|lid|laptop|volume|sound)\b/;
const ASK = /^(?:how|what|why|when|where|who|which|can't|cant|cannot|is|are|does|do|did|should|would|could|will|am i|have i)\b|\?\s*$/;

const cleanName = (raw: string): string => raw.split(" ").filter((w) => w && !FILLER.test(w)).join(" ").replace(/[.!,]+$/, "").trim();
const splitNames = (text: string): string[] => text.split(/\s*(?:,|&|\band\b|\bplus\b|\bn\b|\bas well as\b|\bthen\b)\s*/).map(cleanName).filter((n) => n.length >= 2);
const appish = (n: string) => n.split(" ").length <= 3 && !NOT_APP.test(n) && !/^[a-z]+ing\b/.test(n) && !/^(?:i|im|i'm|you|ur|it|he|she|they)\b/.test(n);

const LIST = [
  /\b(?:what|which)\s+(?:apps?|programs?|applications?|stuff)\b.*\b(?:open|running|up|on)\b/,
  /\b(?:what|whats|what's)\s+(?:do i have\s+|have i got\s+|is\s+|all\s+)?(?:open|running)\b(?!\s+(?:source|ai|house|hours))/,
  /\b(?:show|list|tell|give)\s+(?:me\s+)?(?:all\s+)?(?:my\s+|the\s+)?(?:open|running)\s+(?:apps?|programs?|applications?)\b/,
  /\b(?:show|list)\s+(?:me\s+)?(?:my\s+|the\s+|all\s+)?apps\b.*\b(?:open|running)\b/,
  /\bhow many apps\b.*\b(?:open|running)\b/,
];
const UNUSED = new RegExp(String.raw`\b${VERB}\b.*\b(?:apps?|programs?|applications?|stuff|things|windows)\b.*\b(?:not using|not in use|dont need|don't need|not needed|aint using|ain't using|isnt using|not gonna use|dont use|don't use|not usin|unused|idle|extra|i dont|im not|i'm not|i am not|that arent|that aren't|nobody)\b|\b${VERB}\b.*\b(?:unused|idle|extra|unneeded)\s+(?:apps?|programs?|applications?|stuff)\b|\b${VERB}\s+(?:everything|all(?: of)? (?:it|that|them)|the rest|the rest of (?:them|it))\b.*\b(?:not using|dont need|don't need|im not|i'm not)\b|\b(?:close|quit|clean up|cleanup|clear out)\s+(?:some|a few|a bunch|most)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:open\s+)?(?:apps?|programs?)\b|\b(?:clean up|cleanup|tidy|declutter)\s+(?:my\s+|the\s+)?(?:open\s+|running\s+)?(?:apps?|programs?|mac|computer|laptop)\b|\b(?:i have|theres|there's|there are|got)\s+(?:too many|a bunch of|way too many|so many|a lot of)\s+(?:apps?|programs?)\b.*\b(?:open|running)\b`);
const EXCEPT = /\b(?:close|quit|shut ?down|shut|kill|exit)\s+(?:all|all of|every|everything|all my|all the|all open|every app|all apps)\b(?:\s+(?:apps?|programs?|else))?\s*(?:except|but|besides|other than|apart from|aside from|just keep|leave|keeping|and keep)\s+(.+)$/;
const EXCEPT2 = /\b(?:keep|leave)\s+(.+?)\s+(?:open|running|on)?\s*(?:,|and|but|then)?\s*(?:and\s+)?(?:close|quit|shut|kill)\s+(?:the\s+)?(?:rest|everything else|all the others|everything|all of the others|the others)\b/;
const LIKE = /\b(?:things? like|stuff like|such as|like|e\.?g\.?|for example|especially|mainly|including)\s+(.+)$/;
const QUIT = new RegExp(String.raw`^(?:(?:can you|could you|will you|would you|please|pls|hey|ok|okay|orion|yo|just|go ahead and|go|now|also|and)[,\s]+)*${VERB}\s+(?:out of\s+)?(.+)$`);
const HIDE = /^(?:(?:can you|could you|please|pls|hey|orion|just)[,\s]+)*(?:hide|minimi[sz]e)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|window))?$/;

// Game mode (w18 gamemode): "game mode on/off", "dont close discord when i game", "what did you close". Carried out by `orion-apps game-prep`.
const GM = String.raw`(?:game|gaming)\s*mode`;
const GAMING = String.raw`(?:when|while|whenever)\s+(?:i|im|i'm|we)\s+(?:am\s+|start\s+|started\s+|go\s+)?(?:gam(?:e|es|ing)|play(?:ing)?(?:\s+games?)?)\b`;
const GM_OFF = new RegExp(String.raw`\b${GM}\s+off\b|\bturn\s+off\s+(?:the\s+|my\s+)?${GM}|\b(?:disable|deactivate|stop|end|exit|cancel)\s+(?:the\s+|my\s+)?${GM}`);
const GM_ON = new RegExp(String.raw`\b${GM}\s+on\b|\b(?:turn|switch|put|flip)\s+(?:on\s+)?(?:the\s+|my\s+)?${GM}|\b(?:enable|activate|start)\s+(?:the\s+|my\s+)?${GM}`);

// Game ready on demand (w18 gameready): "make my computer game ready", "prep for gaming", "im about to play minecraft, clean up". Runs the prep right now.
const MACHINE = String.raw`(?:mac|macbook|computer|compter|comp|laptop|pc|machine|setup)`;
const READY_WORD = String.raw`gam(?:e|ing)\s*r(?:ea|e)?d(?:y|ie)`;
const READY_NOT = /\bgame ready (?:drivers?|mean|means|meaning|nvidia|geforce|ready)\b|\bdrivers?\b/;
const READY_GENERIC = new RegExp([
  String.raw`\b${READY_WORD}\b`,
  String.raw`\b(?:gaming|game)\s+prep\b`,
  String.raw`\b(?:get|make|prep|prepare|set up|setup)\s+(?:me\s+|my\s+|the\s+)?(?:${MACHINE}\s+)?(?:ready\s+)?(?:for|to)\s+(?:gaming|games?|a game|game time|play(?:ing)?(?:\s+games?)?|game)\b`,
  String.raw`\b(?:get|make|prep|prepare)\s+(?:me\s+)?ready\s+(?:for|to)\s+(?:gaming|game|play\s+games?)\b`,
  String.raw`^(?:pls\s+|please\s+)?prep\s+(?:for\s+)?(?:gaming|games?)\b`,
].join("|"));
const KNOWN_GAMES = "minecraft|fortnite|valorant|roblox|league of legends|league|overwatch|cs2|csgo|counter strike|apex(?: legends)?|genshin(?: impact)?|rocket league|gta(?: ?v| 5)?|call of duty|cod|warzone|elden ring|terraria|stardew(?: valley)?|dota(?: 2)?|wow|world of warcraft|hearthstone|rust|palworld|helldivers(?: 2)?|diablo(?: 4| iv)?|civ(?:ilization)?(?: ?\\d)?|among us|fifa|baldurs gate(?: 3)?";
const READY_NAMED = new RegExp(String.raw`\b(?:get|make|prep|prepare|set up|setup)\s+(?:my\s+)?${MACHINE}\s+(?:ready\s+)?for\s+(?:some\s+)?(${KNOWN_GAMES})\b|^(?:pls\s+|please\s+)?(?:prep|prepare)\s+(?:my\s+${MACHINE}\s+)?for\s+(${KNOWN_GAMES})\b`);
const ABOUT_TO = String.raw`(?:about to|abt to|bout to|going to|gonna|finna|fixing to|wanna|want to|boutta)\s+(?:play|game|start playing|get on|hop on|jump on)(?:\s+some)?`;
const CLEAN_TAIL = String.raw`(?:clean(?:\s*up)?|tidy(?:\s*up)?|prep|get ready|free up|close (?:everything|apps|stuff|things|the rest)|get (?:my )?${MACHINE} ready|clean up (?:my )?(?:${MACHINE}|apps|everything|stuff|things)|prep (?:my )?${MACHINE}|clean (?:my )?${MACHINE} up)(?:\s+(?:up|for me|pls|please|rn|real quick|now))*`;
const READY_ABOUT = new RegExp(String.raw`\b${ABOUT_TO}\s+([a-z0-9][a-z0-9' ]{1,28}?)\s*(?:[,.;]|\bso\b|\band\b|\bcan you\b|\bcould you\b|\bplease\b|\bpls\b|\brn\b)?\s*(?:can you\s+|could you\s+|pls\s+|please\s+)?${CLEAN_TAIL}\s*$`);
const READY_ABOUT_LEAD = new RegExp(String.raw`^(?:${CLEAN_TAIL})\s+(?:cause|because|im|i'm|i am)?\s*${ABOUT_TO}\s+([a-z0-9][a-z0-9' ]{1,28}?)\s*$`);
const GAME_NAME_STOP = /^(?:a game|games?|some games?|something|a bit|later|tonight)$/;

function readReadyTurn(m: string): AppsTurn | null {
  if (READY_NOT.test(m)) return null;
  const named = READY_NAMED.exec(m);
  const game = named?.[1] ?? named?.[2];
  if (game) return { kind: "gameReady", game };
  const about = READY_ABOUT.exec(m) ?? READY_ABOUT_LEAD.exec(m);
  const name = about?.[1]?.trim();
  if (name && !GAME_NAME_STOP.test(name)) return { kind: "gameReady", game: name };
  if (about) return { kind: "gameReady" };
  return READY_GENERIC.test(m) ? { kind: "gameReady" } : null;
}
const GAME_LAST = /\bwhat\s+(?:apps?\s+|programs?\s+|stuff\s+)?(?:did|have)\s+(?:you|u|ya)\s+(?:just\s+)?(?:close|quit|shut(?:\s*down)?|kill|end)\b/;
const KEEP_ADD = [
  new RegExp(String.raw`\b(?:dont|don't|do not|never|stop|no need to)\s+(?:close|closing|quit|quitting|kill|killing|shut(?:ting)?(?:\s*down)?)\s+(.+?)\s+${GAMING}`),
  new RegExp(String.raw`\b(?:keep|leave)\s+(.+?)(?:\s+(?:open|running|on|alive))?\s+${GAMING}`),
];
const KEEP_REMOVE = [
  new RegExp(String.raw`\blet\s+(.+?)\s+(?:close|quit)(?:\s+again)?\s+${GAMING}`),
  new RegExp(String.raw`\b(?:you can|u can|go ahead and|feel free to|ok to|go back to)\s+(?:close|closing|quit|quitting|shut(?:ting)?(?:\s*down)?)\s+(.+?)(?:\s+again)?\s+${GAMING}`),
  new RegExp(String.raw`^(?:pls\s+|please\s+)?(?:close|quit)\s+(.+?)(?:\s+again)?\s+${GAMING}`),
];
const GAME_ASK = /^(?:how|what|why|when|where|who|which|is|are|does|did)\b/;

function readGameTurn(m: string): AppsTurn | null {
  if (GAME_LAST.test(m)) return { kind: "gameLast" };
  if (GAME_ASK.test(m)) return null;
  if (GM_OFF.test(m)) return { kind: "gameMode", on: false };
  if (GM_ON.test(m)) return { kind: "gameMode", on: true };
  const ready = readReadyTurn(m);
  if (ready) return ready;
  for (const [op, res] of [["add", KEEP_ADD], ["remove", KEEP_REMOVE]] as const) {
    for (const re of res) {
      const hit = re.exec(m);
      const names = splitNames((hit?.[1] ?? "").replace(/\bor\b/g, "and")).filter(appish);
      if (hit && names.length) return { kind: "gameKeep", op, names };
    }
  }
  return null;
}

export function readAppsTurn(message: string): AppsTurn | null {
  const m = flat(message).replace(/[.!]+$/, "");
  if (!m || m.length > 220) return null;
  const game = readGameTurn(m);
  if (game) return game;
  const asks = ASK.test(m);
  if (LIST.some((re) => re.test(m)) && !/\b(?:close|quit|kill)\b/.test(m)) return { kind: "list" };
  if (asks) return null;
  const ex = EXCEPT.exec(m) ?? EXCEPT2.exec(m);
  if (ex) { const keep = splitNames(ex[1] ?? "").filter(appish); if (keep.length) return { kind: "except", keep }; }
  if (UNUSED.test(m)) {
    const like = LIKE.exec(m);
    const also = like ? splitNames(like[1] ?? "").filter(appish) : [];
    return { kind: "unused", also };
  }
  const h = HIDE.exec(m);
  if (h) { const name = cleanName(h[1] ?? ""); if (name && appish(name) && !/\band\b/.test(name)) return { kind: "hide", name }; }
  const q = QUIT.exec(m);
  if (q) {
    const body = (q[1] ?? "").replace(/\s+(?:for me|please|pls|real quick|rn|right now|now)$/, "");
    const names = splitNames(body);
    if (names.length && names.every(appish)) return { kind: "quit", names };
  }
  return null;
}
