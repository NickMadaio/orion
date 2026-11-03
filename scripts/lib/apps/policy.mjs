// What orion-apps will and will not close, and how a spoken name finds an app. Pure: no process, no disk.
// An app is { name, bundleId, pid, path, kind: "regular"|"accessory", frontmost, windows, onscreen, rank, audible, document }.
//   kind accessory = a menu-bar or background app (Epic Games Launcher, Spotify's helper, TeamViewer's agent): no Dock icon.
//   onscreen = windows you can see right now (not hidden, not minimized). rank = 0 for the app whose window is in front, 1 for the next, ...
// "Unused" (documented in the reply too): not in front, not in the RECENT_RANKS windows nearest the front, not playing audio, not protected.
// macOS does not say when an app was last used, so the window stack stands in for it: an app buried under the others, or with nothing
// on screen, is one you have not been in lately.
export const RECENT_RANKS = 3;

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const test = (re, app) => re.test(`${app.name} ${app.bundleId} ${app.path ?? ""}`);

// Never closed, even when named: Finder, ORION and its link, the login window, and the local model server and gateway ORION runs on.
const NEVER = /^ollama|\bopenclaw|com\.electron\.ollama|^finder\b|^orion|orionlink|com\.apple\.finder|com\.apple\.loginwindow|\/orion[^/]*\.app/i;
// Terminals and editors: they may be running work. Skipped by quit-unused, closed when named.
const TERMINAL_IDE = /\b(?:terminal|iterm2?|ghostty|warp|alacritty|kitty|wezterm|claude|xcode|visual studio code|cursor|zed|sublime text|nova|intellij idea|pycharm|webstorm|goland|android studio)\b|com\.googlecode\.iterm2|com\.mitchellh\.ghostty|dev\.warp|com\.microsoft\.vscode|com\.apple\.terminal|com\.apple\.dt\.xcode|com\.anthropic\.claude|com\.jetbrains|dev\.zed|com\.sublimetext/i;
// Apps that can be mid-call or mid-recording; Atlas may be capturing a lecture.
const IN_USE = /\batlas\b|zoom\.us|us\.zoom|facetime|quicktime|voice memos|\bobs\b|com\.obsproject|com\.apple\.voicememos/i;
const SETTINGS = /system settings|system preferences|com\.apple\.systempreferences/i;
// Menu-bar apps do standing jobs (passwords, sync, VPN, window managers): kept by quit-unused unless named. An accessory app counts as
// unused only when it is a launcher, game client, chat, remote-desktop or music app.
const BACKGROUND_LEAVABLE = /epic|steam|battle\.?net|blizzard|riot|roblox|curseforge|overwolf|ubisoft|\bea app\b|origin|gog galaxy|minecraft|discord|spotify|teamviewer|anydesk|whatsapp|telegram|slack|skype|webex|netflix|plex|vlc|twitch/i;

// Game prep closes background apps too, except these: they hold a standing job the Mac would be worse without (passwords, VPN, mouse and
// keyboard drivers, window managers). Anything not here and not on the keep list is closed when he games.
const STANDING_JOB = /1password|bitwarden|lastpass|dashlane|keychain|tailscale|wireguard|vpn|little snitch|karabiner|steermouse|linearmouse|logi|logitech|synapse|bettertouchtool|rectangle|magnet|alfred|raycast|amphetamine|caffeine|hazel|cleanshot|maccy|paste/i;
// A background updater or agent: closes for a game even when its parent app is on the keep list (ZoomUpdater, RazerGameManagerService).
const BACKGROUND_AGENT = /updater|autoupdate|update ?(?:helper|service|agent)|\bagent\b|service\b|daemon|crash ?reporter|helper tool/i;
export const neverClosed = (app) => test(NEVER, app);
/** A windowless menu-bar/background app that is an updater or agent, and not named exactly on the keep list. */
export const isBackgroundAgent = (app, keep = []) => app.kind === "accessory" && !app.windows && test(BACKGROUND_AGENT, app) && !test(STANDING_JOB, app) && !test(NEVER, app)
  && !keep.some((k) => norm(k) && norm(k) === norm(app.name));

/** Why an app is kept by quit-unused, or null when it counts as unused. `all` (close everything except what I named) drops the recent-window and audio protections only. */
export function keptReason(app, { keep = [], all = false, game = false } = {}) {
  if (test(NEVER, app)) return "ORION, the Finder or the model server, never closed";
  const names = [norm(app.name), norm(app.bundleId)];
  if (keep.some((k) => norm(k) && names.some((n) => n === norm(k) || (norm(k).length >= 4 && n.includes(norm(k)))))) return "on your keep list";
  if (app.frontmost) return "you're in it right now";
  if (test(TERMINAL_IDE, app)) return "a terminal or editor that may have work running";
  if (test(IN_USE, app)) return "it may be mid-call or recording";
  if (test(SETTINGS, app)) return "you may be mid-change in it";
  if (app.audible && !all) return "playing audio";
  if (game && app.kind === "accessory") return test(STANDING_JOB, app) ? "a menu-bar utility doing a standing job" : null;
  if (app.kind === "accessory") return test(BACKGROUND_LEAVABLE, app) ? null : "a menu-bar utility doing a standing job";
  if (!all && app.onscreen > 0 && Number.isInteger(app.rank) && app.rank < RECENT_RANKS) return "one of your most recent windows";
  return null;
}

/** How an unused app is described when it is closed. */
export function unusedWhy(app) {
  if (app.kind === "accessory" && !app.windows) return BACKGROUND_AGENT.test(`${app.name} ${app.bundleId}`) ? "a background updater or agent the game doesn't need" : "a background app with no window";
  if (!app.onscreen) return app.windows ? "its windows are hidden or minimized" : "no window open";
  return "buried under your other windows";
}

// What people call an app that its own name does not start with.
const ALIASES = { vscode: "code", vs: "code", vscodium: "code", chrome: "googlechrome", teams: "microsoftteams", word: "microsoftword", excel: "microsoftexcel",
  powerpoint: "microsoftpowerpoint", epic: "epicgameslauncher", battlenet: "battlenet", yt: "youtube", tv: "tv", ps: "photoshop" };
const words = (name) => String(name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
/** True when the query is the whole app name, a known alias of it, or the start of a word in it ("team view" is TeamViewer, "chrome" is Google Chrome). */
function nameMatches(q, name) {
  const w = words(name).map((x) => x.toLowerCase()), whole = w.join("");
  if (!whole) return false;
  if (whole === q || (ALIASES[q] && (whole === ALIASES[q] || whole.endsWith(ALIASES[q])))) return true;
  if (q.length < 4) return false;
  return w.some((_, i) => w.slice(i).join("").startsWith(q));   // starts a word, never the middle of one, and never the other way round
}

/** Running apps a spoken name could mean. An exact name first, otherwise the apps it is an alias or a word-start of. "gmail" and "taking notes" match nothing. */
export function matchApps(query, apps) {
  const q = norm(query);
  if (q.length < 2) return [];
  const exact = apps.filter((a) => norm(a.name) === q || norm(a.bundleId) === q);
  return exact.length ? exact : apps.filter((a) => nameMatches(q, a.name));
}

/** Launchers, game clients, chat and music apps: the class that is ended outright when it will not quit, even with a window up. */
export const isBackgroundClass = (app) => !app.document && BACKGROUND_LEAVABLE.test(`${app.name} ${app.bundleId}`);

/** Why a NAMED app still may not be closed, or null. Only the never list holds against a direct request. */
export const refusedReason = (app) => (test(NEVER, app) ? "ORION, the Finder and the model server stay open" : null);
