import { constants } from "node:fs";
import { describeDuration, readClock, readReminders, readSystemStatus, readWeather, remindersPath, resolveAlarmTime, writeReminders, } from "./ambient.js";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { EMPTY_TRIPS, TRIP_STORE, detectLegs, renderBrief, validateTrip, } from "./travel.js";
import { renderCard, termsFromEvent, } from "./prep.js";
import { EMPTY_STORE, WAITING_STORE, civilToday, daysLate, draftFollowUp, overdue, pending, validateItem as validateWaitingItem, } from "./waiting.js";
import { AUTOMATION_ROOT, describeTrigger, simulate, validateProposal, } from "./automation.js";
import { MAX_OUTPUT_BYTES, boundOutput, devEnvironment, resolveDevCommand, } from "./devops.js";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile, } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clampVolume, browserUrlIssues, isMutableRoot, isObservationPolicy, isSafeRelativePath, isSafeSegment, isVisibleNonSensitiveName, ORION_APP_DOMAIN, resolveBrowserName, resolvePlayerName, SUPPORTED_BROWSERS, SUPPORTED_PLAYERS, TUNABLE_SETTINGS, } from "./catalog.js";
import { addSupplement, defaultHealthLogPath, logExercise, readHealthLog, supplementStatus, takeSupplement, today as todayKey, workoutStatus, } from "./health.js";
import { canonicalActionHash, hash } from "./validator.js";
import { AtlasBridgeError, requestAtlas } from "./atlas.js";
export class ActionExecutionError extends Error {
    retryable;
    constructor(message, retryable = false) {
        super(message);
        this.retryable = retryable;
        this.name = "ActionExecutionError";
    }
}
const execFileAsync = promisify(execFile);
async function resolveApplication(application) {
    let lastFailure;
    for (const root of ["/Applications", "/System/Applications"]) {
        const candidate = path.join(root, `${application}.app`);
        try {
            const stats = await lstat(candidate);
            if (!stats.isDirectory() || stats.isSymbolicLink())
                continue;
            const { stdout } = await execFileAsync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(candidate, "Contents/Info.plist")], { timeout: 5000 });
            const bundleId = stdout.trim();
            if (!/^[A-Za-z0-9.-]{3,200}$/.test(bundleId)) {
                throw new ActionExecutionError("Installed app has an invalid bundle identifier.");
            }
            return { path: candidate, bundleId };
        }
        catch (error) {
            if (error instanceof ActionExecutionError)
                throw error;
            // Keep the last diagnostic so a plutil/permission failure is not reported
            // as a plain "not installed".
            const code = error.code;
            if (code !== "ENOENT") {
                lastFailure = code ?? error.message;
            }
        }
    }
    throw new ActionExecutionError(lastFailure
        ? `Application could not be resolved (${lastFailure}).`
        : "Application was not found in /Applications or /System/Applications.");
}
async function applicationIsRunning(bundleId) {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", `application id "${bundleId}" is running`], { timeout: 5000 });
    return stdout.trim() === "true";
}
async function controlApplication(operation, application, idempotencyKey) {
    const target = await resolveApplication(application);
    if (operation === "open") {
        await execFileAsync("/usr/bin/open", [target.path], { timeout: 10000 });
        return { mode: "opened", idempotencyKey, target: target.path, output: target };
    }
    if (!(await applicationIsRunning(target.bundleId))) {
        return { mode: "already_present", idempotencyKey, target: target.path, output: target };
    }
    await execFileAsync("/usr/bin/osascript", ["-e", `tell application id "${target.bundleId}" to quit`], { timeout: 10000 });
    return { mode: "quit", idempotencyKey, target: target.path, output: target };
}
/**
 * macOS Automation refusal. The user has to grant this once per browser, and a
 * raw "-1743" tells them nothing, so it is translated into the exact steps.
 */
const AUTOMATION_DENIED = /-1743|not authoriz(?:ed|ised) to send apple events|not allowed to send apple events/i;
const JAVASCRIPT_DENIED = /javascript.*(?:turned off|not allowed|disabled)|allow javascript from apple events|-2740/i;
const APPLICATION_NOT_RUNNING = /-600\b|(?:isn't|is not) running/i;
function automationGuidance(application) {
    return (`macOS has not granted permission to control ${application}. ` +
        "Open System Settings > Privacy & Security > Automation, find the app that runs OpenClaw " +
        "(Terminal, iTerm, or the OpenClaw app), and switch on " +
        `${application}. macOS asks once per app; retry after granting it.`);
}
function javascriptGuidance(application) {
    return (`${application} is refusing to run JavaScript from AppleScript, which is how page text is read. ` +
        (application === "Safari"
            ? "Enable Safari > Settings > Advanced > Show features for web developers, then Develop > Allow JavaScript from Apple Events."
            : `Enable ${application}'s View > Developer > Allow JavaScript from Apple Events.`) +
        " Without it Orion cannot read the page.");
}
async function runAppleScript(script, options) {
    try {
        const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
            timeout: options.timeoutMs ?? 10000,
            maxBuffer: 8 * 1024 * 1024,
        });
        return stdout;
    }
    catch (error) {
        const detail = [
            error.stderr ?? "",
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
            throw new ActionExecutionError(`${options.application} is not running, so there is no window to act on.`);
        }
        if (error.killed === true) {
            throw new ActionExecutionError(`${options.application} did not respond in time.`, true);
        }
        throw new ActionExecutionError(`${options.application} refused the request: ${detail.slice(0, 200) || "no diagnostic"}`);
    }
}
const BROWSER_ENGINE = {
    "Opera Air": "chromium",
    Opera: "chromium",
    Safari: "safari",
    "Google Chrome": "chromium",
};
async function describeBrowser(name) {
    const resolved = await resolveApplication(name);
    return {
        name,
        bundleId: resolved.bundleId,
        engine: BROWSER_ENGINE[name],
        path: resolved.path,
    };
}
/** The https handler LaunchServices records, read-only and best-effort. */
async function defaultBrowserBundleId() {
    const plist = path.join(os.homedir(), "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist");
    try {
        const { stdout } = await execFileAsync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], { timeout: 5000 });
        const parsed = JSON.parse(stdout);
        const handler = parsed.LSHandlers?.find((entry) => entry.LSHandlerURLScheme === "https");
        const bundleId = handler?.LSHandlerRoleAll;
        return typeof bundleId === "string" ? bundleId : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Which browser to drive: the caller's explicit choice, else the configured
 * preference, else whichever supported browser is already running, else the
 * system default browser, else the first one installed. The chosen browser is
 * named in the ledger for every browser action.
 */
async function resolveBrowser(policy, step, context) {
    const requested = resolveBrowserName(step.arguments[policy.browserArgument]) ??
        resolveBrowserName(context.browserPreference);
    if (requested)
        return describeBrowser(requested);
    const installed = [];
    for (const name of SUPPORTED_BROWSERS) {
        const described = await describeBrowser(name).catch(() => undefined);
        if (described)
            installed.push(described);
    }
    if (installed.length === 0) {
        throw new ActionExecutionError(`No supported browser is installed. Orion drives one of: ${SUPPORTED_BROWSERS.join(", ")}.`);
    }
    for (const browser of installed) {
        const running = await applicationIsRunning(browser.bundleId).catch(() => false);
        if (running)
            return browser;
    }
    const fallbackId = await defaultBrowserBundleId();
    const preferred = fallbackId
        ? installed.find((browser) => browser.bundleId.toLowerCase() === fallbackId.toLowerCase())
        : undefined;
    return preferred ?? installed[0];
}
/** AppleScript's `character id 1`: cannot occur in a URL or a window title. */
const TAB_FIELD_SEPARATOR = "\u0001";
function tabListScript(browser) {
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
function parseTabs(raw, maxTabs) {
    const tabs = [];
    for (const line of raw.split("\n")) {
        if (line.trim().length === 0)
            continue;
        const fields = line.split(TAB_FIELD_SEPARATOR);
        if (fields.length < 5)
            continue;
        const windowIndex = Number.parseInt(fields[0] ?? "", 10);
        const tabIndex = Number.parseInt(fields[1] ?? "", 10);
        if (!Number.isInteger(windowIndex) || !Number.isInteger(tabIndex))
            continue;
        tabs.push({
            windowIndex,
            tabIndex,
            active: fields[2] === "1",
            url: (fields[3] ?? "").trim(),
            title: fields.slice(4).join(TAB_FIELD_SEPARATOR).trim().slice(0, 300),
        });
        if (tabs.length >= maxTabs)
            break;
    }
    return tabs;
}
async function listBrowserTabs(browser, maxTabs = 200) {
    const raw = await runAppleScript(tabListScript(browser), {
        application: browser.name,
    });
    return parseTabs(raw, maxTabs);
}
function activeTab(tabs) {
    return tabs.find((tab) => tab.active && tab.windowIndex === 1) ??
        tabs.find((tab) => tab.active) ??
        tabs[0];
}
/** Same site, allowing for the redirects and trailing-slash normalisation any real page does. */
function urlsAgree(requested, observed) {
    if (requested === observed)
        return true;
    try {
        const left = new URL(requested);
        const right = new URL(observed);
        if (left.href === right.href)
            return true;
        return left.hostname.toLowerCase() === right.hostname.toLowerCase();
    }
    catch {
        return false;
    }
}
function pageTextScript(browser) {
    return browser.engine === "safari"
        ? `tell application id "${browser.bundleId}" to do JavaScript "document.body.innerText" in current tab of front window`
        : `tell application id "${browser.bundleId}" to execute front window's active tab javascript "document.body.innerText"`;
}
function newTabScript(browser) {
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
function closeTabScript(browser) {
    return browser.engine === "safari"
        ? `tell application id "${browser.bundleId}" to close current tab of front window`
        : `tell application id "${browser.bundleId}" to close active tab of front window`;
}
function activateTabScript(browser, windowIndex, tabIndex) {
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
function selectTab(tabs, selector) {
    if (typeof selector === "number") {
        return tabs.find((tab) => tab.windowIndex === 1 && tab.tabIndex === selector);
    }
    const needle = selector.trim().toLowerCase();
    return tabs.find((tab) => tab.title.toLowerCase().includes(needle) ||
        tab.url.toLowerCase().includes(needle));
}
async function controlBrowser(policy, step, context, idempotencyKey) {
    const browser = await resolveBrowser(policy, step, context);
    const maxTabs = policy.maxTabs ?? 200;
    const describe = (output) => ({
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
            throw new ActionExecutionError(`${browser.name} has no open tab to close.`);
        }
        const closing = policy.operation === "close_tab" ? activeTab(before) : undefined;
        await runAppleScript(policy.operation === "new_tab"
            ? newTabScript(browser)
            : closeTabScript(browser), { application: browser.name });
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
        const selector = typeof rawSelector === "number"
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
            throw new ActionExecutionError(typeof selector === "number"
                ? `${browser.name} has no tab ${selector} in its front window.`
                : `No open ${browser.name} tab matches "${selector}".`);
        }
        await runAppleScript(activateTabScript(browser, chosen.windowIndex, chosen.tabIndex), { application: browser.name });
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
async function runningPlayer(policy, step) {
    const requested = resolvePlayerName(step.arguments[policy.playerArgument ?? "player"]);
    const candidates = requested
        ? [requested]
        : SUPPORTED_PLAYERS;
    for (const name of candidates) {
        const resolved = await resolveApplication(name).catch(() => undefined);
        if (!resolved)
            continue;
        const running = await applicationIsRunning(resolved.bundleId).catch(() => false);
        if (running)
            return { name, bundleId: resolved.bundleId };
    }
    throw new ActionExecutionError(requested
        ? `${requested} is not running, so there is nothing to control.`
        : `No supported media player is running (${SUPPORTED_PLAYERS.join(", ")}).`);
}
async function playerSnapshot(player, timeoutMs) {
    const raw = await runAppleScript(`tell application id "${player.bundleId}"
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
end tell`, { application: player.name, timeoutMs });
    const [state = "unknown", trackId = "", position = "0"] = raw
        .trim()
        .split(TAB_FIELD_SEPARATOR);
    return {
        state,
        trackId,
        position: Number.parseFloat(position) || 0,
    };
}
async function volumeSettings() {
    const raw = await runAppleScript('set s to (get volume settings)\nreturn ((output volume of s) as text) & character id 1 & ((output muted of s) as text)', { application: "the system volume" });
    const [level = "", muted = ""] = raw.trim().split(TAB_FIELD_SEPARATOR);
    return {
        level: Number.parseInt(level, 10),
        muted: muted.trim().toLowerCase() === "true",
    };
}
async function controlMedia(policy, step, idempotencyKey) {
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
        await runAppleScript(policy.operation === "volume_mute"
            ? "set volume with output muted"
            : "set volume without output muted", { application: "the system volume" });
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
    /*
     The snapshot is EVIDENCE, not the action, and it must never cost the action.
  
     It ran with the default 10s osascript timeout and, on 2026-09-02, spent the
     whole budget: the task failed at 10.07s having never sent the playpause.
     Apple Music was running and had already been resolved -- Nick asked Orion to
     pause his music and was told "Music did not respond in time", because
     verification consumed the thing it was verifying.
  
     Three seconds, and a failure degrades to an unknown previous state rather
     than aborting. An unverified pause that actually happened beats a verified
     one that did not. Manifest PHASE 46, added the same day.
    */
    const before = await playerSnapshot(player, 3000).catch(() => ({ state: "unknown", trackId: "", position: 0 }));
    const command = policy.operation === "play_pause"
        ? "playpause"
        : policy.operation === "next_track"
            ? "next track"
            : "previous track";
    await runAppleScript(`tell application id "${player.bundleId}" to ${command}`, { application: player.name });
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
function isWithin(root, target) {
    return target === root || target.startsWith(`${root}${path.sep}`);
}
async function assertRealDirectory(directory) {
    let stats;
    try {
        stats = await lstat(directory);
    }
    catch (error) {
        // A missing or unreadable root must be a controlled, diagnosable failure
        // rather than a bare errno surfaced as "Unexpected executor failure."
        throw new ActionExecutionError(`Controlled root is unavailable (${error.code ?? "unknown"}): ${directory}`);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new ActionExecutionError(`Controlled root is not a real directory: ${directory}`);
    }
    return realpath(directory);
}
async function prepareControlledDirectory(root, subdirectory) {
    const resolvedRoot = path.resolve(root);
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const realRoot = await assertRealDirectory(resolvedRoot);
    let current = realRoot;
    for (const segment of subdirectory.split("/")) {
        current = path.join(current, segment);
        await mkdir(current, { mode: 0o700 }).catch((error) => {
            if (error.code !== "EEXIST")
                throw error;
        });
        current = await assertRealDirectory(current);
        if (!isWithin(realRoot, current)) {
            throw new ActionExecutionError("Controlled directory escaped its configured root.");
        }
    }
    return current;
}
async function resolveExistingPath(root, relativePath) {
    const resolvedRoot = path.resolve(root);
    const realRoot = await assertRealDirectory(resolvedRoot);
    if (relativePath === ".")
        return { realRoot, target: realRoot };
    let current = realRoot;
    for (const segment of relativePath.split("/")) {
        current = path.join(current, segment);
        let stats;
        try {
            stats = await lstat(current);
        }
        catch (error) {
            // Surface a diagnosable message instead of a bare errno that the
            // controller would report as "Unexpected executor failure."
            if (error.code === "ENOENT") {
                throw new ActionExecutionError(`Path does not exist inside the configured root: ${relativePath}`);
            }
            throw new ActionExecutionError(`Path could not be inspected (${error.code ?? "unknown"}): ${relativePath}`);
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
async function readTextFile(target, maxBytes) {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
        throw new ActionExecutionError(`Text target must be a regular file no larger than ${maxBytes} bytes.`);
    }
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        return await handle.readFile("utf8");
    }
    finally {
        await handle.close();
    }
}
function contentHash(content) {
    return createHash("sha256").update(content).digest("hex");
}
async function readFileBytes(target, maxBytes) {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
        throw new ActionExecutionError(`File target must be a regular file no larger than ${maxBytes} bytes.`);
    }
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        return await handle.readFile();
    }
    finally {
        await handle.close();
    }
}
function createRequest(policy, step) {
    const name = step.arguments[policy.nameArgument];
    const content = step.arguments[policy.contentArgument];
    const extension = policy.fixedExtension
        ? policy.fixedExtension
        : policy.extensionArgument
            ? step.arguments[policy.extensionArgument]
            : undefined;
    if (typeof name !== "string" ||
        typeof extension !== "string" ||
        typeof content !== "string") {
        throw new ActionExecutionError("Validated text arguments are missing.");
    }
    return { name, extension, content };
}
async function createOnlyText(policy, step, context) {
    const requested = createRequest(policy, step);
    const directory = await prepareControlledDirectory(context.roots[policy.root], policy.subdirectory);
    const target = path.join(directory, `${requested.name}.${requested.extension}`);
    const idempotencyKey = canonicalActionHash(step, context.workingContext);
    let handle;
    let created = false;
    try {
        handle = await open(target, constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0), 0o600);
        created = true;
        await handle.writeFile(requested.content, "utf8");
        await handle.sync();
        return { mode: "created", idempotencyKey, target };
    }
    catch (error) {
        if (error.code !== "EEXIST") {
            const code = error.code;
            // A partial write must not poison the name forever: a retry would
            // otherwise see EEXIST with different content and fail permanently.
            if (created) {
                await handle?.close();
                handle = undefined;
                await unlink(target).catch(() => undefined);
            }
            throw new ActionExecutionError(`Text creation failed${code ? ` (${code})` : ""}.`, code === "EINTR" || code === "EBUSY");
        }
        const existing = await readTextFile(target, policy.maxBytes);
        if (existing !== requested.content) {
            throw new ActionExecutionError("Text artifact already exists with different content; overwrite is forbidden.");
        }
        return { mode: "already_present", idempotencyKey, target };
    }
    finally {
        await handle?.close();
    }
}
function assertedHash(value) {
    return typeof value === "string" ? value : undefined;
}
function mutationRequest(policy, step) {
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
async function atomicReplace(target, desired, expectedCurrentHash, maxBytes) {
    const temporary = path.join(path.dirname(target), `.orion-control-${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0), 0o600);
        await handle.writeFile(desired);
        await handle.sync();
        await handle.close();
        handle = undefined;
        const currentStats = await lstat(target);
        const current = await readFileBytes(target, maxBytes);
        if (contentHash(current) !== expectedCurrentHash) {
            throw new ActionExecutionError("Desktop text changed before commit; stale hash rejected.");
        }
        // Preserve the original file mode: replace-by-rename must not silently
        // relax or tighten permissions on a file the user already owns.
        await chmod(temporary, currentStats.mode & 0o7777).catch(() => undefined);
        await rename(temporary, target);
    }
    finally {
        await handle?.close();
        await unlink(temporary).catch(() => undefined);
    }
}
function fileMutationRequest(policy, step) {
    const relativePath = step.arguments[policy.relativePathArgument];
    const operation = step.arguments[policy.operationArgument];
    const encoding = step.arguments[policy.encodingArgument];
    const encodedContent = step.arguments[policy.contentArgument];
    const contentSource = step.arguments[policy.contentSourceArgument];
    if (typeof relativePath !== "string" ||
        !["create", "append", "replace"].includes(String(operation)) ||
        typeof encodedContent !== "string") {
        throw new ActionExecutionError("Validated file mutation arguments are missing.");
    }
    return {
        relativePath,
        operation: operation,
        content: encoding === "base64"
            ? Buffer.from(encodedContent, "base64")
            : Buffer.from(encodedContent, "utf8"),
        contentSource: typeof contentSource === "string" ? contentSource : "inline_user_request",
        expectedHash: assertedHash(step.arguments[policy.expectedHashArgument]),
        resultHash: assertedHash(step.arguments[policy.resultHashArgument]),
    };
}
/**
 * Resolve the idempotency token for an append/replace: a caller-asserted
 * resultHash if present, otherwise the hash a previous attempt in this same run
 * already committed. Without either, a fresh write proceeds.
 */
function idempotencyToken(asserted, context, idempotencyKey) {
    return asserted ?? context.writeMemo?.get(idempotencyKey);
}
function rememberWrite(context, idempotencyKey, resultHash) {
    context.writeMemo?.set(idempotencyKey, resultHash);
}
async function mutateFile(policy, step, context) {
    const request = fileMutationRequest(policy, step);
    const parentRelative = path.posix.dirname(request.relativePath);
    const parent = await resolveExistingPath(context.roots[policy.root], parentRelative === "." ? "." : parentRelative);
    if (!(await lstat(parent.target)).isDirectory()) {
        throw new ActionExecutionError("Desktop file parent is not a directory.");
    }
    const target = path.join(parent.target, path.posix.basename(request.relativePath));
    if (!isWithin(parent.realRoot, target)) {
        throw new ActionExecutionError("Desktop file target escaped its root.");
    }
    const idempotencyKey = canonicalActionHash(step, context.workingContext);
    const describe = (resultHash) => ({
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
            throw new ActionExecutionError("Declared resultHash does not match the requested bytes.");
        }
        try {
            const stats = await lstat(target);
            if (!stats.isFile() || stats.isSymbolicLink()) {
                throw new ActionExecutionError("Desktop file target is not a regular file.");
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
            throw new ActionExecutionError("Create target collides with an existing different file.");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        let handle;
        let created = false;
        try {
            handle = await open(target, constants.O_CREAT |
                constants.O_EXCL |
                constants.O_WRONLY |
                (constants.O_NOFOLLOW ?? 0), 0o600);
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
        }
        catch (error) {
            if (created) {
                await handle?.close();
                handle = undefined;
                await unlink(target).catch(() => undefined);
            }
            throw error;
        }
        finally {
            await handle?.close();
        }
    }
    const resolved = await resolveExistingPath(context.roots[policy.root], request.relativePath);
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
        throw new ActionExecutionError("Desktop file expectedHash is stale; modification rejected.");
    }
    const desired = request.operation === "append"
        ? Buffer.concat([current, request.content])
        : request.content;
    if (desired.byteLength > policy.maxResultBytes) {
        throw new ActionExecutionError(`Result exceeds the ${policy.maxResultBytes}-byte limit.`);
    }
    const resultHash = contentHash(desired);
    if (request.resultHash && request.resultHash !== resultHash) {
        throw new ActionExecutionError("Declared resultHash does not match the exact resulting bytes.");
    }
    rememberWrite(context, idempotencyKey, resultHash);
    await atomicReplace(resolved.target, desired, currentHash, policy.maxResultBytes);
    return {
        mode: request.operation === "append" ? "appended" : "replaced",
        idempotencyKey,
        target: resolved.target,
        output: describe(resultHash),
    };
}
async function createDirectory(root, relativePath, context, step) {
    const parentRelative = path.posix.dirname(relativePath);
    const parent = await resolveExistingPath(context.roots[root], parentRelative === "." ? "." : parentRelative);
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
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
        const stats = await lstat(target);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new ActionExecutionError("Desktop folder target collides with a non-directory or symlink.");
        }
        return { mode: "already_present", idempotencyKey, target };
    }
}
async function mutateText(policy, step, context) {
    const request = mutationRequest(policy, step);
    const root = context.roots.desktop;
    const parentRelative = path.posix.dirname(request.relativePath);
    const parent = await resolveExistingPath(root, parentRelative === "." ? "." : parentRelative);
    const parentStats = await lstat(parent.target);
    if (!parentStats.isDirectory()) {
        throw new ActionExecutionError("Desktop mutation parent is not a directory.");
    }
    const target = path.join(parent.target, path.posix.basename(request.relativePath));
    if (!isWithin(parent.realRoot, target)) {
        throw new ActionExecutionError("Desktop mutation escaped its configured root.");
    }
    const idempotencyKey = canonicalActionHash(step, context.workingContext);
    const describe = (resultHash) => ({
        resultHash,
        resultHashSource: request.resultHash ? "asserted" : "derived",
    });
    if (policy.operation === "create") {
        const resultHash = contentHash(request.content);
        if (request.resultHash && request.resultHash !== resultHash) {
            throw new ActionExecutionError("Declared resultHash does not match the requested content.");
        }
        try {
            const stats = await lstat(target);
            if (!stats.isFile() || stats.isSymbolicLink()) {
                throw new ActionExecutionError("Desktop mutation target is not a regular file.");
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
            throw new ActionExecutionError("Create target already exists with different content.");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        let handle;
        let created = false;
        try {
            handle = await open(target, constants.O_CREAT |
                constants.O_EXCL |
                constants.O_WRONLY |
                (constants.O_NOFOLLOW ?? 0), 0o600);
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
        }
        catch (error) {
            if (created) {
                await handle?.close();
                handle = undefined;
                await unlink(target).catch(() => undefined);
            }
            throw error;
        }
        finally {
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
        throw new ActionExecutionError("Desktop text expectedHash is stale; modification rejected.");
    }
    const desired = policy.operation === "append" ? `${current}${request.content}` : request.content;
    if (Buffer.byteLength(desired, "utf8") > policy.maxResultBytes) {
        throw new ActionExecutionError(`Result exceeds the ${policy.maxResultBytes}-byte limit.`);
    }
    const resultHash = contentHash(desired);
    if (request.resultHash && request.resultHash !== resultHash) {
        throw new ActionExecutionError("Declared resultHash does not match the exact resulting content.");
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
async function assertNotOpenElsewhere(target) {
    let stdout;
    try {
        ({ stdout } = await execFileAsync("/usr/sbin/lsof", ["-t", target], {
            timeout: 3000,
        }));
    }
    catch {
        // lsof exits non-zero when nothing has the file open, and may be absent.
        return;
    }
    const holders = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line) && line !== String(process.pid));
    if (holders.length > 0) {
        throw new ActionExecutionError(`${path.basename(target)} is currently open by another process (pid ${holders
            .slice(0, 3)
            .join(", ")}); refusing to move or delete it.`);
    }
}
/**
 * Collision-safe Trash naming, matching what Finder does: `note.txt`, then
 * `note 2.txt`, `note 3.txt`, and finally a timestamped name.
 */
async function trashPath(trashRoot, name) {
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
        }
        catch (error) {
            if (error.code === "ENOENT")
                return absolute;
            throw error;
        }
    }
    throw new ActionExecutionError("Could not find a free name in the Trash.");
}
async function mutateFilesystemEntry(policy, step, context, idempotencyKey) {
    const root = step.arguments[policy.rootArgument];
    const relativePath = step.arguments[policy.relativePathArgument];
    if (!isMutableRoot(root)) {
        throw new ActionExecutionError("Validated root is missing.");
    }
    if (!isSafeRelativePath(relativePath)) {
        throw new ActionExecutionError("Validated relativePath is missing.");
    }
    const rootPath = context.roots[root];
    const resolved = await resolveExistingPath(rootPath, relativePath);
    if (resolved.target === resolved.realRoot) {
        throw new ActionExecutionError("The configured root itself cannot be moved, renamed, or deleted.");
    }
    const stats = await lstat(resolved.target);
    if (stats.isSymbolicLink()) {
        throw new ActionExecutionError("Symlink access is forbidden.");
    }
    if (!stats.isFile() && !stats.isDirectory()) {
        throw new ActionExecutionError("Only regular files and directories can be moved, renamed, or deleted.");
    }
    const name = path.posix.basename(relativePath);
    if (stats.isDirectory()) {
        // A non-empty folder used to require the user's own words to name it. That
        // was the last surviving piece of the wording check, and it goes for the
        // same reason as the rest: the folder is going to the Trash with its
        // inverse in the ledger, so the recovery story is "drag it back", not
        // "should have phrased it differently".
        await readdir(resolved.target);
    }
    else {
        await assertNotOpenElsewhere(resolved.target);
    }
    let destination;
    if (policy.operation === "delete") {
        const trashRoot = context.trashRoot ?? path.join(os.homedir(), ".Trash");
        await mkdir(trashRoot, { recursive: true, mode: 0o700 });
        destination = await trashPath(await assertRealDirectory(trashRoot), name);
    }
    else if (policy.operation === "rename") {
        const newName = step.arguments[policy.destinationArgument ?? "newName"];
        if (!isSafeSegment(newName)) {
            throw new ActionExecutionError("Validated newName is missing.");
        }
        destination = path.join(path.dirname(resolved.target), newName);
    }
    else {
        const destinationPath = step.arguments[policy.destinationArgument ?? "destinationPath"];
        if (!isSafeRelativePath(destinationPath)) {
            throw new ActionExecutionError("Validated destinationPath is missing.");
        }
        const parentRelative = path.posix.dirname(destinationPath);
        const parent = await resolveExistingPath(rootPath, parentRelative === "." ? "." : parentRelative);
        if (!(await lstat(parent.target)).isDirectory()) {
            throw new ActionExecutionError("Move destination parent is not a directory.");
        }
        destination = path.join(parent.target, path.posix.basename(destinationPath));
    }
    if (policy.operation !== "delete" &&
        !isWithin(resolved.realRoot, destination)) {
        throw new ActionExecutionError("Destination escaped the configured root.");
    }
    if (destination === resolved.target) {
        throw new ActionExecutionError("Destination is the same as the source.");
    }
    // Never clobber: a move or rename onto an existing path is refused outright.
    try {
        await lstat(destination);
        throw new ActionExecutionError(`Destination already exists: ${path.basename(destination)}`);
    }
    catch (error) {
        if (error instanceof ActionExecutionError)
            throw error;
        if (error.code !== "ENOENT")
            throw error;
    }
    try {
        await rename(resolved.target, destination);
    }
    catch (error) {
        const code = error.code;
        throw new ActionExecutionError(code === "EXDEV"
            ? "Source and destination are on different volumes; refusing to copy rather than move."
            : `Filesystem mutation failed${code ? ` (${code})` : ""}.`, code === "EBUSY" || code === "EINTR");
    }
    const undo = policy.operation === "delete"
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
async function observe(policy, step, context) {
    const rawRelativePath = step.arguments[policy.relativePathArgument];
    const relativePath = policy.kind === "list_directory" &&
        (rawRelativePath === undefined || rawRelativePath === "")
        ? "."
        : rawRelativePath;
    if (typeof relativePath !== "string") {
        throw new ActionExecutionError("Validated relativePath is missing.");
    }
    const { target } = await resolveExistingPath(context.roots[policy.root], relativePath);
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
        const entries = (await Promise.all(names.map(async (name) => {
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
            }
            catch {
                return undefined;
            }
        }))).filter((entry) => entry !== undefined);
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
export async function executeAction(definition, step, context) {
    const idempotencyKey = canonicalActionHash(step, context.workingContext);
    if (definition.execution.kind === "simulate") {
        context.simulatedState.set(idempotencyKey, true);
        return { mode: "simulated", idempotencyKey };
    }
    if (definition.execution.kind === "self_modify") {
        return runSelfModify(step, idempotencyKey);
    }
    if (definition.execution.kind === "self_source") {
        return runSelfSource(definition.execution.operation, step, idempotencyKey);
    }
    if (definition.execution.kind === "self_repair") {
        return runSelfRepair(definition.execution, step, context, idempotencyKey);
    }
    if (definition.execution.kind === "dev_operation") {
        return runDevOperation(definition.execution, step, idempotencyKey);
    }
    if (definition.execution.kind === "automation") {
        return runAutomation(definition.execution.operation, step, idempotencyKey);
    }
    if (definition.execution.kind === "waiting") {
        return runWaiting(definition.execution.operation, step, idempotencyKey);
    }
    if (definition.execution.kind === "prep_card") {
        return runPrepCard(step, idempotencyKey);
    }
    if (definition.execution.kind === "travel") {
        return runTravel(definition.execution.operation, step, idempotencyKey);
    }
    if (definition.execution.kind === "atlas") {
        try {
            const output = await requestAtlas(definition.execution.operation, step.arguments, idempotencyKey);
            if (definition.execution.operation === "notes.create") {
                return {
                    mode: "created",
                    idempotencyKey,
                    target: output.noteID,
                    output,
                };
            }
            if (definition.execution.operation === "notes.update") {
                return {
                    mode: "replaced",
                    idempotencyKey,
                    target: output.note?.id ?? String(step.arguments.noteID ?? ""),
                    output,
                };
            }
            return { mode: "observed", idempotencyKey, output };
        }
        catch (error) {
            if (error instanceof AtlasBridgeError) {
                throw new ActionExecutionError(error.message, error.retryable);
            }
            throw error;
        }
    }
    if (definition.execution.kind === "app_control") {
        const application = step.arguments[definition.execution.applicationArgument];
        if (typeof application !== "string") {
            throw new ActionExecutionError("Validated application name is missing.");
        }
        return controlApplication(definition.execution.operation, application, idempotencyKey);
    }
    if (definition.execution.kind === "browser_control") {
        return controlBrowser(definition.execution, step, context, idempotencyKey);
    }
    if (definition.execution.kind === "computer_observe") {
        return observeScreen(definition.execution.operation, idempotencyKey);
    }
    if (definition.execution.kind === "computer_control") {
        return controlScreen(definition.execution, step, idempotencyKey);
    }
    if (definition.execution.kind === "media_control") {
        return controlMedia(definition.execution, step, idempotencyKey);
    }
    if (definition.execution.kind === "file_mutate") {
        return mutateFilesystemEntry(definition.execution, step, context, idempotencyKey);
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
    if (definition.execution.kind === "messages_read") {
        return readMessages(definition.execution, step, idempotencyKey);
    }
    if (definition.execution.kind === "calendar") {
        return changeCalendar(definition.execution, step, idempotencyKey);
    }
    if (definition.execution.kind === "messages_send") {
        return sendMessage(step, idempotencyKey);
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
        const relativePath = step.arguments[definition.execution.relativePathArgument];
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
function outputField(output, key) {
    return output !== null && typeof output === "object"
        ? output[key]
        : undefined;
}
/**
 * Browser verification re-observes the browser through a second AppleScript
 * round trip rather than trusting the command's own return value.
 */
async function verifyBrowser(policy, step, execution, context) {
    const browser = await resolveBrowser(policy, step, context);
    const maxTabs = policy.maxTabs ?? 200;
    if (policy.operation === "open_url") {
        const requested = outputField(execution.output, "url");
        if (typeof requested !== "string")
            return { observed: false };
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
        if (typeof before !== "number")
            return { observed: false };
        return {
            observed: policy.operation === "new_tab" ? after > before : after < before,
            evidence: `${browser.name}:tabs ${before}->${after}`,
        };
    }
    if (policy.operation === "switch_tab") {
        const expected = outputField(execution.output, "selectedUrl");
        const current = activeTab(await listBrowserTabs(browser, maxTabs));
        return {
            observed: typeof expected === "string" &&
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
            observed: typeof expected === "string" &&
                current !== undefined &&
                current.url === expected,
            evidence: `${browser.name}:${current?.url ?? "no_active_tab"}:${typeof digest === "string" ? `sha256:${digest}` : "no_text"}`,
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
async function verifyMedia(policy, step, execution) {
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
            observed: policy.operation === "volume_mute" ? settings.muted : !settings.muted,
            evidence: `output_muted:${settings.muted}`,
        };
    }
    if (policy.operation === "display_sleep") {
        // The post-sleep display power state is not readable on every Mac (notably
        // Apple Silicon, where IODisplayWrangler is absent), so this records that
        // the command was accepted and says so rather than pretending to observe.
        try {
            const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g", "powerstate", "IODisplayWrangler"], { timeout: 5000 });
            const state = /IODisplayWrangler\s+(\d+)/.exec(stdout)?.[1];
            if (state !== undefined) {
                return {
                    observed: Number.parseInt(state, 10) <= 3,
                    evidence: `display_power_state:${state}`,
                };
            }
        }
        catch {
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
            observed: typeof previousState === "string" &&
                previousState !== "unknown" &&
                after.state !== "unknown" &&
                after.state !== previousState,
            evidence: `${player.name}:${previousState}->${after.state}`,
        };
    }
    // next/previous: either the track changed, or the player restarted the
    // current one, which is what "previous" does a few seconds into a track.
    const changed = typeof previousTrackId === "string" &&
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
async function verifyFileMutation(execution) {
    const from = outputField(execution.output, "from");
    const to = outputField(execution.output, "to");
    const inode = outputField(execution.output, "inode");
    if (typeof from !== "string" || typeof to !== "string") {
        return { observed: false };
    }
    const sourceGone = await lstat(from).then(() => false, (error) => error.code === "ENOENT");
    const destination = await lstat(to).catch(() => undefined);
    return {
        observed: sourceGone &&
            destination !== undefined &&
            (typeof inode !== "number" || destination.ino === inode),
        evidence: `${to}:ino=${destination?.ino ?? "absent"}:source_gone=${sourceGone}`,
    };
}
/** The result hash the executor committed, as recorded in the execution output. */
function committedResultHash(output) {
    if (output === null || typeof output !== "object")
        return undefined;
    const value = output.resultHash;
    return typeof value === "string" ? value : undefined;
}
// ------------------------------------------------------- ambient & reminders
async function readAmbient(policy, step, context, idempotencyKey) {
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
    const location = typeof requested === "string" && requested.trim().length > 0
        ? requested.trim()
        : context.defaultLocation;
    if (!location) {
        // Deliberately an error rather than a guess: reporting the weather for
        // somewhere the user never named, with no sign it was invented, is worse
        // than refusing. But point at the answer -- where Nick lives is the kind of
        // durable fact that belongs in USER.md, and Orion already has that file in
        // context. Retrying with the city from there is the correct response to
        // this error, not asking him where he lives again.
        throw new ActionExecutionError("No location was given. Check USER.md for where Nick lives and retry " +
            "with that city; only ask him if it genuinely is not recorded.");
    }
    const days = step.arguments.days;
    try {
        const report = await readWeather({
            location,
            ...(typeof days === "number" ? { days } : {}),
        });
        return { mode: "observed", idempotencyKey, target: report.place, output: report };
    }
    catch (error) {
        throw new ActionExecutionError(error instanceof Error ? error.message : "The weather service did not answer.");
    }
}
async function manageReminder(policy, step, context, idempotencyKey) {
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
    const label = typeof step.arguments.label === "string" && step.arguments.label.trim()
        ? step.arguments.label.trim()
        : policy.operation === "alarm_set"
            ? "Alarm"
            : "Timer";
    let dueAt;
    if (policy.operation === "timer_set") {
        dueAt = now + Number(step.arguments.seconds) * 1000;
    }
    else {
        try {
            dueAt = resolveAlarmTime(String(step.arguments.at));
        }
        catch (error) {
            throw new ActionExecutionError(error instanceof Error ? error.message : "That is not a time.");
        }
    }
    const reminder = {
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
async function readTunable(setting) {
    try {
        const { stdout } = await execFileAsync("/usr/bin/defaults", ["read", ORION_APP_DOMAIN, setting.key], { timeout: 5000 });
        const parsed = Number(stdout.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    catch {
        // An unset key exits non-zero. That is "still on the default", not a fault.
        return undefined;
    }
}
async function tuneSelf(execution, step, idempotencyKey) {
    if (execution.operation === "read") {
        const settings = {};
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
    const spec = TUNABLE_SETTINGS[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ActionExecutionError("Tunable value must be a number.");
    }
    if (value < spec.min || value > spec.max) {
        throw new ActionExecutionError(`${name} must be between ${spec.min} and ${spec.max}${spec.unit}.`);
    }
    const previous = await readTunable(spec);
    try {
        await execFileAsync("/usr/bin/defaults", [
            "write",
            ORION_APP_DOMAIN,
            spec.key,
            spec.integer ? "-int" : "-float",
            String(value),
        ], { timeout: 5000 });
    }
    catch (error) {
        throw new ActionExecutionError(`Could not write ${name}: ${error instanceof Error ? error.message : "defaults failed"}`);
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
            restore: previous === undefined
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
async function trackHealth(execution, step, context, idempotencyKey) {
    const file = defaultHealthLogPath(context.healthLogPath);
    if (execution.operation === "supplement_status") {
        return { mode: "observed", idempotencyKey, output: await supplementStatus(file) };
    }
    if (execution.operation === "workout_status") {
        return { mode: "observed", idempotencyKey, output: await workoutStatus(file) };
    }
    if (execution.operation === "supplement_add") {
        const name = String(step.arguments.name ?? "");
        const result = await addSupplement(file, name, String(step.arguments.dose ?? ""), String(step.arguments.timeOfDay ?? "anytime"));
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
        weight: Number(entry.weight),
        reps: Number(entry.reps),
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
export async function verifyAction(definition, step, execution, context) {
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
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return {
            observed: present,
            evidence: present ? `self_source:${definition.execution.operation}` : undefined,
        };
    }
    if (definition.execution.kind === "travel") {
        // Weak, and honest about it: what is verified is that a record exists or a
        // brief rendered, not that the flight is real. Nothing here can check an
        // airline, which is exactly why every leg is reported as `inferred`.
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return { observed: present, evidence: present ? `travel:${definition.execution.operation}` : undefined };
    }
    if (definition.execution.kind === "prep_card") {
        // The card either rendered or it did not. There is nothing else to verify:
        // this action writes nothing, so there is no effect in the world to go and
        // look at, and a verifier that re-ran the searches would be spending the
        // reads twice to learn the same thing.
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return { observed: present, evidence: present ? "prep_card" : undefined };
    }
    if (definition.execution.kind === "atlas") {
        const operation = definition.execution.operation;
        if (operation === "collections.list" || operation === "notes.search" || operation === "notes.read") {
            return {
                observed: execution.output !== undefined,
                evidence: `atlas:${operation}:reported`,
            };
        }
        const noteID = execution.target;
        if (!noteID)
            return { observed: false };
        try {
            const observed = await requestAtlas("notes.read", { noteID }, `${execution.idempotencyKey}verify`);
            const note = observed.note;
            if (!note)
                return { observed: false };
            const titleMatches = step.arguments.title === undefined || note.title === step.arguments.title;
            const summaryMatches = step.arguments.summary === undefined || note.summary === step.arguments.summary;
            const categoryMatches = step.arguments.category === undefined || note.category === step.arguments.category;
            const markdownMatches = step.arguments.markdown === undefined || note.bodyMarkdown === step.arguments.markdown;
            const versionAdvanced = operation !== "notes.update" ||
                Date.parse(note.updatedAt) > Date.parse(String(step.arguments.expectedUpdatedAt));
            const matches = titleMatches && summaryMatches && categoryMatches && markdownMatches && versionAdvanced;
            return {
                observed: matches,
                evidence: `atlas:${noteID}:${matches ? "verified" : "mismatch"}`,
            };
        }
        catch {
            return { observed: false };
        }
    }
    if (definition.execution.kind === "waiting") {
        // Read back from the store after the write, by the same function that
        // wrote it. Weak on purpose and honest about it: what is being verified is
        // that the record exists, not that the professor replied.
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return {
            observed: present,
            evidence: present ? `waiting:${definition.execution.operation}` : undefined,
        };
    }
    if (definition.execution.kind === "automation") {
        // A proposal is a file: either it was written or the write threw. Nothing
        // further is observed, deliberately -- the thing worth verifying about an
        // automation is whether it FIRES, and none of these operations makes
        // anything fire.
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return {
            observed: present,
            evidence: present ? `automation:${definition.execution.operation}` : undefined,
        };
    }
    if (definition.execution.kind === "dev_operation") {
        /*
         The command exited zero, and that IS the verification.
    
         Re-running `git status` to check that `git pull` happened would be a
         second, weaker copy of a check the tool already did against the real
         repository -- and for `tests_run` it would be actively wrong, because a
         suite that passed and a suite that was never run both leave the working
         tree looking identical. What is verified here is what can be: the process
         ran to completion with a zero exit, and it said something.
        */
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return {
            observed: present,
            evidence: present ? `dev_operation:${definition.execution.operation}` : undefined,
        };
    }
    if (definition.execution.kind === "self_repair") {
        // Same answer as `self_modify` below, and for a stronger reason. Reaching
        // here means `orion-repair` exited zero, and for a modify that means it
        // compiled, the suite passed, the gate self-test passed where it applied,
        // and the deploy either came back healthy or was already rolled back. A
        // check re-derived here would be a weaker copy of one that already ran
        // against the real thing.
        const present = typeof execution.output === "string" && execution.output.length > 0;
        return {
            observed: present,
            evidence: present
                ? `self_repair:${definition.execution.surface}:${definition.execution.operation}`
                : undefined,
        };
    }
    if (definition.execution.kind === "self_modify") {
        // The forge already proved it: a non-zero exit threw before reaching here,
        // and reaching here means the code compiled AND the rebuilt app survived
        // its launch watch. That IS the independent verification — re-deriving it
        // would be weaker than the check that already ran.
        const applied = typeof execution.output === "string" && execution.output.includes("✓");
        return {
            observed: applied,
            evidence: applied ? "self_modify:applied" : undefined,
        };
    }
    if (definition.execution.kind === "ambient_read") {
        // The evidence IS the answer: an ambient read has no state to re-check, so
        // verification asks the only meaningful question — did anything come back.
        const present = execution.output !== undefined && execution.output !== null;
        return {
            observed: present,
            evidence: present ? `${definition.execution.operation}:reported` : undefined,
        };
    }
    if (definition.execution.kind === "messages_read") {
        // A read has no state to re-check, so verification asks the only question
        // that means anything: did the script actually answer. The script exits
        // non-zero on a denied read, so reaching here at all means it did.
        const present = typeof execution.output === "string";
        return {
            observed: present,
            evidence: present ? `${definition.execution.operation}:reported` : undefined,
        };
    }
    if (definition.execution.kind === "messages_send") {
        /*
         There is no independent verification of a send, and pretending otherwise
         would be worse than admitting it.
    
         The honest options were all bad. Re-reading chat.db for the outgoing row is
         racy — Messages writes it asynchronously and a poll either sleeps for an
         arbitrary second or reports a false failure for a message that did go. And
         a false failure is the dangerous direction here: the controller retries a
         step whose verification did not observe, so a send reported as unverified
         is a send delivered twice.
    
         So the evidence is the script's own confirmation line, which it prints only
         after AppleScript returned without error. Weaker than every other verifier
         in this file, and the reason `reversible: false` and `approvalRequired` are
         both set on the action: the safety here comes from the gates in front of
         it, not from a check behind it.
        */
        const confirmed = typeof execution.output === "string" && /^sent to /m.test(execution.output);
        return {
            observed: confirmed,
            evidence: confirmed ? "message_sent:acknowledged" : undefined,
        };
    }
    if (definition.execution.kind === "calendar") {
        // The fixed wrapper already performs a post-write EventKit readback and
        // returns only after the exact identifier is present/absent. Do not issue a
        // second mutation or turn a slow Calendar sync into a retry of the action.
        const output = execution.output;
        return {
            observed: output?.verified === true,
            evidence: output?.verified === true
                ? `calendar:${definition.execution.operation}:${output.identifier ?? execution.target ?? "verified"}`
                : undefined,
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
            const found = session?.exercises.some((entry) => entry.name.toLowerCase() === name);
            return {
                observed: found === true,
                evidence: `${step.arguments.exercise}:${found ? "logged" : "missing"}`,
            };
        }
        const name = String(step.arguments.name ?? "").toLowerCase();
        const entry = log.supplements.find((candidate) => candidate.name.toLowerCase() === name);
        if (definition.execution.operation === "supplement_add") {
            return {
                observed: entry !== undefined,
                evidence: `${step.arguments.name}:${entry ? "listed" : "missing"}`,
            };
        }
        const taken = entry
            ? (log.days?.[todayKey()]?.supplementIDs ?? log.supplementLog[todayKey()] ?? []).includes(entry.id)
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
        const spec = TUNABLE_SETTINGS[name];
        const readBack = await readTunable(spec);
        const intended = step.arguments.value;
        const matches = typeof intended === "number" &&
            readBack !== undefined &&
            Math.abs(readBack - intended) < 0.001;
        return {
            observed: matches,
            evidence: `${spec.key}:${readBack ?? "unset"}`,
        };
    }
    if (definition.execution.kind === "app_control") {
        const application = step.arguments[definition.execution.applicationArgument];
        if (typeof application !== "string")
            return { observed: false };
        const target = await resolveApplication(application);
        const running = await applicationIsRunning(target.bundleId);
        return {
            observed: definition.execution.operation === "open" ? running : !running,
            evidence: `${target.bundleId}:${running ? "running" : "not_running"}`,
        };
    }
    if (definition.execution.kind === "browser_control") {
        return verifyBrowser(definition.execution, step, execution, context);
    }
    if (definition.execution.kind === "computer_observe") {
        // A read has no state to re-check, the same reasoning `self_source` and
        // `prep_card` use: the only meaningful verification is whether a
        // structured result came back at all.
        const present = typeof execution.output === "object" && execution.output !== null;
        return {
            observed: present,
            evidence: present ? `computer_observe:${definition.execution.operation}` : undefined,
        };
    }
    if (definition.execution.kind === "computer_control") {
        // Weak, and honest about it, the same way `display_sleep`'s verifier is:
        // `orion-computer` re-observes the frontmost app AFTER the action and
        // confirms it is still the one that was named. That proves the app did
        // not crash or lose focus; it does NOT prove the click landed on the
        // intended element, because nothing outside the target app can observe
        // that its action actually fired.
        const output = execution.output;
        return {
            observed: output?.verified === true,
            evidence: `computer_control:${definition.execution.operation}:${output?.verified === true ? "app_still_frontmost" : "unverified"}`,
        };
    }
    if (definition.execution.kind === "media_control") {
        return verifyMedia(definition.execution, step, execution);
    }
    if (definition.execution.kind === "file_mutate") {
        return verifyFileMutation(execution);
    }
    if (definition.execution.kind === "create_only_text" && execution.target) {
        const expected = createRequest(definition.execution, step).content;
        const observed = await readTextFile(execution.target, definition.execution.maxBytes);
        return { observed: observed === expected, evidence: execution.target };
    }
    if (definition.execution.kind === "mutate_text" && execution.target) {
        // Compare against the hash the executor derived from the bytes it wrote,
        // never against a caller-supplied value.
        const committed = committedResultHash(execution.output);
        const observed = await readTextFile(execution.target, definition.execution.maxResultBytes);
        const observedHash = contentHash(observed);
        return {
            observed: committed !== undefined && observedHash === committed,
            evidence: `sha256:${observedHash}`,
        };
    }
    if (definition.execution.kind === "mutate_file" && execution.target) {
        const committed = committedResultHash(execution.output);
        const observed = await readFileBytes(execution.target, definition.execution.maxResultBytes);
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
    if (isObservationPolicy(definition.execution) &&
        execution.output !== undefined) {
        const independentlyObserved = await observe(definition.execution, step, context);
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
async function runSelfModify(step, idempotencyKey) {
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
    const script = path.join(os.homedir(), "Desktop/ORION/scripts/orion-forge");
    try {
        const result = await new Promise((resolve) => {
            const child = spawn(script, ["edit", file, findPath, replacePath, intent], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            let output = "";
            child.stdout?.on("data", (chunk) => (output += String(chunk)));
            child.stderr?.on("data", (chunk) => (output += String(chunk)));
            const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
            child.on("close", (code) => {
                clearTimeout(timer);
                resolve({ code: code ?? 1, output: output.trim() });
            });
            child.on("error", (error) => {
                clearTimeout(timer);
                resolve({ code: 1, output: String(error) });
            });
        });
        if (result.code !== 0) {
            // The script already undid everything before returning. Surfacing its
            // output verbatim matters: the compiler errors in it are what let the
            // model fix the change rather than guess at why it was refused.
            throw new ActionExecutionError(`The change was rejected and rolled back. Nothing was installed.\n${result.output}`);
        }
        return { mode: "rebuilt", idempotencyKey, output: result.output };
    }
    finally {
        await rm(findPath, { force: true }).catch(() => { });
        await rm(replacePath, { force: true }).catch(() => { });
    }
}
/**
 * Hand a plugin, script or config repair to `scripts/orion-repair`.
 *
 * The same shape and the same reasoning as `runSelfModify` above: this function
 * writes the fragments to temporary files, runs one script, and turns a
 * non-zero exit into a refusal Orion can read out. Every gate that decides
 * whether the change is safe lives in the script — the class tables, the
 * realpath check, the build, the test suite, the gate self-test, the health
 * probe and the rollback — because that is the code a person has to be able to
 * audit in one sitting.
 *
 * Two things here are not in `runSelfModify` and are worth naming:
 *
 * `--authority` is passed only for the actions the catalog marks as authority
 * changes, and the script refuses a target whose class disagrees with the flag.
 * The plugin has therefore already decided, the script decides again, and a bug
 * in either one alone cannot let an authority change through the quiet path.
 *
 * `--instruction` carries the authenticated user turn so the script can write
 * it into its own audit line. It grants nothing — authorization finished in the
 * validator before any executor ran — but "what changed, and what did Nick say
 * that authorised it" has to be answerable from one file afterwards.
 *
 * The restart is detached on purpose. A plugin deploy restarts the gateway, and
 * the gateway is the process running this function: waiting for it here would
 * mean waiting to be killed. So the script deploys, hands the restart and the
 * health probe to a watcher that outlives this process, and the watcher rolls
 * back if the gateway does not come back. `self_repair_status` reads its
 * verdict.
 */
async function runSelfRepair(policy, step, context, idempotencyKey) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scratch = [];
    const write = async (label, content) => {
        const target = path.join(os.tmpdir(), `orion-repair-${label}-${stamp}.txt`);
        await writeFile(target, content, "utf8");
        scratch.push(target);
        return target;
    };
    try {
        const arguments_ = [`${policy.surface}-${policy.operation}`];
        if (policy.operation === "read") {
            arguments_.push(String(step.arguments.pluginFile ?? step.arguments.script ?? ""));
        }
        if (policy.operation === "modify") {
            if (policy.surface === "config") {
                arguments_.push(String(step.arguments.key ?? ""));
                // JSON rather than a bare string so the type survives the trip: a
                // boolean flag written as the word "true" is a string in the config and
                // an enable flag that is a string is not an enable flag that is on.
                arguments_.push(await write("value", JSON.stringify(step.arguments.value ?? null)));
            }
            else {
                arguments_.push(String(step.arguments.pluginFile ?? step.arguments.script ?? ""));
                // Files rather than argv: a TypeScript or zsh fragment carries
                // newlines, quotes and braces, and routing that through a command line
                // is a quoting bug waiting to corrupt the very text being matched.
                arguments_.push(await write("find", String(step.arguments.find ?? "")));
                arguments_.push(await write("replace", String(step.arguments.replace ?? "")));
            }
            if (policy.authority)
                arguments_.push("--authority");
            arguments_.push("--detach-restart");
            if (context.trustedInstruction) {
                arguments_.push("--instruction", await write("instruction", context.trustedInstruction));
            }
        }
        // A plugin repair compiles the project and runs the whole suite before it
        // deploys anything, which is minutes rather than seconds. Killing it
        // halfway is the one state the script is built to avoid.
        const timeout = policy.operation === "modify" ? 20 * 60 * 1000 : 60_000;
        const result = await runOrionScript("orion-repair", arguments_, timeout);
        if (result.code !== 0) {
            // The script has already undone everything by the time it exits non-zero.
            // Its output is the compiler error, the failing test, or the sentence
            // naming which switch Nick has to flip — all of which are the useful part.
            throw new ActionExecutionError(policy.operation === "modify"
                ? `The repair was refused or rolled back. Nothing is left changed.\n${result.output}`
                : result.output || "The repair engine did not answer.");
        }
        return {
            mode: policy.operation === "modify"
                ? "rebuilt"
                : policy.operation === "revert"
                    ? "replaced"
                    : "observed",
            idempotencyKey,
            target: typeof step.arguments.key === "string"
                ? step.arguments.key
                : typeof step.arguments.pluginFile === "string"
                    ? step.arguments.pluginFile
                    : typeof step.arguments.script === "string"
                        ? step.arguments.script
                        : undefined,
            output: result.output,
        };
    }
    finally {
        for (const file of scratch) {
            await rm(file, { force: true }).catch(() => { });
        }
    }
}
/**
 * PHASE 51 — run one structured development operation.
 *
 * Everything that could be a decision was made in `devops.ts` before this
 * function is reached: which repository, which working directory, which argv,
 * which environment, how long, how much output. This spawns it and reports.
 *
 * Two details that are not incidental:
 *
 *   · `shell: false` is the default and is left alone. Nothing in the argv has
 *     been through a shell at any point, so a branch name containing a
 *     semicolon is a branch name.
 *   · The timeout kills with SIGKILL. A test runner that traps SIGTERM to print
 *     a summary is a test runner that ignores a timeout, and the whole reason
 *     there is a timeout is the run that does not end.
 */
async function runDevOperation(policy, step, idempotencyKey) {
    const resolved = resolveDevCommand(String(step.arguments.repository ?? ""), policy.operation, {
        ...(Number.isInteger(step.arguments.limit)
            ? { limit: step.arguments.limit }
            : {}),
        ...(typeof step.arguments.staged === "boolean"
            ? { staged: step.arguments.staged }
            : {}),
    });
    if ("error" in resolved)
        throw new ActionExecutionError(resolved.error);
    const [command, ...arguments_] = resolved.argv;
    const result = await new Promise((resolve) => {
        /*
         `detached: true` puts the child in its own PROCESS GROUP, and the
         timeout kills the group rather than the child.
  
         Found by the Phase 68 hang test, in code shipped hours earlier. The
         original killed `child` and resolved on `close`, and both halves were
         wrong for the same reason: `npm test` is a shell that spawns vitest.
         SIGKILL on npm leaves vitest running, vitest keeps the inherited stdout
         pipe open, and `close` -- which waits for stdio EOF, not for exit --
         never fires. A timed-out test run would have hung the tool call
         indefinitely, which is precisely the failure the timeout exists to
         prevent, arrived at through the timeout itself.
  
         So: kill the group, and settle on `exit` as well as `close`, so a pipe
         some orphan is still holding cannot wedge the promise.
        */
        const child = spawn(command, arguments_, {
            cwd: resolved.cwd,
            env: devEnvironment(),
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        });
        let output = "";
        let timedOut = false;
        let settled = false;
        const collect = (chunk) => {
            // Bounded as it arrives, not at the end. A runaway loop printing to
            // stdout would otherwise be held entirely in memory before being
            // truncated, which is the wrong order to do those two things in.
            if (output.length < MAX_OUTPUT_BYTES * 4)
                output += String(chunk);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        const settle = (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, output: output.trim(), timedOut });
        };
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                // Negative pid = the whole group. `child.kill` would reach only the
                // shell, which is the bug this replaced.
                if (child.pid)
                    process.kill(-child.pid, "SIGKILL");
            }
            catch {
                child.kill("SIGKILL");
            }
            // Belt and braces: if even the group kill leaves something holding a
            // pipe, settle anyway a moment later rather than never.
            setTimeout(() => settle(124), 2_000);
        }, resolved.spec.timeoutMs);
        child.on("close", (code) => settle(code ?? 1));
        child.on("exit", (code) => settle(code ?? 1));
        child.on("error", (error) => {
            output += String(error);
            settle(1);
        });
    });
    if (result.timedOut) {
        throw new ActionExecutionError(`${policy.operation} in ${step.arguments.repository} ran past ${Math.round(resolved.spec.timeoutMs / 1000)}s and was stopped. ` +
            `Nothing was rolled back; check the repository yourself.\n\n${boundOutput(result.output)}`);
    }
    if (result.code !== 0) {
        // A non-zero exit is REPORTED, not thrown away. A failing test suite is
        // the most useful thing this action ever produces, and an error that says
        // only "exit 1" is the version of it nobody can act on.
        throw new ActionExecutionError(`${policy.operation} failed (exit ${result.code}):\n\n${boundOutput(result.output)}`);
    }
    return {
        mode: "observed",
        idempotencyKey,
        output: boundOutput(result.output) || `${policy.operation} finished with nothing to say.`,
    };
}
/**
 * PHASES 57/58 — proposals in, simulations out, and no way to schedule one.
 *
 * Everything here works on files under `automations/proposed`. Nothing in this
 * function starts a job, writes a cron entry or touches a LaunchAgent, and
 * that is not an omission to be filled in later: turning a proposal into a
 * running job is `scripts/orion-automation install`, which is off the exec
 * allowlist for the same reason `orion-approve` is. "The model may not
 * silently install permanent automation" is therefore a property of the shape
 * of this file rather than a rule somebody has to keep remembering.
 */
async function runAutomation(operation, step, idempotencyKey) {
    const proposed = path.join(AUTOMATION_ROOT, "proposed");
    const installed = path.join(AUTOMATION_ROOT, "installed");
    const readAll = async (directory) => {
        const names = await readdir(directory).catch(() => []);
        const out = [];
        for (const name of names.filter((n) => n.endsWith(".json"))) {
            const parsed = await readFile(path.join(directory, name), "utf8")
                .then((text) => JSON.parse(text))
                .catch(() => null);
            if (parsed)
                out.push(parsed);
        }
        return out;
    };
    if (operation === "list") {
        const [waiting, live] = await Promise.all([readAll(proposed), readAll(installed)]);
        const line = (item) => `  ${item.name} — ${describeTrigger(item.trigger)}, ${item.action}, until ${item.expiresOn}\n      ${item.intent}`;
        return {
            mode: "observed",
            idempotencyKey,
            output: [
                `${waiting.length} proposed, waiting on Nick:`,
                ...waiting.map(line),
                `${live.length} installed and running:`,
                ...live.map(line),
                waiting.length > 0
                    ? "Nick installs one by running: orion-automation install <name>. You cannot."
                    : "",
            ]
                .filter(Boolean)
                .join("\n"),
        };
    }
    if (operation === "propose") {
        // Validated twice on purpose. The catalog refuses a malformed proposal
        // before it is authorized; this refuses one that arrived any other way. A
        // second copy is not redundant when the first one can be bypassed.
        const issues = validateProposal(step.arguments);
        if (issues.length > 0)
            throw new ActionExecutionError(issues.join("; "));
        const proposal = {
            ...step.arguments,
            proposedAt: new Date().toISOString(),
        };
        // `installedAt` is a field only a person may write. Stripped rather than
        // rejected, because rejecting it would tell a model that setting it is a
        // thing worth attempting.
        delete proposal.installedAt;
        await mkdir(proposed, { recursive: true, mode: 0o700 });
        await writeFile(path.join(proposed, `${proposal.name}.json`), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
        const forecast = simulate(proposal);
        return {
            mode: "observed",
            idempotencyKey,
            output: `Proposed '${proposal.name}': ${describeTrigger(proposal.trigger)}, running ${proposal.action}, until ${proposal.expiresOn}.\n` +
                `Over 30 days that is at most ${forecast.messageCount} message(s).\n` +
                `NOTHING IS SCHEDULED. Tell Nick to run: orion-automation install ${proposal.name}\n` +
                `You cannot install it yourself, and you must not say it is running.`,
        };
    }
    const name = String(step.arguments.name ?? "");
    const file = path.join(proposed, `${name}.json`);
    const proposal = await readFile(file, "utf8")
        .then((text) => JSON.parse(text))
        .catch(() => null);
    if (!proposal)
        throw new ActionExecutionError(`No proposal called '${name.slice(0, 40)}'.`);
    if (operation === "withdraw") {
        await rm(file, { force: true });
        return { mode: "observed", idempotencyKey, output: `Withdrew the proposal '${name}'.` };
    }
    const forecast = simulate(proposal);
    return {
        mode: "observed",
        idempotencyKey,
        output: [
            `'${proposal.name}' — ${describeTrigger(proposal.trigger)}`,
            `Over the last ${forecast.windowDays} days it would have fired ${forecast.fireCount} time(s),`,
            `${forecast.suppressedCount} of those suppressed by its conditions,`,
            `and spoken at most ${forecast.messageCount} time(s).`,
            ...forecast.notes.map((note) => `- ${note}`),
        ].join("\n"),
    };
}
/**
 * PHASE 62 — what Nick is waiting on.
 *
 * Every write goes through read-modify-write on one small file, and the whole
 * file is rewritten atomically. There is no partial state to recover from,
 * which is the right trade for a store that will never hold more than a few
 * dozen rows.
 */
async function runWaiting(operation, step, idempotencyKey) {
    const load = async () => {
        const text = await readFile(WAITING_STORE, "utf8").catch(() => null);
        if (text === null)
            return { ...EMPTY_STORE };
        try {
            const parsed = JSON.parse(text);
            return Array.isArray(parsed.items) ? parsed : { ...EMPTY_STORE };
        }
        catch {
            // A corrupt store must not silently become an empty one -- that would
            // lose everything Nick is waiting on and report success while doing it.
            throw new ActionExecutionError(`The waiting list at ${WAITING_STORE} is unreadable. Nothing was changed; a human should look at it.`);
        }
    };
    const save = async (store) => {
        await mkdir(path.dirname(WAITING_STORE), { recursive: true, mode: 0o700 });
        await writeFile(WAITING_STORE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    };
    const store = await load();
    const now = new Date();
    if (operation === "list") {
        const late = overdue(store, now);
        const soon = pending(store, now);
        const line = (item, suffix = "") => `  ${item.id} — ${item.what} (${item.who}), expecting ${item.expect}, due ${item.dueBy}${suffix}`;
        return {
            mode: "observed",
            idempotencyKey,
            output: [
                `${late.length} overdue:`,
                ...late.map((item) => line(item, `, ${daysLate(item, now)} day(s) late`)),
                `${soon.length} outstanding and not yet due:`,
                ...soon.map((item) => line(item)),
                late.length + soon.length === 0 ? "Nothing outstanding." : "",
            ].filter(Boolean).join("\n"),
        };
    }
    if (operation === "add") {
        const issues = validateWaitingItem(step.arguments);
        if (issues.length > 0)
            throw new ActionExecutionError(issues.join("; "));
        const id = String(step.arguments.id);
        if (store.items.some((item) => item.id === id)) {
            throw new ActionExecutionError(`'${id}' is already on the list. Use a different id, or resolve the existing one.`);
        }
        const item = {
            id,
            what: String(step.arguments.what),
            who: String(step.arguments.who),
            expect: String(step.arguments.expect),
            since: civilToday(now),
            dueBy: String(step.arguments.dueBy),
            status: "open",
            surfaced: 0,
        };
        await save({ ...store, items: [...store.items, item] });
        return {
            mode: "observed",
            idempotencyKey,
            output: `Waiting on ${item.who} for ${item.what}. Due ${item.dueBy}; I will raise it once it is late.`,
        };
    }
    const id = String(step.arguments.id ?? "");
    const existing = store.items.find((item) => item.id === id);
    if (!existing) {
        throw new ActionExecutionError(`Nothing on the waiting list called '${id.slice(0, 40)}'.`);
    }
    if (operation === "draft") {
        // Written onto the record and NOT sent. See waiting.ts for why that is the
        // gate decision rather than an omission.
        const text = draftFollowUp(existing, now);
        const next = { ...existing, draft: { text, writtenAt: now.toISOString() } };
        await save({ ...store, items: store.items.map((i) => (i.id === id ? next : i)) });
        return {
            mode: "observed",
            idempotencyKey,
            output: `Drafted a follow-up for '${id}'. NOTHING WAS SENT and I cannot send it — ` +
                `read it to Nick and let him decide.\n\n${text}`,
        };
    }
    const patch = operation === "resolve"
        ? { status: "resolved", resolvedAt: now.toISOString() }
        : operation === "dismiss"
            ? { status: "dismissed" }
            : {
                snoozedUntil: new Date(now.getTime() + Number(step.arguments.days) * 86_400_000).toISOString(),
            };
    await save({
        ...store,
        items: store.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
    return {
        mode: "observed",
        idempotencyKey,
        output: operation === "snooze"
            ? `'${id}' will stay quiet for ${Number(step.arguments.days)} day(s).`
            : `'${id}' is ${operation === "resolve" ? "resolved" : "dismissed"} — ${existing.what}.`,
    };
}
/**
 * PHASE 61 — a prep card, assembled and not remembered.
 *
 * Five sources, each already gated and already read-only, fanned out in
 * parallel and rendered into one turn. Nothing here writes: no note, no
 * memory, no file. That is the manifest's own constraint -- "use temporary
 * context; do not convert every relevant document into permanent ORION
 * memory" -- and it is enforced by there being no write call in this function
 * rather than by a rule about how it should be used.
 *
 * Every source is allowed to FAIL VISIBLY. "No relevant email" and "I could
 * not search your email" look identical to a reader and mean opposite things,
 * so a source that could not be read is reported as a blind spot in the card.
 */
async function runPrepCard(step, idempotencyKey) {
    const title = String(step.arguments.title ?? "");
    const attendees = Array.isArray(step.arguments.attendees)
        ? step.arguments.attendees.map(String)
        : [];
    const when = typeof step.arguments.when === "string" ? step.arguments.when : "soon";
    const terms = termsFromEvent(title, attendees);
    const section = async (label, script, argv, timeoutMs = 25_000) => {
        const result = await runOrionScript(script, argv, timeoutMs).catch(() => ({
            code: 1,
            output: "the wrapper could not be run",
        }));
        if (result.code !== 0) {
            return { label, status: "unavailable", lines: [], reason: result.output.slice(0, 140) };
        }
        const lines = result.output.split("\n").map((line) => line.trim()).filter(Boolean);
        return lines.length === 0
            ? { label, status: "empty", lines: [] }
            : { label, status: "ok", lines };
    };
    // Searched on terms extracted MECHANICALLY from the event, never chosen by
    // the model -- see prep.ts. An event title is attacker-controllable if
    // anyone can put something on the calendar.
    const query = terms.join(" ");
    const [threads, notes, tasks, waitingItems] = await Promise.all([
        query
            ? section("Mail", "orion-gmail-search", [query])
            : Promise.resolve({ label: "Mail", status: "empty", lines: [] }),
        query
            ? section("Notes", "orion-recall", [query])
            : Promise.resolve({ label: "Notes", status: "empty", lines: [] }),
        section("Tasks", "orion-agenda", ["tasks"]),
        (async () => {
            // OPEN QUESTIONS, which is the sixth ingredient and the one with no
            // wrapper: things Nick is waiting on that mention anybody in the room.
            const text = await readFile(WAITING_STORE, "utf8").catch(() => null);
            if (text === null)
                return { label: "Open questions", status: "empty", lines: [] };
            try {
                const store = JSON.parse(text);
                const haystack = [title, ...attendees].join(" ").toLowerCase();
                const relevant = store.items.filter((item) => item.status === "open" &&
                    (haystack.includes(item.who.toLowerCase().split("@")[0] ?? "\u0000") ||
                        terms.some((term) => `${item.what} ${item.expect}`.toLowerCase().includes(term))));
                return relevant.length === 0
                    ? { label: "Open questions", status: "empty", lines: [] }
                    : {
                        label: "Open questions",
                        status: "ok",
                        lines: relevant.map((item) => `still waiting on ${item.who} for ${item.what} (due ${item.dueBy})`),
                    };
            }
            catch {
                return { label: "Open questions", status: "unavailable", lines: [], reason: "the waiting list is unreadable" };
            }
        })(),
    ]);
    const people = attendees.length === 0
        ? { label: "People", status: "empty", lines: [] }
        : { label: "People", status: "ok", lines: attendees.map((a) => a) };
    // DOCUMENTS is absent, and says so rather than being quietly dropped. There
    // is no document store to search, and the nearest thing -- an unbounded scan
    // for filenames matching an event title -- is both useless and a way to read
    // whatever Orion happens to be pointed at.
    const documents = {
        label: "Documents",
        status: "unavailable",
        lines: [],
        reason: "there is no document store on this machine to search",
    };
    return {
        mode: "observed",
        idempotencyKey,
        output: renderCard({ title, when, attendees }, [
            threads,
            notes,
            tasks,
            people,
            documents,
            waitingItems,
        ]),
    };
}
/**
 * PHASE 78 — trips, and the line this tier does not cross.
 *
 * `detect` reads mail and returns CANDIDATES. It writes nothing, because a
 * confirmation email is untrusted text and anyone can send Nick one that looks
 * exactly like a real booking. Turning a candidate into a trip is `add`, which
 * takes its arguments from Nick's own turn like any other action.
 *
 * There is no operation here that books, modifies or cancels anything, and
 * that is the manifest's one hard line for this phase satisfied by absence
 * rather than by a gate somebody has to remember.
 */
async function runTravel(operation, step, idempotencyKey) {
    const load = async () => {
        const text = await readFile(TRIP_STORE, "utf8").catch(() => null);
        if (text === null)
            return { ...EMPTY_TRIPS };
        try {
            const parsed = JSON.parse(text);
            return Array.isArray(parsed.trips) ? parsed : { ...EMPTY_TRIPS };
        }
        catch {
            // A corrupt store must never read as an empty one. That would lose every
            // trip AND report success, which is the failure this whole system is
            // built against.
            throw new ActionExecutionError(`The trip store at ${TRIP_STORE} is unreadable. Nothing was changed; a human should look at it.`);
        }
    };
    const save = async (store) => {
        await mkdir(path.dirname(TRIP_STORE), { recursive: true, mode: 0o700 });
        await writeFile(TRIP_STORE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    };
    if (operation === "detect") {
        /*
         Searched on booking words rather than on anything the model chose. Same
         rule as the prep card: the query is fixed here, so a message Orion read
         cannot steer what he goes looking for next.
        */
        const result = await runOrionScript("orion-gmail-search", ["confirmation OR itinerary OR boarding OR reservation"], 30_000).catch(() => ({ code: 1, output: "the mail search could not be run" }));
        if (result.code !== 0) {
            throw new ActionExecutionError(`I could not search your mail, so I have no idea whether you have a trip coming up. ` +
                `That is a blind spot, not an empty answer: ${result.output.slice(0, 140)}`);
        }
        const legs = detectLegs(result.output);
        if (legs.length === 0) {
            return {
                mode: "observed",
                idempotencyKey,
                output: "Nothing in your mail looks like a flight or hotel confirmation.",
            };
        }
        return {
            mode: "observed",
            idempotencyKey,
            output: [
                `${legs.length} possible booking(s). NOTHING WAS SAVED — these are candidates:`,
                ...legs.map((leg) => `  ${leg.kind} ${leg.reference}` +
                    `${leg.from && leg.to ? ` ${leg.from} → ${leg.to}` : ""}` +
                    `${leg.on ? ` on ${leg.on}` : ""}\n    ${leg.confidence}: matched "${leg.evidence}"`),
                "",
                "Every one is INFERRED — a pattern matched an email and nothing checked it",
                "against an airline. Ask Nick which are real before making a trip of them.",
            ].join("\n"),
        };
    }
    const store = await load();
    if (operation === "list") {
        if (store.trips.length === 0) {
            return { mode: "observed", idempotencyKey, output: "No trips on file." };
        }
        return {
            mode: "observed",
            idempotencyKey,
            output: store.trips
                .map((trip) => `  ${trip.id} — ${trip.name}, ${trip.startsOn} to ${trip.endsOn}, ${trip.legs.length} booking(s)`)
                .join("\n"),
        };
    }
    if (operation === "add") {
        const issues = validateTrip(step.arguments);
        if (issues.length > 0)
            throw new ActionExecutionError(issues.join("; "));
        const id = String(step.arguments.id);
        if (store.trips.some((trip) => trip.id === id)) {
            throw new ActionExecutionError(`'${id}' is already a trip. Use a different id, or remove that one.`);
        }
        const legs = Array.isArray(step.arguments.legs)
            ? step.arguments.legs.slice(0, 20)
            : [];
        const trip = {
            id,
            name: String(step.arguments.name),
            startsOn: String(step.arguments.startsOn),
            endsOn: String(step.arguments.endsOn),
            ...(typeof step.arguments.destinationZone === "string"
                ? { destinationZone: step.arguments.destinationZone }
                : {}),
            legs,
            createdAt: new Date().toISOString(),
        };
        await save({ ...store, trips: [...store.trips, trip] });
        return {
            mode: "observed",
            idempotencyKey,
            output: `Trip '${trip.id}' saved: ${trip.name}, ${trip.startsOn} to ${trip.endsOn}.`,
        };
    }
    const id = String(step.arguments.id ?? "");
    const trip = store.trips.find((candidate) => candidate.id === id);
    if (!trip)
        throw new ActionExecutionError(`No trip called '${id.slice(0, 40)}'.`);
    if (operation === "remove") {
        await save({ ...store, trips: store.trips.filter((candidate) => candidate.id !== id) });
        return { mode: "observed", idempotencyKey, output: `Removed the trip '${id}'.` };
    }
    // The home zone is read from the runtime rather than configured, so it is
    // whatever the machine actually believes right now — which is the thing the
    // shift has to be measured against.
    const homeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
        mode: "observed",
        idempotencyKey,
        output: renderBrief(trip, { homeZone }),
    };
}
/** Read-only companion to `runSelfModify` — see the `self_source` policy. */
async function runSelfSource(operation, step, idempotencyKey) {
    const script = path.join(os.homedir(), "Desktop/ORION/scripts/orion-forge");
    const arguments_ = operation === "list"
        ? ["list"]
        : ["read", String(step.arguments.file ?? "")];
    const result = await new Promise((resolve) => {
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
    });
    if (result.code !== 0) {
        throw new ActionExecutionError(result.output || "Could not read the source.");
    }
    return { mode: "observed", idempotencyKey, output: result.output };
}
/**
 * Run one of the allowlisted `orion-*` wrappers and hand back what it said.
 *
 * The same shape as `runSelfSource` above, extracted because the messages pair
 * makes it the third caller. Arguments go through `spawn` as argv with no shell
 * anywhere in the path, so a message body containing quotes, semicolons or
 * backticks is data and cannot become syntax.
 */
async function runOrionScript(name, arguments_, timeoutMs) {
    const script = path.join(os.homedir(), "Desktop/ORION/scripts", name);
    return new Promise((resolve) => {
        const child = spawn(script, arguments_, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout?.on("data", (chunk) => (output += String(chunk)));
        child.stderr?.on("data", (chunk) => (output += String(chunk)));
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 1, output: output.trim() });
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ code: 1, output: String(error) });
        });
    });
}
/**
 * PHASE 53/54. Read the screen through `scripts/orion-computer`, which talks
 * to OrionMacBridge. Redaction (the denylist, the never-read secure field)
 * happens INSIDE the bridge, before any content crosses the process
 * boundary — this function only shapes what comes back, it does not
 * second-guess it.
 */
async function observeScreen(operation, idempotencyKey) {
    const result = await runOrionScript("orion-computer", [operation === "screen_observe" ? "observe" : "capture"], 20_000);
    if (result.code !== 0) {
        throw new ActionExecutionError(result.output || "The screen could not be observed.");
    }
    let output;
    try {
        output = JSON.parse(result.output.split("\n").at(-1) ?? "");
    }
    catch {
        throw new ActionExecutionError("The screen was read but returned no parseable result; refusing to claim success.");
    }
    return {
        mode: "observed",
        idempotencyKey,
        target: typeof output.bundleId === "string" ? output.bundleId : undefined,
        output,
    };
}
/**
 * PHASE 53/55. Act on the screen through `scripts/orion-computer`.
 *
 * Everything that decides WHETHER this may happen has already run: the
 * `computer_control` tier must be enabled AND on the `external_connected`
 * profile, the taint check on `text` (screen_type only), and — because
 * every action in this tier is `approvalRequired: true` with a floor no
 * strictness mode can lower — a human has already approved these exact
 * arguments. What is left here is the call, and the wrapper script's own
 * best-effort re-observation afterward.
 */
async function controlScreen(policy, step, idempotencyKey) {
    const expectedBundleId = String(step.arguments[policy.expectedBundleIdArgument] ?? "");
    const arguments_ = policy.operation === "screen_click"
        ? [
            "click",
            expectedBundleId,
            String(step.arguments[policy.xArgument ?? "x"] ?? ""),
            String(step.arguments[policy.yArgument ?? "y"] ?? ""),
        ]
        : policy.operation === "screen_type"
            ? ["type", expectedBundleId, String(step.arguments[policy.typedTextArgument ?? "typedText"] ?? "")]
            : ["key", expectedBundleId, String(step.arguments[policy.keyNameArgument ?? "keyName"] ?? "")];
    const result = await runOrionScript("orion-computer", arguments_, 20_000);
    if (result.code !== 0) {
        throw new ActionExecutionError(result.output || "The screen action could not be performed.");
    }
    let output;
    try {
        output = JSON.parse(result.output.split("\n").at(-1) ?? "");
    }
    catch {
        throw new ActionExecutionError("The screen action ran but returned no parseable result; refusing to claim success.");
    }
    return {
        mode: "controlled",
        idempotencyKey,
        target: expectedBundleId,
        output,
    };
}
/**
 * Read the Messages database through `scripts/orion-messages`.
 *
 * The generous timeout is because a text search scans a 500MB database, and the
 * script bounds its own row count rather than being killed halfway.
 */
async function readMessages(policy, step, idempotencyKey) {
    const limit = Number.isInteger(step.arguments.limit)
        ? String(step.arguments.limit)
        : "20";
    const arguments_ = policy.operation === "from"
        ? ["from", String(step.arguments.person ?? ""), limit]
        : policy.operation === "search"
            ? ["search", String(step.arguments.text ?? ""), limit]
            // These diagnostics return fixed sets, not feeds to page through.
            : policy.operation === "whoami" || policy.operation === "contacts_status"
                ? [policy.operation === "contacts_status" ? "contacts-status" : "whoami"]
                : [policy.operation, limit];
    const result = await runOrionScript("orion-messages", arguments_, 120_000);
    if (result.code !== 0) {
        // The script distinguishes "no messages matched" from "Full Disk Access is
        // missing" by design, and that distinction is the useful part of the
        // error — pass it through verbatim rather than flattening it.
        throw new ActionExecutionError(result.output || "Could not read Messages.");
    }
    return { mode: "observed", idempotencyKey, output: result.output };
}
/**
 * Mutate Apple Calendar/Reminders through the fixed EventKit bridge wrapper.
 *
 * The wrapper is intentionally NOT on OpenClaw's exec allowlist. Calendar
 * reads use `orion-agenda`; mutations can only arrive here after the catalog
 * tier, trusted-origin and (for removal) approval checks have all passed.
 */
async function changeCalendar(policy, step, idempotencyKey) {
    const arguments_ = policy.operation === "event_add"
        ? [
            "add",
            String(step.arguments.title ?? ""),
            String(step.arguments.start ?? ""),
            String(step.arguments.minutes ?? 60),
        ]
        : policy.operation === "event_remove"
            ? ["remove-title", String(step.arguments.title ?? "")]
            : [
                "task-add",
                String(step.arguments.title ?? ""),
                ...(step.arguments.due === undefined ? [] : [String(step.arguments.due)]),
            ];
    const result = await runOrionScript("orion-agenda-change", arguments_, 60_000);
    if (result.code !== 0) {
        throw new ActionExecutionError(result.output || "The Calendar change failed.");
    }
    let output;
    try {
        output = JSON.parse(result.output.split("\n").at(-1) ?? "");
    }
    catch {
        throw new ActionExecutionError("Calendar changed but returned no verifiable result; refusing to claim success.");
    }
    if (output.verified !== true) {
        throw new ActionExecutionError("Calendar did not verify the requested change.");
    }
    return {
        mode: policy.operation === "event_remove" ? "cancelled" : "created",
        idempotencyKey,
        target: output.title ?? String(step.arguments.title ?? ""),
        output,
    };
}
/**
 * Send one message through `scripts/orion-messages-send`.
 *
 * Everything that decides WHETHER this may happen has already run by the time
 * this function is called: the tier, the recipient-origin check, the taint
 * check, and the approval hash. What is left here is the call itself and the
 * one thing the plugin can add that the script cannot — a clear distinction
 * between "macOS has not been told to allow this yet" and "the send failed",
 * because the first is a dialog a human has to click and the second is a bug.
 */
async function sendMessage(step, idempotencyKey) {
    const recipient = String(step.arguments.recipient ?? "");
    const body = String(step.arguments.body ?? "");
    const result = await runOrionScript("orion-messages-send", [recipient, body], 60_000);
    if (result.code !== 0) {
        throw new ActionExecutionError(result.output || "The message was not sent.");
    }
    return {
        mode: "sent",
        idempotencyKey,
        target: recipient,
        output: result.output,
    };
}
