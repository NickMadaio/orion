import ApplicationServices
import ComputerRelay
import Foundation

// orion-relay-probe: the relay core Orion.app runs, from a terminal.
//
//   orion-relay-probe --dir <relay dir> --key <key file> --bridge <binary> [--seconds 30]
//
// Writes a heartbeat every second (accessibility = this process's own AXIsProcessTrusted)
// and answers requests until --seconds runs out. Used for the integration proof and for
// trying the relay without installing the app. It grants nothing the caller doesn't have.

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

guard let dir = argument("--dir"), let key = argument("--key"), let bridgePath = argument("--bridge") else {
    FileHandle.standardError.write(Data("usage: orion-relay-probe --dir <dir> --key <key> --bridge <binary> [--seconds N]\n".utf8))
    exit(2)
}
let seconds = Double(argument("--seconds") ?? "30") ?? 30
let runner = ProcessBridgeRunner(binary: URL(fileURLWithPath: bridgePath))
let service = RelayService(
    directory: URL(fileURLWithPath: dir), keyURL: URL(fileURLWithPath: key), bridge: { runner },
    log: { line in FileHandle.standardError.write(Data("\(line)\n".utf8)) })
do {
    try service.start()
} catch {
    FileHandle.standardError.write(Data("orion-relay-probe: \(error)\n".utf8))
    exit(1)
}
print("orion-relay-probe: watching \(dir) for \(Int(seconds))s")
fflush(stdout)
let deadline = Date().addingTimeInterval(seconds)
while Date() < deadline {
    service.writeHeartbeat(accessibility: AXIsProcessTrusted())
    RunLoop.current.run(until: Date().addingTimeInterval(1))
}
service.stop()
