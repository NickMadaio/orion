/*
 The first refusal carries the route.

 `orion-learn` counted 26 retry loops across 10 sessions that consumed
 11,826,304 tokens. Reading the transcripts, they all have one shape:

   turn 1  exec("grep -r 'codename' ~/.openclaw/workspace/memory/ | head -20")
             -> {"error":"exec denied: allowlist miss"}
   turn 2  "grep isn't allowlisted, I'll use file tools instead"
           exec("find ~/.openclaw/workspace/memory -name '*.md'")
             -> {"error":"exec denied: allowlist miss"}
   turn 3  exec("ls ~/.openclaw/workspace/memory/")
             -> hung, timed out at 3m21s, session ended in error

 Every refusal was correct. Not one of them said what to do instead, so the
 model did the only thing an "allowlist miss" invites: it guessed a different
 command. `grep` IS allowlisted -- the PIPE is what was refused -- so the second
 guess was reasoning from a false premise the error had handed it.

 That message is generated inside the vendored `openclaw` package and cannot be
 patched from this repo. But `before_tool_call` fires FIRST, and it can block
 with its own reason. So the mistakes we have already seen 263 sessions of get
 named here, before the unhelpful refusal ever happens.

 The rule for adding to this table: only patterns that would be refused ANYWAY.
 This never blocks something that would have worked -- it replaces a refusal
 that teaches nothing with one that ends the turn's confusion.
*/
import { hasShellOperator } from "./shell-operators.js";
const WRAPPERS = [
    "orion-agenda", "orion-recall", "orion-remember", "orion-focus",
    "orion-authority", "orion-standing", "orion-learn", "orion-mission",
    "orion-notify", "orion-remote", "orion-gmail-latest", "orion-gmail-search",
    "orion-discord-alert", "orion-doctor", "orion-permissions", "orion-messages",
    "orion-trace", "orion-selfdoc", "orion-project", "orion-session",
    "orion-daily", "orion-note", "orion-skill",
];
/** Catalog action names. These belong inside `orion_task_run`, not the shell. */
export const TYPED_ACTIONS = /^(messages_\w+|calendar_\w+|apple_reminder_\w+|desktop_\w+|browser_\w+|screen_\w+|atlas_\w+|self_\w+|app_(open|quit)|volume_\w+|media_\w+|system_status|waiting_\w+|automation_\w+|supplement_\w+|workout_\w+)$/;
/** Host tool ids. Calling one as a shell program never works. */
export const TOOL_IDS = new Set([
    "read", "write", "edit", "exec", "session_status", "sessions_list",
    "sessions_send", "web_search", "web_fetch", "memory_search", "memory_get",
    "browser", "apply_patch", "process", "image",
]);
/** Programs that are refused on purpose, each with somewhere to go instead. */
const REDIRECTS = [
    [/^curl\b|^wget\b/, "`web_fetch` fetches a URL and `web_search` searches the web. Both are available to you; neither needs the shell."],
    [/^vm_stat\b|^top\b|^iostat\b/, "the `system_status` action inside `orion_task_run` reports memory, battery and load."],
    [/^pbpaste\b|^pbcopy\b/, "there is no clipboard capability yet. Say so plainly rather than trying another command."],
    [/^gog\b/, "never call `gog` directly — use the full path to `scripts/orion-gmail-latest` or `scripts/orion-gmail-search`."],
    [/^accli\b|^orion-calendar\b/, "calendar reads go through the full path to `scripts/orion-agenda` — `today`, `upcoming`, `tasks`, or `day <when>`."],
    [/^sqlite3\b/, "the Messages database is never read directly. Use the `messages_*` actions inside `orion_task_run`."],
    [/^osascript\b/, "AppleScript is not a route around a typed action. Use the action that owns the effect."],
    [/^open\b/, "`app_open` inside `orion_task_run` opens an app; `browser_open_url` opens a URL."],
];
/** Why a command with a live shell operator is refused. */
export const OPERATOR_REASON = "Exec runs ONE allowlisted program with plain arguments — no pipe, redirect, " +
    "command substitution, `&&` or `;` outside quotes. The program may well be allowed; the operator is not. " +
    "Re-run it as a single command, or use the tool that owns this job.";
const MEMORY_TREE = /(workspace\/memory|orionBrain|\/memory\/)/;
/**
 * Returns a route when `command` is certain to be refused, otherwise undefined.
 *
 * Order matters: the most specific diagnosis wins, because "you used a pipe" is
 * true of the memory-grep case too and is the less useful of the two things to
 * be told.
 */
export function routeForDoomedExec(command) {
    const trimmed = command.trim();
    if (trimmed === "")
        return undefined;
    const head = trimmed.split(/\s+/)[0] ?? "";
    const base = head.split("/").pop() ?? head;
    // Searching memory by hand. The single largest category, 20 denials across
    // 11 sessions, and the one where the plain "allowlist miss" is actively
    // misleading: grep is allowlisted, the pipe is not.
    if (MEMORY_TREE.test(trimmed) && /^(grep|egrep|rg|find|ls|cat|fd)$/.test(base)) {
        return {
            reason: "Memory is searched with `orion-recall`, never with the shell. Use the full path to " +
                "`scripts/orion-recall` with 3-8 distinct keywords. If it finds nothing, that IS the " +
                "answer — say you do not have it. Do not repair this command; the command was the wrong idea.",
        };
    }
    // A catalog action name sent to the shell.
    if (TYPED_ACTIONS.test(base)) {
        return {
            reason: `\`${base}\` is a catalog action, not a program. Call it inside \`orion_task_run\`. ` +
                "Nothing in the shell will ever run it.",
        };
    }
    // A host tool id sent to the shell.
    if (TOOL_IDS.has(base)) {
        return {
            reason: `\`${base}\` is a tool you already have, not a shell command. Call the tool directly.`,
        };
    }
    // A wrapper called by bare name. It is allowlisted by ABSOLUTE PATH, so the
    // bare name misses and the error says "allowlist miss", which reads as "you
    // may not do this" when it means "you spelled it wrong".
    if (WRAPPERS.includes(base) && !head.startsWith("/")) {
        return {
            reason: `\`${base}\` is allowlisted by absolute path only. Run it as ` +
                `\`/Users/nickmadaio/Desktop/ORION/scripts/${base}\` — a bare name or \`~\` misses the ` +
                "allowlist and is refused, which is not the same as being forbidden.",
        };
    }
    for (const [pattern, reason] of REDIRECTS) {
        if (pattern.test(base))
            return { reason: `\`${base}\` is not allowlisted — ${reason}` };
    }
    // A shell operator anywhere. Checked last, because every case above is a
    // better explanation of the same failure.
    if (hasShellOperator(trimmed))
        return { reason: OPERATOR_REASON };
    return undefined;
}
