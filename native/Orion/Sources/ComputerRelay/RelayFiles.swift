import Darwin
import Foundation

/// File-system rules shared by the relay host and its tests: the directory must be a real
/// directory (not a symlink) owned by this user with mode 0700, the key a 0600 file of exactly
/// 32 bytes owned by this user, and every write lands atomically (temp file, then rename).
public enum RelayFiles {
    public enum Failure: Error, Equatable, CustomStringConvertible {
        case directoryUnsafe(String)
        case keyUnsafe(String)

        public var description: String {
            switch self {
            case .directoryUnsafe(let why): return "relay directory refused: \(why)"
            case .keyUnsafe(let why): return "relay key refused: \(why)"
            }
        }
    }

    /// Creates the directory with 0700 if it is missing, then checks it.
    public static func ensureDirectory(_ url: URL) throws {
        let path = url.path
        if mkdir(path, 0o700) != 0, errno != EEXIST {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            guard mkdir(path, 0o700) == 0 || errno == EEXIST else { throw Failure.directoryUnsafe("cannot create (errno \(errno))") }
        }
        var info = stat()
        guard lstat(path, &info) == 0 else { throw Failure.directoryUnsafe("cannot stat") }
        guard (info.st_mode & S_IFMT) == S_IFDIR else { throw Failure.directoryUnsafe("not a directory (or a symlink)") }
        guard info.st_uid == getuid() else { throw Failure.directoryUnsafe("owned by another user") }
        guard (info.st_mode & 0o777) == 0o700 else { throw Failure.directoryUnsafe(String(format: "mode %o, expected 700", info.st_mode & 0o777)) }
    }

    /// The HMAC key, or a reason it is not usable. The plugin generates it; the app only reads.
    public static func readKey(_ url: URL) -> Result<Data, Failure> {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { return .failure(.keyUnsafe("missing")) }
        guard (info.st_mode & S_IFMT) == S_IFREG else { return .failure(.keyUnsafe("not a regular file")) }
        guard info.st_uid == getuid() else { return .failure(.keyUnsafe("owned by another user")) }
        guard (info.st_mode & 0o077) == 0 else { return .failure(.keyUnsafe("readable by group or others")) }
        guard let data = FileManager.default.contents(atPath: url.path), data.count == RelayProtocol.Limits.keyBytes else {
            return .failure(.keyUnsafe("not \(RelayProtocol.Limits.keyBytes) bytes"))
        }
        return .success(data)
    }

    /// Reads a regular file (never through a symlink), refusing anything over `limit` bytes.
    public static func readRegular(_ url: URL, limit: Int) -> Data? {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { return nil }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size <= off_t(limit) else { return nil }
        guard let read = try? handle.read(upToCount: limit + 1) else { return nil }
        let data = read ?? Data()
        return data.count <= limit ? data : nil
    }

    /// Writes `data` to `url` atomically with mode 0600: a hidden temp file in the same directory, then rename.
    public static func writeAtomically(_ data: Data, to url: URL) throws {
        let temp = url.deletingLastPathComponent().appendingPathComponent(".tmp-\(UUID().uuidString.lowercased())")
        let fd = open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.directoryUnsafe("cannot write a temp file (errno \(errno))") }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do {
            try handle.write(contentsOf: data)
            try handle.close()
        } catch {
            unlink(temp.path)
            throw error
        }
        guard rename(temp.path, url.path) == 0 else {
            unlink(temp.path)
            throw Failure.directoryUnsafe("rename failed (errno \(errno))")
        }
    }
}
