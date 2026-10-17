import Capacitor
import Foundation

/**
 * Native deaths never reach the WebView's log ring: an uncaught exception
 * ends the process before JS can write a line. Each one is appended to a file
 * here and handed to the log on the next launch.
 */
@objc(CrashReportPlugin)
public class CrashReportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CrashReportPlugin"
    public let jsName = "CrashReport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takeReport", returnType: CAPPluginReturnPromise),
    ]

    private static let maxBytes = 16 * 1024
    private static let lock = NSLock()
    private static var installed = false
    private static var previous: (@convention(c) (NSException) -> Void)?

    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("native-crash.log")
    }

    static func install() {
        lock.lock()
        defer { lock.unlock() }
        if installed { return }
        installed = true
        previous = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler { exception in
            let trace = exception.callStackSymbols.joined(separator: "\n")
            CrashReportPlugin.record("uncaught \(exception.name.rawValue): \(exception.reason ?? "")\n\(trace)")
            CrashReportPlugin.previous?(exception)
        }
    }

    static func record(_ entry: String) {
        lock.lock()
        defer { lock.unlock() }
        let fm = FileManager.default
        let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
        if size > maxBytes { return }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let line = Data("\(iso.string(from: Date())) \(entry.trimmingCharacters(in: .whitespacesAndNewlines))\n".utf8)
        try? fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(line)
            handle.closeFile()
        } else {
            try? line.write(to: file)
        }
    }

    @objc func takeReport(_ call: CAPPluginCall) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let fm = FileManager.default
        guard fm.fileExists(atPath: Self.file.path) else {
            call.resolve(["report": ""])
            return
        }
        do {
            let report = String(decoding: try Data(contentsOf: Self.file), as: UTF8.self)
            try? fm.removeItem(at: Self.file)
            call.resolve(["report": report])
        } catch {
            call.reject("crash report unreadable: \(error.localizedDescription)")
        }
    }
}
