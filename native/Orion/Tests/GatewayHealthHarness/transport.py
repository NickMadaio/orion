"""Exercise the production URLSession transport against real loopback servers."""
import http.server
import json
import subprocess
import sys
import threading
import time

binary = sys.argv[1]
requests = []
mode = 'ready'
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        requests.append((self.path, dict(self.headers)))
        if mode == 'stalled':
            time.sleep(1)
        if mode == 'redirect':
            self.send_response(302)
            self.send_header('Location', '/redirect-target')
            self.end_headers()
            return
        code = 200
        if mode.startswith('oversized'):
            body = {'ok': True, 'status': 'live'} if self.path == '/healthz' else {'ready': True}
            body['padding'] = 'x' * (128 * 1024)
            data = json.dumps(body).encode()
        elif mode == 'html':
            data = b'<html>UI fallback</html>'
        elif self.path == '/healthz':
            data = b'{"ok":true,"status":"live"}'
        elif mode == 'degraded':
            code, data = 503, b'{"ready":false}'
        else:
            data = b'{"ready":true,"eventLoop":{"degraded":false}}'
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        if mode != 'oversized-stream':
            self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    for mode, expected in [('ready','ready'), ('degraded','degraded'), ('html','unverified'),
                           ('redirect','unverified'), ('stalled','unavailable'),
                           ('oversized','unverified'), ('oversized-stream','unverified'), ('ready','ready')]:
        requests.clear()
        start = time.monotonic()
        result = subprocess.run([binary, '--probe', str(server.server_port)], capture_output=True, text=True, timeout=3)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == expected, (mode, result.stdout)
        assert time.monotonic() - start < 2, 'probe exceeded its bounded deadline'
        assert requests, 'transport fixture was not reached'
        assert all(path in ('/healthz','/readyz') for path, _ in requests), 'redirect followed'
        assert all(not any(k.lower() in ('authorization','cookie') for k in headers) for _, headers in requests)
        print('PASS transport:', mode, '->', expected)
finally:
    server.shutdown()
    server.server_close()
# Closed port must fail, then the next process/check must remain usable.
result = subprocess.run([binary, '--probe', str(server.server_port)], capture_output=True, text=True, timeout=3)
assert result.stdout.strip() == 'unavailable', result.stdout
print('PASS transport: closed port -> unavailable')
