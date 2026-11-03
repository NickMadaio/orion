import Darwin
import Foundation
import MouseKit

/// The running Java processes that belong to a Minecraft install, found by executable path (libproc). A path needs no permission,
/// unlike window titles, which are blank without Screen Recording.
enum GameProcessScan {
    static func javaGamePids() -> [Int32] {
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) + 32)
        let filled = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return [] }
        var found: [Int32] = []
        var buffer = [CChar](repeating: 0, count: 4096)
        for pid in pids.prefix(Int(filled)) where pid > 0 {
            let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
            guard length > 0 else { continue }
            if GameClassifier.isGameProcess(path: String(cString: buffer)) { found.append(pid) }
        }
        return found
    }
}
