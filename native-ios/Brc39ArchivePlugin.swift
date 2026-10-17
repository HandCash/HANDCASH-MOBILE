import Capacitor
import CryptoKit
import Foundation

/** Private, append-only encrypted history files; independent of WebView data. */
@objc(Brc39ArchivePlugin)
public class Brc39ArchivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "Brc39ArchivePlugin"
    public let jsName = "Brc39Archive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
    ]

    private struct ArchiveError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static let maxBytes = 16 * 1024 * 1024
    private static let minBytes = 64
    private let io = DispatchQueue(label: "io.handcash.mobile.brc39-archive")
    private let fm = FileManager.default

    private func execute(_ call: CAPPluginCall, _ work: @escaping () throws -> Void) {
        io.async {
            do { try work() } catch { call.reject("Local history archive failed: \(error.localizedDescription)") }
        }
    }

    private func root() throws -> URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("brc39-archive", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try dir.setResourceValues(values)
        }
        return dir
    }

    private func folder(_ identity: String?) throws -> URL {
        guard let identity = identity, Self.matches(identity, "^(02|03)[0-9a-fA-F]{64}$") else {
            throw ArchiveError(message: "Invalid wallet identity")
        }
        let dir = try root().appendingPathComponent(identity.lowercased(), isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func readBytes(_ file: URL) throws -> Data {
        let size = (try fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
        if size < Self.minBytes || size > Self.maxBytes { throw ArchiveError(message: "Invalid archive size") }
        let data = try Data(contentsOf: file)
        if data.count != size { throw ArchiveError(message: "Archive changed during read") }
        return data
    }

    private func metadata(_ file: URL, _ identity: String) -> [String: Any] {
        let id = file.deletingPathExtension().lastPathComponent
        let parts = id.split(separator: "-", maxSplits: 1).map(String.init)
        let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
        return [
            "id": id,
            "identityKey": identity.lowercased(),
            "exportedAt": Int64(parts.first ?? "") ?? 0,
            "bytes": size,
            "sha256": parts.count > 1 ? parts[1] : "",
            "path": file.path,
        ]
    }

    private func snapshots(in dir: URL) -> [URL] {
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        return names
            .filter { Self.matches($0, "^[0-9]{13}-[0-9a-f]{64}\\.brc39$") }
            .sorted(by: >)
            .map { dir.appendingPathComponent($0) }
    }

    /** Write a sibling, flush it to the device, rename it in, then flush the directory. */
    private func publish(_ data: Data, to target: URL, in dir: URL) throws {
        let pending = dir.appendingPathComponent("pending-\(UUID().uuidString).tmp")
        defer { Darwin.unlink(pending.path) }
        let fd = Darwin.open(pending.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        if fd < 0 { throw ArchiveError(message: "Archive file unavailable") }
        let written = data.withUnsafeBytes { raw -> Bool in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n <= 0 { return false }
                offset += n
            }
            return true
        }
        let synced = written && (fcntl(fd, F_FULLFSYNC) != -1 || fsync(fd) == 0)
        Darwin.close(fd)
        if !synced { throw ArchiveError(message: "Archive write failed") }
        if Darwin.rename(pending.path, target.path) != 0 { throw ArchiveError(message: "Archive publish failed") }
        let dirFd = Darwin.open(dir.path, O_RDONLY)
        if dirFd >= 0 {
            _ = fsync(dirFd)
            Darwin.close(dirFd)
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        execute(call) {
            let identity = call.getString("identityKey") ?? ""
            let encoded = call.getString("bytesBase64") ?? ""
            if encoded.count > ((Self.maxBytes + 2) / 3) * 4 + 4 { throw ArchiveError(message: "Backup exceeds 16 MB") }
            guard let bytes = Data(base64Encoded: encoded), bytes.count >= Self.minBytes, bytes.count <= Self.maxBytes else {
                throw ArchiveError(message: "Invalid backup size")
            }
            let dir = try self.folder(identity)
            let sha = Self.digest(bytes)
            for candidate in self.snapshots(in: dir) where candidate.lastPathComponent.hasSuffix("-\(sha).brc39") {
                if let held = try? self.readBytes(candidate), Self.digest(held) == sha {
                    call.resolve(["created": false, "meta": self.metadata(candidate, identity)])
                    return
                }
            }
            let stamp = Int64(Date().timeIntervalSince1970 * 1000)
            let target = dir.appendingPathComponent("\(stamp)-\(sha).brc39")
            if self.fm.fileExists(atPath: target.path) { throw ArchiveError(message: "Archive already exists") }
            try self.publish(bytes, to: target, in: dir)
            call.resolve(["created": true, "meta": self.metadata(target, identity)])
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        execute(call) {
            let identity = call.getString("identityKey") ?? ""
            let rows = self.snapshots(in: try self.folder(identity)).prefix(100).map { self.metadata($0, identity) }
            call.resolve(["snapshots": Array(rows)])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        execute(call) {
            let identity = call.getString("identityKey") ?? ""
            let id = call.getString("id") ?? ""
            if !Self.matches(id, "^[0-9]{13}-[0-9a-f]{64}$") { throw ArchiveError(message: "Invalid archive id") }
            let file = try self.folder(identity).appendingPathComponent("\(id).brc39")
            let bytes = try self.readBytes(file)
            let expected = String(id.split(separator: "-", maxSplits: 1)[1])
            if Self.digest(bytes) != expected { throw ArchiveError(message: "Archive checksum mismatch") }
            call.resolve(["bytesBase64": bytes.base64EncodedString()])
        }
    }
}
