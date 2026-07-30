"""Tests for the ORION TTS daemon and its thin client.

Everything here runs on any platform: no MLX, no /usr/bin/say, no audio
hardware. The two modules are structured so all the logic that decides how
fast and how correctly ORION speaks -- sentence splitting, chunking, WAV
joining, the socket protocol, the queue, cancellation, and fallback selection
-- is importable and testable without the model.

Run:
    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import orion_tts_client as client  # noqa: E402
import orion_tts_daemon as daemon  # noqa: E402


def wav(seconds: float = 0.05, rate: int = 24000, value: int = 0) -> bytes:
    frames = int(rate * seconds)
    pcm = value.to_bytes(2, "little", signed=True) * frames
    return daemon.wav_bytes_from_pcm(pcm, rate)


# ---------------------------------------------------------------------------
# Sentence splitting
# ---------------------------------------------------------------------------


class SplitSentencesTests(unittest.TestCase):
    def test_plain_sentences(self):
        self.assertEqual(
            daemon.split_sentences("One. Two! Three?"),
            ["One.", "Two!", "Three?"],
        )

    def test_empty_and_whitespace(self):
        for value in ("", "   ", "\n\n", "\t \n"):
            self.assertEqual(daemon.split_sentences(value), [], repr(value))

    def test_no_trailing_punctuation(self):
        self.assertEqual(
            daemon.split_sentences("no trailing punctuation here"),
            ["no trailing punctuation here"],
        )

    def test_trailing_fragment_is_kept(self):
        self.assertEqual(
            daemon.split_sentences("Done. And then"),
            ["Done.", "And then"],
        )

    def test_titles_never_split(self):
        text = "Dr. Smith met Mr. Blake at St. Louis."
        self.assertEqual(daemon.split_sentences(text), [text])

    def test_initials_never_split(self):
        text = "J. R. R. Tolkien wrote it."
        self.assertEqual(daemon.split_sentences(text), [text])

    def test_common_words_that_are_also_abbreviations_do_split(self):
        # Regression: "no." and "sat." are in the abbreviation list, but they
        # are ordinary words too. A capitalised next word means a real break.
        self.assertEqual(
            daemon.split_sentences("The answer is no. Let me explain."),
            ["The answer is no.", "Let me explain."],
        )
        self.assertEqual(
            daemon.split_sentences("He sat. Then he left."),
            ["He sat.", "Then he left."],
        )

    def test_contextual_abbreviation_followed_by_lowercase_or_digit(self):
        text = "See fig. 4 and no. 7 for details."
        self.assertEqual(daemon.split_sentences(text), [text])

    def test_decimals_stay_intact(self):
        self.assertEqual(
            daemon.split_sentences("Pi is 3.14159 and e is 2.718. Enough."),
            ["Pi is 3.14159 and e is 2.718.", "Enough."],
        )

    def test_ellipsis(self):
        self.assertEqual(
            daemon.split_sentences("Wait... I think so."),
            ["Wait...", "I think so."],
        )

    def test_unicode_ellipsis(self):
        self.assertEqual(
            daemon.split_sentences("Hmm… maybe."),
            ["Hmm…", "maybe."],
        )

    def test_quotes_stay_with_their_sentence(self):
        self.assertEqual(
            daemon.split_sentences('"Stop," she said. "Now."'),
            ['"Stop," she said.', '"Now."'],
        )

    def test_dotted_acronym(self):
        self.assertEqual(
            daemon.split_sentences("I live in the U.S.A. It is big."),
            ["I live in the U.S.A.", "It is big."],
        )
        self.assertEqual(
            daemon.split_sentences("Use a tool, e.g. a hammer, next time."),
            ["Use a tool, e.g. a hammer, next time."],
        )

    def test_paragraph_break_is_a_hard_boundary(self):
        self.assertEqual(
            daemon.split_sentences("First para\n\nSecond para"),
            ["First para", "Second para"],
        )

    def test_no_characters_are_lost(self):
        text = (
            "All systems online. Dr. Reyes called at 4.30 about no. 12; "
            "she said \"call back\". Shall I?"
        )
        joined = " ".join(daemon.split_sentences(text))
        self.assertEqual(joined.replace(" ", ""), text.replace(" ", ""))

    def test_multiple_terminators_collapse_into_one_sentence(self):
        self.assertEqual(
            daemon.split_sentences("Really?! Yes."),
            ["Really?!", "Yes."],
        )


class AbbreviationKindTests(unittest.TestCase):
    def test_title(self):
        text = "Dr. Smith"
        self.assertEqual(daemon.abbreviation_kind(text, 2), daemon.ALWAYS)

    def test_initial(self):
        text = "A. Smith"
        self.assertEqual(daemon.abbreviation_kind(text, 1), daemon.ALWAYS)

    def test_context(self):
        text = "etc. and"
        self.assertEqual(daemon.abbreviation_kind(text, 3), daemon.CONTEXT)

    def test_ordinary_word(self):
        text = "house. Next"
        self.assertEqual(daemon.abbreviation_kind(text, 5), daemon.NOT_ABBREV)

    def test_bare_ellipsis_is_not_an_abbreviation(self):
        text = "... yes"
        self.assertEqual(daemon.abbreviation_kind(text, 2), daemon.NOT_ABBREV)


class StartsNewSentenceTests(unittest.TestCase):
    def test_uppercase(self):
        self.assertTrue(daemon.starts_new_sentence("no. Later", 3))

    def test_lowercase(self):
        self.assertFalse(daemon.starts_new_sentence("no. later", 3))

    def test_digit(self):
        self.assertFalse(daemon.starts_new_sentence("no. 7", 3))

    def test_end_of_text(self):
        self.assertTrue(daemon.starts_new_sentence("no.", 3))

    def test_skips_opening_quote(self):
        self.assertTrue(daemon.starts_new_sentence('no. "Later"', 3))


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


class ChunkTextTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(daemon.chunk_text(""), [])
        self.assertEqual(daemon.chunk_text("   \n  "), [])

    def test_first_chunk_is_smaller_than_the_rest(self):
        text = " ".join(f"Sentence number {n}." for n in range(1, 20))
        chunks = daemon.chunk_text(text, first_max=40, max_chars=160)
        self.assertGreater(len(chunks), 1)
        self.assertLessEqual(len(chunks[0]), 60)
        self.assertGreater(max(len(c) for c in chunks[1:]), len(chunks[0]))

    def test_no_words_are_lost(self):
        text = (
            "All systems are online. I have finished the review of your "
            "calendar and there is one conflict tomorrow afternoon. "
            "Shall I move it?"
        )
        chunks = daemon.chunk_text(text, first_max=40, max_chars=90)
        self.assertEqual(" ".join(chunks).split(), text.split())

    def test_long_sentence_is_broken_on_soft_boundaries(self):
        text = (
            "I checked the calendar, the mail, and the reminders; "
            "nothing else needs you today, so you are clear until three."
        )
        chunks = daemon.chunk_text(text, first_max=45, max_chars=60)
        self.assertTrue(all(len(c) <= 75 for c in chunks), chunks)
        self.assertEqual(" ".join(chunks).split(), text.split())

    def test_single_unbroken_run_is_split_on_words(self):
        text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet"
        chunks = daemon.chunk_text(text, first_max=20, max_chars=20)
        self.assertTrue(all(len(c) <= 25 for c in chunks), chunks)
        self.assertEqual(" ".join(chunks).split(), text.split())

    def test_short_text_is_one_chunk(self):
        self.assertEqual(daemon.chunk_text("Online."), ["Online."])

    def test_chunks_are_never_blank(self):
        chunks = daemon.chunk_text("Hi.   \n\n   There.  ")
        self.assertTrue(all(c.strip() for c in chunks))
        self.assertEqual(chunks, ["Hi. There."])


# ---------------------------------------------------------------------------
# WAV helpers
# ---------------------------------------------------------------------------


class WavTests(unittest.TestCase):
    def test_roundtrip(self):
        data = wav(0.1)
        params, frames = daemon.read_wav(data)
        self.assertEqual(params, (1, 2, 24000))
        self.assertEqual(len(frames), 2 * int(24000 * 0.1))

    def test_duration(self):
        self.assertAlmostEqual(daemon.wav_duration_ms(wav(0.25)), 250, delta=2)

    def test_join_single_chunk_without_gap_is_identity(self):
        data = wav(0.05)
        self.assertEqual(daemon.join_wav_bytes([data], gap_ms=0), data)

    def test_join_adds_gaps(self):
        chunks = [wav(0.1), wav(0.1)]
        joined = daemon.join_wav_bytes(chunks, gap_ms=100)
        self.assertAlmostEqual(daemon.wav_duration_ms(joined), 300, delta=5)

    def test_join_rejects_mismatched_formats(self):
        with self.assertRaises(daemon.WavMismatch):
            daemon.join_wav_bytes([wav(0.05, rate=24000), wav(0.05, rate=16000)])

    def test_join_rejects_empty(self):
        with self.assertRaises(ValueError):
            daemon.join_wav_bytes([])

    def test_pcm16_from_bytes_is_passthrough(self):
        self.assertEqual(daemon.pcm16_from_audio(b"\x01\x02"), b"\x01\x02")

    def test_pcm16_from_floats_scales_and_clips(self):
        pcm = daemon.pcm16_from_audio([0.0, 1.0, -1.0, 2.0])
        values = [
            int.from_bytes(pcm[i : i + 2], "little", signed=True)
            for i in range(0, len(pcm), 2)
        ]
        self.assertEqual(values[0], 0)
        self.assertEqual(values[1], 32767)
        self.assertEqual(values[2], -32767)
        self.assertEqual(values[3], 32767)


class AtomicWriteTests(unittest.TestCase):
    def test_never_leaves_an_audio_extension_behind(self):
        # OpenClaw's tts-local-cli provider scans the output directory for ANY
        # audio file, so a half-written *.wav would be picked up as the reply.
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "speech.wav")
            daemon._atomic_write(target, wav(0.02))
            names = os.listdir(tmp)
            self.assertEqual(names, ["speech.wav"])
            self.assertTrue(client.looks_like_wav(target))

    def test_creates_missing_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "a", "b", "speech.wav")
            daemon._atomic_write(target, wav(0.02))
            self.assertTrue(os.path.exists(target))


# ---------------------------------------------------------------------------
# Engines / fallback selection
# ---------------------------------------------------------------------------


class StubEngine(daemon.Engine):
    """Engine that fabricates audio, optionally slowly or by failing."""

    name = "stub"

    def __init__(self, delay: float = 0.0, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail
        self.calls: list[tuple[str, str, float]] = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.release.set()

    def synth(self, text, voice, speed, cancel):
        self.calls.append((text, voice, speed))
        self.started.set()
        if self.fail:
            raise daemon.EngineError("stub failure")
        deadline = time.monotonic() + self.delay
        while True:
            # Cancel is checked first on every pass, including the pass where
            # the release fires, so "cancelled and released at the same time"
            # is decided in favour of cancellation -- same ordering the real
            # MLX engine uses between generated segments.
            if cancel.is_set():
                raise daemon.Cancelled("cancelled in stub")
            if time.monotonic() >= deadline and self.release.is_set():
                break
            time.sleep(0.005)
        return wav(0.02)


def make_config(**overrides) -> daemon.Config:
    config = daemon.Config()
    config.warmup = False
    config.cache_entries = 0
    config.gap_ms = 0
    config.first_chunk_chars = 40
    config.chunk_chars = 120
    for key, value in overrides.items():
        setattr(config, key, value)
    return config


class EngineSelectionTests(unittest.TestCase):
    def test_explicit_say_preference_short_circuits(self):
        engine = daemon.build_engine(make_config(engine_pref="say"))
        self.assertIsInstance(engine, daemon.SayEngine)

    def test_auto_falls_all_the_way_down_to_say(self):
        # No MLX here, and the CLI path points at nothing executable.
        config = make_config(
            engine_pref="auto",
            model_path="/nonexistent/model",
            mlx_cli="/nonexistent/mlx_audio.tts.generate",
        )
        self.assertIsInstance(daemon.build_engine(config), daemon.SayEngine)

    def test_failing_engine_degrades_per_chunk(self):
        config = make_config()
        synth = daemon.Synthesizer(config, StubEngine(fail=True))
        fallback = StubEngine()
        synth.fallback = fallback
        data, cached = synth._synth_chunk("hello", "v", 1.0, threading.Event())
        self.assertFalse(cached)
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(len(fallback.calls), 1)

    def test_warmup_failure_demotes_the_engine(self):
        config = make_config(warmup=True, warmup_text="hi")
        synth = daemon.Synthesizer(config, StubEngine(fail=True))
        synth.warmup()
        self.assertIsInstance(synth.engine, daemon.SayEngine)

    def test_speed_defaults_to_natural_rate(self):
        # The original script hard-coded 0.94; 1.0 must be the default now.
        env_backup = os.environ.pop("ORION_TTS_SPEED", None)
        try:
            self.assertEqual(daemon.Config().speed, 1.0)
        finally:
            if env_backup is not None:
                os.environ["ORION_TTS_SPEED"] = env_backup

    def test_speed_and_voice_are_env_tunable(self):
        os.environ["ORION_TTS_SPEED"] = "1.15"
        os.environ["ORION_TTS_VOICE"] = "conversational_a"
        try:
            config = daemon.Config()
            self.assertAlmostEqual(config.speed, 1.15)
            self.assertEqual(config.voice, "conversational_a")
        finally:
            os.environ.pop("ORION_TTS_SPEED", None)
            os.environ.pop("ORION_TTS_VOICE", None)


class ChunkCacheTests(unittest.TestCase):
    def test_hit_and_miss(self):
        cache = daemon.ChunkCache(2)
        self.assertIsNone(cache.get("a", "v", 1.0))
        cache.put("a", "v", 1.0, b"A")
        self.assertEqual(cache.get("a", "v", 1.0), b"A")
        self.assertEqual((cache.hits, cache.misses), (1, 1))

    def test_speed_and_voice_are_part_of_the_key(self):
        cache = daemon.ChunkCache(4)
        cache.put("a", "v1", 1.0, b"A")
        self.assertIsNone(cache.get("a", "v2", 1.0))
        self.assertIsNone(cache.get("a", "v1", 0.9))

    def test_lru_eviction(self):
        cache = daemon.ChunkCache(2)
        cache.put("a", "v", 1.0, b"A")
        cache.put("b", "v", 1.0, b"B")
        cache.get("a", "v", 1.0)
        cache.put("c", "v", 1.0, b"C")
        self.assertIsNone(cache.get("b", "v", 1.0))
        self.assertEqual(cache.get("a", "v", 1.0), b"A")

    def test_zero_capacity_disables_the_cache(self):
        cache = daemon.ChunkCache(0)
        cache.put("a", "v", 1.0, b"A")
        self.assertIsNone(cache.get("a", "v", 1.0))

    def test_repeated_chunk_is_served_from_cache(self):
        config = make_config(cache_entries=8)
        engine = StubEngine()
        synth = daemon.Synthesizer(config, engine)
        cancel = threading.Event()
        synth._synth_chunk("Yes.", "v", 1.0, cancel)
        _, cached = synth._synth_chunk("Yes.", "v", 1.0, cancel)
        self.assertTrue(cached)
        self.assertEqual(len(engine.calls), 1)


# ---------------------------------------------------------------------------
# Synthesizer: requests, queue, cancellation
# ---------------------------------------------------------------------------


class SynthesizerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def out(self, name: str = "speech.wav") -> str:
        return os.path.join(self.tmp.name, name)

    def run_job(self, synth, request):
        frames: list[dict] = []
        synth.run(request, frames.append)
        return frames

    def test_file_mode_writes_a_joined_wav(self):
        synth = daemon.Synthesizer(make_config(), StubEngine())
        output = self.out()
        frames = self.run_job(
            synth,
            {"op": "synth", "text": "One. Two. Three.", "output": output},
        )
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0]["ok"], frames)
        self.assertTrue(client.looks_like_wav(output))
        self.assertGreaterEqual(frames[0]["chunks"], 1)

    def test_empty_text_is_rejected_without_synthesis(self):
        engine = StubEngine()
        synth = daemon.Synthesizer(make_config(), engine)
        frames = self.run_job(
            synth, {"op": "synth", "text": "   ", "output": self.out()}
        )
        self.assertFalse(frames[0]["ok"])
        self.assertEqual(frames[0]["code"], "empty_text")
        self.assertEqual(engine.calls, [])

    def test_file_mode_requires_an_output_path(self):
        synth = daemon.Synthesizer(make_config(), StubEngine())
        frames = self.run_job(synth, {"op": "synth", "text": "Hello."})
        self.assertEqual(frames[0]["code"], "no_output")

    def test_stream_mode_emits_a_chunk_frame_per_chunk_then_done(self):
        config = make_config(runtime_dir=os.path.join(self.tmp.name, "rt"))
        synth = daemon.Synthesizer(config, StubEngine())
        frames = self.run_job(
            synth,
            {
                "op": "synth",
                "mode": "stream",
                "text": "One sentence here. Another sentence here. A third.",
                "id": "s1",
            },
        )
        chunk_frames = [f for f in frames if f.get("event") == "chunk"]
        self.assertGreaterEqual(len(chunk_frames), 2)
        for index, frame in enumerate(chunk_frames):
            self.assertEqual(frame["index"], index)
            self.assertTrue(client.looks_like_wav(frame["path"]))
        self.assertEqual(frames[-1]["event"], "done")
        self.assertTrue(frames[-1]["ok"])
        self.assertEqual(frames[-1]["chunks"], len(chunk_frames))

    def test_stream_mode_base64_encoding(self):
        import base64

        synth = daemon.Synthesizer(make_config(), StubEngine())
        frames = self.run_job(
            synth,
            {"op": "synth", "mode": "stream", "encode": "base64", "text": "Hi."},
        )
        chunk = next(f for f in frames if f.get("event") == "chunk")
        self.assertTrue(base64.b64decode(chunk["audio_b64"]).startswith(b"RIFF"))

    def test_queue_full_is_reported_rather_than_queued_forever(self):
        engine = StubEngine()
        engine.release.clear()
        synth = daemon.Synthesizer(make_config(queue_max=1), engine)
        blocker = threading.Thread(
            target=self.run_job,
            args=(synth, {"op": "synth", "text": "Long one.", "output": self.out("a.wav")}),
            daemon=True,
        )
        blocker.start()
        self.assertTrue(engine.started.wait(2.0))
        try:
            frames = self.run_job(
                synth, {"op": "synth", "text": "Second.", "output": self.out("b.wav")}
            )
            self.assertFalse(frames[0]["ok"])
            self.assertEqual(frames[0]["code"], "queue_full")
        finally:
            engine.release.set()
            blocker.join(5)
        self.assertFalse(blocker.is_alive())

    def test_slot_is_released_after_every_request(self):
        synth = daemon.Synthesizer(make_config(queue_max=1), StubEngine())
        for index in range(3):
            frames = self.run_job(
                synth,
                {"op": "synth", "text": "Hello.", "output": self.out(f"{index}.wav")},
            )
            self.assertTrue(frames[0]["ok"], frames)
        self.assertEqual(synth.registry.active(), 0)

    def test_cancel_stops_an_in_flight_job(self):
        engine = StubEngine()
        engine.release.clear()
        synth = daemon.Synthesizer(make_config(), engine)
        frames: list[dict] = []
        worker = threading.Thread(
            target=synth.run,
            args=(
                {"op": "synth", "id": "j1", "text": "Speak.", "output": self.out()},
                frames.append,
            ),
            daemon=True,
        )
        worker.start()
        self.addCleanup(engine.release.set)
        self.assertTrue(engine.started.wait(2.0))
        # No release: the only thing that can end this job is the cancel.
        cancelled = synth.registry.cancel("j1")
        worker.join(5)
        self.assertFalse(worker.is_alive(), "cancel must unblock the job")
        self.assertEqual(cancelled, ["j1"])
        self.assertEqual(frames[-1]["code"], "cancelled")
        self.assertFalse(frames[-1]["ok"])
        self.assertFalse(os.path.exists(self.out()))

    def test_cancel_all_targets_every_job(self):
        registry = daemon.Registry()
        a, b = daemon.Job("a", "x"), daemon.Job("b", "y")
        registry.add(a)
        registry.add(b)
        self.assertEqual(sorted(registry.cancel()), ["a", "b"])
        self.assertTrue(a.cancel.is_set() and b.cancel.is_set())

    def test_cancel_unknown_id_is_a_no_op(self):
        registry = daemon.Registry()
        registry.add(daemon.Job("a", "x"))
        self.assertEqual(registry.cancel("nope"), [])

    def test_preempt_cancels_the_other_jobs_barge_in(self):
        engine = StubEngine()
        engine.release.clear()
        synth = daemon.Synthesizer(make_config(queue_max=4), engine)
        first: list[dict] = []
        worker = threading.Thread(
            target=synth.run,
            args=(
                {"op": "synth", "id": "old", "text": "Old reply.", "output": self.out("old.wav")},
                first.append,
            ),
            daemon=True,
        )
        worker.start()
        self.assertTrue(engine.started.wait(2.0))

        second: list[dict] = []
        interrupt = threading.Thread(
            target=synth.run,
            args=(
                {
                    "op": "synth",
                    "id": "new",
                    "text": "New reply.",
                    "output": self.out("new.wav"),
                    "preempt": True,
                },
                second.append,
            ),
            daemon=True,
        )
        interrupt.start()
        # The old job must notice the cancel even while the new one waits.
        for _ in range(200):
            if first:
                break
            time.sleep(0.01)
        engine.release.set()
        worker.join(5)
        interrupt.join(5)
        self.assertEqual(first[-1]["code"], "cancelled")
        self.assertTrue(second[-1]["ok"], second)

    def test_deadline_without_partial_fails_fast(self):
        engine = StubEngine(delay=1.0)
        synth = daemon.Synthesizer(make_config(first_chunk_chars=16, chunk_chars=16), engine)
        frames = self.run_job(
            synth,
            {
                "op": "synth",
                "text": "One two three. Four five six. Seven eight nine.",
                "output": self.out(),
                "deadline_ms": 60,
            },
        )
        self.assertFalse(frames[0]["ok"])
        self.assertIn(frames[0]["code"], ("error", "cancelled"))

    def test_stats_snapshot_counts_successes(self):
        synth = daemon.Synthesizer(make_config(), StubEngine())
        self.run_job(synth, {"op": "synth", "text": "Hi.", "output": self.out()})
        snapshot = synth.stats.snapshot()
        self.assertEqual(snapshot["served"], 1)
        self.assertIn("avg_first_chunk_ms", snapshot)


# ---------------------------------------------------------------------------
# Server dispatch over a real unix socket
# ---------------------------------------------------------------------------


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = make_config(
            socket_path=os.path.join(self.tmp.name, "tts.sock"),
            runtime_dir=os.path.join(self.tmp.name, "rt"),
        )
        self.engine = StubEngine()
        self.synth = daemon.Synthesizer(self.config, self.engine)
        self.server = daemon.Server(self.config, self.synth)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            probe = client.connect(self.config.socket_path, 0.1)
            if probe is not None:
                probe.close()
                break
            time.sleep(0.01)
        else:  # pragma: no cover - only on a broken box
            self.fail("daemon socket never started accepting")

    def stop_server(self):
        self.server.stop_event.set()
        self.thread.join(5)

    def request(self, payload: dict, expect: int = 1) -> list[dict]:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(self.config.socket_path)
        try:
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            frames = []
            for frame in client.iter_frames(sock, time.monotonic() + 5):
                frames.append(frame)
                if len(frames) >= expect and client.is_terminal(frame):
                    break
            return frames
        finally:
            sock.close()

    def test_ping(self):
        frames = self.request({"op": "ping"})
        self.assertTrue(frames[0]["ok"])
        self.assertTrue(frames[0]["pong"])

    def test_status_reports_engine_and_speed(self):
        frames = self.request({"op": "status"})
        self.assertEqual(frames[0]["engine"], "stub")
        self.assertEqual(frames[0]["speed"], self.config.speed)

    def test_unknown_op(self):
        frames = self.request({"op": "nope"})
        self.assertEqual(frames[0]["code"], "bad_op")

    def test_bad_json_does_not_kill_the_connection(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(self.config.socket_path)
        try:
            sock.sendall(b"{not json}\n")
            sock.sendall(b'{"op":"ping"}\n')
            frames = []
            for frame in client.iter_frames(sock, time.monotonic() + 5):
                frames.append(frame)
                if len(frames) == 2:
                    break
            self.assertEqual(frames[0]["code"], "bad_json")
            self.assertTrue(frames[1]["pong"])
        finally:
            sock.close()

    def test_non_object_request_is_rejected(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(self.config.socket_path)
        try:
            sock.sendall(b"[1,2,3]\n")
            frame = next(iter(client.iter_frames(sock, time.monotonic() + 5)))
            self.assertEqual(frame["code"], "bad_request")
        finally:
            sock.close()

    def test_two_requests_on_one_connection(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(self.config.socket_path)
        try:
            sock.sendall(b'{"op":"ping"}\n{"op":"ping"}\n')
            frames = []
            for frame in client.iter_frames(sock, time.monotonic() + 5):
                frames.append(frame)
                if len(frames) == 2:
                    break
            self.assertEqual(len(frames), 2)
        finally:
            sock.close()

    def test_synth_over_the_socket(self):
        output = os.path.join(self.tmp.name, "speech.wav")
        frames = self.request(
            {"op": "synth", "text": "Hello there. All good.", "output": output}
        )
        self.assertTrue(frames[-1]["ok"], frames)
        self.assertTrue(client.looks_like_wav(output))

    def test_cancel_op_reports_the_ids_it_stopped(self):
        frames = self.request({"op": "cancel"})
        self.assertTrue(frames[0]["ok"])
        self.assertEqual(frames[0]["cancelled"], [])

    def test_socket_path_is_published_only_once_it_accepts(self):
        # Regression: bind() creates the file, listen() makes it usable. If the
        # daemon published the path between the two, an autostarting client
        # would poll, see the file, connect, and get ECONNREFUSED.
        leftovers = [
            name for name in os.listdir(self.tmp.name) if name.endswith(".new")
        ]
        self.assertEqual(leftovers, [])
        self.assertTrue(os.path.exists(self.config.socket_path))
        for _ in range(25):
            sock = client.connect(self.config.socket_path, 0.5)
            self.assertIsNotNone(sock)
            sock.close()

    def test_probe_detects_a_live_daemon(self):
        self.assertTrue(daemon._probe(self.config.socket_path))

    def test_probe_on_a_dead_path(self):
        self.assertFalse(daemon._probe(os.path.join(self.tmp.name, "nope.sock")))


# ---------------------------------------------------------------------------
# Client: protocol framing
# ---------------------------------------------------------------------------


class FramingTests(unittest.TestCase):
    def setUp(self):
        self.a, self.b = socket.socketpair()
        self.addCleanup(self.a.close)
        self.addCleanup(self.b.close)

    def frames(self, timeout: float = 2.0):
        return list(client.iter_frames(self.a, time.monotonic() + timeout))

    def test_multiple_frames_in_one_packet(self):
        self.b.sendall(b'{"a":1}\n{"a":2}\n')
        self.b.close()
        self.assertEqual(self.frames(), [{"a": 1}, {"a": 2}])

    def test_frame_split_across_packets(self):
        self.b.sendall(b'{"ok":tr')
        time.sleep(0.05)
        self.b.sendall(b'ue,"id":"x"}\n')
        self.b.close()
        self.assertEqual(self.frames(), [{"ok": True, "id": "x"}])

    def test_trailing_frame_without_a_newline(self):
        self.b.sendall(b'{"ok":true}')
        self.b.close()
        self.assertEqual(self.frames(), [{"ok": True}])

    def test_blank_lines_and_garbage_are_skipped(self):
        self.b.sendall(b'\n\nnot json\n{"ok":true}\n')
        self.b.close()
        self.assertEqual(self.frames(), [{"ok": True}])

    def test_non_object_json_is_skipped(self):
        self.b.sendall(b'[1,2]\n"str"\n{"ok":false}\n')
        self.b.close()
        self.assertEqual(self.frames(), [{"ok": False}])

    def test_unicode_survives(self):
        self.b.sendall('{"text":"café — ok"}\n'.encode("utf-8"))
        self.b.close()
        self.assertEqual(self.frames(), [{"text": "café — ok"}])

    def test_deadline_raises_rather_than_hanging(self):
        started = time.monotonic()
        with self.assertRaises(TimeoutError):
            list(client.iter_frames(self.a, time.monotonic() + 0.2))
        self.assertLess(time.monotonic() - started, 2.0)

    def test_is_terminal(self):
        self.assertTrue(client.is_terminal({"ok": True}))
        self.assertTrue(client.is_terminal({"ok": False, "code": "queue_full"}))
        self.assertTrue(client.is_terminal({"event": "done", "ok": True}))
        self.assertFalse(client.is_terminal({"event": "chunk", "index": 0}))
        self.assertFalse(client.is_terminal({"note": "progress"}))


# ---------------------------------------------------------------------------
# Client: end-to-end against a scripted fake daemon
# ---------------------------------------------------------------------------


class FakeDaemon:
    """Minimal NDJSON server that replays a scripted reply per request."""

    def __init__(self, socket_path: str, handler):
        self.socket_path = socket_path
        self.handler = handler
        self.requests: list[dict] = []
        self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._sock.bind(socket_path)
        self._sock.listen(8)
        self._sock.settimeout(0.2)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except OSError:
                continue
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        buffer = b""
        conn.settimeout(2.0)
        with conn:
            while not self._stop.is_set():
                try:
                    data = conn.recv(65536)
                except OSError:
                    return
                if not data:
                    return
                buffer += data
                while b"\n" in buffer:
                    raw, buffer = buffer.split(b"\n", 1)
                    if not raw.strip():
                        continue
                    request = json.loads(raw)
                    self.requests.append(request)
                    for reply in self.handler(request) or []:
                        conn.sendall((json.dumps(reply) + "\n").encode("utf-8"))

    def close(self):
        self._stop.set()
        try:
            self._sock.close()
        except OSError:
            pass
        try:
            os.unlink(self.socket_path)
        except OSError:
            pass


class ClientSpeakTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.socket_path = os.path.join(self.tmp.name, "tts.sock")
        self.output = os.path.join(self.tmp.name, "speech.wav")

    def options(self, **overrides) -> client.Options:
        env = {
            "ORION_TTS_SOCKET": self.socket_path,
            "ORION_TTS_AUTOSTART": "0",
            "ORION_TTS_CLIENT_BUDGET_MS": "2000",
            "ORION_TTS_FALLBACK_RESERVE_MS": "200",
            "ORION_TTS_CLIENT_LOG": os.path.join(self.tmp.name, "client.log"),
        }
        env.update(overrides)
        return client.Options(env)

    def serve(self, handler) -> FakeDaemon:
        fake = FakeDaemon(self.socket_path, handler)
        self.addCleanup(fake.close)
        return fake

    def test_happy_path_writes_audio_and_exits_zero(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(wav(0.05))
            return [{"ok": True, "id": request["id"], "engine": "mlx-warm",
                     "chunks": 2, "ms": 210}]

        fake = self.serve(handler)
        code = client.speak(self.output, "Hello there.", self.options())
        self.assertEqual(code, client.EXIT_OK)
        self.assertTrue(client.looks_like_wav(self.output))
        self.assertEqual(fake.requests[0]["op"], "synth")
        self.assertEqual(fake.requests[0]["mode"], "file")
        self.assertEqual(fake.requests[0]["text"], "Hello there.")
        self.assertGreater(fake.requests[0]["deadline_ms"], 0)

    def test_chunk_frames_before_the_result_are_ignored(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(wav(0.05))
            return [
                {"event": "chunk", "id": request["id"], "index": 0},
                {"event": "chunk", "id": request["id"], "index": 1},
                {"ok": True, "id": request["id"], "chunks": 2},
            ]

        self.serve(handler)
        self.assertEqual(
            client.speak(self.output, "One. Two.", self.options()), client.EXIT_OK
        )

    def test_daemon_error_falls_back(self):
        self.serve(lambda r: [{"ok": False, "id": r["id"], "code": "queue_full",
                               "error": "queue full"}])
        self.assertEqual(
            client.speak(self.output, "Hi.", self.options()), client.EXIT_FALLBACK
        )

    def test_ok_without_a_real_wav_falls_back(self):
        self.serve(lambda r: [{"ok": True, "id": r["id"]}])
        self.assertEqual(
            client.speak(self.output, "Hi.", self.options()), client.EXIT_FALLBACK
        )
        self.assertFalse(os.path.exists(self.output))

    def test_truncated_output_is_rejected(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(b"RIFF" + b"\x00" * 8)
            return [{"ok": True, "id": request["id"]}]

        self.serve(handler)
        self.assertEqual(
            client.speak(self.output, "Hi.", self.options()), client.EXIT_FALLBACK
        )

    def test_silent_daemon_times_out_into_the_fallback(self):
        self.serve(lambda r: [])
        started = time.monotonic()
        code = client.speak(self.output, "Hi.", self.options())
        elapsed = time.monotonic() - started
        self.assertEqual(code, client.EXIT_FALLBACK)
        self.assertLess(elapsed, 3.0, "client must not outlive its budget")

    def test_daemon_that_hangs_up_falls_back(self):
        def handler(request):
            raise SystemExit  # closes the connection without a reply

        fake = FakeDaemon(self.socket_path, handler)
        self.addCleanup(fake.close)
        self.assertEqual(
            client.speak(self.output, "Hi.", self.options()), client.EXIT_FALLBACK
        )

    def test_no_daemon_and_no_autostart_falls_back_immediately(self):
        started = time.monotonic()
        code = client.speak(self.output, "Hi.", self.options())
        self.assertEqual(code, client.EXIT_FALLBACK)
        self.assertLess(time.monotonic() - started, 1.0)

    def test_autostart_failure_still_falls_back_within_budget(self):
        options = self.options(
            ORION_TTS_AUTOSTART="1",
            ORION_TTS_DAEMON=os.path.join(self.tmp.name, "missing_daemon.py"),
            ORION_TTS_START_WAIT_MS="200",
        )
        started = time.monotonic()
        self.assertEqual(
            client.speak(self.output, "Hi.", options), client.EXIT_FALLBACK
        )
        self.assertLess(time.monotonic() - started, 2.0)

    def test_empty_text_falls_back_without_touching_the_socket(self):
        fake = self.serve(lambda r: [{"ok": True, "id": r["id"]}])
        self.assertEqual(
            client.speak(self.output, "   ", self.options()), client.EXIT_FALLBACK
        )
        self.assertEqual(fake.requests, [])

    def test_voice_and_speed_are_forwarded_when_set(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(wav(0.05))
            return [{"ok": True, "id": request["id"]}]

        fake = self.serve(handler)
        options = self.options(ORION_TTS_VOICE="conversational_a",
                               ORION_TTS_SPEED="1.1")
        client.speak(self.output, "Hi.", options)
        self.assertEqual(fake.requests[0]["voice"], "conversational_a")
        self.assertAlmostEqual(fake.requests[0]["speed"], 1.1)

    def test_no_preempt_by_default(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(wav(0.05))
            return [{"ok": True, "id": request["id"]}]

        fake = self.serve(handler)
        client.speak(self.output, "Hi.", self.options())
        self.assertNotIn("preempt", fake.requests[0])

    def test_preempt_opt_in_for_barge_in(self):
        def handler(request):
            with open(request["output"], "wb") as handle:
                handle.write(wav(0.05))
            return [{"ok": True, "id": request["id"]}]

        fake = self.serve(handler)
        client.speak(self.output, "Hi.", self.options(ORION_TTS_PREEMPT="1"))
        self.assertTrue(fake.requests[0]["preempt"])

    def test_abandoned_job_is_cancelled_so_it_cannot_clobber_say_output(self):
        seen: list[dict] = []

        def handler(request):
            seen.append(request)
            if request.get("op") == "cancel":
                return [{"ok": True, "cancelled": [request.get("id")]}]
            return []  # never answers the synth request

        self.serve(handler)
        client.speak(self.output, "Hi.", self.options())
        ops = [r.get("op") for r in seen]
        self.assertIn("cancel", ops)
        self.assertEqual(seen[0]["id"], seen[-1]["id"])


class ClientHelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_looks_like_wav(self):
        good = os.path.join(self.tmp.name, "good.wav")
        with open(good, "wb") as handle:
            handle.write(wav(0.05))
        self.assertTrue(client.looks_like_wav(good))

        bad = os.path.join(self.tmp.name, "bad.wav")
        with open(bad, "wb") as handle:
            handle.write(b"not audio at all, definitely not a wav file header")
        self.assertFalse(client.looks_like_wav(bad))
        self.assertFalse(client.looks_like_wav(os.path.join(self.tmp.name, "nope")))

    def test_connect_returns_none_instead_of_raising(self):
        self.assertIsNone(
            client.connect(os.path.join(self.tmp.name, "absent.sock"), 0.1)
        )

    def test_start_lock_is_claimed_once(self):
        path = os.path.join(self.tmp.name, "tts.sock")
        self.assertTrue(client.claim_start_lock(path))
        self.assertFalse(client.claim_start_lock(path))

    def test_stale_start_lock_is_reclaimed(self):
        path = os.path.join(self.tmp.name, "tts.sock")
        self.assertTrue(client.claim_start_lock(path))
        old = time.time() - 600
        os.utime(path + ".start", (old, old))
        self.assertTrue(client.claim_start_lock(path, ttl_s=90))

    def test_daemon_python_prefers_explicit_override(self):
        options = client.Options({"ORION_TTS_PYTHON": "/opt/py/bin/python3"})
        self.assertEqual(client.resolve_daemon_python(options), "/opt/py/bin/python3")

    def test_daemon_python_is_read_from_the_mlx_console_script_shebang(self):
        cli = os.path.join(self.tmp.name, "mlx_audio.tts.generate")
        with open(cli, "w", encoding="utf-8") as handle:
            handle.write(f"#!{sys.executable}\nprint('hi')\n")
        os.chmod(cli, 0o755)
        options = client.Options({"ORION_TTS_MLX_CLI": cli})
        self.assertEqual(client.resolve_daemon_python(options), sys.executable)

    def test_daemon_python_falls_back_to_path(self):
        options = client.Options({"ORION_TTS_MLX_CLI": "/nonexistent/mlx"})
        resolved = client.resolve_daemon_python(options)
        self.assertTrue(os.access(resolved, os.X_OK), resolved)

    def test_options_defaults(self):
        options = client.Options({})
        self.assertEqual(options.budget_ms, 6000)
        self.assertTrue(options.autostart)
        self.assertFalse(options.preempt)
        self.assertTrue(options.socket_path.endswith("orion-tts.sock"))

    def test_usage_exit_code(self):
        self.assertEqual(client.main([]), client.EXIT_USAGE)
        self.assertEqual(client.main(["only-one"]), client.EXIT_USAGE)

    def test_client_logging_never_records_the_spoken_text(self):
        log_path = os.path.join(self.tmp.name, "client.log")
        options = client.Options({
            "ORION_TTS_SOCKET": os.path.join(self.tmp.name, "absent.sock"),
            "ORION_TTS_AUTOSTART": "0",
            "ORION_TTS_CLIENT_LOG": log_path,
        })
        secret = "my private diary entry"
        client.speak(os.path.join(self.tmp.name, "o.wav"), secret, options)
        with open(log_path, encoding="utf-8") as handle:
            contents = handle.read()
        self.assertNotIn(secret, contents)
        self.assertIn("say fallback", contents)


# ---------------------------------------------------------------------------
# Shipped configuration
# ---------------------------------------------------------------------------


class ShippedFilesTests(unittest.TestCase):
    def test_wrapper_is_executable_and_keeps_the_cli_contract(self):
        wrapper = REPO_ROOT / "scripts" / "orion-local-tts"
        self.assertTrue(os.access(wrapper, os.X_OK), "orion-local-tts must be +x")
        body = wrapper.read_text(encoding="utf-8")
        self.assertIn("exit 64", body)
        self.assertIn("/usr/bin/say", body)
        self.assertIn("--data-format=LEI16@24000", body)
        self.assertNotIn("--speed 0.94", body)

    def test_launch_agent_plist_is_valid(self):
        import plistlib

        path = REPO_ROOT / "native" / "launchd" / "com.nickmadaio.orion.tts.plist"
        with open(path, "rb") as handle:
            data = plistlib.load(handle)
        self.assertEqual(data["Label"], "com.nickmadaio.orion.tts")
        self.assertTrue(data["RunAtLoad"])
        self.assertTrue(data["KeepAlive"])
        self.assertTrue(data["StandardOutPath"].endswith(".log"))
        self.assertIn("/.openclaw/logs/", data["StandardOutPath"])
        self.assertIn("/.openclaw/logs/", data["StandardErrorPath"])
        self.assertEqual(data["EnvironmentVariables"]["ORION_TTS_SPEED"], "1.0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
