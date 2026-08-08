import { constants } from "node:fs";
import {
  describeDuration,
  readClock,
  readReminders,
  readSystemStatus,
  readWeather,
  remindersPath,
  resolveAlarmTime,
  writeReminders,
  type Reminder,
} from "./ambient.js";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ActionDefinition,
  BrowserControlPolicy,
  ControlledRoot,
  CreateOnlyTextPolicy,
  DesktopFileMutationPolicy,
  DesktopTextMutationPolicy,
  ExecutionPolicy,
  FileMutationPolicy,
  MediaControlPolicy,
  MutableRoot,
  ObservationPolicy,
  SupportedBrowser,
  SupportedPlayer,
} from "./catalog.js";
import {
  clampVolume,
  browserUrlIssues,
  isMutableRoot,
  isObservationPolicy,
  isSafeRelativePath,
  isSafeSegment,
  isVisibleNonSensitiveName,
  ORION_APP_DOMAIN,
  resolveBrowserName,
  resolvePlayerName,
  SUPPORTED_BROWSERS,
  SUPPORTED_PLAYERS,
  TUNABLE_SETTINGS,
} from "./catalog.js";
import type { TunableSetting } from "./catalog.js";
import {
  addSupplement,
  defaultHealthLogPath,
  logExercise,
  readHealthLog,
  supplementStatus,
  takeSupplement,
  today as todayKey,
  workoutStatus,
} from "./health.js";
import type { TaskStep, UndoRecord } from "./types.js";
import { canonicalActionHash, hash } from "./validator.js";

export interface ExecutionContext {
  roots: Record<ControlledRoot, string>;
  /** Shared supplement/workout store, also read by the Orion dashboard. */
  healthLogPath?: string;
  workingContext?: string;
  simulatedState: Map<string, unknown>;
  /**
   * Run-scoped idempotency memo: idempotencyKey -> hash of the bytes a prior
   * attempt in this same run already committed. Lets a retry after a failed
   * verification recognise its own completed write instead of appending twice.
   */
  writeMemo?: Map<string, string>;
  /**
   * The authenticated user text for this run.
   *
   * Used ONLY to add refusals the validator cannot make without touching the
   * filesystem — currently "this directory is not empty, so your own words must
   * name it". It never grants anything: authorization has already happened in
   * the validator before any executor runs.
   */
  trustedInstruction?: string;
  /** Overridable for tests; defaults to the user's ~/.Trash. */
  trashRoot?: string;
  /** Configured browser preference; otherwise auto-detected. */
  browserPreference?: string;
  /** Where timers and alarms live. Overridable for tests. */
  remindersPath?: string;
  /** Default place for weather when the user did not name one. */
  defaultLocation?: string;
}

export interface ExecutionResult {
  mode:
    | "simulated"
    | "created"
    | "appended"
    | "replaced"
    | "opened"
    | "quit"
    | "already_present"
    // Orion rebuilt and reinstalled himself. Its own mode because it is not
    // like the others: the artefact that changed is the app doing the work.
    | "rebuilt"
    | "observed"
    | "controlled"
    | "moved"
    | "trashed"
    | "scheduled"
    | "cancelled";
  idempotencyKey: string;
  target?: string;
  output?: unknown;
  /** The exact inverse operation, recorded in the ledger. */
  undo?: UndoRecord;
}

export interface VerificationResult {
  observed: boolean;
  evidence?: string;
}

export class ActionExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

const execFileAsync = promisify(execFile);

async function resolveApplication(application: string): Promise<{
  path: string;
  bundleId: string;
}> {
  let lastFailure: string | undefined;
  for (const root of ["/Applications", "/System/Applications"]) {
    const candidate = path.join(root, `${application}.app`);
    try {
      const stats = await lstat(candidate);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      const { stdout } = await execFileAsync(
        "/usr/bin/plutil",
        ["-extract", "CFBundleIdentifier", "raw", path.join(candidate, "Contents/Info.plist")],
        { timeout: 5000 },
      );
      const bundleId = stdout.trim();
      if (!/^[A-Za-z0-9.-]{3,200}$/.test(bundleId)) {
        throw new ActionExecutionError("Installed app has an invalid bundle identifier.");
      }
      return { path: candidate, bundleId };
    } catch (error) {
      if (error instanceof ActionExecutionError) throw error;
      // Keep the last diagnostic so a plutil/permission failure is not reported
      // as a plain "not installed".
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        lastFailure = code ?? (error as Error).message;
      }
    }
  }
  throw new ActionExecutionError(
    lastFailure
      ? `Application could not be resolved (${lastFailure}).`
      : "Application was not found in /Applications or /System/Applications.",
  );
}

async function applicationIsRunning(bundleId: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-e", `application id "${bundleId}" is running`],
    { timeout: 5000 },
  );
  return stdout.trim() === "true";
}

async function controlApplication(
  operation: "open" | "quit",
  application: string,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const target = await resolveApplication(application);
  if (operation === "open") {
    await execFileAsync("/usr/bin/open", [target.path], { timeout: 10000 });
    return { mode: "opened", idempotencyKey, target: target.path, output: target };
  }
  if (!(await applicationIsRunning(target.bundleId))) {
    return { mode: "already_present", idempotencyKey, target: target.path, output: target };
  }
  await execFileAsync(
    "/usr/bin/osascript",
    ["-e", `tell application id "${target.bundleId}" to quit`],
    { timeout: 10000 },
  );
  return { mode: "quit", idempotencyKey, target: target.path, output: target };
}

/**
 * macOS Automation refusal. The user has to grant this once per browser, and a
 * raw "-1743" tells them nothing, so it is translated into the exact steps.
 */
const AUTOMATION_DENIED =
  /-1743|not authoriz(?:ed|ised) to send apple events|not allowed to send apple events/i;
const JAVASCRIPT_DENIED =
  /javascript.*(?:turned off|not allowed|disabled)|allow javascript from apple events|-2740/i;
const APPLICATION_NOT_RUNNING = /-600\b|(?:isn't|is not) running/i;

function automationGuidance(application: string): string {
  return (
    `macOS has not granted permission to control ${application}. ` +
    "Open System Settings > Privacy & Security > Automation, find the app that runs OpenClaw " +
    "(Terminal, iTerm, or the OpenClaw app), and switch on " +
    `${application}. macOS asks once per app; retry after granting it.`
  );
}

function javascriptGuidance(application: string): string {
  return (
    `${application} is refusing to run JavaScript from AppleScript, which is how page text is read. ` +
    (application === "Safari"
      ? "Enable Safari > Settings > Advanced > Show features for web developers, then Develop > Allow JavaScript from Apple Events."
      : `Enable ${application}'s View > Developer > Allow JavaScript from Apple Events.`) +
    " Without it Orion cannot read the page."
  );
}

async function runAppleScript(
  script: string,
  options: { application: string; timeoutMs?: number },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: options.timeoutMs ?? 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail = [
      (error as { stderr?: string }).stderr ?? "",
      error instanceof Error ? error.message : "",
    ]
      .join(" ")
      .trim();
    if (AUTOMATION_DENIED.test(detail)) {
      throw new ActionExecutionError(automationGuidance(options.application));
    }
    if (JAVASCRIPT_DENIED.test(detail)) {
      throw new ActionExecutionError(javascriptGuidance(options.application));
    }
    if (APPLICATION_NOT_RUNNING.test(detail)) {
      throw new ActionExecutionError(
        `${options.application} is not running, so there is no window to act on.`,
      );
    }
    if ((error as { killed?: boolean }).killed === true) {
      throw new ActionExecutionError(
        `${options.application} did not respond in time.`,
        true,
      );
    }
    throw new ActionExecutionError(
      `${options.application} refused the request: ${detail.slice(0, 200) || "no diagnostic"}`,
    );
  }
}

type BrowserEngine = "chromium" | "safari";

const BROWSER_ENGINE: Readonly<Record<SupportedBrowser, BrowserEngine>> = {
  "Opera Air": "chromium",
  Opera: "chromium",
  Safari: "safari",
  "Google Chrome": "chromium",
};

export interface ResolvedBrowser {
  name: SupportedBrowser;
  bundleId: string;
  engine: BrowserEngine;
  path: string;
}

async function describeBrowser(
  name: SupportedBrowser,
): Promise<ResolvedBrowser> {
  const resolved = await resolveApplication(name);
  return {
    name,
    bundleId: resolved.bundleId,
    engine: BROWSER_ENGINE[name],
    path: resolved.path,
  };
}

/** The https handler LaunchServices records, read-only and best-effort. */
async function defaultBrowserBundleId(): Promise<string | undefined> {
  const plist = path.join(
    os.homedir(),
    "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
  );
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plist],
      { timeout: 5000 },
    );
    const parsed = JSON.parse(stdout) as {
      LSHandlers?: Array<Record<string, unknown>>;
    };
    const handler = parsed.LSHandlers?.find(
      (entry) => entry.LSHandlerURLScheme === "https",
    );
    const bundleId = handler?.LSHandlerRoleAll;
    return typeof bundleId === "string" ? bundleId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which browser to drive: the caller's explicit choice, else the configured
 * preference, else whichever supported browser is already running, else the
 * system default browser, else the first one installed. The chosen browser is
 * named in the ledger for every browser action.
 */
async function resolveBrowser(
  policy: BrowserControlPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ResolvedBrowser> {
  const requested =
    resolveBrowserName(step.arguments[policy.browserArgument]) ??
    resolveBrowserName(context.browserPreference);
  if (requested) return describeBrowser(requested);

  const installed: ResolvedBrowser[] = [];
  for (const name of SUPPORTED_BROWSERS) {
    const described = await describeBrowser(name).catch(() => undefined);
    if (described) installed.push(described);
  }
  if (installed.length === 0) {
    throw new ActionExecutionError(
      `No supported browser is installed. Orion drives one of: ${SUPPORTED_BROWSERS.join(", ")}.`,
    );
  }
  for (const browser of installed) {
    const running = await applicationIsRunning(browser.bundleId).catch(
      () => false,
    );
    if (running) return browser;
  }
  const fallbackId = await defaultBrowserBundleId();
  const preferred = fallbackId
    ? installed.find(
        (browser) => browser.bundleId.toLowerCase() === fallbackId.toLowerCase(),
      )
    : undefined;
  return preferred ?? installed[0]!;
}

export interface BrowserTab {
  windowIndex: number;
  tabIndex: number;
  active: boolean;
  url: string;
  title: string;
}

/** AppleScript's `character id 1`: cannot occur in a URL or a window title. */
const TAB_FIELD_SEPARATOR = "\u0001";

function tabListScript(browser: ResolvedBrowser): string {
  if (browser.engine === "safari") {
    return `tell application id "${browser.bundleId}"
  set sep to character id 1
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set act to 0
    try
      set act to index of current tab of w
    end try
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set flag to "0"
      if ti = act then set flag to "1"
      set out to out & wi & sep & ti & sep & flag & sep & (URL of t) & sep & (name of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;
  }
  return `tell application id "${browser.bundleId}"
  set sep to character id 1
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set act to 0
    try
      set act to active tab index of w
    end try
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set flag to "0"
      if ti = act then set flag to "1"
      set out to out & wi & sep & ti & sep & flag & sep & (URL of t) & sep & (title of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;
}

function parseTabs(raw: string, maxTabs: number): BrowserTab[] {
  const tabs: BrowserTab[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split(TAB_FIELD_SEPARATOR);
    if (fields.length < 5) continue;
    const windowIndex = Number.parseInt(fields[0] ?? "", 10);
    const tabIndex = Number.parseInt(fields[1] ?? "", 10);
    if (!Number.isInteger(windowIndex) || !Number.isInteger(tabIndex)) continue;
    tabs.push({
      windowIndex,
      tabIndex,
      active: fields[2] === "1",
      url: (fields[3] ?? "").trim(),
      title: fields.slice(4).join(TAB_FIELD_SEPARATOR).trim().slice(0, 300),
    });
    if (tabs.length >= maxTabs) break;
  }
  return tabs;
}

async function listBrowserTabs(
  browser: ResolvedBrowser,
  maxTabs = 200,
): Promise<BrowserTab[]> {
  const raw = await runAppleScript(tabListScript(browser), {
    application: browser.name,
  });
  return parseTabs(raw, maxTabs);
}

function activeTab(tabs: BrowserTab[]): BrowserTab | undefined {
  return tabs.find((tab) => tab.active && tab.windowIndex === 1) ??
    tabs.find((tab) => tab.active) ??
    tabs[0];
}

/** Same site, allowing for the redirects and trailing-slash normalisation any real page does. */
function urlsAgree(requested: string, observed: string): boolean {
  if (requested === observed) return true;
  try {
    const left = new URL(requested);
    const right = new URL(observed);
    if (left.href === right.href) return true;
    return left.hostname.toLowerCase() === right.hostname.toLowerCase();
  } catch {
    return false;
  }
}

function pageTextScript(browser: ResolvedBrowser): string {
  return browser.engine === "safari"
    ? `tell application id "${browser.bundleId}" to do JavaScript "document.body.innerText" in current tab of front window`
    : `tell application id "${browser.bundleId}" to execute front window's active tab javascript "document.body.innerText"`;
}

function newTabScript(browser: ResolvedBrowser): string {
  return browser.engine === "safari"
    ? `tell application id "${browser.bundleId}"
  if (count of windows) = 0 then
    make new document
  else
    tell front window to set current tab to (make new tab)
  end if
  return "ok"
end tell`
    : `tell application id "${browser.bundleId}"
  if (count of windows) = 0 then
    make new window
  else
    make new tab at end of tabs of front window
    set active tab index of front window to (count of tabs of front window)
  end if
  return "ok"
end tell`;
}

function closeTabScript(browser: ResolvedBrowser): string {
  return browser.engine === "safari"
    ? `tell application id "${browser.bundleId}" to close current tab of front window`
    : `tell application id "${browser.bundleId}" to close active tab of front window`;
}

function activateTabScript(
  browser: ResolvedBrowser,
  windowIndex: number,
  tabIndex: number,
): string {
  return browser.engine === "safari"
    ? `tell application id "${browser.bundleId}"
  set current tab of window ${windowIndex} to tab ${tabIndex} of window ${windowIndex}
  set index of window ${windowIndex} to 1
  return "ok"
end tell`
    : `tell application id "${browser.bundleId}"
  set active tab index of window ${windowIndex} to ${tabIndex}
  set index of window ${windowIndex} to 1
  return "ok"
end tell`;
}

function selectTab(
  tabs: BrowserTab[],
  selector: string | number,
): BrowserTab | undefined {
  if (typeof selector === "number") {
    return tabs.find(
      (tab) => tab.windowIndex === 1 && tab.tabIndex === selector,
    );
  }
  const needle = selector.trim().toLowerCase();
  return tabs.find(
    (tab) =>
      tab.title.toLowerCase().includes(needle) ||
      tab.url.toLowerCase().includes(needle),
  );
}

async function controlBrowser(
  policy: BrowserControlPolicy,
  step: TaskStep,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const browser = await resolveBrowser(policy, step, context);
  const maxTabs = policy.maxTabs ?? 200;
  const describe = <T extends Record<string, unknown>>(output: T) => ({
    browser: browser.name,
    bundleId: browser.bundleId,
    ...output,
  });

  if (policy.operation === "open_url") {
    const url = step.arguments[policy.urlArgument ?? "url"];
    // Re-validate at the boundary: the executor never trusts that validation
    // already ran. A non-http(s) scheme, a credentialed URL, or anything with a
    // quote in it dies here too.
    const issues = browserUrlIssues(url);
    if (issues.length > 0 || typeof url !== "string") {
      throw new ActionExecutionError(`Refused URL: ${issues.join("; ")}`);
    }
    // LaunchServices, not AppleScript: no Automation prompt, and the URL is an
    // argv element rather than anything interpolated into a script.
    await execFileAsync("/usr/bin/open", ["-b", browser.bundleId, url], {
      timeout: 15000,
    });
    return {
      mode: "controlled",
      idempotencyKey,
      target: url,
      output: describe({ operation: policy.operation, url }),
    };
  }

  if (policy.operation === "new_tab" || policy.operation === "close_tab") {
    const before = await listBrowserTabs(browser, maxTabs);
    if (policy.operation === "close_tab" && before.length === 0) {
      throw new ActionExecutionError(
        `${browser.name} has no open tab to close.`,
      );
    }
    const closing = policy.operation === "close_tab" ? activeTab(before) : undefined;
    await runAppleScript(
      policy.operation === "new_tab"
        ? newTabScript(browser)
        : closeTabScript(browser),
      { application: browser.name },
    );
    return {
      mode: "controlled",
      idempotencyKey,
      target: browser.name,
      output: describe({
        operation: policy.operation,
        tabCountBefore: before.length,
        ...(closing ? { closedUrl: closing.url, closedTitle: closing.title } : {}),
      }),
    };
  }

  if (policy.operation === "list_tabs") {
    const tabs = await listBrowserTabs(browser, maxTabs);
    return {
      mode: "observed",
      idempotencyKey,
      target: browser.name,
      output: describe({
        operation: policy.operation,
        tabCount: tabs.length,
        tabs,
      }),
    };
  }

  if (policy.operation === "switch_tab") {
    const rawSelector = step.arguments[policy.selectorArgument ?? "tab"];
    const selector =
      typeof rawSelector === "number"
        ? rawSelector
        : typeof rawSelector === "string"
          ? rawSelector
          : undefined;
    if (selector === undefined) {
      throw new ActionExecutionError("Validated tab selector is missing.");
    }
    const tabs = await listBrowserTabs(browser, maxTabs);
    const chosen = selectTab(tabs, selector);
    if (!chosen) {
      throw new ActionExecutionError(
        typeof selector === "number"
          ? `${browser.name} has no tab ${selector} in its front window.`
          : `No open ${browser.name} tab matches "${selector}".`,
      );
    }
    await runAppleScript(
      activateTabScript(browser, chosen.windowIndex, chosen.tabIndex),
      { application: browser.name },
    );
    return {
      mode: "controlled",
      idempotencyKey,
      target: chosen.url,
      output: describe({
        operation: policy.operation,
        selectedUrl: chosen.url,
        selectedTitle: chosen.title,
        windowIndex: chosen.windowIndex,
        tabIndex: chosen.tabIndex,
      }),
    };
  }

  // read_page
  const tabs = await listBrowserTabs(browser, maxTabs);
  const current = activeTab(tabs);
  if (!current) {
    throw new ActionExecutionError(`${browser.name} has no open tab to read.`);
  }
  const raw = await runAppleScript(pageTextScript(browser), {
    application: browser.name,
    timeoutMs: 20000,
  });
  const maxBytes = policy.maxBytes ?? 102400;
  const full = Buffer.from(raw.replace(/\s+$/, ""), "utf8");
  const truncated = full.byteLength > maxBytes;
  const text = truncated
    ? full.subarray(0, maxBytes).toString("utf8")
    : full.toString("utf8");
  return {
    mode: "observed",
    idempotencyKey,
    target: current.url,
    // The ledger records that a page read happened, of which URL, how much text
    // came back, and a hash of it. Orion seeing the open tab is auditable
    // rather than invisible.
    output: describe({
      operation: policy.operation,
      url: current.url,
      title: current.title,
      bytes: Buffer.byteLength(text, "utf8"),
      truncated,
      textSha256: contentHash(text),
      text,
    }),
  };
}

async function runningPlayer(
  policy: MediaControlPolicy,
  step: TaskStep,
): Promise<{ name: SupportedPlayer; bundleId: string }> {
  const requested = resolvePlayerName(
    step.arguments[policy.playerArgument ?? "player"],
  );
  const candidates: readonly SupportedPlayer[] = requested
    ? [requested]
    : SUPPORTED_PLAYERS;
  for (const name of candidates) {
    const resolved = await resolveApplication(name).catch(() => undefined);
    if (!resolved) continue;
    const running = await applicationIsRunning(resolved.bundleId).catch(
      () => false,
    );
    if (running) return { name, bundleId: resolved.bundleId };
  }
  throw new ActionExecutionError(
    requested
      ? `${requested} is not running, so there is nothing to control.`
      : `No supported media player is running (${SUPPORTED_PLAYERS.join(", ")}).`,
  );
}

interface PlayerSnapshot {
  state: string;
  trackId: string;
  position: number;
}

async function playerSnapshot(player: {
  name: string;
  bundleId: string;
}): Promise<PlayerSnapshot> {
  const raw = await runAppleScript(
    `tell application id "${player.bundleId}"
  set s to "unknown"
  try
    if player state is playing then
      set s to "playing"
    else
      set s to "not_playing"
    end if
  end try
  set t to ""
  try
    set t to (id of current track) as text
  end try
  set p to "0"
  try
    set p to (player position) as text
  end try
  return s & character id 1 & t & character id 1 & p
end tell`,
    { application: player.name },
  );
  const [state = "unknown", trackId = "", position = "0"] = raw
    .trim()
    .split(TAB_FIELD_SEPARATOR);
  return {
    state,
    trackId,
    position: Number.parseFloat(position) || 0,
  };
}

async function volumeSettings(): Promise<{ level: number; muted: boolean }> {
  const raw = await runAppleScript(
    'set s to (get volume settings)\nreturn ((output volume of s) as text) & character id 1 & ((output muted of s) as text)',
    { application: "the system volume" },
  );
  const [level = "", muted = ""] = raw.trim().split(TAB_FIELD_SEPARATOR);
  return {
    level: Number.parseInt(level, 10),
    muted: muted.trim().toLowerCase() === "true",
  };
}

async function controlMedia(
  policy: MediaControlPolicy,
  step: TaskStep,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  if (policy.operation === "volume_set") {
    const requested = step.arguments[policy.levelArgument ?? "level"];
    if (typeof requested !== "number" || !Number.isFinite(requested)) {
      throw new ActionExecutionError("Validated volume level is missing.");
    }
    const level = clampVolume(requested);
    const before = await volumeSettings();
    await runAppleScript(`set volume output volume ${level}`, {
      application: "the system volume",
    });
    return {
      mode: "controlled",
      idempotencyKey,
      target: "system volume",
      output: {
        operation: policy.operation,
        requestedLevel: requested,
        level,
        previousLevel: before.level,
      },
    };
  }

  if (policy.operation === "volume_mute" || policy.operation === "volume_unmute") {
    const before = await volumeSettings();
    await runAppleScript(
      policy.operation === "volume_mute"
        ? "set volume with output muted"
        : "set volume without output muted",
      { application: "the system volume" },
    );
    return {
      mode: "controlled",
      idempotencyKey,
      target: "system volume",
      output: {
        operation: policy.operation,
        previouslyMuted: before.muted,
      },
    };
  }

  if (policy.operation === "display_sleep") {
    await execFileAsync("/usr/bin/pmset", ["displaysleepnow"], {
      timeout: 10000,
    });
    return {
      mode: "controlled",
      idempotencyKey,
      target: "display",
      output: { operation: policy.operation },
    };
  }

  const player = await runningPlayer(policy, step);
  const before = await playerSnapshot(player);
  const command =
    policy.operation === "play_pause"
      ? "playpause"
      : policy.operation === "next_track"
        ? "next track"
        : "previous track";
  await runAppleScript(
    `tell application id "${player.bundleId}" to ${command}`,
    { application: player.name },
  );
  return {
    mode: "controlled",
    idempotencyKey,
    target: player.name,
    output: {
      operation: policy.operation,
      player: player.name,
      previousState: before.state,
      previousTrackId: before.trackId,
      previousPosition: before.position,
    },
  };
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function assertRealDirectory(directory: string): Promise<string> {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    // A missing or unreadable root must be a controlled, diagnosable failure
    // rather than a bare errno surfaced as "Unexpected executor failure."
    throw new ActionExecutionError(
      `Controlled root is unavailable (${(error as NodeJS.ErrnoException).code ?? "unknown"}): ${directory}`,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ActionExecutionError(
      `Controlled root is not a real directory: ${directory}`,
    );
  }
  return realpath(directory);
}

async function prepareControlledDirectory(
  root: string,
  subdirectory: string,
): Promise<string> {
  const resolvedRoot = path.resolve(root);
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const realRoot = await assertRealDirectory(resolvedRoot);
  let current = realRoot;
  for (const segment of subdirectory.split("/")) {
    current = path.join(current, segment);
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    current = await assertRealDirectory(current);
    if (!isWithin(realRoot, current)) {
      throw new ActionExecutionError(
        "Controlled directory escaped its configured root.",
      );
    }
  }
  return current;
}

async function resolveExistingPath(
  root: string,
  relativePath: string,
): Promise<{ realRoot: string; target: string }> {
  const resolvedRoot = path.resolve(root);
  const realRoot = await assertRealDirectory(resolvedRoot);
  if (relativePath === ".") return { realRoot, target: realRoot };
  let current = realRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      // Surface a diagnosable message instead of a bare errno that the
      // controller would report as "Unexpected executor failure."
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ActionExecutionError(
          `Path does not exist inside the configured root: ${relativePath}`,
        );
      }
      throw new ActionExecutionError(
        `Path could not be inspected (${(error as NodeJS.ErrnoException).code ?? "unknown"}): ${relativePath}`,
      );
    }
    if (stats.isSymbolicLink()) {
      throw new ActionExecutionError("Symlink access is forbidden.");
    }
  }
  const target = await realpath(current);
  if (!isWithin(realRoot, target)) {
    throw new ActionExecutionError("Path escaped the configured root.");
  }
  return { realRoot, target };
}

async function readTextFile(target: string, maxBytes: number): Promise<string> {
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new ActionExecutionError(
      `Text target must be a regular file no larger than ${maxBytes} bytes.`,
    );
  }
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function contentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readFileBytes(target: string, maxBytes: number): Promise<Buffer> {
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new ActionExecutionError(
      `File target must be a regular file no larger than ${maxBytes} bytes.`,
    );
  }
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function createRequest(
  policy: CreateOnlyTextPolicy,
  step: TaskStep,
): { name: string; extension: string; content: string } {
  const name = step.arguments[policy.nameArgument];
  const content = step.arguments[policy.contentArgument];
  const extension = policy.fixedExtension
    ? policy.fixedExtension
    : policy.extensionArgument
      ? step.arguments[policy.extensionArgument]
      : undefined;
  if (
    typeof name !== "string" ||
    typeof extension !== "string" ||
    typeof content !== "string"
  ) {
    throw new ActionExecutionError("Validated text arguments are missing.");
  }
  return { name, extension, content };
}

async function createOnlyText(
  policy: CreateOnlyTextPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const requested = createRequest(policy, step);
  const directory = await prepareControlledDirectory(
    context.roots[policy.root],
    policy.subdirectory,
  );
  const target = path.join(
    directory,
    `${requested.name}.${requested.extension}`,
  );
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  let handle;
  let created = false;
  try {
    handle = await open(
      target,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    await handle.writeFile(requested.content, "utf8");
    await handle.sync();
    return { mode: "created", idempotencyKey, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      const code = (error as NodeJS.ErrnoException).code;
      // A partial write must not poison the name forever: a retry would
      // otherwise see EEXIST with different content and fail permanently.
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw new ActionExecutionError(
        `Text creation failed${code ? ` (${code})` : ""}.`,
        code === "EINTR" || code === "EBUSY",
      );
    }
    const existing = await readTextFile(target, policy.maxBytes);
    if (existing !== requested.content) {
      throw new ActionExecutionError(
        "Text artifact already exists with different content; overwrite is forbidden.",
      );
    }
    return { mode: "already_present", idempotencyKey, target };
  } finally {
    await handle?.close();
  }
}

/**
 * A caller-asserted hash. `undefined` means "derive it"; a present value is
 * enforced as an additional optimistic-concurrency assertion.
 */
type AssertedHash = string | undefined;

function assertedHash(value: unknown): AssertedHash {
  return typeof value === "string" ? value : undefined;
}

function mutationRequest(
  policy: DesktopTextMutationPolicy,
  step: TaskStep,
): {
  relativePath: string;
  content: string;
  expectedHash: AssertedHash;
  resultHash: AssertedHash;
} {
  const relativePath = step.arguments[policy.relativePathArgument];
  const content = step.arguments[policy.contentArgument];
  if (typeof relativePath !== "string" || typeof content !== "string") {
    throw new ActionExecutionError("Validated mutation arguments are missing.");
  }
  return {
    relativePath,
    content,
    expectedHash: assertedHash(step.arguments[policy.expectedHashArgument]),
    resultHash: assertedHash(step.arguments[policy.resultHashArgument]),
  };
}

async function atomicReplace(
  target: string,
  desired: string | Buffer,
  expectedCurrentHash: string,
  maxBytes: number,
): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.orion-control-${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(desired);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const currentStats = await lstat(target);
    const current = await readFileBytes(target, maxBytes);
    if (contentHash(current) !== expectedCurrentHash) {
      throw new ActionExecutionError(
        "Desktop text changed before commit; stale hash rejected.",
      );
    }
    // Preserve the original file mode: replace-by-rename must not silently
    // relax or tighten permissions on a file the user already owns.
    await chmod(temporary, currentStats.mode & 0o7777).catch(() => undefined);
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

function fileMutationRequest(
  policy: DesktopFileMutationPolicy,
  step: TaskStep,
): {
  relativePath: string;
  operation: "create" | "append" | "replace";
  content: Buffer;
  contentSource: string;
  expectedHash: AssertedHash;
  resultHash: AssertedHash;
} {
  const relativePath = step.arguments[policy.relativePathArgument];
  const operation = step.arguments[policy.operationArgument];
  const encoding = step.arguments[policy.encodingArgument];
  const encodedContent = step.arguments[policy.contentArgument];
  const contentSource = step.arguments[policy.contentSourceArgument];
  if (
    typeof relativePath !== "string" ||
    !["create", "append", "replace"].includes(String(operation)) ||
    typeof encodedContent !== "string"
  ) {
    throw new ActionExecutionError("Validated file mutation arguments are missing.");
  }
  return {
    relativePath,
    operation: operation as "create" | "append" | "replace",
    content:
      encoding === "base64"
        ? Buffer.from(encodedContent, "base64")
        : Buffer.from(encodedContent, "utf8"),
    contentSource:
      typeof contentSource === "string" ? contentSource : "inline_user_request",
    expectedHash: assertedHash(step.arguments[policy.expectedHashArgument]),
    resultHash: assertedHash(step.arguments[policy.resultHashArgument]),
  };
}

/**
 * Resolve the idempotency token for an append/replace: a caller-asserted
 * resultHash if present, otherwise the hash a previous attempt in this same run
 * already committed. Without either, a fresh write proceeds.
 */
function idempotencyToken(
  asserted: AssertedHash,
  context: ExecutionContext,
  idempotencyKey: string,
): string | undefined {
  return asserted ?? context.writeMemo?.get(idempotencyKey);
}

function rememberWrite(
  context: ExecutionContext,
  idempotencyKey: string,
  resultHash: string,
): void {
  context.writeMemo?.set(idempotencyKey, resultHash);
}

async function mutateFile(
  policy: DesktopFileMutationPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const request = fileMutationRequest(policy, step);
  const parentRelative = path.posix.dirname(request.relativePath);
  const parent = await resolveExistingPath(
    context.roots[policy.root],
    parentRelative === "." ? "." : parentRelative,
  );
  if (!(await lstat(parent.target)).isDirectory()) {
    throw new ActionExecutionError("Desktop file parent is not a directory.");
  }
  const target = path.join(
    parent.target,
    path.posix.basename(request.relativePath),
  );
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop file target escaped its root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  const describe = (resultHash: string) => ({
    operation: request.operation,
    contentSource: request.contentSource,
    resultHash,
    resultHashSource: request.resultHash ? "asserted" : "derived",
  });
  if (request.operation === "create") {
    // Derived from the exact bytes we are about to write. A caller-asserted
    // resultHash, when present, must agree with it.
    const resultHash = contentHash(request.content);
    if (request.resultHash && request.resultHash !== resultHash) {
      throw new ActionExecutionError(
        "Declared resultHash does not match the requested bytes.",
      );
    }
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new ActionExecutionError(
          "Desktop file target is not a regular file.",
        );
      }
      const existing = await readFileBytes(target, policy.maxResultBytes);
      if (contentHash(existing) === resultHash) {
        return {
          mode: "already_present",
          idempotencyKey,
          target,
          output: describe(resultHash),
        };
      }
      throw new ActionExecutionError(
        "Create target collides with an existing different file.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let handle;
    let created = false;
    try {
      handle = await open(
        target,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      await handle.writeFile(request.content);
      await handle.sync();
      rememberWrite(context, idempotencyKey, resultHash);
      return {
        mode: "created",
        idempotencyKey,
        target,
        output: describe(resultHash),
      };
    } catch (error) {
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  const resolved = await resolveExistingPath(
    context.roots[policy.root],
    request.relativePath,
  );
  const current = await readFileBytes(resolved.target, policy.maxResultBytes);
  const currentHash = contentHash(current);
  const token = idempotencyToken(request.resultHash, context, idempotencyKey);
  if (token && currentHash === token) {
    return {
      mode: "already_present",
      idempotencyKey,
      target: resolved.target,
      output: describe(currentHash),
    };
  }
  if (request.expectedHash && currentHash !== request.expectedHash) {
    throw new ActionExecutionError(
      "Desktop file expectedHash is stale; modification rejected.",
    );
  }
  const desired =
    request.operation === "append"
      ? Buffer.concat([current, request.content])
      : request.content;
  if (desired.byteLength > policy.maxResultBytes) {
    throw new ActionExecutionError(
      `Result exceeds the ${policy.maxResultBytes}-byte limit.`,
    );
  }
  const resultHash = contentHash(desired);
  if (request.resultHash && request.resultHash !== resultHash) {
    throw new ActionExecutionError(
      "Declared resultHash does not match the exact resulting bytes.",
    );
  }
  rememberWrite(context, idempotencyKey, resultHash);
  await atomicReplace(
    resolved.target,
    desired,
    currentHash,
    policy.maxResultBytes,
  );
  return {
    mode: request.operation === "append" ? "appended" : "replaced",
    idempotencyKey,
    target: resolved.target,
    output: describe(resultHash),
  };
}

async function createDirectory(
  root: ControlledRoot,
  relativePath: string,
  context: ExecutionContext,
  step: TaskStep,
): Promise<ExecutionResult> {
  const parentRelative = path.posix.dirname(relativePath);
  const parent = await resolveExistingPath(
    context.roots[root],
    parentRelative === "." ? "." : parentRelative,
  );
  if (!(await lstat(parent.target)).isDirectory()) {
    throw new ActionExecutionError("Desktop folder parent is not a directory.");
  }
  const target = path.join(parent.target, path.posix.basename(relativePath));
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop folder escaped its root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  try {
    await mkdir(target, { mode: 0o700 });
    return { mode: "created", idempotencyKey, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stats = await lstat(target);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ActionExecutionError(
        "Desktop folder target collides with a non-directory or symlink.",
      );
    }
    return { mode: "already_present", idempotencyKey, target };
  }
}

async function mutateText(
  policy: DesktopTextMutationPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const request = mutationRequest(policy, step);
  const root = context.roots.desktop;
  const parentRelative = path.posix.dirname(request.relativePath);
  const parent = await resolveExistingPath(
    root,
    parentRelative === "." ? "." : parentRelative,
  );
  const parentStats = await lstat(parent.target);
  if (!parentStats.isDirectory()) {
    throw new ActionExecutionError("Desktop mutation parent is not a directory.");
  }
  const target = path.join(parent.target, path.posix.basename(request.relativePath));
  if (!isWithin(parent.realRoot, target)) {
    throw new ActionExecutionError("Desktop mutation escaped its configured root.");
  }
  const idempotencyKey = canonicalActionHash(step, context.workingContext);

  const describe = (resultHash: string) => ({
    resultHash,
    resultHashSource: request.resultHash ? "asserted" : "derived",
  });

  if (policy.operation === "create") {
    const resultHash = contentHash(request.content);
    if (request.resultHash && request.resultHash !== resultHash) {
      throw new ActionExecutionError(
        "Declared resultHash does not match the requested content.",
      );
    }
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new ActionExecutionError(
          "Desktop mutation target is not a regular file.",
        );
      }
      const existing = await readTextFile(target, policy.maxResultBytes);
      if (contentHash(existing) === resultHash) {
        return {
          mode: "already_present",
          idempotencyKey,
          target,
          output: describe(resultHash),
        };
      }
      throw new ActionExecutionError(
        "Create target already exists with different content.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let handle;
    let created = false;
    try {
      handle = await open(
        target,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      await handle.writeFile(request.content, "utf8");
      await handle.sync();
      rememberWrite(context, idempotencyKey, resultHash);
      return {
        mode: "created",
        idempotencyKey,
        target,
        output: describe(resultHash),
      };
    } catch (error) {
      if (created) {
        await handle?.close();
        handle = undefined;
        await unlink(target).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  const resolved = await resolveExistingPath(root, request.relativePath);
  const current = await readTextFile(resolved.target, policy.maxResultBytes);
  const currentHash = contentHash(current);
  const token = idempotencyToken(request.resultHash, context, idempotencyKey);
  if (token && currentHash === token) {
    return {
      mode: "already_present",
      idempotencyKey,
      target: resolved.target,
      output: describe(currentHash),
    };
  }
  if (request.expectedHash && currentHash !== request.expectedHash) {
    throw new ActionExecutionError(
      "Desktop text expectedHash is stale; modification rejected.",
    );
  }
  const desired =
    policy.operation === "append" ? `${current}${request.content}` : request.content;
  if (Buffer.byteLength(desired, "utf8") > policy.maxResultBytes) {
    throw new ActionExecutionError(
      `Result exceeds the ${policy.maxResultBytes}-byte limit.`,
    );
  }
  const resultHash = contentHash(desired);
  if (request.resultHash && request.resultHash !== resultHash) {
    throw new ActionExecutionError(
      "Declared resultHash does not match the exact resulting content.",
    );
  }
  rememberWrite(context, idempotencyKey, resultHash);
  await atomicReplace(resolved.target, desired, currentHash, policy.maxResultBytes);
  return {
    mode: policy.operation === "append" ? "appended" : "replaced",
    idempotencyKey,
    target: resolved.target,
    output: describe(resultHash),
  };
}

/**
 * Is this file open in another process? Cheap best-effort via lsof: if it is
 * not cheaply detectable (lsof absent, slow, or unhelpful) the mutation
 * proceeds, because a guess is not a reason to refuse the user's own request.
 */
async function assertNotOpenElsewhere(target: string): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("/usr/sbin/lsof", ["-t", target], {
      timeout: 3000,
    }));
  } catch {
    // lsof exits non-zero when nothing has the file open, and may be absent.
    return;
  }
  const holders = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line) && line !== String(process.pid));
  if (holders.length > 0) {
    throw new ActionExecutionError(
      `${path.basename(target)} is currently open by another process (pid ${holders
        .slice(0, 3)
        .join(", ")}); refusing to move or delete it.`,
    );
  }
}

/**
 * Collision-safe Trash naming, matching what Finder does: `note.txt`, then
 * `note 2.txt`, `note 3.txt`, and finally a timestamped name.
 */
async function trashPath(trashRoot: string, name: string): Promise<string> {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  const candidates = [
    name,
    ...Array.from({ length: 99 }, (_, index) => `${stem} ${index + 2}${extension}`),
    `${stem} ${new Date().toISOString().replace(/[:.]/g, "-")}${extension}`,
  ];
  for (const candidate of candidates) {
    const absolute = path.join(trashRoot, candidate);
    try {
      await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
      throw error;
    }
  }
  throw new ActionExecutionError("Could not find a free name in the Trash.");
}

async function mutateFilesystemEntry(
  policy: FileMutationPolicy,
  step: TaskStep,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const root = step.arguments[policy.rootArgument];
  const relativePath = step.arguments[policy.relativePathArgument];
  if (!isMutableRoot(root)) {
    throw new ActionExecutionError("Validated root is missing.");
  }
  if (!isSafeRelativePath(relativePath)) {
    throw new ActionExecutionError("Validated relativePath is missing.");
  }
  const rootPath = (context.roots as Record<MutableRoot, string>)[root];
  const resolved = await resolveExistingPath(rootPath, relativePath);
  if (resolved.target === resolved.realRoot) {
    throw new ActionExecutionError(
      "The configured root itself cannot be moved, renamed, or deleted.",
    );
  }
  const stats = await lstat(resolved.target);
  if (stats.isSymbolicLink()) {
    throw new ActionExecutionError("Symlink access is forbidden.");
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new ActionExecutionError(
      "Only regular files and directories can be moved, renamed, or deleted.",
    );
  }
  const name = path.posix.basename(relativePath);
  if (stats.isDirectory()) {
    // A non-empty folder used to require the user's own words to name it. That
    // was the last surviving piece of the wording check, and it goes for the
    // same reason as the rest: the folder is going to the Trash with its
    // inverse in the ledger, so the recovery story is "drag it back", not
    // "should have phrased it differently".
    await readdir(resolved.target);
  } else {
    await assertNotOpenElsewhere(resolved.target);
  }

  let destination: string;
  if (policy.operation === "delete") {
    const trashRoot = context.trashRoot ?? path.join(os.homedir(), ".Trash");
    await mkdir(trashRoot, { recursive: true, mode: 0o700 });
    destination = await trashPath(await assertRealDirectory(trashRoot), name);
  } else if (policy.operation === "rename") {
    const newName = step.arguments[policy.destinationArgument ?? "newName"];
    if (!isSafeSegment(newName)) {
      throw new ActionExecutionError("Validated newName is missing.");
    }
    destination = path.join(path.dirname(resolved.target), newName);
  } else {
    const destinationPath = step.arguments[policy.destinationArgument ?? "destinationPath"];
    if (!isSafeRelativePath(destinationPath)) {
      throw new ActionExecutionError("Validated destinationPath is missing.");
    }
    const parentRelative = path.posix.dirname(destinationPath);
    const parent = await resolveExistingPath(
      rootPath,
      parentRelative === "." ? "." : parentRelative,
    );
    if (!(await lstat(parent.target)).isDirectory()) {
      throw new ActionExecutionError("Move destination parent is not a directory.");
    }
    destination = path.join(
      parent.target,
      path.posix.basename(destinationPath),
    );
  }
  if (
    policy.operation !== "delete" &&
    !isWithin(resolved.realRoot, destination)
  ) {
    throw new ActionExecutionError("Destination escaped the configured root.");
  }
  if (destination === resolved.target) {
    throw new ActionExecutionError("Destination is the same as the source.");
  }
  // Never clobber: a move or rename onto an existing path is refused outright.
  try {
    await lstat(destination);
    throw new ActionExecutionError(
      `Destination already exists: ${path.basename(destination)}`,
    );
  } catch (error) {
    if (error instanceof ActionExecutionError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await rename(resolved.target, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ActionExecutionError(
      code === "EXDEV"
        ? "Source and destination are on different volumes; refusing to copy rather than move."
        : `Filesystem mutation failed${code ? ` (${code})` : ""}.`,
      code === "EBUSY" || code === "EINTR",
    );
  }

  const undo: UndoRecord =
    policy.operation === "delete"
      ? {
          operation: "restore_from_trash",
          from: destination,
          to: resolved.target,
          description: `Move ${destination} back to ${resolved.target} to undo this delete.`,
          root,
          relativePath,
        }
      : {
          operation: policy.operation,
          from: destination,
          to: resolved.target,
          description: `Move ${destination} back to ${resolved.target} to undo this ${policy.operation}.`,
          root,
          relativePath,
        };

  return {
    mode: policy.operation === "delete" ? "trashed" : "moved",
    idempotencyKey,
    target: destination,
    output: {
      operation: policy.operation,
      root,
      relativePath,
      from: resolved.target,
      to: destination,
      entryType: stats.isDirectory() ? "directory" : "file",
      inode: stats.ino,
      ...(policy.operation === "delete" ? { trashPath: destination } : {}),
    },
    undo,
  };
}

async function observe(
  policy: ObservationPolicy,
  step: TaskStep,
  context: ExecutionContext,
): Promise<{ target: string; output: unknown }> {
  const relativePath = step.arguments[policy.relativePathArgument];
  if (typeof relativePath !== "string") {
    throw new ActionExecutionError("Validated relativePath is missing.");
  }
  const { target } = await resolveExistingPath(
    context.roots[policy.root],
    relativePath,
  );
  if (policy.kind === "list_directory") {
    const stats = await lstat(target);
    if (!stats.isDirectory()) {
      throw new ActionExecutionError("Listing target is not a directory.");
    }
    const names = (await readdir(target))
      .filter(isVisibleNonSensitiveName)
      .sort()
      .slice(0, policy.maxEntries);
    // An entry that disappears between readdir and lstat must not reject the
    // whole listing; skip it instead of failing the step.
    const entries = (
      await Promise.all(
        names.map(async (name) => {
          try {
            const entry = await lstat(path.join(target, name));
            return {
              name,
              type: entry.isSymbolicLink()
                ? "symlink"
                : entry.isDirectory()
                  ? "directory"
                  : entry.isFile()
                    ? "file"
                    : "other",
              size: entry.size,
              modifiedAt: entry.mtime.toISOString(),
            };
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((entry) => entry !== undefined);
    return { target, output: { relativePath, entries } };
  }
  if (policy.kind === "path_metadata") {
    const stats = await lstat(target);
    return {
      target,
      output: {
        relativePath,
        type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    };
  }
  const content = await readTextFile(target, policy.maxBytes);
  return {
    target,
    output: {
      relativePath,
      content,
      size: Buffer.byteLength(content, "utf8"),
    },
  };
}

export async function executeAction(
  definition: ActionDefinition,
  step: TaskStep,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const idempotencyKey = canonicalActionHash(step, context.workingContext);
  if (definition.execution.kind === "simulate") {
    context.simulatedState.set(idempotencyKey, true);
    return { mode: "simulated", idempotencyKey };
  }
  if (definition.execution.kind === "self_modify") {
    return runSelfModify(step, idempotencyKey);
  }
  if (definition.execution.kind === "self_source") {
    return runSelfSource(
      definition.execution.operation,
      step,
      idempotencyKey,
    );
  }
  if (definition.execution.kind === "app_control") {
    const application = step.arguments[definition.execution.applicationArgument];
    if (typeof application !== "string") {
      throw new ActionExecutionError("Validated application name is missing.");
    }
    return controlApplication(
      definition.execution.operation,
      application,
      idempotencyKey,
    );
  }
  if (definition.execution.kind === "browser_control") {
    return controlBrowser(definition.execution, step, context, idempotencyKey);
  }
  if (definition.execution.kind === "media_control") {
    return controlMedia(definition.execution, step, idempotencyKey);
  }
  if (definition.execution.kind === "file_mutate") {
    return mutateFilesystemEntry(
      definition.execution,
      step,
      context,
      idempotencyKey,
    );
  }
  if (definition.execution.kind === "ambient_read") {
    return readAmbient(definition.execution, step, context, idempotencyKey);
  }
  if (definition.execution.kind === "reminder") {
    return manageReminder(definition.execution, step, context, idempotencyKey);
  }
  if (definition.execution.kind === "self_tuning") {
    return tuneSelf(definition.execution, step, idempotencyKey);
  }
  if (definition.execution.kind === "health_log") {
    return trackHealth(definition.execution, step, context, idempotencyKey);
  }
  if (definition.execution.kind === "create_only_text") {
    return createOnlyText(definition.execution, step, context);
  }
  if (definition.execution.kind === "mutate_text") {
    return mutateText(definition.execution, step, context);
  }
  if (definition.execution.kind === "mutate_file") {
    return mutateFile(definition.execution, step, context);
  }
  if (definition.execution.kind === "create_directory") {
    const relativePath =
      step.arguments[definition.execution.relativePathArgument];
    if (typeof relativePath !== "string") {
      throw new ActionExecutionError("Validated relativePath is missing.");
    }
    return createDirectory(definition.execution.root, relativePath, context, step);
  }
  if (!isObservationPolicy(definition.execution)) {
    throw new ActionExecutionError("No executor is installed for this action.");
  }
  const observation = await observe(definition.execution, step, context);
  return { mode: "observed", idempotencyKey, ...observation };
}

function outputField(output: unknown, key: string): unknown {
  return output !== null && typeof output === "object"
    ? (output as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Browser verification re-observes the browser through a second AppleScript
 * round trip rather than trusting the command's own return value.
 */
async function verifyBrowser(
  policy: BrowserControlPolicy,
  step: TaskStep,
  execution: ExecutionResult,
  context: ExecutionContext,
): Promise<VerificationResult> {
  const browser = await resolveBrowser(policy, step, context);
  const maxTabs = policy.maxTabs ?? 200;
  if (policy.operation === "open_url") {
    const requested = outputField(execution.output, "url");
    if (typeof requested !== "string") return { observed: false };
    const tabs = await listBrowserTabs(browser, maxTabs);
    const match = tabs.find((tab) => urlsAgree(requested, tab.url));
    return {
      observed: match !== undefined,
      evidence: `${browser.name}:${match?.url ?? "not_found"}`,
    };
  }
  if (policy.operation === "new_tab" || policy.operation === "close_tab") {
    const before = outputField(execution.output, "tabCountBefore");
    const after = (await listBrowserTabs(browser, maxTabs)).length;
    if (typeof before !== "number") return { observed: false };
    return {
      observed: policy.operation === "new_tab" ? after > before : after < before,
      evidence: `${browser.name}:tabs ${before}->${after}`,
    };
  }
  if (policy.operation === "switch_tab") {
    const expected = outputField(execution.output, "selectedUrl");
    const current = activeTab(await listBrowserTabs(browser, maxTabs));
    return {
      observed:
        typeof expected === "string" &&
        current !== undefined &&
        current.url === expected,
      evidence: `${browser.name}:${current?.url ?? "no_active_tab"}`,
    };
  }
  if (policy.operation === "read_page") {
    // Confirm the text that was captured really belongs to the tab the ledger
    // names, without pulling the page contents a second time.
    const expected = outputField(execution.output, "url");
    const current = activeTab(await listBrowserTabs(browser, maxTabs));
    const digest = outputField(execution.output, "textSha256");
    return {
      observed:
        typeof expected === "string" &&
        current !== undefined &&
        current.url === expected,
      evidence: `${browser.name}:${current?.url ?? "no_active_tab"}:${
        typeof digest === "string" ? `sha256:${digest}` : "no_text"
      }`,
    };
  }
  // list_tabs: re-list and compare the observed set.
  const tabs = await listBrowserTabs(browser, maxTabs);
  const expectedHash = hash(outputField(execution.output, "tabs"));
  const observedHash = hash(tabs);
  return {
    observed: expectedHash === observedHash,
    evidence: `${browser.name}:sha256:${observedHash}`,
  };
}

async function verifyMedia(
  policy: MediaControlPolicy,
  step: TaskStep,
  execution: ExecutionResult,
): Promise<VerificationResult> {
  if (policy.operation === "volume_set") {
    const requested = outputField(execution.output, "level");
    const settings = await volumeSettings();
    if (typeof requested !== "number" || !Number.isFinite(settings.level)) {
      return { observed: false, evidence: "volume_unreadable" };
    }
    // macOS quantises output volume into sixteenths, so an exact match is not
    // available; anything within one step counts as observed.
    return {
      observed: Math.abs(settings.level - requested) <= 4,
      evidence: `output_volume:${settings.level}`,
    };
  }
  if (policy.operation === "volume_mute" || policy.operation === "volume_unmute") {
    const settings = await volumeSettings();
    return {
      observed:
        policy.operation === "volume_mute" ? settings.muted : !settings.muted,
      evidence: `output_muted:${settings.muted}`,
    };
  }
  if (policy.operation === "display_sleep") {
    // The post-sleep display power state is not readable on every Mac (notably
    // Apple Silicon, where IODisplayWrangler is absent), so this records that
    // the command was accepted and says so rather than pretending to observe.
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/pmset",
        ["-g", "powerstate", "IODisplayWrangler"],
        { timeout: 5000 },
      );
      const state = /IODisplayWrangler\s+(\d+)/.exec(stdout)?.[1];
      if (state !== undefined) {
        return {
          observed: Number.parseInt(state, 10) <= 3,
          evidence: `display_power_state:${state}`,
        };
      }
    } catch {
      /* fall through to the accepted-command evidence */
    }
    return {
      observed: true,
      evidence: "display_sleep_command_accepted:power_state_unverifiable",
    };
  }
  const player = await runningPlayer(policy, step);
  const after = await playerSnapshot(player);
  const previousState = outputField(execution.output, "previousState");
  const previousTrackId = outputField(execution.output, "previousTrackId");
  if (policy.operation === "play_pause") {
    return {
      observed:
        typeof previousState === "string" &&
        previousState !== "unknown" &&
        after.state !== "unknown" &&
        after.state !== previousState,
      evidence: `${player.name}:${previousState}->${after.state}`,
    };
  }
  // next/previous: either the track changed, or the player restarted the
  // current one, which is what "previous" does a few seconds into a track.
  const changed =
    typeof previousTrackId === "string" &&
    previousTrackId.length > 0 &&
    after.trackId !== previousTrackId;
  return {
    observed: changed || after.position <= 3,
    evidence: `${player.name}:track ${String(previousTrackId)}->${after.trackId}@${after.position}`,
  };
}

/**
 * A move, rename, or trash is verified by inode: the source must be gone and
 * the destination must be the very same filesystem object that was moved.
 */
async function verifyFileMutation(
  execution: ExecutionResult,
): Promise<VerificationResult> {
  const from = outputField(execution.output, "from");
  const to = outputField(execution.output, "to");
  const inode = outputField(execution.output, "inode");
  if (typeof from !== "string" || typeof to !== "string") {
    return { observed: false };
  }
  const sourceGone = await lstat(from).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
  const destination = await lstat(to).catch(() => undefined);
  return {
    observed:
      sourceGone &&
      destination !== undefined &&
      (typeof inode !== "number" || destination.ino === inode),
    evidence: `${to}:ino=${destination?.ino ?? "absent"}:source_gone=${sourceGone}`,
  };
}

/** The result hash the executor committed, as recorded in the execution output. */
function committedResultHash(output: unknown): string | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const value = (output as { resultHash?: unknown }).resultHash;
  return typeof value === "string" ? value : undefined;
}


// ------------------------------------------------------- ambient & reminders

async function readAmbient(
  policy: Extract<ExecutionPolicy, { kind: "ambient_read" }>,
  step: TaskStep,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  if (policy.operation === "clock") {
    const timezone = step.arguments.timezone;
    return {
      mode: "observed",
      idempotencyKey,
      output: readClock(typeof timezone === "string" ? timezone : undefined),
    };
  }
  if (policy.operation === "system_status") {
    return { mode: "observed", idempotencyKey, output: await readSystemStatus() };
  }

  const requested = step.arguments.location;
  const location =
    typeof requested === "string" && requested.trim().length > 0
      ? requested.trim()
      : context.defaultLocation;
  if (!location) {
    // Deliberately an error rather than a guess: reporting the weather for
    // somewhere the user never named, with no sign it was invented, is worse
    // than refusing. But point at the answer -- where Nick lives is the kind of
    // durable fact that belongs in USER.md, and Orion already has that file in
    // context. Retrying with the city from there is the correct response to
    // this error, not asking him where he lives again.
    throw new ActionExecutionError(
      "No location was given. Check USER.md for where Nick lives and retry " +
        "with that city; only ask him if it genuinely is not recorded.",
    );
  }
  const days = step.arguments.days;
  try {
    const report = await readWeather({
      location,
      ...(typeof days === "number" ? { days } : {}),
    });
    return { mode: "observed", idempotencyKey, target: report.place, output: report };
  } catch (error) {
    throw new ActionExecutionError(
      error instanceof Error ? error.message : "The weather service did not answer.",
    );
  }
}

async function manageReminder(
  policy: Extract<ExecutionPolicy, { kind: "reminder" }>,
  step: TaskStep,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const file = remindersPath(context.remindersPath);
  const now = Date.now();
  // Anything already past is dropped on every touch of the store, so a machine
  // that was asleep when a timer was due does not wake up and fire a backlog.
  const live = (await readReminders(file)).filter((entry) => entry.dueAt > now);

  if (policy.operation === "reminder_list") {
    return {
      mode: "observed",
      idempotencyKey,
      output: {
        reminders: live.map((entry) => ({
          ...entry,
          dueIn: describeDuration((entry.dueAt - now) / 1000),
        })),
      },
    };
  }

  if (policy.operation === "reminder_cancel") {
    const id = String(step.arguments.id);
    const remaining = live.filter((entry) => entry.id !== id);
    if (remaining.length === live.length) {
      throw new ActionExecutionError(`There is no timer or alarm with id ${id}.`);
    }
    await writeReminders(file, remaining);
    return { mode: "cancelled", idempotencyKey, target: id };
  }

  const label =
    typeof step.arguments.label === "string" && step.arguments.label.trim()
      ? step.arguments.label.trim()
      : policy.operation === "alarm_set"
        ? "Alarm"
        : "Timer";

  let dueAt: number;
  if (policy.operation === "timer_set") {
    dueAt = now + Number(step.arguments.seconds) * 1000;
  } else {
    try {
      dueAt = resolveAlarmTime(String(step.arguments.at));
    } catch (error) {
      throw new ActionExecutionError(
        error instanceof Error ? error.message : "That is not a time.",
      );
    }
  }

  const reminder: Reminder = {
    // Short and speakable: the user may have to say it back to cancel it.
    id: `${policy.operation === "alarm_set" ? "a" : "t"}${now.toString(36).slice(-5)}`,
    kind: policy.operation === "alarm_set" ? "alarm" : "timer",
    label,
    dueAt,
    createdAt: now,
  };
  await writeReminders(file, [...live, reminder]);
  return {
    mode: "scheduled",
    idempotencyKey,
    target: reminder.id,
    output: {
      ...reminder,
      dueIn: describeDuration((dueAt - now) / 1000),
      dueAtLocal: new Date(dueAt).toLocaleString(),
    },
  };
}

/*
 Orion adjusting his own ears.

 Reads and writes a closed list of keys in his own preference domain via
 `defaults`, which is the same interface `orion-doctor` already uses to read
 them back — so there is one source of truth and no second config file to drift.

 Two properties worth stating plainly, because this is the tier that grants
 Orion power over himself:

   • The key never comes from the model. The model names a SETTING from
     `TUNABLE_SETTINGS`; this function looks up the key. A model-authored string
     therefore cannot reach `defaults write` as a key, a domain, or a flag.
   • The domain is a constant. There is no argument that can redirect a write to
     another application's preferences.
*/
async function readTunable(setting: TunableSetting): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/defaults",
      ["read", ORION_APP_DOMAIN, setting.key],
      { timeout: 5000 },
    );
    const parsed = Number(stdout.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    // An unset key exits non-zero. That is "still on the default", not a fault.
    return undefined;
  }
}

async function tuneSelf(
  execution: { kind: "self_tuning"; operation: "read" | "write" },
  step: TaskStep,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  if (execution.operation === "read") {
    const settings: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(TUNABLE_SETTINGS)) {
      const current = await readTunable(spec);
      settings[name] = {
        value: current ?? null,
        usingDefault: current === undefined,
        range: [spec.min, spec.max],
        unit: spec.unit,
        description: spec.description,
      };
    }
    return { mode: "observed", idempotencyKey, output: { settings } };
  }

  const name = step.arguments.setting;
  const value = step.arguments.value;
  // Both were already checked by `validateArguments`; re-checked here because
  // an executor that trusts its caller is one refactor away from not being
  // checked at all.
  if (typeof name !== "string" || !(name in TUNABLE_SETTINGS)) {
    throw new ActionExecutionError("Unknown tunable setting.");
  }
  const spec = TUNABLE_SETTINGS[name]!;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ActionExecutionError("Tunable value must be a number.");
  }
  if (value < spec.min || value > spec.max) {
    throw new ActionExecutionError(
      `${name} must be between ${spec.min} and ${spec.max}${spec.unit}.`,
    );
  }
  const previous = await readTunable(spec);
  try {
    await execFileAsync(
      "/usr/bin/defaults",
      [
        "write",
        ORION_APP_DOMAIN,
        spec.key,
        spec.integer ? "-int" : "-float",
        String(value),
      ],
      { timeout: 5000 },
    );
  } catch (error) {
    throw new ActionExecutionError(
      `Could not write ${name}: ${error instanceof Error ? error.message : "defaults failed"}`,
    );
  }
  return {
    mode: "replaced",
    idempotencyKey,
    target: spec.key,
    output: {
      setting: name,
      value,
      previous: previous ?? null,
      unit: spec.unit,
      // The inverse, in the result rather than in `undo`: `UndoRecord` is typed
      // for filesystem moves (from/to paths) and a preference change is not one.
      // Widening that type to fit would make every undo consumer handle a shape
      // it cannot act on, so the reversal is recorded here, where the ledger
      // still captures it verbatim.
      //
      // Restoring a value that was never set means DELETING the key, not
      // writing a zero — otherwise the undo pins the setting to a number it
      // never had and the built-in default becomes unreachable.
      restore:
        previous === undefined
          ? `defaults delete ${ORION_APP_DOMAIN} ${spec.key}`
          : `defaults write ${ORION_APP_DOMAIN} ${spec.key} ${spec.integer ? "-int" : "-float"} ${previous}`,
    },
  };
}

/*
 Supplements and workouts, written to the file the Orion app reads.

 Every operation goes through `health.ts`, which does read-modify-write with an
 atomic rename. Two writers exist -- this and the dashboard -- so nothing here
 caches, and a set logged by voice shows up in the UI within its poll interval.
*/
async function trackHealth(
  execution: {
    kind: "health_log";
    operation:
      | "supplement_add"
      | "supplement_take"
      | "supplement_status"
      | "workout_log"
      | "workout_status";
  },
  step: TaskStep,
  context: ExecutionContext,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const file = defaultHealthLogPath(context.healthLogPath);

  if (execution.operation === "supplement_status") {
    return { mode: "observed", idempotencyKey, output: await supplementStatus(file) };
  }
  if (execution.operation === "workout_status") {
    return { mode: "observed", idempotencyKey, output: await workoutStatus(file) };
  }

  if (execution.operation === "supplement_add") {
    const name = String(step.arguments.name ?? "");
    const result = await addSupplement(
      file,
      name,
      String(step.arguments.dose ?? ""),
      String(step.arguments.timeOfDay ?? "anytime"),
    );
    return {
      mode: result.added ? "created" : "already_present",
      idempotencyKey,
      target: result.supplement?.name ?? name,
      output: {
        added: result.added,
        name: result.supplement?.name ?? name,
        note: result.added ? undefined : "Already on the list; nothing changed.",
      },
    };
  }

  if (execution.operation === "supplement_take") {
    const name = String(step.arguments.name ?? "");
    const result = await takeSupplement(file, name);
    return {
      mode: result.alreadyTaken ? "already_present" : "created",
      idempotencyKey,
      target: result.matched?.name ?? name,
      output: {
        name: result.matched?.name ?? name,
        alreadyTaken: result.alreadyTaken,
        // Recorded rather than refused: being told about a supplement Orion has
        // never heard of is a fact to keep, not a setup error to complain about.
        addedToList: result.created,
      },
    };
  }

  const exercise = String(step.arguments.exercise ?? "");
  const rawSets = Array.isArray(step.arguments.sets) ? step.arguments.sets : [];
  const sets = rawSets.map((entry) => ({
    weight: Number((entry as Record<string, unknown>).weight),
    reps: Number((entry as Record<string, unknown>).reps),
  }));
  const unit = String(step.arguments.unit ?? "lb");
  const logged = await logExercise(file, exercise, sets, unit);
  if (!logged) {
    throw new ActionExecutionError("Could not record that exercise.");
  }
  return {
    mode: "appended",
    idempotencyKey,
    target: logged.exercise.name,
    output: {
      exercise: logged.exercise.name,
      setsLogged: sets.length,
      totalSetsToday: logged.exercise.sets.length,
      sets: logged.exercise.sets.map((set) => `${set.weight}${set.unit} x ${set.reps}`),
    },
  };
}

export async function verifyAction(
  definition: ActionDefinition,
  step: TaskStep,
  execution: ExecutionResult,
  context: ExecutionContext,
): Promise<VerificationResult> {
  if (definition.execution.kind === "simulate") {
    return {
      observed: context.simulatedState.has(execution.idempotencyKey),
      evidence: `simulated:${execution.idempotencyKey}`,
    };
  }
  if (definition.execution.kind === "self_source") {
    // Same question an ambient read asks, for the same reason: a read has no
    // state to re-check, so the only meaningful verification is whether
    // anything came back. Declaring a verification name with no verifier behind
    // it is what made these fail with "independent verification did not observe
    // the expected state" — a true message about a check that did not exist.
    const present =
      typeof execution.output === "string" && execution.output.length > 0;
    return {
      observed: present,
      evidence: present ? `self_source:${definition.execution.operation}` : undefined,
    };
  }
  if (definition.execution.kind === "self_modify") {
    // The forge already proved it: a non-zero exit threw before reaching here,
    // and reaching here means the code compiled AND the rebuilt app survived
    // its launch watch. That IS the independent verification — re-deriving it
    // would be weaker than the check that already ran.
    const applied =
      typeof execution.output === "string" && execution.output.includes("✓");
    return {
      observed: applied,
      evidence: applied ? "self_modify:applied" : undefined,
    };
  }
  if (definition.execution.kind === "ambient_read") {
    // The evidence IS the answer: an ambient read has no state to re-check, so
    // verification asks the only meaningful question — did anything come back.
    const present =
      execution.output !== undefined && execution.output !== null;
    return {
      observed: present,
      evidence: present ? `${definition.execution.operation}:reported` : undefined,
    };
  }
  if (definition.execution.kind === "reminder") {
    const file = remindersPath(context.remindersPath);
    const stored = await readReminders(file);
    if (definition.execution.operation === "reminder_list") {
      return { observed: true, evidence: `reminders:${stored.length}` };
    }
    // Re-read the store rather than trusting the write: this is the same
    // independent check every other mutation gets, and it is what catches a
    // rename that silently did not land.
    const id = execution.target;
    const found = stored.some((entry) => entry.id === id);
    const wantPresent = definition.execution.operation !== "reminder_cancel";
    return {
      observed: found === wantPresent,
      evidence: `${id}:${found ? "present" : "absent"}`,
    };
  }
  if (definition.execution.kind === "health_log") {
    // Read the log back rather than trusting the write. Same discipline as
    // every other mutation here, and it is what catches a store that silently
    // did not persist.
    const file = defaultHealthLogPath(context.healthLogPath);
    if (definition.execution.operation === "supplement_status") {
      return { observed: execution.output !== undefined, evidence: "supplements:reported" };
    }
    if (definition.execution.operation === "workout_status") {
      return { observed: execution.output !== undefined, evidence: "workout:reported" };
    }
    const log = await readHealthLog(file);
    if (definition.execution.operation === "workout_log") {
      const day = todayKey();
      const session = log.workouts.find((entry) => entry.day === day);
      const name = String(step.arguments.exercise ?? "").toLowerCase();
      const found = session?.exercises.some(
        (entry) => entry.name.toLowerCase() === name,
      );
      return {
        observed: found === true,
        evidence: `${step.arguments.exercise}:${found ? "logged" : "missing"}`,
      };
    }
    const name = String(step.arguments.name ?? "").toLowerCase();
    const entry = log.supplements.find(
      (candidate) => candidate.name.toLowerCase() === name,
    );
    if (definition.execution.operation === "supplement_add") {
      return {
        observed: entry !== undefined,
        evidence: `${step.arguments.name}:${entry ? "listed" : "missing"}`,
      };
    }
    const taken = entry
      ? (log.supplementLog[todayKey()] ?? []).includes(entry.id)
      : false;
    return {
      observed: taken,
      evidence: `${step.arguments.name}:${taken ? "taken" : "not-taken"}`,
    };
  }
  if (definition.execution.kind === "self_tuning") {
    if (definition.execution.operation === "read") {
      return { observed: execution.output !== undefined, evidence: "tuning:reported" };
    }
    // Read it straight back out of the preference domain. `defaults write` can
    // exit zero and still not land — a bad type flag, or cfprefsd holding the
    // domain — and a setting that silently did not take is the single most
    // confusing failure this tier could have.
    const name = step.arguments.setting;
    if (typeof name !== "string" || !(name in TUNABLE_SETTINGS)) {
      return { observed: false };
    }
    const spec = TUNABLE_SETTINGS[name]!;
    const readBack = await readTunable(spec);
    const intended = step.arguments.value;
    const matches =
      typeof intended === "number" &&
      readBack !== undefined &&
      Math.abs(readBack - intended) < 0.001;
    return {
      observed: matches,
      evidence: `${spec.key}:${readBack ?? "unset"}`,
    };
  }
  if (definition.execution.kind === "app_control") {
    const application = step.arguments[definition.execution.applicationArgument];
    if (typeof application !== "string") return { observed: false };
    const target = await resolveApplication(application);
    const running = await applicationIsRunning(target.bundleId);
    return {
      observed:
        definition.execution.operation === "open" ? running : !running,
      evidence: `${target.bundleId}:${running ? "running" : "not_running"}`,
    };
  }
  if (definition.execution.kind === "browser_control") {
    return verifyBrowser(definition.execution, step, execution, context);
  }
  if (definition.execution.kind === "media_control") {
    return verifyMedia(definition.execution, step, execution);
  }
  if (definition.execution.kind === "file_mutate") {
    return verifyFileMutation(execution);
  }
  if (definition.execution.kind === "create_only_text" && execution.target) {
    const expected = createRequest(definition.execution, step).content;
    const observed = await readTextFile(
      execution.target,
      definition.execution.maxBytes,
    );
    return { observed: observed === expected, evidence: execution.target };
  }
  if (definition.execution.kind === "mutate_text" && execution.target) {
    // Compare against the hash the executor derived from the bytes it wrote,
    // never against a caller-supplied value.
    const committed = committedResultHash(execution.output);
    const observed = await readTextFile(
      execution.target,
      definition.execution.maxResultBytes,
    );
    const observedHash = contentHash(observed);
    return {
      observed: committed !== undefined && observedHash === committed,
      evidence: `sha256:${observedHash}`,
    };
  }
  if (definition.execution.kind === "mutate_file" && execution.target) {
    const committed = committedResultHash(execution.output);
    const observed = await readFileBytes(
      execution.target,
      definition.execution.maxResultBytes,
    );
    const observedHash = contentHash(observed);
    return {
      observed: committed !== undefined && observedHash === committed,
      evidence: `sha256:${observedHash}`,
    };
  }
  if (definition.execution.kind === "create_directory" && execution.target) {
    const stats = await lstat(execution.target);
    return {
      observed: stats.isDirectory() && !stats.isSymbolicLink(),
      evidence: execution.target,
    };
  }
  if (
    isObservationPolicy(definition.execution) &&
    execution.output !== undefined
  ) {
    const independentlyObserved = await observe(
      definition.execution,
      step,
      context,
    );
    const expectedHash = hash(execution.output);
    const observedHash = hash(independentlyObserved.output);
    return {
      observed: observedHash === expectedHash,
      evidence: `sha256:${observedHash}`,
    };
  }
  return { observed: false };
}


/**
 * Hand a source rewrite to `scripts/orion-forge` and report what it decided.
 *
 * Deliberately thin. Everything that makes this survivable — the path gate, the
 * build gate, the launch gate, the automatic restore of the previous bundle,
 * the git commit and the ledger — lives in the script, so the dangerous logic is
 * one readable file rather than a branch buried in this one. This function only
 * writes the proposed source to a temporary file, runs the script, and turns a
 * non-zero exit into a refusal the model can read.
 *
 * The timeout is generous because a release build of the whole app plus a
 * twelve-second launch watch genuinely takes minutes, and killing it halfway
 * would leave the app mid-swap — the one state the script is built to avoid.
 */
async function runSelfModify(
  step: TaskStep,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const file = String(step.arguments.file ?? "");
  const find = String(step.arguments.find ?? "");
  const replace = String(step.arguments.replace ?? "");
  const intent = String(step.arguments.message ?? "Orion changed his own code");

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const findPath = path.join(os.tmpdir(), `orion-forge-find-${stamp}.txt`);
  const replacePath = path.join(os.tmpdir(), `orion-forge-replace-${stamp}.txt`);
  // Written to files rather than passed as argv: a Swift fragment contains
  // newlines, quotes and braces, and routing that through a command line is a
  // quoting bug waiting to corrupt the very text being matched.
  await writeFile(findPath, find, "utf8");
  await writeFile(replacePath, replace, "utf8");

  const script = path.join(
    os.homedir(),
    "Desktop/ORION/scripts/orion-forge",
  );

  try {
    const result = await new Promise<{ code: number; output: string }>(
      (resolve) => {
        const child = spawn(script, ["edit", file, findPath, replacePath, intent], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout?.on("data", (chunk) => (output += String(chunk)));
        child.stderr?.on("data", (chunk) => (output += String(chunk)));
        const timer = setTimeout(
          () => child.kill("SIGKILL"),
          15 * 60 * 1000,
        );
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, output: output.trim() });
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({ code: 1, output: String(error) });
        });
      },
    );

    if (result.code !== 0) {
      // The script already undid everything before returning. Surfacing its
      // output verbatim matters: the compiler errors in it are what let the
      // model fix the change rather than guess at why it was refused.
      throw new ActionExecutionError(
        `The change was rejected and rolled back. Nothing was installed.\n${result.output}`,
      );
    }
    return { mode: "rebuilt", idempotencyKey, output: result.output };
  } finally {
    await rm(findPath, { force: true }).catch(() => {});
    await rm(replacePath, { force: true }).catch(() => {});
  }
}


/** Read-only companion to `runSelfModify` — see the `self_source` policy. */
async function runSelfSource(
  operation: "list" | "read",
  step: TaskStep,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  const script = path.join(os.homedir(), "Desktop/ORION/scripts/orion-forge");
  const arguments_ =
    operation === "list"
      ? ["list"]
      : ["read", String(step.arguments.file ?? "")];

  const result = await new Promise<{ code: number; output: string }>(
    (resolve) => {
      const child = spawn(script, arguments_, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout?.on("data", (chunk) => (output += String(chunk)));
      child.stderr?.on("data", (chunk) => (output += String(chunk)));
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, output: output.trim() });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: 1, output: String(error) });
      });
    },
  );

  if (result.code !== 0) {
    throw new ActionExecutionError(result.output || "Could not read the source.");
  }
  return { mode: "observed", idempotencyKey, output: result.output };
}
