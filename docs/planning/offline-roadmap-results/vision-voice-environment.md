# Vision: Voice, Media, Home, Battery & Meeting Capture

## Baseline
- **Inspected source**: `native/Orion/Sources/SessionService/AudioCoordinator.swift` — audio ownership boundary, clip/music ducking, conversation-spanning lease for Apple Music, crash recovery via persisted duck state. No AVAudioSession configuration here; that lives in the app target.
- **Inspected vision**: `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md` — original roadmap with capability assessments and delivery order.
- **Searched for existing integrations**: `HMHome` (no matches), `ChargeLimit` (no matches), `AVAudioSession` (no matches in committed worktree). HomeKit, battery charge-limit control, and audio-session configuration are not present in the current source tree.
- **Limits**: Report maps existing modules to vision; does not implement new features. Source references beat copied source. Missing source may be dirty-checkout work; recorded as unavailable where found.

## Requirement Matrix
| Req ID | Capability | Source Evidence / Status | Notes |
|--------|------------|--------------------------|-------|
| REQ-VOICE | Voice/Media coexistence & cancellation | **Built**. `AudioCoordinator` in `native/Orion/Sources/SessionService/AudioCoordinator.swift`: clip ducking via `whileSpeaking()`/`beginSpeaking()`/`endSpeaking()`, Apple Music ducking via `beginConversation()`/`endConversation()`, crash recovery via `MusicDuckState`. Ducking (not pausing) by design. `AppleMusicControl.pauseForSession()` exists separately for harder stop. | Audio ownership preserved. Phase 46, 60, 65, 68. |
| REQ-HOME | Device-scoped home adapter/readback/revoke | **Not yet proven**. SEARCH `HMHome` returned no matches in committed worktree. No HomeKit/Matter adapter exists in current source. Vision doc states "Missing connected integration evidence." | Blocker: needs HMHome discovery, device-scoped action binding, state readback, revoke path. Phase 65 area. |
| REQ-BATTERY | Verified OS support or guided settings | **Not yet proven**. SEARCH `ChargeLimit` returned no matches. Vision doc notes macOS Tahoe 26.4+ documents native Charge Limit on Apple-silicon Macs but does not establish a public programmatic API for ORION to change it. | Blocker: inspect model/OS support first; then provide supported narrow operation or guided settings route. No undocumented low-level power-control API. Phase 65 area. |
| REQ-MEETING | Recording state, consent, pause/stop, retention | **Not yet proven**. No recording session management found in committed source. Vision doc states "Missing complete consent-aware workflow." Requires explicit recording state, pause/stop, local retention, transcript provenance, and participant consent handling. | Blocker: needs recording lifecycle, consent gate, retention policy. Phases 20, 65, 71–72. |

## Architecture and Interfaces

### Voice/Media (REQ-VOICE) — existing seam
- **Producer**: `AudioCoordinator` (SessionService) manages clip volume and Apple Music volume. `AppleMusicControl` (ExternalActions) provides the scriptable music backend via retroactive `MusicDucking` conformance.
- **Consumer**: Session phase transitions call `beginConversation()`/`endConversation()` for Music ducking; TTS playback calls `whileSpeaking()`/`beginSpeaking()`/`endSpeaking()` for clip ducking. Home UI and menu use readiness projections separately.
- **Serialized Fields**: `MusicDuckState.State` persists `{ priorVolume: Double }` to `~/.openclaw/orion-music-duck-state.json` for crash recovery. No other durable state in this module.
- **State Ownership**: In-memory reference counters (`speakers`, `conversationHolders`) on dedicated dispatch queues. Music duck state survives crash via JSON file, cleared on successful restore or mismatch. Clip volume is ephemeral per-process.
- **Errors**: Ducking is idempotent and guarded: `duckableVolume()` returns nil if music not playing; restore skips if user changed volume manually (within 0.03 tolerance). Crash recovery restores only if current volume matches expected duck level.

### Home (REQ-HOME) — proposed seam
- **Producer**: Not yet built. Would need HMHome/Matter accessory discovery, device-scoped action binding.
- **Consumer**: Not yet built. Would need readback of actual accessory state and immediate revoke capability.
- **Blocker**: No committed source. Needs reconnaissance: does a dirty checkout contain HomeKit work? If not, this is a new integration requiring user/provider/device gate per vision doc.

### Battery (REQ-BATTERY) — proposed seam
- **Producer**: Not yet built. macOS Tahoe 26.4+ has native Charge Limit UI but no confirmed programmatic API for ORION.
- **Consumer**: Not yet built. Would need OS support verification or guided settings route.
- **Blocker**: No committed source. Needs reconnaissance: inspect target model/OS version, verify if any public API exists, then decide between narrow operation or guided settings link.

### Meeting Capture (REQ-MEETING) — proposed seam
- **Producer**: Not yet built. Would need recording lifecycle with explicit state, consent gate, pause/stop controls.
- **Consumer**: Not yet built. Would need local retention policy, transcript provenance, notes/capture integration.
- **Blocker**: No committed source. Needs reconnaissance: check for any recording-related code in dirty checkout; otherwise new integration requiring participant consent handling before recording.

## Smallest Next Slice

### Slice 1: Voice/Media coexistence proof (REQ-VOICE)
**Status**: Built, needs installed proof.
- **Write paths**: None — source exists in `native/Orion/Sources/SessionService/AudioCoordinator.swift`.
- **Acceptance criteria**:
  1. Clip ducks during TTS playback and restores after.
  2. Apple Music ducks for whole conversation (listening+thinking+speaking) and restores on idle.
  3. Manual volume change by user is respected (no restore if changed).
  4. Crash recovery restores Music volume if still ducked.
- **Dependencies**: Existing `AppleMusicControl`, existing test infrastructure for `AudioCoordinator`.
- **Existing checks**: Native Swift tests for `AudioCoordinator` (not registered in local worker; would need separate registry addition per execution limits).
- **API signatures**: `beginConversation()`, `endConversation()`, `whileSpeaking(_:)`, `reset()`.
- **Escalation**: If Music is not installed or scriptable, ducking is a no-op — acceptable per design.

### Slice 2: Home control adapter (REQ-HOME)
**Status**: Blocker — no source in committed worktree.
- **Blocker**: SEARCH `HMHome` returned zero matches. No HomeKit/Matter integration exists.
- **Reconnaissance needed**: Check dirty checkout for any HomeKit work; if absent, this is a new integration requiring: (a) user gate for HomeKit access, (b) provider decision on Matter vs. HomeKit-only, (c) device-scoped action binding contract, (d) readback and revoke paths.
- **Cannot propose truthful contract** until source exists or dirty-checkout status is confirmed.

### Slice 3: Battery charge limit (REQ-BATTERY)
**Status**: Blocker — no source in committed worktree.
- **Blocker**: SEARCH `ChargeLimit` returned zero matches. No battery control route exists.
- **Reconnaissance needed**: Inspect target Mac model and OS version for Charge Limit support; verify whether any public programmatic API exists (vision doc says none confirmed). If no API, the slice becomes a guided-settings route instead of direct control.
- **Cannot propose truthful contract** until OS/model inspection is done and API availability is determined.

### Slice 4: Meeting capture workflow (REQ-MEETING)
**Status**: Blocker — no source in committed worktree.
- **Blocker**: No recording session management found. SEARCH for recording-related symbols returned nothing.
- **Reconnaissance needed**: Check dirty checkout for any recording code; if absent, this is a new integration requiring: (a) explicit consent gate before recording, (b) recording state machine with pause/stop, (c) local retention policy, (d) transcript provenance tracking, (e) participant consent handling.
- **Cannot propose truthful contract** until source exists or dirty-checkout status is confirmed.

## Test Scenarios

### REQ-VOICE (Voice/Media) — existing source
| Scenario | Type | Seam | Fixture or Installed | Expected State | Product-visible Result |
|----------|------|------|---------------------|----------------|------------------------|
| Music ducks during conversation | Positive | `AudioCoordinator.beginConversation()` → `duckMusicIfPlaying()` | Fixture (unit test with mocked `MusicDucking`) | `musicDuckedFromVolume` set, Music volume at `prior * musicDuckedFraction` | Music quieter but still playing |
| Music restore skipped after user change | Failure/injected | `AudioCoordinator.endConversation()` → `restoreMusicIfWeDuckedIt()` with volume changed by >0.03 | Fixture | `musicDuckedFromVolume` cleared, Music volume unchanged from user's setting | Music stays at user-chosen volume |
| Clip ducks during TTS | Positive | `AudioCoordinator.beginSpeaking()` → `fade()` | Fixture | `ClipPlayer.volume` faded to `unducked * duckedFraction` over 8 steps | Background clip quieter during Orion speech |
| Crash recovery restores Music | Positive | `AudioCoordinator.init()` → `recoverMusicFromCrash()` with persisted state | Fixture | `MusicDuckState` loaded, Music restored to `priorVolume`, state cleared | Music back to pre-Orion volume after restart |

### REQ-HOME (Home control) — no source
| Scenario | Type | Seam | Fixture or Installed | Expected State | Product-visible Result |
|----------|------|------|---------------------|----------------|------------------------|
| Home action without adapter | Failure | N/A — no seam exists | N/A | N/A | Cannot test until adapter built. Blocker recorded. |

### REQ-BATTERY (Battery) — no source
| Scenario | Type | Seam | Fixture or Installed | Expected State | Product-visible Result |
|----------|------|------|---------------------|----------------|------------------------|
| Battery limit check on unsupported OS | Failure | N/A — no seam exists | N/A | N/A | Cannot test until OS inspection done. Blocker recorded. |

### REQ-MEETING (Meeting capture) — no source
| Scenario | Type | Seam | Fixture or Installed | Expected State | Product-visible Result |
|----------|------|------|---------------------|----------------|------------------------|
| Recording without consent | Failure | N/A — no seam exists | N/A | N/A | Cannot test until recording workflow built. Blocker recorded. |

**Note**: REQ-HOME, REQ-BATTERY, and REQ-MEETING have no committed source; their test scenarios are placeholders pending reconnaissance of dirty checkout or new integration contracts. Installed/hardware proof is separate from fixture tests per vision doc requirements.

## Gates and Handoff

### Entry Gate
- Source verification complete for REQ-VOICE (AudioCoordinator inspected).
- Blockers documented for REQ-HOME, REQ-BATTERY, REQ-MEETING (no committed source found).
- Each optional integration requires its own user/provider/device gate per vision doc; none are opened by this report.

### Remaining Hands-on Proof
- **REQ-VOICE**: Installed Mac proof of Music ducking during a live conversation (requires Music installed and scriptable). Native Swift tests exist but are not registered in local worker — would need separate registry addition per execution limits before they become executable checks.
- **REQ-HOME**: Physical HomeKit accessory discovery and action binding test. Simulator insufficient for Matter/HomeKit proof.
- **REQ-BATTERY**: Physical Mac model/OS inspection for Charge Limit support; if API exists, direct control test; otherwise guided-settings route proof.
- **REQ-MEETING**: Physical recording with consent dialog, pause/stop during capture, local file retention verification, transcript provenance check.

### Rollback
- Report-only changes. No source code modified. Revert by deleting or restoring previous version of this Markdown file.

### Reviewer Handoff
1. Verify all source citations point to real files and symbols (`AudioCoordinator`, `MusicDuckState`, `AppleMusicControl`, `MusicDucking` protocol).
2. Confirm REQ-VOICE is genuinely Built (source exists, tests exist natively even if not locally registered).
3. Confirm REQ-HOME/REQ-BATTERY/REQ-MEETING blockers are truthful (SEARCH returned zero matches for `HMHome`, `ChargeLimit`, recording symbols).
4. Verify no phase numbers were renumbered or gates closed by this report.
5. Check that proposed slices have ≤3 write paths and ≤8 acceptance criteria where contracts could be written; blockers are stated where they cannot.
