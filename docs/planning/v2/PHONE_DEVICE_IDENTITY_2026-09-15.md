# Persistent phone device identity

Updated 2026-09-15 14:22 BST. **Local identity adapter: 100%. Physical-device proof and account pairing remain open.**

The app now creates and reloads a platform EC P-256 key and shows its public-key
fingerprint in Control. It exports only the public key. Lookup errors refuse
to load rather than silently creating a replacement. Simulator storage is
explicitly software-backed; physical iOS requires Secure Enclave with no software
fallback. The device key is separate from the temporary read-session credential.

## Proven

- Actual Simulator UI: identity fingerprint survives full app termination/relaunch.
- A fresh challenge is signed and verified; the changed challenge is rejected.
- Final three UI scenarios pass: identity, sample navigation/relaunch and local HTTP stale/outage/recovery/revocation.
- 693 MobileCore checks pass with iOS compilation. Generic physical-iOS target compiles without signing or installation.
- Independent review has no remaining findings. Source/history secret scan clean.
- Mac build 232 remains installed. No Mac permissions, account, remote service or production token changed.

The initial unsigned Simulator build could not access its identity; normal Xcode
ad-hoc signing supplies the Simulator entitlements and the signed run succeeds.
Review also found that successful verification after a failure left the old
failure message visible. Successful verification now restores the correct status.
The broad regression check found a repository-reorganization path missed in
MobileCoreCheck; it now reads its unchanged shared vectors from docs/planning.

## Read the code

- [PhoneDeviceIdentity and Control UI](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/App/OrionMobileApp.swift)
- [Identity relaunch test](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/AppUITests/PhoneShellTests.swift)
- [Run instructions](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/README.md)

The key intentionally remains in the Simulator Keychain. This is not a production
account, pairing proof, biometric approval or remote authority. Key reset/deletion
is not automated, and app removal alone is not claimed to erase Keychain state.
Physical Secure Enclave behavior, device loss and migration are unproven.

Next: bind this public identity into the existing pairing/session contracts, with
explicit approval and durable revocation. No numbered phase or REC gate closes;
formal roadmap remains 45/85 phases marked complete (53%).

Evidence: `.builds/phone-identity-2026-09-15/` and
`.builds/phone-read-check/Logs/Test/Test-OrionPhone-2026.09.15_14-19-29-+0100.xcresult`.
Source checkpoint is local only; no remote push. Reverting it removes the adapter
and UI, but does not claim to erase an existing Simulator key.

![Simulator identity after relaunch](/Users/nickmadaio/Documents/Codex/2026-09-07/af/outputs/orion-phone-device-identity.png)
