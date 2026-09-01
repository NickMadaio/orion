# AGENTS.md — shared ground truth for coding assistants

For any AI working on this repository: Claude Code, ChatGPT/Codex, or anything
else. One file, so two assistants do not hold two different beliefs about how
this thing is built.

Not to be confused with `openclaw-workspace/AGENTS.md`, which is Orion's OWN
runtime instructions — how the assistant behaves when it is running. This file
is about the codebase.

Companion docs: `HANDOFF.md` (running log of completed work), `OVERNIGHT-LOG.md`,
`planning/` (design docs), `native/Orion/README.md` (the app itself).

Current ORION v2 state and exact continuation steps live in
`planning/v2/HANDOFF.md`. Phase 32.5's product charter and additive recovery
gates live in `planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md` and
`planning/v2/ROADMAP_AMENDMENTS.json`; `planning/v2/SESSION_LOG_2026-08-25.md`
summarises phases 5-20 on one page. Read them before changing v2 contracts or
the OpenClaw integration, and preserve the shared dirty worktree.

Last updated 2026-09-01.

---

## Relay protocol

Two assistants work on this repo and neither sees the other's chat. These files
are the entire channel, so treat them as the job rather than the paperwork.

**Read before you touch anything:** this file, `HANDOFF.md`, `NICK-TODO.md`, and
`planning/v2/HANDOFF.md` if the work is v2. For work after Phase 32, also read
`planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md` and
`planning/v2/ROADMAP_AMENDMENTS.json`.

**A handoff's date is when it was written, not when the work stopped.** This has
already cost a session. On 2026-08-19 Codex wrote its handoff at 18:32, kept
working until 18:47, and then hit zero credits — so the file listed as "next" a
slice that was already built, tested, installed, and proven live. Never take the
last write as the end of the work. Verify against the machine:

```bash
git log -1 --format='%H %ci %s'          # what is actually committed
git status --short                        # this tree is always dirty; that is normal
find . -newermt "<handoff date>" -not -path './.git/*' -not -path './.build/*'
tail -5 ~/.openclaw/logs/config-audit.jsonl        # live config changes, with argv
gzcat ~/.openclaw/orion-controlled/archive/ledger-*.jsonl.gz   # what actually ran
ls -lat ~/.codex/sessions/*/*/*/rollout-*.jsonl | head          # Codex's own tool log
```

That last file is the good one. The auto-review thread inside it carries the main
agent's full numbered transcript — every command, every result — so you can
recover exactly where a dead session stopped instead of guessing.

**When the manifest and reality disagree, register it — do not improvise.**
`planning/v2/PHASE_GATES.json` holds two lists for this. `pendingGateAmendments`
is for a gate whose text rests on an assumption the built system contradicts:
record proposed replacement wording, keep working under a recorded deviation, and
amend them together in one reviewed pass. `scopeNotInManifest` is for something
Nick wants that no phase covers: record what already exists and where it would
belong. Bending a gate in the moment, or building outside the requirements source
without saying so, is how a program stops meaning anything. Tests enforce that
entries stay well formed.

**Additive checkpoints are not numbered phases.** Phase 32.5 records product
intent and recovery work without changing the fingerprinted 0-84 sequence.
`scripts/orion_v2_phase_gate.py` currently reads records under
`PHASE_GATES.json`'s `phases` object, so it does not mechanically block on the
stable `REC-*` IDs in `ROADMAP_AMENDMENTS.json`. Treat that as an explicit tool
limitation, not permission to skip them: check the amendment register before a
new batch or consequential live v2 path, and never claim the checker enforced
what it ignores.

**Close roughly ten-phase batches with review, then a learning checkpoint.**
Nick's 2026-08-27 workflow is: independent review against requirements and the
current tree; repair findings; rerun meaningful checks; write a readable batch
report; scan for secrets; then make detailed local commit checkpoint(s) covering
only that batch. The report records what, why, alternatives, review findings,
actual proofs, limitations and rollback so Nick can study the history later.
The reviewer sees code and source requirements, but should not be primed with
the implementer's conclusion. Full procedure and the existing mixed-backlog
recovery plan are in the Phase 32.5 charter, section 6.

This is standing authorization for local checkpoints of future implementation
batches Nick asks to run after their review gates pass; do not ask again for the
same checkpoint. It is not permission to sweep the existing mixed dirty tree
into a commit or push to a remote. Separate unrelated work and record local
commit versus verified remote backup explicitly. Record remaining user decisions
and refresh the handoff before yielding; do not commit after every response.

**Check the date, do not infer it.** A long session can span days, and file
mtimes tell you when something was last touched, not when today is. Run `date`
before writing a dated entry. An agent session on 2026-08-23 wrote three days'
worth of entries dated 2026-08-20 because it anchored on the mtimes it happened
to be reading.

**It has now happened twice, to a session that had read this paragraph.** On
2026-08-27 a session that opened on the 25th dated two handoff entries, two phase
gates and a review record as 2026-08-26, because it ran `date` once at the start
and never again. Sessions here routinely span a day boundary and a long one can
span two. `date` costs nothing; run it immediately before you write any dated
record, not once at the beginning. If you are recording work that took hours,
the date you checked when you started is already suspect.

**Write before you finish.** Append a dated section to `HANDOFF.md` (newest
first, and `planning/v2/HANDOFF.md` too for v2 work) covering:

- what state you found, and where the previous session's record was wrong;
- what changed and why, including alternatives you rejected;
- verification — actual numbers and command output, not "tests pass";
- live/installed state: what is running, what flags are set, what was deployed;
- the rollback path, in the repo (`.builds/`), never in `/private/tmp` — that
  path does not survive a reboot;
- the exact next step, and which shared files it needs.

An entry that only says what you did is half an entry. The next assistant needs
the state of the world, because it cannot ask you.

---

## The one invariant

**The app's code-signing identity must never change.** Everything else here is
detail; this is the thing that breaks users.

macOS binds TCC permissions (microphone, accessibility, speech) to the app's
*designated requirement*:

```
identifier "com.nickmadaio.orion.app" and certificate leaf = H"171a72ab4922a629de353811e065ce2c5820ac09"
```

Ship a build whose requirement differs by one byte and macOS treats it as a
different application. Every permission resets, every stored token becomes
unreadable, and a second "Orion" appears in Privacy & Security. The user did
nothing wrong and gets no explanation.

Consequences you must respect:

- **Never ad-hoc sign.** `make_app_bundle.sh` now hard-fails rather than falling
  back. `--allow-adhoc` exists for throwaway builds and must never be used for
  anything a user will run.
- **Never casually regenerate the signing certificate.** A new certificate is a
  new identity and resets everything. It is sometimes necessary (see expiry
  below) but it is a decision, not a step.
- **Check before shipping:** `scripts/orion-identity-check` compares a built
  bundle's requirement against the installed app. Exit 0 = safe. Anything else
  means do not publish.

### The Keychain does NOT work this way — measured 2026-08-18

TCC survives rebuilds. **Keychain ACLs do not.** Legacy (file-based) Keychain
items bind their ACL to the specific BINARY, not to the signing identity. Proven
with two binaries compiled from near-identical source, signed with the same
certificate and identifier, differing only in cdhash: the second one was
prompted for an item the first one created.

So every new build prompts once per stored secret — roughly fifteen dialogs —
and "Always Allow" only whitelists that one build. This is the "million Keychain
permissions" problem and the signing certificate does not fix it.

The prompt-free path is the data-protection Keychain
(`kSecUseDataProtectionKeychain`), which is entitlement-gated rather than
ACL-gated. It is **unavailable to a self-signed app**, also measured: claiming
`keychain-access-groups` gets the process SIGKILLed by the kernel, and without
that entitlement every data-protection call returns `-34018`. It needs a real
Apple team identity (Developer ID).

Do not repeat these experiments casually — each one costs the user a dialog.

**The certificate expires 2027-07-31.** The build warns from 90 days out and
refuses to build after. Renewal costs one permission reset, so plan it.

---

## Layout and commands

| Thing | Where |
|---|---|
| The Mac app (Swift, SwiftPM) | `native/Orion/` |
| Pure domain logic, no I/O | `native/Orion/Sources/SessionDomain/` |
| State files, history, locks | `native/Orion/Sources/SessionService/` |
| The OpenClaw plugin | `openclaw-plugins/orion-control` |
| Runtime data the app reads/writes | `~/.openclaw/orion-controlled/` |
| App log | `~/.openclaw/logs/orion-app.log` |

```bash
# Build a signed .app bundle (also stamps version + verifies the signature)
native/Orion/make_app_bundle.sh

# Install it
cp -R native/Orion/.build/Orion.app /Applications/

# Unit tests — 318 of them. Use THIS, not `swift test`.
native/Orion/Tests/run-domain-test.sh

# End-to-end update test (builds, signs, serves, installs, asserts)
native/Orion/Tests/run-update-test.sh
native/Orion/Tests/run-update-test.sh --tamper   # must REFUSE
```

`swift test` fails with "no such module 'XCTest'" because `xcode-select` points
at CommandLineTools. The wrapper sets `DEVELOPER_DIR` for one invocation. Do not
"fix" this by changing the machine's active developer directory.

---

## Versioning

- `native/Orion/VERSION` holds the semantic version (currently **1.2.0**), read
  at bundle time.
- `CFBundleVersion` is `git rev-list --count HEAD` (currently **118**). It only
  ever goes up. **Do not rewrite published history** — the build number would go
  backwards and updates would stop being offered.
- `ORION_VERSION`, `ORION_BUILD_NUMBER`, `ORION_BUNDLE_OUT` override all of this,
  for the release script and the update test only.

---

## Auto-updates (Sparkle)

Added 2026-08-18. Sparkle **2.9.6** via SwiftPM — the only third-party
dependency in a package that is otherwise Apple-frameworks-only. That was a
deliberate exception; do not treat it as precedent.

- `Sources/Orion/UpdateController.swift` — the updater and its policies.
- The framework is embedded and signed **inside-out** by `make_app_bundle.sh`
  (XPC services → Updater.app → Autoupdate → framework → app). Signing the app
  first seals a hash of its contents, so anything signed afterwards invalidates
  it. The build verifies with `codesign --verify --deep --strict` and fails if
  the order was wrong.
- EdDSA public key lives in `Resources/Info.plist` as `SUPublicEDKey`
  (`XpJLRMEJj6NI7CBHBI1JNhIWr8UG94GDXywVw6YMgHI=`). **The private key is in
  Nick's login Keychain and is not backed up yet.** Losing it means never
  shipping an accepted update again.

Two policies that are not Sparkle defaults, both load-bearing:

1. **Nothing on the launch path.** The updater starts 30s after launch. This app
   has already lost an afternoon to a launch path that waited on securityd; an
   update check reaches the network, which can hang without erroring.
2. **Never interrupt an active focus session.** Checked before a check runs and
   again before the relaunch. Gated on `.running` specifically — *not*
   `snapshot().isRunning`, which stays true for `waitingForReturn` indefinitely.
   Postponement has a six-hour ceiling, because "wait for a good moment" is one
   stuck state away from "never".

### Not done yet

- **No rollback if an update crashes on launch.** Sparkle will not catch this.
  `scripts/orion-forge` already solves the shape locally — keep
  `Orion-previous.app`, verify the launch, restore if it dies — and that pattern
  should be carried into the update path before anyone else installs Orion.
- **No feed.** `UpdateController.defaultFeedURL` is a placeholder
  (`ORION_OWNER/ORION_REPO`) and 404s, so a real "Check for Updates" fails today.
  Needs a GitHub repo, an appcast, and one published release.
- **No release script** yet. It must gate on: clean tree, tests green, identity
  check, deep signature verify.
- Not notarized, so the app is Gatekeeper-blocked for anyone but Nick. Public
  distribution needs a Developer ID (Apple Developer Program, $99/yr). The design
  keeps that a configuration change rather than a rewrite.

---

## Running the suites

Not obvious, and it cost a session twenty minutes to work out: **pytest is not
installed** and never has been -- this repo's Python has zero third-party
dependencies. The Python suite is unittest, and plain `discover` from the repo
root finds nothing because `tests/` has no `__init__.py`:

```bash
PYTHONPATH=. ./.venv/bin/python -m unittest discover -s tests -t tests -q
```

The `.venv/bin/python` symlink still reports a path under `~/ORION` (the repo's
old home) but runs correctly from `~/Desktop/ORION`.

`orion_v2_secret_scan.py` has **no default allowlist path**. Run without
`--allowlist planning/v2/secret-scan-allowlist.json` it reports the reviewed
synthetic fixtures as unexpected findings, which reads like a leak and is not one.

The v2 check scripts, all read-only:

| script | what it proves |
|---|---|
| `orion_v2_capability_check.py` | the capability registry still describes the compiled catalog |
| `orion_v2_policy_check.py` | the policy engine is never more permissive than the live gate (390 combinations) |
| `orion_v2_audit_check.py` | nothing survives redaction, and every live task-ledger row fits the v2 contract |
| `orion_v2_schema_check.py` | schema, migrations and the manifest's 26 tables agree (`--sql` prints the DDL) |
| `orion_v2_sync_check.py` | Python and Swift order a conversation identically |
| `orion_v2_mobile_check.sh` | MobileCore compiles and its 335 assertions pass |
| `orion_v2_phase_gate.py --phase N` | that phase's requirements are recorded and open |

Two more live under `native/Orion/Tests/`, both compiling the REAL app sources:

| script | what it proves |
|---|---|
| `run-health-firewall-test.sh` | no raw HRV, resting heart rate, recovery, sleep score or strain survives into a model prompt — asserted by pulling every number out of the generated text, not by grepping for words |
| `run-capability-test.sh` | the profile ladder matches the plugin's, and every live config flag has a Settings switch |

`scripts/orion-lock` is the off switch (Phase 43): it drops the permission
profile to `restricted_read_only` and disables every cron job. `orion-lock
status` reports both without changing anything.

**Xcode 26.6 is installed, but `xcode-select` points at CommandLineTools**, so
plain `xcodebuild`, `xcrun` and `swift` use the wrong toolchain and report that
there is no iOS SDK. There is one. Override per command, no sudo needed:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun --sdk iphonesimulator --show-sdk-path    # iPhoneSimulator26.5.sdk
xcrun simctl list devices available            # five iPhone simulators
```

`scripts/orion_v2_mobile_check.sh` sets it and builds MobileCore for the iOS
simulator on every run, which is what keeps "MobileCore imports no platform
framework" true rather than aspirational — importing AppKit into it fails the
check with exit 1.

**XCTest and swift-testing both work**, through the same override — the
`native/Orion` section above has documented this since long before the mobile
package existed, and `Tests/run-domain-test.sh` runs 318 XCTest cases that way.
MobileCoreCheck is an executable rather than a test target because it also runs
with Command Line Tools alone and is proven to exit non-zero; converting it to a
`swift test` target with the same wrapper pattern would be more consistent with
`native/Orion` and is a reasonable thing for a later session to do.

## Traps that have already bitten, do not reintroduce

- **`set -euo pipefail` + `grep`.** A `grep` that matches nothing exits 1 and
  kills the script mid-assignment. This silently made the ad-hoc warning path in
  `make_app_bundle.sh` unreachable. Use `|| true` on pipelines whose emptiness is
  a legitimate outcome.
- **Ad-hoc bundles print their requirement commented**: `# designated => cdhash
  H"..."`. Parsers must accept both spellings or they misreport the one case that
  matters.
- **Sparkle delegate callbacks arrive on the main thread.** `DispatchQueue.main.sync`
  inside one is an instant deadlock.
- **Sparkle installs on quit by default.** A menu-bar app that starts at login may
  never be quit, so the update downloads and silently never lands.
- **Whoop pagination returns 401 on page 2**, reproducibly, on a token that just
  served page 1. `WhoopClient` therefore fetches two fixed windows (7d and 35d)
  rather than following `next_token`. A data-fetch 401 must never clear the
  grant — renew and retry once first, because clearing it disconnects the user.
- **`log` is a shell builtin in this environment.** `log show ...` silently fails
  with "too many arguments" — any assertion built on it passes vacuously. Use
  `/usr/bin/log` explicitly. This invalidated a "no permission prompts appeared"
  test result and led to a wrong conclusion that the Keychain problem was solved.
- **A default-off bridge that can throw is not default-off.** The v2
  `system_status` adapter validated its contract *before* calling the legacy
  route and threw on a mismatch, so turning the flag on could refuse a call that
  works with it off — `system_status` declares `requiredArguments: []` and the
  validator rejects no unknown key, so an extra argument is a normal call. An
  observer that is allowed to fail the action is not an observer. Anything that
  should *deny* belongs in the validator and the permission profile, which
  already own that authority.
- **Claude Code updating mid-session kills Desktop access, and it looks like a
  macOS permissions problem.** On 2026-08-25 an auto-update replaced
  `~/Library/Application Support/Claude/claude-code/<version>/` while a session
  was running from the old one. macOS resolves the responsible process when
  granting access to a protected folder; the binary was gone, so `~/Desktop` and
  `~/Documents` started returning `Operation not permitted` while `~/ORION`,
  `~/.openclaw` and `/tmp` kept working. Full Disk Access was granted correctly
  the whole time and changing it does nothing. Diagnose with:

  ```bash
  ps -o comm= -p $(ps -o ppid= -p $$ | tr -d ' ')      # the binary you are running
  ls ~/Library/Application\ Support/Claude/claude-code/ # the versions that exist
  ```

  If the first is not in the second, restart Claude Code. Nothing is wrong with
  the files, and nothing is wrong with the permissions.
- **`tests/test_tts_daemon.py` fails intermittently under load.** It uses real
  sockets, `sleep(0.005)` polling and a 60 ms wall-clock deadline, so a busy
  machine can miss the window. Observed once in a normal run on 2026-08-24 and
  reproduced by running four copies of that file concurrently; 20+ other runs
  were clean. A full-suite failure you cannot reproduce is probably this rather
  than your change -- re-run before you go looking.
- **A consumer's tests must run over what the producer actually emits.** Phase
  32's fixtures were hand-built `Baseline` values with hand-chosen spreads, so
  23 of its 42 guards were unenforced and a defect in Phase 31 -- a quantised
  spread that rounded real variability to zero -- was invisible to both. Building
  a stand-in is how a test stops testing the seam. If module B consumes module
  A's output, at least some of B's fixtures must come from calling A.
- **Rounding a SPREAD fabricates certainty.** Quantising a value for display is
  honest; quantising the dispersion that decides whether something is unusual is
  not. A real spread of 14 minutes rounded to 0, a `max(spread, 1)` floor turned
  that into 1, and a fifteen-minute difference read as a crisis. Keep the
  precise dispersion for comparison and round only what a person reads -- and
  floor it on a quantity of the same kind, never a bare `1`.
- **Filter non-finite values at every entry point, not just the obvious one.**
  `baseline()` filtered NaN and infinity; `trainingLoad()` twenty lines below did
  not, and every `Int(someDouble)` downstream is a trap that crashes rather than
  refuses. `Int(Double.nan)` is a fatal error in Swift, not an exception.
- **A guard on a function is not a guard on the type.** Three separate findings
  in one review had the same shape: the rule was implemented, mutation-tested and
  correct, and the object it protected could still be built another way.
  `ReplyContext` validated its ids and nothing about where its permitted set came
  from; `revise()` cleared a draft's review while `dataclasses.replace` — the
  same API `revise()` calls — did not; every `Preview` invariant lived in the
  `preview()` function and nothing forced callers through it. If a property must
  hold, put it in `__post_init__` or bind it to a fingerprint of the content, and
  ask "what else constructs this?" before believing a mutation test.
- **`$` in a Python regex also matches before a trailing newline.** `"abc\n"`
  passes `re.match(r"^[a-z]+$", ...)`. Use `\Z` for anything that becomes a URL
  path, a filename or an identifier.
- **`json.dumps` defaults to `ensure_ascii=True`, which escapes astral characters
  as surrogate PAIRS.** So `"\U0001F600"` and the two-code-point lone-surrogate
  string encode identically — a real collision for any hash used as an
  authorization token, and lone surrogates arrive from `json.loads` of provider
  JSON. Use `ensure_ascii=False` and refuse unencodable text at the boundary.
  Also never pass `default=str` to a hash payload: it silently flattens any
  object, so a class with the right `__str__` collides with a real string.
- **`str.lower()` is a display transform, not a security normalization.** Python
  folds U+212A KELVIN SIGN to ASCII "k", so `nic\u212a@example.com` lowercases to
  `nick@example.com`. `egress.py` already refuses non-ASCII hosts for this
  reason; anything comparing identifiers needs the same stance.
- **`allSatisfy` over an empty collection is true, in Swift and everywhere.** An
  assertion that a still-deferred feature "cannot have lost its tokens" passed
  when the token list was emptied, and one derived from the very list it checked
  was a tautology. Pin expected CONTENTS, not a property of the structure.
- **`(try? String(contentsOf:)) ?? ""` makes a grep pass on any file it cannot
  read.** A source chmod-ed to 000 with a forbidden token in it went green.
- **A same-length source edit can leave poisoned `.pyc` bytecode.** Python
  invalidates a cached `.pyc` on `(mtime, size)` with **one-second** mtime
  resolution. A mutation test that swaps a token for one of the same length --
  `RiskLevel.R3` to `RiskLevel.R2` -- leaves the file the same size, and
  restoring it inside the same second leaves the cached *mutated* bytecode
  looking valid. The next test run then silently executes the mutation. This
  produced a phantom failure in the full suite on 2026-08-26 that did not
  reproduce when the file was run alone, and the file on disk was correct the
  whole time. In the other direction it can make a mutation falsely appear
  CAUGHT, because the poisoned module fails a test that has nothing to do with
  the current edit. Any script that edits a source file, runs something, and
  restores it must set `PYTHONDONTWRITEBYTECODE=1` on the child. Diagnose with:

  ```bash
  find . -name '__pycache__' -type d -not -path './.venv/*' -exec rm -rf {} +
  ```

  If purging fixes it, nothing was ever wrong with the source.
- **Before changing a constant that appears in user-facing text, grep the tests
  for it.** `CameraPresence.sampleDuration` looked like a tuning knob — presence
  checking had failed 504 times out of 504 because 1.5 seconds has to cover both
  the camera warming up and the first frame arriving. Raising it to 4s broke
  `testTheDutyCycleIsUnderTwoPercentAsClaimed`, which asserts
  `sampleDuration / sampleInterval < 0.02`, because the disclosure states that
  number to the user. The privacy promise was not prose; it was checked. The
  right move was to revert and record the diagnosis, because verifying a camera
  fix needs a camera that delivers frames.
- **Check a writer's actual return vocabulary; do not guess it.** `orion-lock`
  was written to treat a status of `"applied"` as success. `changePermissionProfile`
  returns `changed | unchanged | rejected | stale | needs_approval` and never
  `applied`, so a SUCCESSFUL emergency lockdown would have been reported as a
  failure. Caught only by running it against a copy of the state file. Test a
  panic button before you need it.
- **launchd cannot read `~/Desktop`.** The TTS daemon's launch agent has never
  been installable, because the repo lives under `~/Desktop` and a launchd job
  gets `getcwd: cannot access parent directories: Operation not permitted` plus
  `can't open input file`. That is why the daemon stayed dead for nineteen days
  after being killed on 2026-08-18 — nothing could restart it. Start it the way
  `launchers/Choose Orion Voice.command` does, with `ORION_TTS_CLOUD_VOICE=1`, or
  it silently serves the local voice while logging `elevenlabs key found but not
  selected`.
- **A session can span a REBOOT, not just a day boundary.** On 2026-08-28 a
  session ran from 01:20 to 23:59, wrote its handoff at 00:00 on the 29th, and
  then resumed after the machine rebooted (`kern.boottime`: Aug 29 13:22) to make
  its commits on **2026-09-01**. Three different dates, all correct for what they
  stamp. Check `date` before every dated write, and when the document date and
  the commit date differ, say so in the entry — otherwise the next reader cannot
  tell an honest gap from a fabricated timestamp. `sysctl -n kern.boottime`
  tells you whether the machine restarted under you.
- **State the SCOPE of a parity result, not just its verdict.** Third instance of
  the self-verifying family, found 2026-09-01. `orion_v2_policy_check.py` reports
  "never more permissive than the live gate across 390 combinations" and its
  `baseline()` docstring honestly says it uses "the most ordinary request there
  is... no external data, nothing expired, nothing delegated." The check is
  correctly scoped; the INFERENCE drawn from it is not. Measured at
  `external_connected`: baseline gives 14 stricter / 0 deny, but
  `external_data_involved=True` gives **54 stricter / 25 DENY** -- including
  `browser_open_url`, `messages_send`, `calendar_event_add`, `file_delete` and
  every `self_*` action. 390 is 78 actions x 5 profiles at ONE point in a
  five-dimensional space. A headline that omits the fixed dimensions will be read
  as covering them.
- **`docs/` is not on the assistant read path, and a whole plan was lost in it.**
  `CLAUDE.md` routes to `HANDOFF.md`, `NICK-TODO.md`, `planning/v2/HANDOFF.md`,
  the charter and the amendments. `docs/GAME_PLAN.md` -- a full architectural
  plan whose permission half shipped and whose architecture half did not -- is
  cited by nothing except a one-line directory listing in `README.md`. It was
  functionally unread for a month while a later plan rebuilt the machinery it
  argued for deleting. If a document is meant to be binding, it goes on the read
  path or it does not exist.
- **A mechanism that verifies itself against itself always passes.** Three of
  these were found in one batch on 2026-08-28, all three cited as evidence.
  `APPLIED_CHECKSUMS = {1: MIGRATIONS[0].checksum}` made "was this migration
  edited?" evaluate `x == x`, so changing a column type left the schema check at
  exit 0 and all 1,375 tests green. `is_wall_clock_free` built two IDENTICAL
  `Position` objects and asserted the key gave the same answer for both — true of
  `lambda _: 0` — with a docstring claiming they differed by a timestamp and that
  the check script used it; nothing imported it. And `MIGRATIONS` is generated
  from `SCHEMA`, so `drift()` compared the schema to a function of itself. Before
  believing a recorded value, ask where it was recorded FROM. A constant assigned
  at import from the thing it is meant to detect changes in records nothing.
- **Pin CONTENTS, not counts.** `TodaySection.allCases.count == 8` passed after
  deleting "priorities" and "action inbox" and substituting "Steps" and
  "Calories" — the metrics dashboard the manifest forbids. The same shape was
  live in `DesktopOnlySurface`, `CaptureSource`, `CaptureKind` and `SecureKey`,
  and in a `!rawValue.contains("private")` guard that a slot named
  `device_signing_key_material` walked straight past. A count cannot tell you the
  members are the ones you meant; an exact set can.
- **A recursive language needs a recursive scan.** `contentsOfDirectory` does not
  descend, but SwiftPM compiles subdirectories — so a deferred feature parked at
  `MobileCore/Remote/MacBridge.swift` was public, callable, compiled and green.
  Any source-scanning guard must enumerate, not list.
- **A compiler guard only covers what the compiler can see.** "MobileCore imports
  no platform framework" was enforced by the iOS build, which catches
  platform-EXCLUSIVE frameworks like AppKit and UIKit. `SwiftUI`, `Security`,
  `UserNotifications`, `CryptoKit` and `CoreLocation` exist on both platforms, so
  they compiled cleanly while the check reported "no platform framework crept
  in". Those were precisely the frameworks the phase planned to add next.
- **A second constructor is a second door, and it is usually the unlocked one.**
  Already recorded below as "a guard on a function is not a guard on the type",
  and it recurred four more times in one batch: `adopt()` beside `register()`
  (no verifier at all, reaching `DeviceTrust.PAIRED` where `register` raises),
  `put()` beside `insert()` (no ownership refusal), `MemoryItem(...)` and
  `dataclasses.replace` beside `MemoryStore.remember` (no durability rule), and
  `Capture.classify(as:confidence:)` beside the classifier (a public setter that
  stamped `resolvedBy = .classifier` for whoever called it). When you write the
  guard, grep for every other path that builds or mutates the same thing.
- **Never truncate an identifier that is compared for equality.** `_key_id` was
  `f"key-{device_id}"[:127]` while `Identifier` permits 128 characters, so two
  device ids sharing 123 leading characters got the same `signing_key_id` — the
  value `rules.py` compares to bind a signature to its origin device. Hash it.
  The same rule caught `key_fingerprint`, which was `public_key[:12]` and so read
  `-----BEGIN P` for every PEM key in the Security Center.
- **A default is not a ceiling, and a lifetime is not a policy.** `issue()` used
  a caller-supplied `family_expires_at` unclamped against a 90-day absolute
  lifetime; `remember()` let a caller override working memory's 12-hour
  "never durable" lifetime by ten years. Clamp at the boundary, not only on the
  path you happened to test.
- **`compare_digest` refuses non-ASCII `str`.** Both `claim()` and `CsrfGuard`
  raised `TypeError` out of methods whose documented contract was a rejection —
  an attacker-chosen 500. Worse in the pairing case: it was the one wrong-nonce
  path that did NOT cancel, which made it a probe oracle. Encode both sides.
- **An empty filter must deny, not admit.** `wanted = {...} if classes else
  set(MemoryClass)` treated an empty allowlist as "no filter given" and returned
  every class. Distinguish `None` from empty.
- **Missing health data is not zero.** `SessionDomain/DayScore.swift` excludes
  absent inputs and redistributes their weight. Scoring a missing input as zero
  tells the user they had a bad day because a watch did not sync.

---

## Version control

**This repo has a remote as of 2026-08-20: `github.com/NickMadaio/orion`,
private.** Before that date nothing left the machine — no remote, no backup, and
the project lived in four folders that did not know about each other. They are
one tree now:

| Was | Is now |
|---|---|
| `~/Desktop/ORION` | repo root |
| `~/orionBrain` (Obsidian vault) | `brain/` |
| `~/orion-privacy` | `web/privacy/` |
| `~/Orion Controlled Test Workspace` | `tests/workspace/` |

The originals still exist on disk; they were copied, not moved. **The repo is
authoritative.** Editing `~/orionBrain` does not reach GitHub, and a session
that reads that folder is reading a stale fork of `brain/`.

Full workflow, including branch layout and the secret-scanning rules, is in
`.claude/skills/orion-git/SKILL.md`. Claude Code loads it as a skill; anything
else should just read the file.

### You may push and pull without asking

This reverses the rule that was in House rules below, which predates the remote
existing. `gh` is authenticated on this machine through the browser flow (set up
2026-08-20), so `git pull`, `git push`, and `git fetch` work with no token and no
prompt. Use them.

If auth breaks: `gh auth login` → GitHub.com → HTTPS → Yes → browser. Never a
personal access token in a URL or a config file.

What did not change: **the dirty tree is usually not yours.** Stage deliberately
with `git add <paths>` rather than `git add -A`, unless you have checked
`git log` and confirmed the whole tree is your work.

### Never rewrite published history

This was already a rule (see Versioning) and the remote makes it binding.
`CFBundleVersion` is `git rev-list --count HEAD` — run it to see the current
value. Sparkle offers an update only when that number goes up. Rewriting history makes
it go down, and every installed copy of Orion silently stops updating, with no
error and no symptom until someone notices they are months behind.

Banned on any pushed branch: `push --force`, `push --force-with-lease`,
`rebase`, `commit --amend`, `reset --hard` to an older commit, `filter-branch`.
If history genuinely has to change, that is a conversation with Nick.

---

## House rules

- **Committing and pushing is allowed** as of 2026-08-20 — see Version control
  above. The caution that came with the old rule still stands: something else in
  this repo commits on its own schedule (a commit landed 2026-08-18 22:11 that no
  session here authored), so check `git log` before assuming the tree is yours.
- **`git log` is not enough — `git fetch` too, and not only at the start.** Nick
  committed and pushed on 2026-08-20, moving `main` and switching the checkout
  from `orion-v2/phase-0-inventory`; one session did not notice until the 23rd.
  It happened again on 2026-09-01: a session checked `git log` at 01:20, worked
  for a full day against `1efd37c`, and only discovered four commits of Nick's
  own on `origin/main` when a push listed the remote heads. `git log` shows you
  the LOCAL ref, which is a snapshot of whenever you last fetched. Run
  `git fetch && git status -sb` at the start of a session and again before you
  branch, commit or merge.
- `.env`, `.env.save` and `.builds/openclaw.json.*` are untracked and must stay
  that way; run `orion_v2_secret_scan.py --history` before anything reaches the
  remote. Note it needs `--allowlist planning/v2/secret-scan-allowlist.json` or
  it reports the reviewed fixtures as findings.
- The working tree usually has uncommitted changes that are not yours. Builds
  include them. A release must require a clean tree.
- Hooks are active (see `~/.claude/settings.json`): git-push review, doc
  blocking, auto-format, console.log audit.
- Prefer many small files over few large ones; 200–400 lines typical.
- Comments here explain *why*, especially why an obvious alternative was
  rejected. Match that; do not strip it.
