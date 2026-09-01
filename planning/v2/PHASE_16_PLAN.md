# ORION v2 Phase 16 — ORION Mobile Foundation

Status: **planned — 2026-08-25**. Phase 15 closed the same day. Nick asked for
16–20.

## What the manifest asks for

The iPhone app, native, Swift and SwiftUI. Five tabs — Today, Plan, ORION,
Health, Control — with ORION interaction central and no attempt to replicate the
desktop. Nine things implemented first: account authentication, ORION
conversation, streaming responses, local secure storage, device identity, device
management, notifications, basic settings, security controls. And explicitly not
yet: Gmail, HealthKit, remote Mac control.

## The constraint, checked before writing anything

**There is no Xcode on this machine — only Command Line Tools.** So:

```
xcrun --sdk iphonesimulator --show-sdk-path   → SDK cannot be located
xcodebuild -version                          → requires Xcode
xcrun simctl list devices                    → simctl is not a developer tool here
```

No iOS SDK means SwiftUI cannot be compiled, an app cannot be built, and no
simulator exists to run one in. It also means `XCTest` and `swift-testing` are
unavailable, because both ship with Xcode.

What *does* work is `swift build` and `swift run` against the macOS toolchain
(Swift 6.3.3). So this phase writes the half of the app that is real Swift,
compiles it, and runs assertions against it — rather than producing a folder of
SwiftUI views nobody can compile and calling it a foundation. Untested code that
looks finished is precisely what the independent review caught last time.

## The shape, which the repository already uses

`native/Orion/Package.swift` already separates `SessionDomain` — "no AppKit, no
SwiftUI, no file I/O, no network — which is what makes it testable... Kept a
separate target rather than a folder so that constraint is enforced by the
compiler instead of by good intentions."

`native/OrionMobile/` follows that exactly: `MobileCore` is the app's brain and
imports nothing platform-specific. When Xcode exists, the SwiftUI layer becomes a
second target that renders this one, and the views are thin because the decisions
already have a home.

## Verification without XCTest

`MobileCoreCheck` is an executable target that asserts and exits non-zero on
failure. Proven to fail before being trusted: a deliberately wrong assertion made
`swift run MobileCoreCheck` exit 1. It is wired into the phase's verification the
same way the Python suite is.

## The nine features, as models

Each is a value type with the decisions in it and the platform at arm's length:

| Feature | What is real here | What waits for the SDK |
|---|---|---|
| account authentication | session state machine, token lifetime, sign-out | the login screen |
| ORION conversation | messages, ids, ordering, roles | the transcript view |
| streaming responses | chunk assembly, cancel, error, completion | the typing animation |
| local secure storage | a port; the default REFUSES | the Keychain adapter |
| device identity | a client that holds a key *reference*, never material | Secure Enclave key generation |
| device management | list, revoke, current-device marking | the settings screen |
| notifications | categories, permission state, delivery record | APNs registration |
| basic settings | a closed key list with typed values | the form |
| security controls | lock, session list, revocation surface | the Security Center screen |

## What is deliberately absent

Gmail, HealthKit and remote Mac control are named in a `deferred` list with the
phase that owns each, and a check asserts no source file mentions them. A "not
yet" that is only in a plan document is a "not yet" until somebody is in a hurry.

## Exit criteria

- A Swift package that compiles with `swift build`.
- Five tabs, ORION central and default, and a check that no desktop-only surface
  appears in the mobile navigation.
- Nine feature models, each exercised by the check runner.
- Secure storage refuses by default rather than falling back to something.
- The deferred three appear nowhere in the source, asserted.
- `swift run MobileCoreCheck` exits 0, and is proven to exit non-zero when an
  assertion fails.
- The Python suites stay green.

## What this phase does NOT do

No SwiftUI, no app bundle, no simulator run, no APNs, no Keychain. Every one of
those needs Xcode, and none of them can be faked convincingly enough to be worth
faking.

---

## Postscript — 2026-08-25, 22:13

**The environment finding above was right about the symptoms and wrong about the
cause.** Xcode 26.6 was installed the whole time; `xcode-select` pointed at
CommandLineTools, so every probe reported no SDK. `DEVELOPER_DIR` overrides it
without sudo.

What that changed, and what it did not:

- **Verified**: MobileCore compiles for the iOS simulator — arm64 and x86_64,
  deployment target 17.0 — with **no source change**, only `.iOS(.v17)` added to
  the platforms line. The discipline this phase was built around held, and the
  compiler was the only thing enforcing it.
- **Now standing**: the iOS build runs on every `orion_v2_mobile_check.sh`, so it
  cannot quietly stop being true. Proven to bite.
- **Unchanged**: there is still no SwiftUI layer and no app. That was an
  environmental impossibility when this plan was written; it is now simply work
  nobody has done, which is a weaker thing and is recorded as such in the gate.
