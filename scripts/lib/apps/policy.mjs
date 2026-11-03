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

/** Why an app is kept by quit-unused, or null when it counts as unused. `all` (close everything except what I named) drops the recent-window and audio protections only. */
export function keptReason(app, { keep = [], all = false } = {}) {
  if (test(NEVER, app)) return "ORION, the Finder or the model server, never closed";
  const names = [norm(app.name), norm(app.bundleId)];
  if (keep.some((k) => norm(k) && names.some((n) => n === norm(k) || (norm(k).length >= 4 && n.includes(norm(k)))))) return "on your keep list";
  if (app.frontmost) return "you're in it right now";
  if (test(TERMINAL_IDE, app)) return "a terminal or editor that may have work running";
  if (test(IN_USE, app)) return "it may be mid-call or recording";
  if (test(SETTINGS, app)) return "you may be mid-change in it";
  if (app.audible && !all) return "playing audio";
  if (app.kind === "accessory") return test(BACKGROUND_LEAVABLE, app) ? null : "a menu-bar utility doing a standing job";
  if (!all && app.onscreen > 0 && Number.isInteger(app.rank) && app.rank < RECENT_RANKS) return "one of your most recent windows";
  return null;
}

/** How an unused app is described when it is closed. */
export function unusedWhy(app) {
  if (app.kind === "accessory" && !app.windows) return "a background launcher with no window";
  if (!app.onscreen) return app.windows ? "its windows are hidden or minimized" : "no window open";
  return "buried under your other windows";
}

/** Running apps a spoken name could mean: an exact name first, otherwise every app whose name contains it ("team view" is TeamViewer). */
export function matchApps(query, apps) {
  const q = norm(query);
  if (q.length < 2) return [];
  const exact = apps.filter((a) => norm(a.name) === q || norm(a.bundleId) === q);
  if (exact.length) return exact;
  return apps.filter((a) => norm(a.name).includes(q) || (norm(a.name).length >= 4 && q.includes(norm(a.name))));
}

/** Why a NAMED app still may not be closed, or null. Only the never list holds against a direct request. */
export const refusedReason = (app) => (test(NEVER, app) ? "ORION, the Finder and the model server stay open" : null);
