# Orion — voice, interface, and trust hardening (2026-07-30, second session)

Supplements `ORION_FINALIZE_ACCESS_HANDOFF.md` (same day, earlier). Architecture
is unchanged: OpenClaw `2026.7.1-2` is the runtime/brain/channels, and
`orion-control` is Orion's permission-gated Mac body. Three things changed.

---

## 1. Voice is no longer cold-starting on every reply

**The bug.** `talk.provider` pointed at `scripts/orion-local-tts`, a zsh script
that invoked `mlx_audio.tts.generate` directly. That spawns a fresh Python
process and loads the 250M Marvis model **from disk on every single spoken
reply**. On top of that, `--join_audio` meant the entire answer was synthesized
before one sample played, and `--speed 0.94` deliberately slowed the voice below
natural rate. Three independent latency taxes, compounding.

**The fix.**

- `scripts/orion_tts_daemon.py` (new) — loads the model **once** and stays warm.
  Unix socket at `~/.openclaw/orion-tts.sock`. Splits on sentence boundaries so
  the first sentence is ready long before the last one is. Bounded queue, a
  cancel/flush path so barge-in abandons in-flight synthesis, a chunk cache, and
  a hard fallback to `/usr/bin/say` if MLX fails to import or load. Voice never
  goes fully dead.
- `scripts/orion-local-tts` (rewritten) — thin client, same CLI contract
  (`OUTPUT_PATH TEXT`), so the config keeps working. Autostarts the daemon if
  it's not up. Bounded by its own budget and a watchdog: it cannot hang, it
  degrades to `say`.
- `native/launchd/com.nickmadaio.orion.tts.plist` (new) — `KeepAlive` +
  `RunAtLoad`. **Not loaded yet — see "Do this first" below.**
- `openclaw.json` — `talk.providers.tts-local-cli.timeoutMs` cut `120000 → 8000`
  (a warm daemon taking 120s means something is broken; you should hear the
  fallback, not silence). `talk.silenceTimeoutMs` `1500 → 700`, so Orion stops
  waiting a second and a half after you finish a sentence. Speed is `1.0`,
  tunable via `ORION_TTS_SPEED` / `ORION_TTS_VOICE`.

**Honest accounting of the numbers.** The per-utterance model load was removed —
that is a structural fact about the code, not a measurement. But **nothing here
was timed on your Mac**, because this sandbox cannot run MLX, `say`, or reach
`127.0.0.1:18789`. The 1–3s estimate for the old cold load is inference from how
MLX model loading behaves, not something observed. Measure it yourself with the
command in "Verify" below before believing any specific figure.

Tests: **112 pass** (`python3 -m unittest discover -s tests`) covering sentence
splitting, chunking, WAV joining, socket framing, queueing, cancellation, atomic
writes, and fallback selection — all the logic that doesn't need the model.

---

## 2. Orion has its own interface

`orion/interface/` — standalone, does not depend on the OpenClaw UI.

- `hologram.js` — the Age of Ultron core. A rotating spherical shell of ~1500
  radial filaments, 46 broken latitude arcs, 260 circuit chips, 3 tilted orbital
  great-circles, and drifting motes, drawn additively over a white-hot core with
  an anamorphic lens streak. Canvas 2D deliberately: no CDN, no WebGL context
  loss, nothing that breaks offline. Orion is local-first; its face should be
  too. Geometry is built once; the draw loop allocates nothing.
  Five states — `idle / listening / thinking / speaking / error` — differing in
  spin rate, tint (gold → cool blue when listening, red on error), and bloom.
  It reacts to the **actual waveform** via an `AnalyserNode`, mic while you talk
  and TTS while it answers, not a canned animation.
- `index.html` — the interface. Push-to-talk on held **space** (or the mic
  button), `esc` to cut Orion off mid-sentence, `/` to focus the text field.
  Streaming interim transcripts via the Web Speech API. Live transcript rail,
  gateway/voice health pills, per-turn latency in milliseconds.
- `server.py` — the bridge, stdlib only. **The only component that knows how to
  reach the gateway**, so when OpenClaw's RPC surface drifts, one function moves.
  It shells out to the documented `openclaw agent --json` CLI rather than the
  versioned WebSocket protocol, which is the more stable contract. Loopback-only
  bind (refuses anything else), CSP, cross-origin POST rejection, static-asset
  allowlist instead of path joins, session-key validation. The gateway auth
  token never reaches the browser.
- `scripts/orion-interface` — launcher. Warms the TTS daemon, checks the
  gateway, starts the bridge, opens it. Idempotent. `--status` reports without
  changing anything.

Verified: the bridge serves, health-checks, and correctly **rejects** path
traversal, cross-origin POSTs, empty prompts, and malformed session keys. The
hologram renders all five states for 60 headless frames with no errors
(~1,570 stroke calls/frame, fine for an M-series Mac at 60fps).

**Not verified:** how it actually looks and sounds in a browser on your machine.
Nobody has run it yet.

---

## 3. The trust-tag hole is closed

This was the top item on the previous handoff's remaining-work list, and it was
worse than described.

**The defect.** `trusted_user` was supplied *by the model* inside the TaskGraph.
The anti-injection boundary was model-enforced. A malicious instruction inside a
file Orion read, or a web page it fetched, could get the model to stamp
`trusted_user` on an action you never asked for.

**The fix, structurally.**

1. The `trust` field is **gone from the model's schema**. It cannot be expressed.
2. `src/provenance.ts` (new) rebuilds every model-supplied input field-by-field
   as `untrusted_external` — no object spread, so no model-controlled byte can
   reach `TaskInput.trust`. That is a dataflow property, not a convention.
   Trusted inputs are minted separately from harness-captured user text.
3. Trust arrives through OpenClaw hooks the model cannot invoke or forge
   (`message_received`, `llm_input`, `before_tool_call`), and a tool-call binding
   is **consumed once**.
4. Fail-closed: no anchor ⇒ zero trusted inputs ⇒ rejection.

**Two more instances of the same defect were found and fixed:**

- `orion_permission_change` took its authorizing `instruction` string *from the
  model* — Orion could raise its own permission profile. That parameter is gone;
  the authorizing text now comes from the anchor.
- `desktop_text_{create,append,replace}_confirmed` gated only on a hash the model
  can compute, so an injection during a real turn could rewrite arbitrary Desktop
  `.txt`/`.md`. They now require the user's own words to name the operation and
  the exact target.

**File-write UX** got the same treatment as the earlier `risk`/`verify` fix:
SHA-256 hashes are derived server-side from the bytes actually being written.
The model supplies intent + target + content, nothing ceremonial. Integrity is
unchanged — the hash is still computed and ledgered, just not by the model.

**Plus ~15 real correctness fixes**, the notable ones: a single torn ledger line
used to make `ledger.find` throw forever; task-id collisions could return the
wrong run's status; a permission-state race in read-check-write; corrupt
permission state bricked the tool instead of failing closed to read-only;
`atomicReplace` silently reset file permissions to 0600; and `app_open`/`app_quit`
were advertised in the `approved_root_edit` tier but unreachable — no config flag
existed. Now behind `enableAppControlActions` (default off).

Plugin tests: **26 → 35, all passing.** Three existing tests were edited because
they encoded the insecure behavior — they asserted that a model-computable hash
alone authorizes a Desktop mutation. Version `0.7.0`. Source and the installed
copy at `~/.openclaw/extensions/orion-control` are byte-identical (`diff -rq`).

### Residual gaps — deliberate, and yours to close once verified

1. **`recent` binding** (default on): if `before_tool_call` doesn't fire, the
   newest turn within 120s authorizes. This loosens *which* turn, not *whose
   text*.
2. **`llm_input` source** (default on): the host prompt can carry plugin-injected
   context. Raw channel messages are always preferred when present.
3. Non-mutating actions (Desktop reads, scratch creates) still only require that
   *some* authenticated turn exists. All state-changing Desktop actions now
   require your own words.
4. **Filesystem TOCTOU** remains: a directory component can be swapped between
   the path walk and the `open`. A real fix needs `openat2`/`O_RESOLVE_BENEATH`,
   which Node on macOS doesn't expose. Documented, not fixed.

---

## 4. Orion.app — the native interface (added after the browser UI was rejected)

The browser interface shipped broken, and the cause was mine: `server.py` sent a
`Content-Security-Policy` of `script-src 'self'`, which blocks **inline** scripts.
All the interface JS lived in an inline `<script type="module">` block, so the
browser refused to execute any of it — no hologram, and no way to reach the
gateway. Both reported symptoms, one cause. Fixed by extracting the script to
`orion/interface/app.js` and serving it as a real asset, so the CSP stays strict.
The browser UI now works and is kept as a fallback.

But the interface should not have been a browser tab in the first place, so:

`native/Orion/` — a real menu-bar app. Swift Package Manager, `swift-tools-version 6.0`,
macOS 14+, Apple frameworks only, no third-party dependencies. 16 source files,
~3,060 lines. Bundle id `com.nickmadaio.orion.app`, distinct from OrionCompanion's.

- **Menu-bar resident**, `LSUIElement` / `.accessory` — no Dock icon.
- **Floating non-activating `NSPanel`** so the hologram can sit over other apps
  without stealing focus.
- **Global push-to-talk on Right Option** (keyCode 61, checked alongside the
  `.option` flag since left and right Option share it). Works while any app is
  frontmost. Needs Accessibility; the app detects the absence with
  `AXIsProcessTrustedWithOptions`, shows a banner, and opens the right pane in
  System Settings rather than silently doing nothing.
- **`SFSpeechRecognizer` with `requiresOnDeviceRecognition`** where supported —
  streaming interim transcripts, and local, which is the point of this project.
- **Talks to the TTS daemon directly over the unix socket** in `mode: "stream"`,
  and **plays each chunk the moment its frame arrives** rather than waiting for
  `done`. This is the streaming-playback win that item 5 under "Still open" was
  describing; the native app gets it because it isn't bound by the OpenClaw
  provider's one-file-in-one-file-out contract. Barge-in sends `{"op":"cancel"}`
  on a second connection (the stream connection is parked in a blocking read)
  and stops playback in the same breath.
- **Hologram ported to SwiftUI `Canvas` + `TimelineView`**, preserving the
  Fibonacci distribution, two-pass depth ordering, additive blending, and the
  fast-attack/slow-release level smoothing. Quality defaults to `automatic`: it
  starts at full density and steps down once to a stride-2 subsample if frame
  intervals stay above ~20ms after a 120-frame warmup.

**Verified:** all 16 files have balanced delimiters, the Info.plist parses and
carries the three required usage strings, no secret is referenced anywhere in the
sources, and the other two `native/` packages are untouched.

**NOT verified — and this matters:** *none of it was compiled.* There is no Swift
toolchain in the sandbox this was written from, and AppKit/SwiftUI do not exist
on Linux regardless, so a clean first build is not something anyone has observed.
Expect to fix compile errors. The likeliest candidates, in order:

1. `.swiftLanguageMode(.v5)` in `Package.swift` — if the toolchain rejects it,
   the older spelling is `.swiftLanguageVersion(.v5)` (noted in a comment there).
2. `AVAudioConverter.convert(to:error:withInputFrom:)` in `SpeechOutput` — only
   executes if the daemon renders at something other than 24 kHz mono.
3. `GraphicsContext.Shading` held in an array property.
4. `&context` forwarding into the hologram draw call.

The hologram's **frame budget is unmeasured**, and the visual result of the port
has never been rendered — fidelity to `hologram.js` is by line-by-line
correspondence only.

### Build and run

```bash
cd ~/Desktop/ORION/native/Orion
./make_app_bundle.sh
open .build/Orion.app          # must run from the bundle, not .build/release/Orion
```

It has to run from the `.app` bundle: macOS attaches microphone, speech, and
accessibility permissions to a bundle identity, so a bare executable gets asked
for nothing and then silently does nothing. Ad-hoc signing means macOS may
re-prompt for permissions after each rebuild.

Then grant, in System Settings → Privacy & Security: **Accessibility** (for the
global hotkey), **Microphone**, and **Speech Recognition**.

---

## 5. Two failures found after the first run — both fixed

Orion.app **built cleanly** (28.7s, only `#selector` style warnings). It looked
right and didn't work. Two causes, neither in the Swift.

### `mlx_audio` was never importable — the warm daemon was never warm

From `~/.openclaw/logs/orion-tts.err.log`:

```
warn: mlx-warm unavailable: No module named 'mlx_audio'
warn: mlx-generate-fn unavailable: No module named 'mlx_audio'
warn: engine=mlx-cli (cold model load per chunk)
```

The daemon launched under Homebrew's **python 3.13.14**, which has no
`mlx_audio` in its site-packages. It did exactly what it was designed to do on
failure — degraded and logged — and landed on `mlx-cli`, which spawns a process
and reloads the 250M model **per chunk**. That is precisely the cold-start cost
the entire warm-daemon design exists to remove. Voice worked, so nothing looked
broken. It was just slow, for a reason buried in a log nobody reads.

The launcher's interpreter choice was the bug: it took the first `python3` on
`PATH`. That is not a meaningful answer to "which Python has MLX".

`scripts/orion-python` (new) resolves it properly — the authoritative source is
the **shebang of the `mlx_audio` console script**, since pip writes that line
pointing at the exact interpreter it installed into. It then *verifies* `import
mlx_audio` actually succeeds before selecting, and refuses to pretend otherwise.
`orion-interface` and the LaunchAgent plist both use it, and the launcher now
warns loudly if no interpreter has the module.

**You may still need:** `<that python> -m pip install mlx-audio`. Run
`./scripts/orion-python --why` to see exactly which interpreters were tried.

### Duplicate "Orion" rows in Accessibility — why push-to-talk died

System Settings showed **two identical "Orion" entries**, both toggled on. That
is the ad-hoc signature. `codesign -s -` carries no identity, so macOS falls back
to identifying the app by its cdhash — a hash of the binary. Every rebuild
changes the binary, so every rebuild is a *different application* to TCC. The
grant stays attached to the previous build while the running one has nothing.

`scripts/orion-sign-setup` (new) creates a self-signed code-signing certificate
once. With a real certificate, TCC keys on the certificate instead of the cdhash,
so the grant survives rebuilds. Self-signed is sufficient — this app is never
leaving your Mac, so a paid Developer ID would add nothing.
`make_app_bundle.sh` now uses that identity when present and prints a clear
warning when it falls back to ad-hoc.

### `scripts/orion-doctor` (new)

The real lesson is that a silent degradation cost an afternoon. One command now
reports what is **actually true at runtime** rather than what is configured:
which interpreter, which TTS engine the daemon is *really* using (it asks the
daemon via `{"op":"status"}` rather than trusting config), gateway reachability
plus a live agent turn, bundle signing state, and whether you're running from
`.build` instead of `/Applications`.

```bash
./scripts/orion-doctor
```

### Fix sequence

```bash
cd ~/Desktop/ORION
./scripts/orion-doctor                    # see what is actually wrong

./scripts/orion-sign-setup                # once — stable signing identity
# then remove EVERY existing "Orion" row in
# System Settings -> Privacy & Security -> Accessibility

cd native/Orion && ./make_app_bundle.sh   # should now say "stable identity"
cp -R .build/Orion.app /Applications/
open /Applications/Orion.app              # grant Accessibility once

cd ~/Desktop/ORION && ./scripts/orion-doctor   # expect engine=mlx-warm
```

---

## Do this first, in this order

```bash
# 1. Deploy the hardened plugin
openclaw daemon restart

# 2. Confirm the trust hooks actually fire on your machine.
#    Send Orion one normal message, then run the tool:
#      orion_permission_status
#    Look at `trustProvenance`. You want:
#      channelMessageHookFired: true   retainedTurns >= 1
#    Then run any orion_task_run and check:
#      toolCallHookFired: true         lastBinding: "run"
#
#    If channelMessageHookFired stays false, that channel doesn't emit
#    `message_received` and Orion is running on the weaker `llm_input`
#    fallback. Worth knowing before you tighten anything.

# 3. Warm voice + open the interface
cd ~/Desktop/ORION
./scripts/orion-interface

# 4. Keep the voice daemon alive across reboots
cp native/launchd/com.nickmadaio.orion.tts.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.nickmadaio.orion.tts.plist
```

### Verify — and get the real latency number

```bash
# Cold vs warm, measured rather than assumed.
# First call pays the model load; the second should be dramatically faster.
time ./scripts/orion-local-tts /tmp/a.wav "System check, one."
time ./scripts/orion-local-tts /tmp/b.wav "System check, two."

./scripts/orion-interface --status     # gateway / voice / interface at a glance
cd plugin/orion-control && npm test    # real vitest, expect 35 passing
```

Then in the interface: hold space, ask something current, confirm it searches and
answers; talk over it mid-reply and confirm barge-in cuts it off; ask it to create
a folder on your Desktop and confirm it still flows through the gate.

### Once trust hooks are confirmed firing, tighten

In `~/.openclaw/openclaw.json` under `plugins.entries.orion-control.config`:

```json
{
  "trustAllowPromptSource": false,
  "trustAllowRecentBinding": false,
  "enableAppControlActions": true
}
```

Apply the first two **only after** `orion_permission_status` shows both hooks
firing, or Orion will fail closed on every action.

---

## Still open

1. **Grant OpenClaw Input Monitoring + Accessibility + Microphone**
   (System Settings → Privacy & Security). Still the likely cause of flaky
   push-to-talk in the OpenClaw app. The new interface sidesteps this — it uses
   the browser's own mic permission — but the OpenClaw app itself still needs it.
2. **`orion-mac-bridge` crash** (2026-07-28) — not investigated this session.
3. **Delete `~/Desktop/ORION/.env.save`** — it holds the old dead key. Left in
   place deliberately; deleting your files isn't mine to do.
4. **Capability ladder** (from the previous handoff, unchanged): force-quit →
   system settings → allowlisted shell → app install → credentials via the
   1Password skill. `app_control` is now wired and just needs the flag.
5. **Streaming TTS end-to-end.** The daemon synthesizes sentence-by-sentence, but
   OpenClaw's `tts-local-cli` provider contract is one-file-in-one-file-out, so
   the *provider path* still waits for the joined WAV. The interface bridge is
   where per-sentence streaming playback should land — that's the next real
   latency win after the warm daemon.
6. **STT.** Confirm what OpenClaw is actually using; `openai-whisper`,
   `openai-whisper-api`, and `sherpa-onnx-tts` are all `enabled: false`. The
   interface uses the browser's streaming recognizer, which is fast and free, but
   the OpenClaw-app path is unexamined.
