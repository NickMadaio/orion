# Automation history — agent work backlog

**Owner:** Nick · **Prepared:** 26 September 2026 (Claude) · **Purpose:** close Phase 58's last open requirement, *uses historical data where available*.

## Goal

`orion-automation simulate` today replays the CALENDAR: it counts every moment a trigger would fire and says plainly that it is a ceiling. Nothing records what automations actually did, so "how often would this really have spoken" cannot be answered. This batch adds a small, append-only history of every automation firing, and a simulation that uses it where it exists. It also starts recording the legacy `orion-cron-deliver` outcomes, so real history accumulates from the day this merges.

No live scheduling, no Discord, no changes to authority or dispatch semantics.

## Starting point (verified at HEAD 9855d99)

- `scripts/lib/orion-automation-runtime.mjs` `runInstalledAutomation(name, scheduledAt, options)` calls `dispatchAutomation(join(automationRoot, "runtime"), …)` and returns its result. It records nothing.
- `scripts/lib/orion-automation-dispatch.mjs` returns `{status, reason?, attempts?, output?, delivery?}`; statuses `succeeded | failed | refused | outcome_unknown`.
- `plugin/orion-control/dist/automation.js` `simulate(proposal, {windowDays, from})` returns `{fireCount, suppressedCount, messageCount, windowDays, cappedByRiskLimit, notes}`.
- `scripts/orion-automation simulate <name>` prints that forecast.
- `scripts/orion-cron-deliver` keeps only the LAST delivery per label in `cron-delivery.json`.
- No history module and no history file exist.

## How this becomes work

```orion-plan
{"project":"Automation history — Phase 58","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

Three tasks have no dependencies (`hist-ledger`, `hist-summary`, `hist-cron-deliver`), so a deferred task never stops the night.

## Phase A — the record

```orion-task
{
  "id": "hist-ledger",
  "title": "Append-only automation history ledger",
  "objective": "After this task, scripts/lib/orion-automation-history.mjs exports appendAutomationHistory(file, entry) and readAutomationHistory(file, window), which write and read one validated JSON object per line, refuse invalid entries, and skip corrupt lines instead of failing.",
  "context": "READ first: scripts/lib/orion-automation-dispatch.mjs (the result shapes a history entry records), tests/automation-delivery.test.mjs (how tests here use temp roots).",
  "scope": ["scripts/lib/orion-automation-history.mjs", "tests/automation-hist-ledger.test.mjs"],
  "nonScope": ["Do not edit the dispatch, runtime, admission or any other existing module.", "Do not read or write anything under the real home directory."],
  "constraints": ["Node built-ins only.", "Never mutate an argument; build new objects.", "Files are created with mode 0o600 and directories with 0o700."],
  "acceptance": [
    "Exports appendAutomationHistory and readAutomationHistory with the signatures in the brief.",
    "appendAutomationHistory throws a TypeError with message 'invalid history entry' for every invalid case listed in the brief.",
    "appendAutomationHistory appends exactly one line and never rewrites earlier lines.",
    "readAutomationHistory returns {entries: [], skipped: 0} when the file does not exist.",
    "readAutomationHistory counts corrupt or invalid lines in skipped and still returns the valid ones.",
    "readAutomationHistory returns only entries with since <= at < until, sorted by at.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": ["node-syntax", "scope-tests"],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": ["An entry field the brief specifies cannot be produced from a dispatch result."]
}
```

```orion-task
{
  "id": "hist-summary",
  "title": "Summarize a window of automation history",
  "objective": "After this task, scripts/lib/orion-automation-history-summary.mjs exports summarizeAutomationHistory(entries, options), a pure function that counts firings, suppressions and deliveries over a window, per reason and per UTC day.",
  "context": "READ first: scripts/lib/orion-automation-admission.mjs (the refusal reasons that count as suppression).",
  "scope": ["scripts/lib/orion-automation-history-summary.mjs", "tests/automation-hist-summary.test.mjs"],
  "nonScope": ["Do not import the ledger module; take entries as an argument.", "No file or network access."],
  "constraints": ["Pure function: no I/O, no Date.now(), no mutation of the input array or its objects."],
  "acceptance": [
    "Exports summarizeAutomationHistory(entries, {from, windowDays}) returning the shape in the brief.",
    "It throws a TypeError for the invalid options listed in the brief.",
    "Entries outside [from - windowDays*86400000, from) are ignored.",
    "A refusal whose reason is in the brief's SUPPRESSION list counts as suppressed, not as a firing.",
    "observedDays counts distinct UTC dates that have at least one entry in the window.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": ["node-syntax", "scope-tests"],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

## Phase B — recording real outcomes

```orion-task
{
  "id": "hist-runtime-record",
  "title": "Record every installed-automation dispatch outcome",
  "objective": "After this task, runInstalledAutomation appends one history entry for every dispatch result except not_due, to <automationRoot>/history/<name>.jsonl, and a failure to record never changes the result it returns.",
  "context": "READ first: scripts/lib/orion-automation-runtime.mjs (the one function to change), scripts/lib/orion-automation-history.mjs (the append API), tests/automation-runtime.test.mjs (the fixture to copy).",
  "scope": ["scripts/lib/orion-automation-runtime.mjs", "tests/automation-hist-runtime.test.mjs"],
  "nonScope": ["Do not change dispatch, admission or host modules.", "Do not change what runInstalledAutomation returns or which checks it runs.", "Do not edit tests/automation-runtime.test.mjs."],
  "constraints": ["Recording happens after dispatch returns, never before or during it.", "Early refusals before dispatch (invalid_name, installation_unavailable_or_unsupported) are not recorded."],
  "preconditions": ["exists: scripts/lib/orion-automation-history.mjs"],
  "acceptance": [
    "A succeeded dispatch appends one entry whose fields match the mapping in the brief.",
    "A refused dispatch with reason duplicate_or_old_trigger appends one entry with status refused and that reason.",
    "A not_due refusal appends nothing.",
    "An unwritable history directory leaves the returned result identical to the unrecorded one.",
    "The existing runtime suite still passes unchanged.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": ["node-syntax", "scope-tests", "automation-tests"],
  "dependencies": ["hist-ledger"],
  "weight": 2,
  "risk": "medium",
  "reviewDepth": "deep",
  "escalateWhen": ["Recording would require changing dispatchAutomation's return shape."]
}
```

```orion-task
{
  "id": "hist-cron-deliver",
  "title": "orion-cron-deliver keeps an outcome history",
  "objective": "After this task, every run of scripts/orion-cron-deliver appends one line to ~/.openclaw/orion-controlled/cron-delivery-history.jsonl naming its label and outcome, and delivery behaviour, exit codes and the existing state file are unchanged.",
  "context": "READ first: scripts/orion-cron-deliver (every exit path after the command runs).",
  "scope": ["scripts/orion-cron-deliver", "tests/automation-hist-cron-deliver.test.mjs"],
  "nonScope": ["Do not change matching, dedup, rate limiting, message text, MAX_BODY or cron-delivery.json.", "Tests must NEVER reach the real orion-discord-alert: always run the script with HOME set to a temp directory."],
  "constraints": ["A history write failure is reported on stderr and never changes the exit code.", "The history line never contains the command's output or the message text."],
  "acceptance": [
    "Each outcome in the brief's table appends one line with that outcome string.",
    "The script's exit code is the wrapped command's exit code in every test.",
    "A history line contains only the fields in the brief.",
    "Tests run the real script with HOME set to a temp directory and a fake orion-discord-alert.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": ["node-syntax", "scope-tests"],
  "dependencies": [],
  "weight": 2,
  "risk": "medium",
  "reviewDepth": "deep",
  "escalateWhen": ["A test would need to send a real Discord message to pass."]
}
```

## Phase C — using it

```orion-task
{
  "id": "hist-forecast",
  "title": "Simulation uses history where it exists",
  "objective": "After this task, scripts/lib/orion-automation-history-forecast.mjs exports withHistory(forecast, summary), which returns a new forecast carrying an observed section and honest notes, and orion-automation simulate prints the observed numbers read from <automations>/history/<name>.jsonl.",
  "context": "READ first: scripts/orion-automation (the simulate command to extend), scripts/lib/orion-automation-history-summary.mjs (the summary shape).",
  "scope": ["scripts/lib/orion-automation-history-forecast.mjs", "scripts/orion-automation", "tests/automation-hist-forecast.test.mjs"],
  "nonScope": ["Do not change any other orion-automation command.", "Do not change the plugin (plugin/orion-control)."],
  "constraints": ["withHistory never mutates its arguments.", "With no observed days the forecast numbers are unchanged."],
  "preconditions": ["exists: scripts/lib/orion-automation-history.mjs", "exists: scripts/lib/orion-automation-history-summary.mjs"],
  "acceptance": [
    "Exports withHistory(forecast, summary) returning the shape in the brief.",
    "With summary.observedDays === 0 the result equals the forecast plus the single 'no history yet' note from the brief.",
    "With observed days the result has an observed object and the observed note from the brief.",
    "With observed days the focus 'not modelled' note is replaced by the focus note from the brief.",
    "orion-automation simulate reads the history file, summarizes it over forecast.windowDays and prints the observed lines in the brief.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": ["node-syntax", "scope-tests"],
  "dependencies": ["hist-ledger", "hist-summary"],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

```orion-task
{
  "id": "hist-review-packet",
  "title": "Phase 58 history review packet",
  "objective": "After this task, docs/planning/v2/PHASE_58_HISTORY_REVIEW.md tells Astra and Nick what was built, where the history lives, and what is still not proven.",
  "context": "READ first: scripts/lib/orion-automation-history.mjs, scripts/lib/orion-automation-history-forecast.mjs.",
  "scope": ["docs/planning/v2/PHASE_58_HISTORY_REVIEW.md"],
  "nonScope": ["Do not edit PHASE_GATES.json or any code."],
  "constraints": ["Say only what the code in this branch does; no claims about live runs."],
  "acceptance": [
    "Section 'Files' lists each new or changed file with one line on what it does.",
    "Section 'Record format' gives the history entry fields and the cron-deliver line fields.",
    "Section 'Where history lives' gives both file paths.",
    "Section 'Not yet proven' states that no live scheduler writes history yet and the Phase 58 gate stays open until one does.",
    "Section 'How to verify' lists the node --test commands for the five new test files."
  ],
  "checks": ["automation-tests"],
  "dependencies": ["hist-runtime-record", "hist-cron-deliver", "hist-forecast"],
  "weight": 1,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

## Next batch (not executable)

Phase 59: a write path from standing orders into Today for low-priority items.

## What Astra reviews

That no task changed dispatch semantics or authority; that the cron-deliver tests never touch the real home; that simulate still prints the ceiling first.

## Progress rules

Accepted tasks stay on the branch for review. Nothing is merged, deployed or installed by the loop.
