# Orion.app

A native macOS menu-bar assistant. SwiftUI + AppKit, Swift Package Manager, no
third-party dependencies — Apple frameworks only.

This replaces the browser interface. Same brain, same voice, same hologram; it
just no longer lives in a tab.

## What it is

- **Menu-bar resident.** `LSUIElement` + `.accessory` activation policy: no Dock
  icon, no app menu. The status item carries Show/Hide, gateway and voice
  reachability, Preferences and Quit.
- **A floating hologram panel.** A borderless non-activating `NSPanel` at
  `.floating` level that can appear over any app without stealing focus. The
  hologram is centred, the transcript sits beneath it, and a compact field takes
  typed input.
- **Global push-to-talk on Right Option** (keyCode 61). Hold to talk, release to
  send, from anywhere. Escape stops Orion mid-sentence.
- **Speech in** via `SFSpeechRecognizer`, forced on-device wherever the locale
  supports it. Interim results stream to the panel live.
- **Speech out** by talking to the warm TTS daemon's unix socket directly
  (`~/.openclaw/orion-tts.sock`), not the CLI. Each chunk is played the moment
  its frame arrives instead of waiting for `done`. If the daemon is absent or
  errors before a chunk plays, `AVSpeechSynthesizer` takes over — Orion is never
  mute.
- **Brain** is `openclaw agent --session-key orion-app --json`, run off the main
  thread, parsed the same way `orion/interface/server.py` parses it.

## Build

```sh
cd ~/Desktop/ORION/native/Orion
./make_app_bundle.sh
```

That produces `.build/Orion.app`. To install it:

```sh
cp -R ~/Desktop/ORION/native/Orion/.build/Orion.app /Applications/
open /Applications/Orion.app
```

Run it from the bundle, never from `.build/release/Orion` directly. macOS
attaches microphone, speech and accessibility permissions to a bundle identity;
a bare executable is never granted them and push-to-talk will do nothing.

`swift build -c release` on its own works too if you only want to check that it
compiles.

## Permissions

Three, and Orion will tell you which are missing rather than failing quietly.

### 1. Accessibility — required for Right Option to work everywhere

This one cannot be granted from inside the app. macOS only offers a prompt that
sends you to System Settings; the switch has to be flipped by hand.

1. Launch Orion. If the panel shows a **"Push-to-talk is off"** banner, click
   **Open Accessibility settings** (the menu-bar item **Push-to-talk: grant
   Accessibility…** does the same).
2. Or go there directly:
   *System Settings ▸ Privacy & Security ▸ Accessibility*
3. Add `Orion.app` if it is not listed, then turn its switch **on**.
4. Orion re-checks every two seconds; the banner disappears on its own.

Without it, the global monitor never fires and Right Option only works while the
Orion panel itself is focused.

### 2. Microphone

Prompted the first time you hold Right Option, or on demand from
**Preferences ▸ Ask for microphone and speech now**.
Manually: *System Settings ▸ Privacy & Security ▸ Microphone*.

### 3. Speech Recognition

Prompted alongside the microphone.
Manually: *System Settings ▸ Privacy & Security ▸ Speech Recognition*.

> **After a rebuild** the ad-hoc code signature changes, so macOS may treat the
> app as new and ask again — or, for Accessibility, show a stale entry. If Right
> Option stops working after a rebuild, remove Orion from the Accessibility list
> with the **−** button and add it back.

## Using it

| Action | How |
| --- | --- |
| Talk | Hold **Right Option**, speak, release |
| Interrupt Orion | **Escape**, or just start talking again |
| Type instead | Click the panel's field, Return to send |
| Show / hide the panel | Menu bar ▸ **Show / Hide Orion** (⌘O) |
| Move the panel | Drag it anywhere; the position is remembered |
| Quit | Menu bar ▸ **Quit Orion** (⌘Q) |

The two dots in the panel header are gateway and voice reachability. Gateway is
a TCP connect to `127.0.0.1` on `gateway.port` from `~/.openclaw/openclaw.json`
(default 18789). Voice is a connect to the TTS socket. Both are polled every six
seconds and refreshed whenever the menu opens.

## What it depends on

Everything already exists and runs; Orion.app only talks to it.

| Thing | Path |
| --- | --- |
| Agent CLI | `/Users/nickmadaio/.openclaw/bin/openclaw` |
| Gateway config (only `gateway.port` is read) | `/Users/nickmadaio/.openclaw/openclaw.json` |
| Warm TTS daemon socket | `/Users/nickmadaio/.openclaw/orion-tts.sock` |

No credentials are read, logged or copied by this app. The CLI holds its own.

## Hologram

`HologramModel.swift` is a port of `orion/interface/hologram.js` and keeps its
choices intact: Fibonacci-sphere point distribution, two-pass depth rendering
with the core glow drawn between the far and near hemispheres, additive
blending, ~1500 radial filaments (14% of them spikes), 46 broken latitude arcs,
260 circuit chips, 3 tilted orbital great-circles, 150 motes, a white-hot core
with an anamorphic lens streak, and the fast-attack/slow-release level smoothing
that makes speech transients snap the core bright.

Geometry is built once. The draw path allocates only its three gradients and
reuses a precomputed colour ramp for the ~2000 per-element strokes.

**Detail** in Preferences:

- **Automatic** (default) — starts at full detail and steps down once, to half
  the element count, if the measured frame interval stays worse than ~50fps.
- **High** — full detail, pinned.
- **Balanced** — half detail, pinned.

The step-down subsamples the golden-angle sequence rather than truncating it, so
the shell thins evenly instead of opening a seam at a pole.

## Layout

```
Package.swift
Resources/Info.plist          LSUIElement + the two usage strings
make_app_bundle.sh            builds .build/Orion.app
Sources/Orion/
  main.swift                  entry point, .accessory policy
  AppDelegate.swift           wiring only
  AppState.swift              phase machine, conversation, status polling
  MenuBarController.swift     NSStatusItem + menu
  PanelController.swift       the non-activating floating NSPanel
  PanelView.swift             the panel's SwiftUI content
  PreferencesWindow.swift     preferences window + view
  HologramModel.swift         geometry, simulation, draw
  HologramView.swift          TimelineView(.animation) + Canvas
  PushToTalk.swift            global + local Right Option monitors
  SpeechInput.swift           SFSpeechRecognizer + mic tap
  SpeechOutput.swift          chunk queue, playback tap, fallback voice
  TTSClient.swift             NDJSON over the unix socket
  GatewayClient.swift         openclaw subprocess + reply parsing
  Permissions.swift           accessibility checks, settings deep links
  AudioLevel.swift            shared RMS → 0..1
```

`native/OrionCompanion` and `native/OrionMacBridge` are separate binaries and
are untouched by this package.
