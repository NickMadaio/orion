# Orion implementation handoff

**Purpose:** This document lets the next developer resume the Orion project without reconstructing the work or the user's intent. It records the current architecture, decisions, implemented behavior, verification, macOS permissions, and the one in-progress native-bridge change.

## Product intent

Orion is a local-first, personal macOS assistant. The desired experience is conversational and proactive like a capable desktop agent: the user can ask naturally for information, timers, file organization, reminders, calendar work, and eventually computer actions and voice interaction. It must be useful without forcing the user to repeatedly select models, grant routine permissions, or manually translate requests into commands.

The current priority is **the native macOS foundation before remote messaging/text channels**. Orion should run persistently as a menu-bar/desktop application backed by a local Python runtime and Ollama. The web view is a control surface, not the primary automation mechanism.

### User decisions that should be preserved

- **Local first.** GPT-OSS 20B via Ollama is the Phase One default. It beat the comparison model for speed and tool use in the small local benchmark. The provider abstraction must remain swappable.
- **Cloud is supplemental, not the default.** Cheap cloud escalation may later happen automatically for complex/low-confidence work, but expensive tiers require approval. Cloud access must be explicitly configured and audited.
- **Planner and executor are separate.** The model should interpret a natural request into a structured plan; deterministic code validates it, checks policy, and executes it. Do not turn Orion into a collection of brittle phrase-by-phrase parsers.
- **Standing permissions.** Directly requested, small, reversible local actions such as creating folders and moving files in an allowed scope should run automatically. Deletion, overwrite/bulk changes, system settings, external services, and other consequential work require a clear conversational approval.
- **Approvals must be conversational.** The UI should show a plain-language approval in the chat flow, so the same interaction maps to voice later (e.g. user can say “yes, do it”).
- **Native means native.** A browser-only timer or webpage notification is not sufficient. Where macOS has a public API, Orion should use the actual macOS service. For actions without a public API, explain the limitation and use a user-owned Shortcut only if necessary.
- **No coding-agent scope for now.** Reading/writing/moving ordinary files is useful, but Orion is a personal assistant first. Do not position it as a replacement for Claude Code or ChatGPT coding tools yet.
- **Logging should be concise to the user.** Persist enough data for recovery, approvals, and follow-up questions; default updates should remain conversational and short.

## Repository and runtime

- Project root: `/Users/nickmadaio/Desktop/ORION`
- Python package: `orion/`
- Data: `orion/data/` (SQLite and local control data)
- Planning: `planning/`
- Native Swift code: `native/`
- Primary launcher during development: `uv run python main.py serve`
- Local interface: `http://127.0.0.1:8765/`
- Local model: Ollama `gpt-oss:20b`
- Native companion app target: `/Users/nickmadaio/Applications/Orion.app`

The Python project uses `uv`. Run commands from the project root. The reliable Python interpreter is the project virtual environment (`.venv/bin/python`), not a parent/global interpreter.

## Current architecture

```text
Orion.app (Swift menu-bar companion)
  ├─ owns native macOS permission context and native UI window
  ├─ starts the Python runtime in the background
  └─ hosts the local Orion control surface in a WKWebView

Python runtime (ThreadingHTTPServer)
  ├─ local Ollama provider (GPT-OSS 20B)
  ├─ structured planner -> deterministic policy executor
  ├─ SQLite store, task state machine, durable scheduler, memory retrieval
  ├─ safe filesystem tools with scopes, approvals, audit, rollback
  └─ MacBridge -> companion/native macOS capability boundary

SQLite state
  ├─ conversations and messages
  ├─ tasks, task events, approvals, tool executions
  ├─ memories and retrieval signals
  ├─ durable scheduled jobs/timers
  ├─ provider escalation audit
  └─ native-action records
```

## Implemented components

### 1. Durable runtime, provider, and conversation state

`orion/runtime.py`, `orion/store.py`, and `orion/server.py` provide a persistent local HTTP runtime.

- Ollama is the active local provider with GPT-OSS 20B.
- Conversations and tool/audit events are stored in SQLite.
- SQLite is configured for threaded HTTP handling (`check_same_thread=False` plus a lock).
- Interrupted planning/running tasks are marked failed on restart with a recovery event instead of appearing to finish silently.
- Context retrieval adds relevant saved memory to local answers without dumping the entire history.
- Time replies are deliberately concise: plain time requests should not unnecessarily repeat the location; explicit locations are honored.

### 2. Planner/executor and permissions

`orion/planner.py` converts model output into validated structured tool actions. `orion/executor.py` applies deterministic policy.

The important design is that the model is not trusted to decide authorization. The code enforces it.

Current intent/policy:

| Action | Current policy |
|---|---|
| Create folders in permitted Desktop/sandbox scope | automatic |
| Move files in permitted scope | automatic |
| Create a brand-new file | automatic where supported |
| Edit/overwrite existing file | approval |
| Delete | approval and only where rollback data is safe |
| Bulk/file-system/system settings/external service changes | approval |
| Local durable timer/reminder task | automatic for a direct request |
| Calendar/Reminders creation | proposal + approval in the native UI |

There is deterministic support for nested folder requests such as “create a parent folder X with child folders Y and Z.” It was added because the initial model responded with generic permission text even though Desktop folder creation was allowed. That specific behavior works, but the general planner/executor layer remains the intended long-term solution.

### 3. Computer/file tools and rollback

`orion/computer.py` implements scoped filesystem changes.

- A computer sandbox exists for safe tests.
- Desktop is a separate allowed workspace.
- Proposals show a preview and are persisted with the related task and approval.
- Approved supported changes can be rolled back. Folder rollback only removes an empty folder; it will not silently delete user content.
- Natural-language folder creation was tested successfully against the Desktop through the UI: Orion made a requested folder after its normal action flow.

### 4. Tasks, approvals, jobs, and reminders

`orion/tasks.py`, `orion/scheduler.py`, `orion/timers.py`, and `orion/store.py` provide durable work state.

- Tasks use state transitions and recorded events.
- Approvals are persisted instead of living only in a browser session.
- The scheduler claims persisted due jobs, preventing normal restart loss.
- Local “remind me in …” handling creates a durable task/job rather than a visual-only browser countdown.
- The current job delivery is wired to native notification delivery, which depends on macOS notification permission being granted.

### 5. Desktop control surface

`orion/ui/index.html` and `orion/ui/app.js` currently provide:

- Chat with saved conversations.
- In-chat approval cards and approval execution.
- Workspace/file previews, execution, and rollback controls.
- Memory and activity views.
- Timer/native Mac tab.
- Native Calendar and Reminders read views.
- Native reminder and calendar-event forms that create a proposal first, then require approval.
- Scheduled-job activity with cancellation.
- Retry behavior while the local runtime starts, so the native window should recover without a manual page refresh.

The control surface is shown inside the native companion app’s WKWebView, not only in an external browser.

### 6. Cloud routing scaffold

`orion/cloud.py` and parts of `orion/runtime.py` provide a conservative, disabled-by-default cloud path.

- Requires `ORION_ENABLE_CLOUD_ESCALATION=true` and a configured cloud model.
- A low-cost model can be selected by routing policy for complex/local-failure work.
- Higher-cost tiers (including names containing `opus` or `max`) must be approved.
- Provider calls are auditable in SQLite.
- `.env.example` documents the opt-in variables.

Do **not** enable or store credentials casually. Never paste a real API key into source control or chat. Use a local `.env` and keep `.env.example` secret-free.

## Native macOS work

### What exists

`native/OrionCompanion/` is a Swift menu-bar companion app.

- Uses AppKit, WebKit, and ServiceManagement.
- Starts the local Python runtime automatically.
- Opens Orion in an actual native desktop window using `WKWebView`.
- Has menu actions for runtime state, open, quit, and launch-at-login.
- App bundle script: `native/OrionCompanion/make_app_bundle.sh`.

`native/OrionMacBridge/` is the earlier Swift helper implementation for native capability calls. It contains working code paths for:

- native permission status;
- notifications;
- EventKit Calendar and Reminders read/create operations;
- Accessibility status/settings prompt;
- Clock timers using a user-owned Shortcut named `Orion Native Timer`.

### Important macOS limitation: Clock timer

Apple does not expose a public direct API for the Clock app’s timer. The current correct native strategy is:

1. User creates a Shortcut named **Orion Native Timer**.
2. The shortcut uses Clock’s **Set Timer** action and uses Shortcut Input as the duration.
3. Orion passes the requested seconds to that shortcut.

This gives a real macOS Clock timer, but it cannot be silently created by Orion. The UI explains this setup. Before the shortcut exists, Orion should report that it needs this one-time setup rather than falsely claim a native timer started.

### Permissions established in this session

The user explicitly authorized Orion permission testing.

- **Calendar:** full access was requested and the native bridge returned granted.
- **Reminders:** full access was requested and the native bridge returned granted.
- **Accessibility:** a settings prompt was opened; it is not possible to flip this system permission automatically. The user may need to manually enable Orion in Privacy & Security > Accessibility. Note: the final owning app identity is changing (see below), so recheck after the companion implementation is rebuilt.
- **Notifications:** still `not_determined`. A request through a background helper returned a macOS error; this is the reason for the in-progress companion-owned bridge change below.

Read-only direct bridge checks saw a real upcoming Calendar event and zero incomplete reminders. Do not copy those personal event details into logs or documentation.

## In-progress native bridge change — must be completed first

### Problem discovered

Calling EventKit/UserNotifications from a Swift helper executable spawned by the Python runtime gave inconsistent TCC (macOS privacy) identity. The same helper invoked from a development terminal could see granted Calendar/Reminders access, but the Python runtime saw `not_determined`. Notifications also failed from the background helper.

This is a design issue, not just a path issue: macOS permission-sensitive calls should be owned by the actual foreground/menu-bar app, **Orion.app**, not a separately spawned command-line helper.

### Work just started

The following files have **partially verified edits at handoff time**:

- `native/OrionCompanion/Sources/OrionCompanion/main.swift`
- `native/OrionCompanion/Package.swift`
- `orion/mac_bridge.py`

The change moves the native bridge into the running `OrionCompanion` app:

1. The Swift companion now imports EventKit, UserNotifications, and ApplicationServices.
2. It polls a tiny local request queue under `orion/data/native_bridge/requests`.
3. Python `MacBridge` writes a JSON request, waits briefly for a JSON response in `responses`, then falls back to the packaged helper only when no companion is running.
4. The companion handles status, permission requests, notifications, Calendar/Reminders read/create, accessibility, and the Clock Shortcut itself.

This is intentionally local-only and uses request IDs plus atomic file replacement. It avoids opening an additional network port and makes **Orion.app** the responsible macOS process.

### Required next steps

1. Build the companion (this was run successfully once after the edits; run it again after any change):
   ```bash
   cd /Users/nickmadaio/Desktop/ORION/native/OrionCompanion
   swift build
   ```
   Fix any Swift 6 concurrency/compiler errors introduced by the new request-queue code.
2. Run the automated Python tests from the project root:
   ```bash
   PYTHONPYCACHEPREFIX=/private/tmp/orion-pyc uv run python -m unittest discover -s tests -v
   ```
3. Build/install the app bundle:
   ```bash
   cd /Users/nickmadaio/Desktop/ORION/native/OrionCompanion
   zsh make_app_bundle.sh
   ditto .build/Orion.app /Users/nickmadaio/Applications/Orion.app
   ```
   Stop any existing Orion companion/runtime first, then launch `/Users/nickmadaio/Applications/Orion.app`.
4. Confirm the companion creates the request and response queue folders.
5. With Orion.app running, verify:
   - `GET /native/status` reports companion-owned native state;
   - `GET /native/calendar` and `GET /native/reminders` succeed;
   - Calendar and Reminders permission status remains full access;
   - request Notifications from the native tab, while Orion’s native window is visibly open;
   - use a harmless local notification only after notifications are granted;
   - Accessibility appears as a manual Settings-toggle requirement, not an automatic grant.
6. Do **not** create real calendar events/reminders solely to test if read-only endpoint and proposal behavior already verifies the integration. If a write test is required, create a clearly labeled temporary item and remove it through the same permission-aware path.

The companion bundle must include `NSCalendarsFullAccessUsageDescription`, `NSRemindersFullAccessUsageDescription`, and `NSUserNotificationUsageDescription` in its `Info.plist`; these declarations were added after the first live bridge test returned no Calendar/Reminders grant.

For local notification authorization, the development bundle is also ad-hoc signed by `make_app_bundle.sh`. This gives macOS a stable local application identity; a release build should be signed with the appropriate Apple Developer identity instead.

### Latest live verification update

The companion-owned request queue compiled, was bundled, and the installed Orion app successfully launched the local runtime. Calendar and Reminders were successfully granted once through an unsigned/rebuilt companion during development. After the final ad-hoc signing step, macOS treated the app as a new identity and its direct native status returned Calendar/Reminders as `not_determined` again; request those permissions once more from the final signed Orion.app before treating them as complete. The direct Calendar read endpoint still returned a real event through the legacy fallback, so **do not use that fallback result as proof that the final companion identity has permission**.

The final signed companion reported Notifications as `denied` after the automated request. The user must re-enable it in macOS notification settings or approve a future visible prompt; do not claim native timer/reminder notifications are deliverable until status is `authorized`.

Permission requests now explicitly foreground Orion’s native window before asking macOS. Rebuild and reinstall after this edit, then retry the permission requests while the app window is visible.

This foregrounding change compiled successfully and the complete Python test suite passed afterward. It has not yet been installed into the final app bundle at the time of this handoff update.

### Final verification correction

The foregrounding build was subsequently installed and launched. The initial Python bridge wait period was too short during companion startup, causing a fallback to the legacy helper. `orion/mac_bridge.py` now waits up to ten seconds for the companion queue before falling back. With that correction, the live Orion runtime verified all of the following through the actual `Orion.app` companion:

- local runtime health is ready with the local GPT-OSS provider;
- native status reports **Calendar: full access** and **Reminders: full access**;
- the Calendar endpoint returns upcoming events;
- the Reminders endpoint returns the current incomplete reminder list;
- the Python automated suite passes all 17 tests after the correction.

Current remaining native setup is intentionally explicit: Notifications are `denied` and must be enabled by the user in macOS notification settings; Accessibility is `not_granted` and requires the user to enable Orion in Privacy & Security; the `Orion Native Timer` Shortcut is absent, so real Clock timers cannot yet start. Do not regress the verified Calendar/Reminders bridge by using the legacy helper for normal companion operation.

The native Clock Shortcut remains absent (`native_timer_ready: false`). The user must create the one-time `Orion Native Timer` Shortcut before a real Clock timer can be started.

### Packaging notes

The build script now puts the old helper app under:

`Orion.app/Contents/Library/LoginItems/OrionMacBridge.app`

instead of `Contents/Resources`. This conventional nested-app location survived copying to Applications during testing. The old helper should remain only as a development fallback once the companion-owned bridge works.

## Verification performed before the in-progress bridge edit

The project’s Python test suite passed with **17 tests**:

- cloud-routing policy;
- nested Desktop folder parser and isolated server execution;
- scoped computer proposals and rollback;
- executor permission policy;
- concise time behavior and audit;
- SQLite thread safety;
- structured planner validation;
- restart task recovery;
- durable scheduler execution and cancellation;
- memory retrieval;
- native-action persistence and native proposal endpoint.

Swift builds also passed for both the old `OrionMacBridge` and the initial `OrionCompanion` before the final bridge refactor.

After the companion-owned bridge refactor, `swift build` for `native/OrionCompanion` passed successfully and the Python suite again passed all 17 tests. The bridge has not yet been installed and smoke-tested through a newly launched Orion.app after that refactor; keep that distinction explicit.

Live checks that passed before the final refactor:

- Ollama reached GPT-OSS 20B from Orion.
- Local HTTP health endpoint returned ready.
- In-app UI loaded, showed Chat/Workspace/Memory/Activity/Native controls, and native forms rendered.
- Planner returned a valid nested Desktop folder plan from GPT-OSS 20B.
- Isolated end-to-end nested-folder test created only test workspace folders.
- The installed Orion app started its Python runtime and displayed the desktop control surface.

## Known gaps / recommended order of work

1. **Finish and verify the companion-owned macOS bridge** described above. This is the highest priority because it fixes native permissions correctly.
2. **Native notifications:** request from the actual app window and verify a benign notification. Update UI wording based on the true authorization state.
3. **Clock Shortcut setup:** guide the user through the one-time shortcut creation and test a short timer. Do not claim a native timer exists until the shortcut is detected.
4. **Planner depth:** expand structured multi-step planning tests. The model should decompose requests, but all paths/operations must continue through deterministic validation and policy.
5. **Conversational approval vocabulary:** support unambiguous responses such as “yes, do it,” “no,” and “show me first” across chat; keep the UI buttons as a convenience.
6. **More native capability coverage:** prioritize public macOS APIs and user-visible approval boundaries. Examples: local notifications, Calendar/Reminders, selected Finder/file operations, and later Shortcuts for APIs Apple does not expose. Avoid broad unrestricted shell execution.
7. **Voice:** add only after the text/native action loop is reliable. Voice should be another client of the same task/approval runtime, not a second automation system.
8. **Cloud and external connectors:** defer Zapier/Google Calendar cloud connectors until the local layer is stable. If added, make every external write explicit and auditable.

## Safety constraints worth keeping

- Never use an LLM’s text alone as permission proof.
- Keep filesystem scopes explicit; do not grant the entire home directory by default.
- Do not auto-delete, silently overwrite, alter system settings, or run arbitrary terminal commands.
- Maintain rollback only when it is genuinely safe; do not call a destructive operation reversible when it is not.
- Do not expose API secrets in UI, logs, screenshots, tests, or handoff documents.
- Separate “can propose” from “can execute.” Native calendar/reminder writes should still pass an approval record.
- Treat native macOS permission state as authoritative only when reported by the actual owning app, not a background process.

## Suggested quick resumption checklist

1. Read this handoff and `planning/ORION_BUILD_ROADMAP.md`.
2. Inspect the uncommitted changes in the three native-bridge files listed above.
3. Compile Swift; repair the companion queue bridge if necessary.
4. Install/restart Orion.app and confirm the live native status is returned through the companion.
5. Run the full Python suite and one cautious in-app smoke test.
6. Report only verified behavior to the user; specifically distinguish Calendar/Reminders permission from Notifications and the Clock Shortcut requirement.
