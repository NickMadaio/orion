#!/usr/bin/env python3
"""
ORION — speaker verification. Wake for Nick, not for the room.

WHAT THIS IS, AND IS NOT

It is an annoyance filter. A television, a podcast, a video call and a flatmate
all say words, and some of them say "Orion". This decides whether the voice that
just triggered the wake word sounds like the person who enrolled it, and drops
the wake if it does not.

It is NOT a security boundary, and nothing should be built on top of it as if it
were. Voices can be recorded and replayed, and a good impressionist beats it.
Anyone treating a similarity score as authentication is going to be disappointed
in an interesting way. Push-to-talk is deliberately never gated by this: the key
is the trusted path, this is the convenient one.

DESIGN NOTES

* Runs as its own daemon on a unix socket, mirroring `orion_tts_daemon.py`,
  because loading an embedding model per wake word would cost more than the wake
  word saves. One load, then ~10ms per verification.

* Fails OPEN. If the daemon is down or the model missing, the wake word behaves
  exactly as it did before this existed. Failing closed would make Orion
  silently deaf for a reason invisible from the outside, which is the specific
  failure mode this project keeps producing. The app logs and shows the
  degraded state instead.

* The threshold is measured, not guessed. Enrolment records several samples,
  computes how similar they are to each other, and sets the bar below the
  observed spread. A number I invented would be wrong on his microphone, in his
  room, with his voice.

PROTOCOL — one JSON object per line, over the socket

    {"op":"ping"}                          -> {"ok":true,"enrolled":bool,...}
    {"op":"enroll","audio":"<b64 f32le>","rate":16000}
    {"op":"finalize"}                      -> writes the profile, returns threshold
    {"op":"verify","audio":"<b64 f32le>","rate":16000}
                                           -> {"ok":true,"match":bool,"score":0.0}
    {"op":"reset"}                         -> forget the enrolled profile
"""

from __future__ import annotations

import base64
import json
import math
import os
import signal
import socket
import sys
import threading
import time
from pathlib import Path

HOME = Path.home()
SOCKET_PATH = Path(
    os.environ.get("ORION_VOICEID_SOCKET", HOME / ".openclaw" / "orion-voiceid.sock")
)
PROFILE_PATH = Path(
    os.environ.get("ORION_VOICEID_PROFILE", HOME / ".openclaw" / "orion-voiceid.json")
)

# A wake word is short. Anything under this is noise, not a voice, and scoring it
# produces confident nonsense.
MIN_SECONDS = 0.35

# How far below the enrolled spread the bar sits. Enrolment measures how much
# his own samples vary; the threshold is the mean minus this many standard
# deviations, so a cold or a different room does not lock him out.
THRESHOLD_SIGMA = 2.0
# Never accept a bar outside this range however the measurement lands. The low
# end stops a degenerate enrolment from accepting everything; the high end stops
# an unusually consistent one from rejecting him on an off day.
THRESHOLD_FLOOR = 0.45
THRESHOLD_CEILING = 0.88


# --------------------------------------------------------------- embedding

class Embedder:
    """
    Turns audio into a vector where 'same speaker' means 'similar direction'.

    Requires `resemblyzer` — a pretrained speaker encoder. There is deliberately
    no dependency-free fallback, and that is worth explaining because writing
    one was the obvious move.

    A fallback WAS written: log-mel and MFCC summaries compared by cosine, no
    dependencies, about eighty lines. Tested against synthetic voices it scored
    0.999 for the enrolled speaker, 0.928 for a very different one, and **0.996
    for a similar one** — a margin of 0.004, which is noise. It would have woken
    for almost anybody while producing confident-looking scores and a plausible
    threshold.

    That is the exact failure this project keeps paying for: a component that
    reports success while doing nothing. Shipping it as "basic speaker ID" would
    have been worse than shipping nothing, because nothing is at least visible.

    So: no encoder, no verification, and the app is told plainly so it can leave
    the wake word ungated and say why.

        pip install resemblyzer
    """

    def __init__(self) -> None:
        self.name = "none"
        self.detail = ""
        self._encoder = None
        try:
            from resemblyzer import VoiceEncoder  # type: ignore

            self._encoder = VoiceEncoder(verbose=False)
            self.name = "resemblyzer"
        except ImportError:
            self.detail = "resemblyzer is not installed (pip install resemblyzer)"
        except Exception as error:  # noqa: BLE001
            self.detail = f"resemblyzer failed to load: {error}"

    @property
    def available(self) -> bool:
        return self._encoder is not None

    def embed(self, samples, rate: int):
        import numpy as np
        from resemblyzer import preprocess_wav  # type: ignore

        wav = preprocess_wav(samples.astype("float32"), source_sr=rate)
        return np.asarray(self._encoder.embed_utterance(wav), dtype="float64")


def cosine(a, b) -> float:
    import numpy as np

    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ------------------------------------------------------------------ state

class Profile:
    def __init__(self) -> None:
        self.vectors: list[list[float]] = []
        self.threshold: float = THRESHOLD_FLOOR
        self.embedder_name: str = "none"
        self.enrolled_at: float = 0.0
        self.load()

    def load(self) -> None:
        try:
            data = json.loads(PROFILE_PATH.read_text())
            self.vectors = data.get("vectors", [])
            self.threshold = float(data.get("threshold", THRESHOLD_FLOOR))
            self.embedder_name = data.get("embedder", "none")
            self.enrolled_at = float(data.get("enrolledAt", 0))
        except Exception:
            self.vectors = []

    def save(self) -> None:
        PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        PROFILE_PATH.write_text(
            json.dumps(
                {
                    "vectors": self.vectors,
                    "threshold": self.threshold,
                    "embedder": self.embedder_name,
                    "enrolledAt": self.enrolled_at,
                },
                indent=2,
            )
        )
        os.chmod(PROFILE_PATH, 0o600)

    @property
    def enrolled(self) -> bool:
        return len(self.vectors) >= 2

    def score(self, vector) -> float:
        """Best match against any enrolled sample.

        Max rather than mean: he enrols in a few different ways — close to the
        mic, leaning back, half-asleep — and a mean would punish the variety
        that makes the profile robust in the first place.
        """
        import numpy as np

        if not self.vectors:
            return 0.0
        return max(cosine(np.asarray(v), vector) for v in self.vectors)

    def calibrate(self) -> float:
        """Set the bar from how much his own samples differ from each other."""
        import numpy as np

        if len(self.vectors) < 2:
            self.threshold = THRESHOLD_FLOOR
            return self.threshold
        sims = []
        for i in range(len(self.vectors)):
            for j in range(i + 1, len(self.vectors)):
                sims.append(cosine(np.asarray(self.vectors[i]), np.asarray(self.vectors[j])))
        mean = float(np.mean(sims))
        spread = float(np.std(sims)) if len(sims) > 1 else 0.05
        raw = mean - THRESHOLD_SIGMA * max(spread, 0.02)
        self.threshold = max(THRESHOLD_FLOOR, min(THRESHOLD_CEILING, raw))
        return self.threshold


# ----------------------------------------------------------------- server

EMBEDDER = Embedder()
PROFILE = Profile()
PENDING: list = []
LOCK = threading.Lock()


def decode(payload: dict):
    import numpy as np

    raw = base64.b64decode(payload.get("audio", ""))
    return np.frombuffer(raw, dtype="<f4").astype("float64"), int(payload.get("rate", 16000))


def handle(payload: dict) -> dict:
    op = payload.get("op")

    if op == "ping":
        return {
            "ok": True,
            "embedder": EMBEDDER.name,
            "detail": EMBEDDER.detail,
            "usable": EMBEDDER.available,
            "enrolled": PROFILE.enrolled,
            "samples": len(PROFILE.vectors),
            "threshold": round(PROFILE.threshold, 3),
        }

    if op == "reset":
        with LOCK:
            PENDING.clear()
            PROFILE.vectors = []
            PROFILE.enrolled_at = 0.0
            PROFILE.save()
        return {"ok": True, "enrolled": False}

    if not EMBEDDER.available:
        # Explicitly NOT a rejection. Callers treat this as "cannot verify" and
        # let the wake through, because a voice filter that fails closed makes
        # Orion mysteriously deaf.
        return {
            "ok": False,
            "error": EMBEDDER.detail or "no speaker encoder available",
            "canVerify": False,
        }

    if op in ("enroll", "verify"):
        samples, rate = decode(payload)
        if samples.size < MIN_SECONDS * rate:
            return {"ok": False, "error": "too short", "seconds": samples.size / rate}
        vector = EMBEDDER.embed(samples, rate)

        if op == "enroll":
            with LOCK:
                PENDING.append([float(x) for x in vector])
            return {"ok": True, "collected": len(PENDING)}

        with LOCK:
            if not PROFILE.enrolled:
                # Nothing to compare against: say so rather than inventing a
                # verdict. The app treats this as "not enrolled" and lets the
                # wake word through.
                return {"ok": True, "match": True, "score": 1.0, "enrolled": False}
            score = PROFILE.score(vector)
            return {
                "ok": True,
                "enrolled": True,
                "match": score >= PROFILE.threshold,
                "score": round(score, 4),
                "threshold": round(PROFILE.threshold, 4),
            }

    if op == "finalize":
        with LOCK:
            if len(PENDING) < 2:
                return {"ok": False, "error": "need at least 2 samples"}
            PROFILE.vectors = list(PENDING)
            PROFILE.embedder_name = EMBEDDER.name
            PROFILE.enrolled_at = time.time()
            threshold = PROFILE.calibrate()
            PROFILE.save()
            PENDING.clear()
        return {
            "ok": True,
            "enrolled": True,
            "samples": len(PROFILE.vectors),
            "threshold": round(threshold, 4),
            "embedder": PROFILE.embedder_name,
        }

    return {"ok": False, "error": f"unknown op {op!r}"}


def serve() -> None:
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(SOCKET_PATH))
    os.chmod(SOCKET_PATH, 0o600)
    server.listen(8)
    print(
        f"orion-voiceid: listening on {SOCKET_PATH} "
        f"(embedder={EMBEDDER.name}, enrolled={PROFILE.enrolled})",
        flush=True,
    )
    # Say why, not just what. "embedder=none" on its own sent this round in
    # circles: the install reported success, the daemon reported no model, and
    # the reason was sitting in a variable nobody printed.
    if not EMBEDDER.available:
        print(f"orion-voiceid: NO SPEAKER MODEL -> {EMBEDDER.detail}", flush=True)
        print(f"orion-voiceid: interpreter = {sys.executable}", flush=True)
        print(f"orion-voiceid: python {sys.version.split()[0]}", flush=True)

    while True:
        conn, _ = server.accept()
        threading.Thread(target=session, args=(conn,), daemon=True).start()


def session(conn: socket.socket) -> None:
    with conn:
        buffer = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    response = handle(json.loads(line))
                except Exception as error:  # noqa: BLE001
                    response = {"ok": False, "error": str(error)}
                conn.sendall((json.dumps(response) + "\n").encode())


if __name__ == "__main__":
    # Same reasoning as the TTS daemon: nohup sets SIGHUP to ignore and a
    # handler of our own would undo that, killing the daemon when the terminal
    # that started it closes.
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    try:
        serve()
    except KeyboardInterrupt:
        sys.exit(0)
