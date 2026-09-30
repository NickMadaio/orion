# trace — what did ORION actually do?

## Where you start
ORION's replies claim things ("I've added…") that his tools never did. The truth is in his session log, a JSONL file under `~/.openclaw/agents/main/sessions/<id>.jsonl`. You write a pure parser for that format plus a grader for tool expectations: `scripts/lib/eval/trace.mjs` and `tests/truthful-trace.test.mjs`. Claude wires it into `orion-eval-run`.

## The log format (real, 30 September)
One JSON object per line. Only lines with `"type":"message"` matter:
- user: `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` (content may also be a plain string)
- assistant: `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"…"},{"type":"toolCall","id":"toolu_…","name":"exec","arguments":{"command":"/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda today"}}]}}`
- tool result: `{"type":"message","message":{"role":"toolResult","toolCallId":"toolu_…","toolName":"exec","isError":false,"content":[{"type":"text","text":"…"}]}}`
Other line types (session, model_change, custom, …) are ignored. Malformed lines are skipped and counted.

## Interface
```
export function parseTrace(jsonlText)
  // -> { turns: Turn[], skipped: int }
  // Turn = { say: string, reply: string, calls: Call[] }   one per user message
  // Call = { id, tool, command: string|null, script: string|null, args: string[], ok: boolean|null, output: string }
export function expectTools(turn, expect)
  // expect = { mustRun?: string[], mustNotRun?: string[], mustInclude?: string[], mustNotInclude?: string[], maxCalls?: int, noErrors?: boolean }
  // -> { pass: boolean, failures: string[] }
```
- `script`: for `exec`, the basename of the first word of `command` (e.g. "orion-agenda"); for `tool_call`, `arguments.tool` or `arguments.name`; otherwise the tool name.
- `args`: the command split shell-style (respect double and single quotes) minus the first word; [] for non-exec.
- `ok`: from the matching toolResult's `isError` (false → true); null if no result arrived. `output`: result text, first 2000 chars.
- `reply`: the text of the LAST assistant message in the turn (joined text parts).
- The user text of the turn: if it starts with "[orion-remote] Live facts", take only what follows the last line that starts with "Nick:" or "Nick says:"; otherwise the whole text.

## expectTools decisions
- `mustRun`: each name must equal some call's `script`. Failure text: `did not run <name>`.
- `mustNotRun`: failure `ran <name>`.
- `mustInclude`: each string must appear in some call's command (or JSON args). Failure `no call included "<s>"`.
- `mustNotInclude`: failure `a call included "<s>"` — e.g. `", fixed"` catches the invented fixed blocks.
- `maxCalls`: failure `<n> calls (max <m>)`. `noErrors`: failure `<script> failed` for each ok === false.

## Tests (titles exact)
1. `parses the real todo turn` — fixture: user message, assistant with orion-agenda call, its result, assistant with an orion-reschedule call whose command has `--plan "fix Orion stuff, 60, 12:30, fixed"`, its result, final assistant text. → 1 turn, 2 calls, scripts ["orion-agenda","orion-reschedule"], args of the second include `fix Orion stuff, 60, 12:30, fixed` as ONE arg.
2. `live facts wrapper is stripped` — say is only Nick's words.
3. `missing result gives ok null`.
4. `malformed lines are skipped and counted`.
5. `mustRun and mustNotInclude catch the 30 September failure` — expectTools(turn, { mustRun: ["orion-remind"], mustNotInclude: [", fixed"] }) → 2 failures with the exact texts.
6. `tool_call script name` — a toolCall named "tool_call" with arguments {tool:"web_search"} → script "web_search".
7. `two turns` — two user messages → two turns with their own calls.
8. `invalid input throws` — parseTrace(42) TypeError; expectTools(null, {}) TypeError.

## For the reviewer
Quoted args must stay whole. Failure strings are exact.
