/*
 Quote-aware shell-operator check (r8b2, 2026-10-16).

 The old check was a flat regex over the whole command, so the `&` in the quoted title
 "Design & Implementation" blocked a perfectly good `orion-reschedule add` (two real calls, 3b64dd81 22:48
 and 23:31). This walks the command the way a POSIX shell would tokenize it and only counts an operator
 that is live: outside quotes, or a substitution (`$(` or a backtick) inside double quotes. Anything it cannot
 be sure of (an unterminated quote, a backslash before an operator, a newline outside quotes) is refused.
*/
const OPERATOR_CHARS = new Set(["|", ">", "<", ";", "&"]);
export function hasShellOperator(command) {
    let quote = "";
    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (quote === "'") {
            if (ch === "'")
                quote = "";
            continue;
        }
        if (quote === '"') {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === '"') {
                quote = "";
                continue;
            }
            if (ch === "`" || (ch === "$" && command[i + 1] === "("))
                return true;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === "\\") {
            const next = command[i + 1];
            // An escaped operator is literal to a shell, but not worth trusting a different parser to agree on.
            if (next === undefined || OPERATOR_CHARS.has(next) || next === "\n" || next === "\r" || next === "`" || next === "$")
                return true;
            i++;
            continue;
        }
        if (OPERATOR_CHARS.has(ch) || ch === "`" || ch === "\n" || ch === "\r")
            return true;
        if (ch === "$" && command[i + 1] === "(")
            return true;
        // review 5 M1 (2026-10-16): bash's $'…' and $"…" quoting (an escaped quote inside $'…') is not tokenised here: refuse it.
        if (ch === "$" && (command[i + 1] === "'" || command[i + 1] === '"'))
            return true;
    }
    return quote !== "";
}
