import Foundation

if CommandLine.arguments.count > 2, CommandLine.arguments[1] == "--probe" {
    let port = Int(CommandLine.arguments[2])!
    let snapshot = GatewayHealthProbe.check(port: port, timeout: 0.3)
    print(snapshot.availability.rawValue)
    exit(0)
}
var checks = 0
func expect(_ value: @autoclosure () -> Bool, _ name: String) {
    checks += 1
    if !value() { print("FAIL: \(name)"); exit(1) }
}
func response(_ code: Int, _ text: String) -> GatewayProbeResponse {
    GatewayProbeResponse(statusCode: code, data: Data(text.utf8))
}
let live = response(200, #"{"ok":true,"status":"live"}"#)
let ready = response(200, #"{"ready":true,"failing":[],"eventLoop":{"degraded":false}}"#)
func check(_ liveness: GatewayProbeResponse?, _ readiness: GatewayProbeResponse?) -> GatewayAvailability {
    GatewayHealthProbe.check(port: 18789) { url, _ in
        url.path == "/healthz" ? liveness : readiness
    }.availability
}
expect(check(live, ready) == .ready, "installed endpoint contract is ready")
expect(check(nil, ready) == .unavailable, "refused or timed out liveness is unavailable")
expect(check(response(200, "<html>control ui</html>"), ready) == .unverified, "HTTP 200 HTML is not health")
expect(check(response(200, #"{"ok":1,"status":"live"}"#), ready) == .unverified, "numeric truth is not a boolean")
expect(check(response(200, #"{"ok":true,"status":"starting"}"#), ready) == .unverified, "liveness contract must match")
expect(check(response(503, #"{"ok":true,"status":"live"}"#), ready) == .unverified, "JSON does not override failure status")
expect(check(live, nil) == .degraded, "live but stalled readiness is degraded")
expect(check(live, response(503, #"{"ready":false,"failing":["channel"]}"#)) == .degraded, "known readiness refusal")
expect(check(live, response(200, #"{"ready":true,"eventLoop":{"degraded":true}}"#)) == .degraded, "event loop degradation is visible")
expect(check(live, response(200, "<html>ready</html>")) == .unverified, "ready HTML is rejected")
expect(check(live, response(200, #"{"ready":"true"}"#)) == .unverified, "string truth rejected")
expect(check(live, response(503, #"{"ready":true}"#)) == .unverified, "contradictory status is not ready")
expect(check(live, response(200, #"{"ready":false}"#)) == .unverified, "contradictory body is not ready")
expect(check(live, response(200, #"{"ready":true}"#)) == .ready, "optional diagnostics do not break older endpoint")
expect(check(live, response(401, #"{"ready":true}"#)) == .unverified, "auth refusal is not readiness")
let now = Date()
expect(GatewayHealthSnapshot.initial.current(at: now) == .checking, "initial state unknown")
expect(GatewayHealthSnapshot(availability: .ready, checkedAt: now).current(at: now) == .ready, "fresh observation")
expect(GatewayHealthSnapshot(availability: .ready, checkedAt: now.addingTimeInterval(-21)).current(at: now) == .stale, "old green expires")
expect(GatewayHealthSnapshot(availability: .ready, checkedAt: now.addingTimeInterval(1)).current(at: now) == .stale, "clock rollback invalidates freshness")
var called = false
let invalid = GatewayHealthProbe.check(port: 0) { _, _ in called = true; return live }
expect(invalid.availability == .unverified && !called, "invalid config never probes a different port")
for timeout in [Double.nan, Double.infinity, 0, -1] {
    called = false
    let invalid = GatewayHealthProbe.check(port: 18789, timeout: timeout) { _, _ in called = true; return live }
    expect(invalid.availability == .unverified && !called, "invalid timeout is refused")
}
expect(GatewayHealthProbe.request(URL(string: "https://example.com/healthz")!, timeout: 0.1) == nil, "external URL refused")
expect(GatewayHealthProbe.request(URL(string: "http://127.0.0.1/healthz?secret=value")!, timeout: 0.1) == nil, "query refused")
print("Gateway health: \(checks) checks passed")
