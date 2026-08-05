#!/usr/bin/env python3
"""
Record enrolment samples and hand them to the voice daemon.

A REAL FILE, not a heredoc piped into `python3 -`.

That distinction is the whole reason this exists. When the script arrives on
stdin, stdin is the script — so the first `input()` prompt gets EOF immediately
and enrolment dies before the user is ever asked to speak:

    [1/6] press return, then say "Orion"…
    EOFError: EOF when reading a line

Run as a file, stdin stays the terminal and `input()` works.

Exits non-zero on any failure so the caller can tell. The shell around this
previously printed "done — restart Orion" regardless of outcome.
"""

import base64, json, socket, sys, time
import sounddevice as sd  # type: ignore
import numpy as np

sock_path = sys.argv[1]
RATE, SECONDS, SAMPLES = 16000, 2.0, 6

def call(payload):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(20)
    s.connect(sock_path)
    s.sendall((json.dumps(payload) + "\n").encode())
    buf = b""
    while b"\n" not in buf:
        part = s.recv(65536)
        if not part: break
        buf += part
    s.close()
    return json.loads(buf.split(b"\n")[0])

def describe_input():
    """Which microphone is this actually about to use?"""
    try:
        index = sd.default.device[0]
        info = sd.query_devices(index if index is not None and index >= 0 else None, "input")
        return f"{info['name']} ({int(info['default_samplerate'])} Hz)"
    except Exception:
        return "unknown input device"


print(f"  Recording from: {describe_input()}\n")

def flush_input():
    """Throw away anything typed while we were busy.

    Pressing return during a recording leaves the keystroke in the buffer, so
    the NEXT prompt returns instantly and records two seconds of someone who is
    not speaking yet. That is what produced a run of "heard almost nothing"
    immediately after a sample that worked perfectly.
    """
    try:
        import termios
        termios.tcflush(sys.stdin, termios.TCIFLUSH)
    except Exception:
        pass


def record_one(index, total):
    """Prompt, record, and report the peak. Returns the audio or None."""
    flush_input()
    input(f"  [{index}/{total}] press return, then say \"Orion\"… ")
    # Say GO after the prompt returns, not before. The old version started
    # recording the instant return was pressed with no indication, so the first
    # half-second was reliably silence.
    print("        ● recording — say it now", end="", flush=True)
    rec = sd.rec(int(RATE * SECONDS), samplerate=RATE, channels=1, dtype="float32")
    sd.wait()
    audio = rec.flatten()
    peak = float(np.abs(audio).max())
    print(f"\r        {' ' * 32}\r", end="")
    return audio, peak


call({"op": "reset"})

collected = 0
attempts = 0
silent_run = 0
# A while loop, not `for i in range(SAMPLES)`: a silent take used to consume one
# of the six attempts, so a couple of stumbles left too few samples to enrol
# with. Retries no longer cost a slot.
while collected < SAMPLES and attempts < SAMPLES * 3:
    attempts += 1
    audio, peak = record_one(collected + 1, SAMPLES)

    if peak < 0.02:
        silent_run += 1
        print(f"        heard almost nothing (peak {peak:.4f}) — let's retry that one")
        if silent_run >= 3:
            print()
            print("  The microphone is returning silence to this program.")
            print()
            print("  If mic access is already granted, the usual causes are:")
            print("    - speaking before the '● recording' line appears")
            print("    - another app holding the microphone (Orion itself, a call)")
            print("    - the wrong input device selected in Sound settings")
            print()
            print(f"  Input device: {describe_input()}")
            sys.exit(1)
        continue

    silent_run = 0
    reply = call({
        "op": "enroll",
        "audio": base64.b64encode(audio.astype("<f4").tobytes()).decode(),
        "rate": RATE,
    })
    if not reply.get("ok"):
        print(f"        rejected: {reply.get('error')}")
        continue
    collected += 1
    print(f"        got it ({collected}/{SAMPLES})  peak {peak:.2f}")

final = call({"op": "finalize"})
if not final.get("ok"):
    print(f"\n  could not finish: {final.get('error')}")
    sys.exit(1)

print(f"\n  Enrolled {final['samples']} samples.")
print(f"  Acceptance bar measured at {final['threshold']:.3f} using {final['embedder']}.")
print("\n  Now say \"Orion\" once more to check it recognises you:")
rec, _peak = record_one(1, 1)
check = call({
    "op": "verify",
    "audio": base64.b64encode(rec.astype("<f4").tobytes()).decode(),
    "rate": RATE,
})
mark = "recognised" if check.get("match") else "NOT recognised"
print(f"  -> {mark}  (score {check.get('score')}, bar {check.get('threshold')})")
if not check.get("match"):
    print("     Run this again and vary the samples more, or the bar is too high.")
