"""Voice-ID daemon: a dead client must not hurt other clients or the accept loop."""
import importlib.util
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

_dir = tempfile.mkdtemp()
os.environ["ORION_VOICEID_SOCKET"] = str(Path(_dir) / "v.sock")
os.environ["ORION_VOICEID_PROFILE"] = str(Path(_dir) / "p.json")
_spec = importlib.util.spec_from_file_location(
    "voiceid_daemon", Path(__file__).resolve().parents[1] / "scripts" / "orion_voiceid_daemon.py"
)
daemon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(daemon)


def ask(conn, payload):
    conn.sendall((json.dumps(payload) + "\n").encode())
    data = b""
    while not data.endswith(b"\n"):
        data += conn.recv(4096)
    return json.loads(data)


class SessionTests(unittest.TestCase):
    def test_broken_pipe_on_reply_is_contained(self):
        real = daemon.handle
        daemon.handle = lambda p: (time.sleep(0.3), {"ok": True})[1]
        try:
            a, b = socket.socketpair()
            worker = threading.Thread(target=daemon.session, args=(b,))
            worker.start()
            a.sendall(b'{"op":"ping"}\n')
            a.close()  # client times out before the reply
            worker.join(3)
            self.assertFalse(worker.is_alive())
        finally:
            daemon.handle = real

    def test_slow_client_does_not_block_others(self):
        a1, b1 = socket.socketpair()  # connected but silent
        a2, b2 = socket.socketpair()
        for b in (b1, b2):
            threading.Thread(target=daemon.session, args=(b,), daemon=True).start()
        a2.settimeout(2)
        self.assertTrue(ask(a2, {"op": "ping"})["ok"])
        a1.close()
        a2.close()

    def test_bad_json_returns_error_and_keeps_session(self):
        a, b = socket.socketpair()
        threading.Thread(target=daemon.session, args=(b,), daemon=True).start()
        a.settimeout(2)
        a.sendall(b"not json\n")
        self.assertFalse(json.loads(a.recv(4096))["ok"])
        self.assertTrue(ask(a, {"op": "ping"})["ok"])
        a.close()

    def test_warm_without_model_is_noop(self):
        if not daemon.EMBEDDER.available:
            self.assertEqual(daemon.warm(), 0.0)


if __name__ == "__main__":
    unittest.main()
