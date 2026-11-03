// Friendly words for the mouse (orion-mouse): buttons, actions and apps, each resolved against the shared contract
// (~/.openclaw/orion-controlled/mouse/bindings.json, written by the Mac app and by orion-mouse).
//
// BUTTONS. The contract's keys are CGEvent button numbers: 0 left, 1 right, 2 middle, 3+ extras. What he says maps like this:
//   "back", "side back", "back side", "rear side", "thumb back"              -> 3   (the rear side button, the box's "button 4")
//   "front", "forward", "side front", "front side", "thumb front"            -> 4   (the front side button, the box's "button 5")
//   "button N", "btn N", "mouse button N"  (N counts from 1, as the box does) -> N-1   (button 4 = 3, button 5 = 4, button 6 = 5 ...)
//   a bare integer ("3")                                                     -> that CGEvent number
//   "side button" alone is ambiguous: the caller asks "the front or the back one?". Left, right and the wheel click (0-2) are refused.
import { execFileSync } from "node:child_process";

export const FIRST_EXTRA = 3;
export const LAST_EXTRA = 31;

const flat = (s) => String(s ?? "").toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9+' .\-]/g, " ").replace(/\s+/g, " ").trim();
const FIXED = "the left, right and wheel buttons stay as they are; I can only remap the extra buttons";

function fromIndex(n) {
  if (n >= 0 && n < FIRST_EXTRA) return { error: FIXED };
  if (n < FIRST_EXTRA || n > LAST_EXTRA) return { error: `there is no mouse button ${n + 1}` };
  return { n };
}

/** { n } for a button, { ask: "button" } when it cannot be told, { error } when it is not remappable. */
export function parseButton(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ask: "button" };
  if (/^\d{1,2}$/.test(raw)) return fromIndex(Number(raw));
  const text = flat(raw);
  const numbered = /\b(?:button|btn)\s*#?(\d{1,2})\b/.exec(text) ?? /^#(\d{1,2})$/.exec(text);
  if (numbered) return fromIndex(Number(numbered[1]) - 1);
  const s = text.replace(/\b(?:the|my|mouse|thumb|button|one|side|please)\b/g, " ").replace(/\s+/g, " ").trim();
  const back = /\b(?:back|rear|behind|bottom)\b/.test(s), front = /\b(?:front|forward|fwd|top)\b/.test(s);
  if (back && front) return { ask: "button" };
  if (back) return { n: 3 };
  if (front) return { n: 4 };
  if (/\b(?:left|right|middle|wheel|scroll)\b/.test(s)) return { error: FIXED };
  return { ask: "button" };
}

export const buttonLabel = (n) => (n === 3 ? "back side button" : n === 4 ? "front side button" : `button ${n + 1}`);

const SYSTEM = {
  missionControl: ["Mission Control", /\bmission ?control\b|\bexpose all\b|\ball (?:my )?windows\b/],
  appExpose: ["App Exposé", /\bapp ?expos[eé]\b|\bapplication windows\b/],
  stageManager: ["Stage Manager", /\bstage ?manager\b/],
  showDesktop: ["Show Desktop", /\bshow (?:the |my )?desktop\b|\bclear (?:the )?desktop\b/],
  launchpad: ["Launchpad", /\blaunch ?pad\b/],
  desktopLeft: ["the left desktop", /\b(?:left|previous|prev|last)\s+(?:desktop|space)\b|\b(?:desktop|space)\s+(?:to the |on the )?left\b/],
  desktopRight: ["the right desktop", /\b(?:right|next)\s+(?:desktop|space)\b|\b(?:desktop|space)\s+(?:to the |on the )?right\b/],
  notificationCenter: ["Notification Center", /\bnotification ?(?:center|centre)\b|\bnotifications\b/],
};
const SHORTCUTS = [
  ["a full-screen screenshot", "cmd+shift+3", /\b(?:full|whole|entire) (?:screen ?shot|screen)\b/],
  ["a screenshot", "cmd+shift+4", /\bscreen ?shot\b|\bscreen ?capture\b|\bsnip\b/],
  ["Spotlight", "cmd+space", /\bspotlight\b/],
  ["copy", "cmd+c", /^copy$/], ["paste", "cmd+v", /^paste$/], ["undo", "cmd+z", /^undo$/],
  ["new tab", "cmd+t", /\bnew tab\b/], ["close tab", "cmd+w", /\bclose (?:the )?(?:tab|window)\b/],
  ["lock screen", "ctrl+cmd+q", /\block (?:the |my )?screen\b/],
];
const ORION = {
  summon: /\b(?:summon|wake|bring up|call) orion\b|\borion summon\b/,
  talk: /\btalk to orion\b|\bspeak to orion\b/,
  dashboard: /\b(?:orion )?dashboard\b/,
  type: /\btype to orion\b|\btext (?:box|window|input|bar)\b|\btyping (?:box|bar|window|input)\b|\btype (?:box|overlay)\b/,
};
const MODS = { cmd: "cmd", command: "cmd", ctrl: "ctrl", control: "ctrl", opt: "opt", option: "opt", alt: "opt", shift: "shift", fn: "fn" };
const MOD_ORDER = ["cmd", "ctrl", "opt", "shift", "fn"];
const KEYS = /^(?:[a-z0-9]|space|tab|return|enter|escape|esc|delete|backspace|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1\d|20)|[-=;',./`])$/;
const KEY_ALIAS = { esc: "escape", enter: "return", backspace: "delete" };

/** Modifiers plus a key ("cmd+shift+4", "command shift 4", "control option left") as the contract's "keys", or null. */
export function parseKeys(text) {
  const parts = flat(text).replace(/\+/g, " ").split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts.at(-1), mods = parts.slice(0, -1).map((p) => MODS[p]);
  if (mods.some((m) => !m) || !KEYS.test(key)) return null;
  const set = [...new Set(mods)].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return `${set.join("+")}+${KEY_ALIAS[key] ?? key}`;
}

const LEAD = /^(?:do|be|go to|switch to|trigger|run|show|bring up|activate|use)\s+(?=(?:the )?(?:stage|mission|app|launch|notification|left|right|previous|next|desktop|screen))/;

/** { action, label } | { ask: "action" } | { error } | { app: <phrase> } (an app to open, resolved by the caller). */
export function parseAction(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ask: "action" };
  const s = flat(raw).replace(LEAD, "");
  for (const [name, [label, re]] of Object.entries(SYSTEM)) if (re.test(s)) return { action: { kind: "system", name }, label };
  const keys = parseKeys(raw);
  if (keys) return { action: { kind: "shortcut", keys }, label: `the ${keys} shortcut` };
  for (const [label, k, re] of SHORTCUTS) if (re.test(s)) return { action: { kind: "shortcut", keys: k }, label };
  for (const [command, re] of Object.entries(ORION)) if (re.test(s)) return { action: { kind: "orion", command }, label: `ORION ${command}` };
  if (/^(?:nothing|do nothing|normal|default|passthrough|pass ?through|regular|usual|its normal|stock|no action)$/.test(s)) return { action: { kind: "passthrough" }, label: "its normal behavior" };
  const open = /^(?:open|launch|start|switch to|go to)\s+(?:the )?(.+?)(?: app)?$/.exec(s);
  if (open) return { app: open[1] };
  return { error: `I don't have an action called "${raw.slice(0, 40)}". I can do Stage Manager, Mission Control, App Exposé, Show Desktop, Launchpad, Notification Center, the left or right desktop, a screenshot, a keyboard shortcut like cmd+shift+4, open an app, or summon ORION` };
}

/** A sentence-ready name for an Action. `appName` turns a bundle id into the name he knows. */
export function actionLabel(a, appName = (id) => id) {
  if (a?.kind === "system") return SYSTEM[a.name]?.[0] ?? a.name;
  if (a?.kind === "shortcut") return SHORTCUTS.find((x) => x[1] === a.keys)?.[0] ?? `the ${a.keys} shortcut`;
  if (a?.kind === "openApp") return `open ${appName(a.bundleId)}`;
  if (a?.kind === "orion") return `ORION ${a.command}`;
  if (a?.kind === "passthrough") return "its normal behavior";
  return "something I don't recognize";
}

/** Common apps by the names he says. Bundle ids are exact; anything else is looked up on this Mac only when needed. */
export const BUILTIN_APPS = {
  minecraft: ["com.mojang.minecraftlauncher", "Minecraft"], "minecraft launcher": ["com.mojang.minecraftlauncher", "Minecraft"],
  safari: ["com.apple.Safari", "Safari"], chrome: ["com.google.Chrome", "Chrome"], "google chrome": ["com.google.Chrome", "Chrome"],
  firefox: ["org.mozilla.firefox", "Firefox"], arc: ["company.thebrowser.Browser", "Arc"], finder: ["com.apple.finder", "Finder"],
  mail: ["com.apple.mail", "Mail"], messages: ["com.apple.MobileSMS", "Messages"], notes: ["com.apple.Notes", "Notes"],
  music: ["com.apple.Music", "Music"], calendar: ["com.apple.iCal", "Calendar"], preview: ["com.apple.Preview", "Preview"],
  terminal: ["com.apple.Terminal", "Terminal"], "system settings": ["com.apple.systempreferences", "System Settings"],
  xcode: ["com.apple.dt.Xcode", "Xcode"], vscode: ["com.microsoft.VSCode", "VS Code"], "vs code": ["com.microsoft.VSCode", "VS Code"],
  spotify: ["com.spotify.client", "Spotify"], discord: ["com.hnc.Discord", "Discord"], slack: ["com.tinyspeck.slackmacgap", "Slack"],
  zoom: ["us.zoom.xos", "Zoom"], steam: ["com.valvesoftware.steam", "Steam"], photoshop: ["com.adobe.Photoshop", "Photoshop"],
  figma: ["com.figma.Desktop", "Figma"], obsidian: ["md.obsidian", "Obsidian"], notion: ["notion.id", "Notion"],
};
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 .&'_-]{0,39}$/;

/** The bundle id of an installed app by name (Spotlight metadata via mdfind and mdls; nothing is launched). Null when there is none. */
function lookupOnMac(name) {
  if (process.env.ORION_MOUSE_NO_LOOKUP || !SAFE_NAME.test(name)) return null;
  try {
    const found = execFileSync("mdfind", [`kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '${name.replace(/'/g, "")}'c`], { encoding: "utf8", timeout: 5000 });
    for (const path of found.split("\n").filter(Boolean).slice(0, 3)) {
      const id = execFileSync("mdls", ["-name", "kMDItemCFBundleIdentifier", "-raw", path], { encoding: "utf8", timeout: 5000 }).trim();
      if (BUNDLE.test(id)) return id;
    }
  } catch { /* none */ }
  return null;
}

/** The name he knows an app by, from a bundle id. */
export const appNameOf = (bundleId) => Object.values(BUILTIN_APPS).find(([id]) => id === bundleId)?.[1] ?? bundleId;

/** { bundleId, name } or { error }. A bundle id passes as written; a name goes through the table, then this Mac. */
export function resolveApp(input, { lookup = lookupOnMac } = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "which app?" };
  if (BUNDLE.test(raw)) return { bundleId: raw, name: appNameOf(raw) };
  const key = flat(raw).replace(/^the /, "").replace(/ app$/, "");
  const hit = BUILTIN_APPS[key];
  if (hit) return { bundleId: hit[0], name: hit[1] };
  const display = raw.replace(/^the /i, "").replace(/ app$/i, "").trim();
  const id = lookup(display);
  return id ? { bundleId: id, name: display } : { error: `I couldn't find an app called "${raw.slice(0, 40)}" on this Mac` };
}
