# Gate 1 — the audio experiment

Status: **closed on the built-in route.** Bluetooth is deferred to Gate 4 with a
stated prediction — see the end of this document.

The plan asks for "built-in and the actual Bluetooth route". Built-in is done and
conclusive. Bluetooth is not, and holding the gate open for it was the wrong
call: Nick has headsets paired (AirPods Pro, Sony WH-1000XM4) but was not using
one, and nothing between here and Gate 4 plays binaural audio. Gate 4 is the
first gate where the answer changes any code, and it is also the first point
where "does this sound right" — which only Nick can answer — is a real question.
So the measurement belongs there, taken opportunistically whenever he happens to
have headphones on, not manufactured at 3am against a route he is not using.

Harness: `native/Orion/Tests/run-audio-matrix.sh`. Re-run it whenever
`SpeechOutput` or a future `AudioCoordinator` changes.

---

## The claim under test

`SpeechOutput.swift:50-64` asserts that a running `AVAudioEngine` pins the shared
output device to 24 kHz mono and drags the rest of the Mac down with it. That
assertion is load-bearing: it is the stated reason for `releaseDevice()`, the
1.5 s timer that tears the engine down after every reply.

The plan restated this as a *missing* `mainMixerNode → outputNode` connection.
**That is not what the code does.** `SpeechOutput.swift:244` makes an explicit
connection, `player → mainMixerNode`, at a **hardcoded 24 kHz mono float32**
format, and `outputNode` is never referenced anywhere in the app. So the
experiment tested the real graph, not the described one.

## Method

Measured with **CoreAudio**, not with `AVAudioEngine`. The claim is about the
device every process shares; `engine.outputNode.outputFormat` reports only the
engine's own end of the pipe and says nothing at all once the engine stops.

Nominal sample rate and channel count read for both output and input at eight
points per run, with two things live throughout, because Nick's pass criterion
is that both work *at the same time*:

- a 48 kHz stereo fixture (440 Hz left, 880 Hz right) playing from a **separate**
  `AVAudioEngine` — standing in for the binaural clip, and for "the rest of the
  Mac" the claim is about;
- **microphone capture live** with a tap, standing in for the wake word.

Two frequencies rather than one panned tone: identical tones would survive a
mono collapse looking identical.

## Result — built-in speakers

Device: MacBook Pro Speakers, 48000 Hz, 2 ch. **Accepted rates: 44100, 48000,
88200, 96000.**

> **24 kHz is not in the list. The built-in output device cannot be pinned to
> 24 kHz by anything, because it does not accept 24 kHz.** That half of the
> hypothesis is refuted before any graph is built.

All three candidates, with stereo playing and the microphone live:

| Candidate | Device through run | Mic buffers | Chunk conversion |
|---|---|---|---|
| **A** — ships today: `player → mainMixer` @ 24 kHz mono | 48000 Hz 2 ch, steady | 54 | **none** |
| **B** — `player → outputNode` @ file format | 48000 Hz 2 ch, steady | 54 | none |
| **C** — `nil` connect + explicit mixer→output + change handling | 48000 Hz 2 ch, steady | 54 | **required, 24000/1 → 44100/2** |

Every candidate returned the device to baseline. Nothing stayed degraded.

### Two findings beyond the headline

**C is worse than A, measurably.** Connecting the player with `format: nil` did
**not** make it track the device. It resolved to **44100/2** — AVAudioEngine's
generic default — while the output node ran at 48000. So C adds a hidden second
resample (24k → 44.1k → 48k) that A does not have, and it moves resampling from
the mixer into our code on every chunk. This is exactly the responsibility
transfer the plan's review warned about, now with a number attached.

**C also crashes if you take the plan literally.** With a `nil` connect the
player adopts the hardware format, so scheduling a 24 kHz mono buffer on it
raises an NSException rather than being resampled. C is implementable — 
`SpeechOutput.swift:286-306` already has a converter — but only by adding
conversion the current graph does not need.

**B carries exactly one source.** `outputNode` has a single input bus, so a
second player cannot join it. B cannot serve binaural and TTS from one engine.

## Decision for the built-in route

**Make no change.** Candidate A — what ships today — passes every criterion:
stereo stayed stereo, the device held its rate and channel count, the microphone
kept delivering throughout, and nothing was left degraded. A passing baseline
was an allowed outcome and it is the outcome.

`releaseDevice()`'s 1.5 s timer is **not** solving the problem its comment
claims, at least not on this device. **It is deliberately left in place** —
removing it is a separate change with its own risk, it is not required by any
gate, and the Bluetooth run may yet justify it. The comment should be corrected
when something next touches that file.

## Deferred to Gate 4: the Bluetooth route, and a prediction

It is the interesting one, and it is worth writing the prediction down now so the
measurement can confirm or kill it rather than being interpreted after the fact.

A Bluetooth headset has two profiles: **A2DP**, stereo and high rate, no
microphone; and **HFP**, which has a microphone and is **mono at a low rate**.
Opening the mic on a headset that is *also* the output device forces the whole
link into HFP — stereo collapses to mono, the rate drops, and music turns to
mud. That is the exact symptom `SpeechOutput.swift:50-64` describes, and it is
far more likely to be what was actually observed than anything `AVAudioEngine`
did to the graph.

If that is what happens, **no output graph fixes it**, and the honest options are:

1. **Keep input on the built-in microphone while output goes to Bluetooth.**
   macOS allows split devices. This preserves both halves of Nick's requirement
   and is the outcome to aim for.
2. Prohibit wake-word capture during binaural playback on Bluetooth, and **say
   so in the UI** rather than silently sounding wrong.

The harness already reports the input device, the output device, and whether
they are the same physical device, and prints a note explaining what to watch
when they are. Running it with a headset connected is one command and about
thirty seconds:

```
./Tests/run-audio-matrix.sh --candidate A
```

**Do this at Gate 4**, whenever Nick happens to have the AirPods or the Sony
XM4s on. It does not need to be scheduled and it does not block anything before
then. If the prediction holds, Gate 4 ships split-device selection; if it does
not, Gate 4 ships unchanged and this section becomes a note about a theory that
turned out to be wrong.

---

## Note: a permission changed during this gate

Microphone authorization for the terminal read `notDetermined` (status 0) during
the first run and `authorized` from the second run onward. **Nothing in the
harness calls `requestAccess`** — it only reads `authorizationStatus` and skips
capture when not authorised. The change came from outside this process.

Recorded because it is a real permission change on Nick's machine that he should
know about, and because it means run 1 of candidate A did not test the wake-word
half. Candidate A was re-run afterwards with capture live; that is the result in
the table.
