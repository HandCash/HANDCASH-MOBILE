import CryptoKit
import Foundation
import WebKit

/**
 * The wallet core's durable store (`window.handcash.storageGetSync` /
 * `storageSetSync`), kept in app-private files instead of WebView storage.
 *
 * Port of `native-android/DurableStorePlugin.java`: same file layout, same
 * committed-key rule, same vault identity guard and archive. WebKit storage
 * is capped per origin and iOS may purge it under disk pressure; the vault,
 * signed cheques, outboxes and input locks cannot live there.
 *
 * Every call arrives on the main thread through {@link DurableStorePrompt}.
 */
final class DurableStore {
    static let shared = DurableStore(directory: DurableStore.defaultDirectory())

    private static let vaultKey = "handcash.brc100.vault.v1"
    private static let vaultBackupKey = "handcash.brc100.vault.backup.v1"
    private static let vaultHistoryPrefix = "handcash.brc100.vault.history."
    private static let maxVaultHistory = 10
    /** Longest plain file name; longer keys are hashed with a sidecar naming them. */
    private static let maxPlainName = 200
    private static let hashedPrefix = "h-"
    private static let keySidecar = ".key"
    private static let tmpSuffix = ".tmp"
    /** Mirrors `requiresCommittedWrite` in Desktop `electron/durableStore.ts`. */
    private static let committed = try! NSRegularExpression(
        pattern: "^(?:handcash\\.brc100\\.vault|handcash\\.wallet\\.(?:signedChequeArchive|pendingMinerOutbox|utxoLocks)"
            + "|handcash\\.brc29\\.pendingOutbox|handcash\\.item\\.pendingOutbox|handcash\\.brc100\\.deviceDek"
            + "|handcash\\.createdBeef|handcash\\.autoPayReservations|handcash\\.toolboxDatabasePointer"
            + "|handcash\\.publicIdentities|handcash\\.issuerIdentities|handcash\\.custodyJournal)"
    )

    private let dir: URL
    private let fm = FileManager.default
    /** A held `nil` means the key is known to be absent. */
    private var cache: [String: String?] = [:]
    private var pending: [String: String] = [:]
    private let diskLock = NSLock()
    private let writer = DispatchQueue(label: "io.handcash.mobile.durable-writer")

    static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("durable", isDirectory: true)
    }

    init(directory: URL) {
        dir = directory
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            // Android excludes this store from cloud backup; a restored vault
            // file without its device unlock key is a second, stale custody copy.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var url = dir
            try url.setResourceValues(values)
        } catch {
            NSLog("[DurableStore] could not prepare %@: %@", dir.path, error.localizedDescription)
        }
    }

    func get(_ key: String) -> String? {
        if key.isEmpty { return nil }
        if let held = cache[key] { return held }
        let read = readFile(key)
        cache[key] = .some(read)
        return read
    }

    func set(_ key: String, _ value: String, allowVaultIdentityReplace: Bool) -> Bool {
        if key.isEmpty { return false }
        if value.isEmpty { return remove(key) }
        if key == Self.vaultKey, let previous = get(key), previous != value {
            if !vaultReplaceAllowed(previous, value, allowVaultIdentityReplace) { return false }
            if !archiveVault(previous) { return false }
        }
        return put(key, value)
    }

    func remove(_ key: String) -> Bool {
        if key.isEmpty { return false }
        if key == Self.vaultKey, let previous = get(key), !archiveVault(previous) { return false }
        diskLock.lock()
        defer { diskLock.unlock() }
        pending.removeValue(forKey: key)
        let file = fileFor(key)
        var ok = true
        if fm.fileExists(atPath: file.path) {
            do { try fm.removeItem(at: file) } catch { ok = false }
        }
        let sidecar = dir.appendingPathComponent(file.lastPathComponent + Self.keySidecar)
        if fm.fileExists(atPath: sidecar.path) {
            do { try fm.removeItem(at: sidecar) } catch { ok = false }
        }
        if ok { cache[key] = .some(nil) }
        return ok
    }

    func keys() -> [String] {
        diskLock.lock()
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        diskLock.unlock()
        var out = Set<String>()
        for name in names where !name.hasSuffix(Self.tmpSuffix) && !name.hasSuffix(Self.keySidecar) {
            if let key = keyOf(name) { out.insert(key) }
        }
        for (key, value) in cache {
            if value == nil { out.remove(key) } else { out.insert(key) }
        }
        return out.sorted()
    }

    /** Land every coalesced write before iOS suspends or ends the process. */
    func drain() {
        writer.sync {}
    }

    private func put(_ key: String, _ value: String) -> Bool {
        if isCommitted(key) {
            diskLock.lock()
            pending.removeValue(forKey: key)
            let ok = writeFile(key, value)
            diskLock.unlock()
            if !ok { return false }
            cache[key] = .some(value)
            return true
        }
        cache[key] = .some(value)
        // Coalesce: a burst of activity writes lands as the last value only.
        diskLock.lock()
        let first = pending.updateValue(value, forKey: key) == nil
        diskLock.unlock()
        if first { writer.async { [weak self] in self?.flush(key) } }
        return true
    }

    private func flush(_ key: String) {
        diskLock.lock()
        defer { diskLock.unlock() }
        guard let value = pending.removeValue(forKey: key) else { return }
        if !writeFile(key, value) { NSLog("[DurableStore] background write failed for %@", key) }
    }

    private func isCommitted(_ key: String) -> Bool {
        let range = NSRange(key.startIndex..., in: key)
        return Self.committed.firstMatch(in: key, options: [], range: range) != nil
    }

    private func vaultReplaceAllowed(_ previous: String, _ next: String, _ allow: Bool) -> Bool {
        guard
            let before = identityKey(previous),
            let after = identityKey(next)
        else {
            NSLog("[DurableStore] vault guard parse failed — refusing write")
            return false
        }
        if before.isEmpty || after.isEmpty || before == after { return true }
        if !allow {
            NSLog("[DurableStore] blocked vault identity overwrite %@ → %@", String(before.prefix(12)), String(after.prefix(12)))
            return false
        }
        NSLog("[DurableStore] allowing vault identity replace (recovery)")
        return true
    }

    private func identityKey(_ json: String) -> String? {
        guard
            let data = json.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["identityKey"] as? String ?? ""
    }

    /** Keep the replaced vault, as Desktop does: a backup plus the last ten. */
    private func archiveVault(_ previous: String) -> Bool {
        if !put(Self.vaultBackupKey, previous) { return false }
        let stamp = String(Int64(Date().timeIntervalSince1970 * 1000))
        if !put(Self.vaultHistoryPrefix + stamp, previous) { return false }
        var history = keys().filter { $0.hasPrefix(Self.vaultHistoryPrefix) }.sorted()
        while history.count > Self.maxVaultHistory { _ = remove(history.removeFirst()) }
        return true
    }

    private func fileFor(_ key: String) -> URL {
        let plain = Self.encode(key)
        if plain.count <= Self.maxPlainName { return dir.appendingPathComponent(plain) }
        return dir.appendingPathComponent(Self.hashedPrefix + Self.sha256Hex(key))
    }

    private func keyOf(_ name: String) -> String? {
        if name.hasPrefix(Self.hashedPrefix) {
            guard let raw = fm.contents(atPath: dir.appendingPathComponent(name + Self.keySidecar).path) else { return nil }
            return String(data: raw, encoding: .utf8)
        }
        return Self.decode(name)
    }

    private func readFile(_ key: String) -> String? {
        guard let raw = fm.contents(atPath: fileFor(key).path) else { return nil }
        return String(data: raw, encoding: .utf8)
    }

    private func writeFile(_ key: String, _ value: String) -> Bool {
        let file = fileFor(key)
        if file.lastPathComponent.hasPrefix(Self.hashedPrefix) {
            let sidecar = dir.appendingPathComponent(file.lastPathComponent + Self.keySidecar)
            if !fm.fileExists(atPath: sidecar.path), !replace(sidecar, Data(key.utf8)) { return false }
        }
        return replace(file, Data(value.utf8))
    }

    /** Write a sibling, flush it to the device, then rename over the target. */
    private func replace(_ target: URL, _ data: Data) -> Bool {
        let tmp = dir.appendingPathComponent(target.lastPathComponent + Self.tmpSuffix)
        let fd = Darwin.open(tmp.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
        if fd < 0 { return false }
        let written = data.withUnsafeBytes { raw -> Bool in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n <= 0 { return false }
                offset += n
            }
            return true
        }
        // fsync leaves data in the drive cache on Apple hardware; F_FULLFSYNC does not.
        let synced = written && (fcntl(fd, F_FULLFSYNC) != -1 || fsync(fd) == 0)
        Darwin.close(fd)
        if !synced || Darwin.rename(tmp.path, target.path) != 0 {
            NSLog("[DurableStore] write failed %@", target.lastPathComponent)
            Darwin.unlink(tmp.path)
            return false
        }
        return true
    }

    /** File-name safe and reversible: `[A-Za-z0-9._-]` as is, every other UTF-8 byte as `%XX`. */
    static func encode(_ key: String) -> String {
        var out = ""
        for b in key.utf8 {
            let plain = (b >= 0x61 && b <= 0x7A) || (b >= 0x41 && b <= 0x5A) || (b >= 0x30 && b <= 0x39)
                || b == 0x2E || b == 0x5F || b == 0x2D
            if plain { out.append(Character(UnicodeScalar(b))) } else { out += String(format: "%%%02X", b) }
        }
        // A leading dot would hide the file and `h-` names belong to hashed keys.
        if out.hasPrefix(".") || out.hasPrefix(hashedPrefix), let first = out.unicodeScalars.first {
            out = String(format: "%%%02X", first.value) + String(out.dropFirst())
        }
        return out
    }

    static func decode(_ name: String) -> String? {
        let chars = Array(name.utf8)
        var bytes: [UInt8] = []
        bytes.reserveCapacity(chars.count)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c != 0x25 {
                bytes.append(c)
                i += 1
                continue
            }
            guard i + 2 < chars.count, let hi = hexValue(chars[i + 1]), let lo = hexValue(chars[i + 2]) else { return nil }
            bytes.append(hi << 4 | lo)
            i += 3
        }
        return String(bytes: bytes, encoding: .utf8)
    }

    private static func hexValue(_ c: UInt8) -> UInt8? {
        switch c {
        case 0x30...0x39: return c - 0x30
        case 0x41...0x46: return c - 0x41 + 10
        case 0x61...0x66: return c - 0x61 + 10
        default: return nil
        }
    }

    private static func sha256Hex(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/**
 * The synchronous channel to {@link DurableStore}.
 *
 * WKWebView has no synchronous script message, and the core's storage API is
 * synchronous; JavaScript `prompt()` blocks the page until the UI delegate
 * answers. This delegate stands in front of Capacitor's and answers only
 * store requests from the wallet page's own main frame. Every other delegate
 * call, including Capacitor's own `prompt()` traffic, is forwarded unchanged.
 */
final class DurableStorePrompt: NSObject, WKUIDelegate {
    static let requestType = "HandcashDurableStore"

    private let fallback: WKUIDelegate?
    private let store: DurableStore
    private let origin: URL

    /** Script injected at document start; it defines `window.HandcashDurableStore`. */
    static let pageScript = """
    (function () {
      if (window.HandcashDurableStore) return;
      var T = '\(requestType)';
      var held = new Map();
      function ask(msg) {
        // `type` first: native matches the request by its prefix.
        var raw = window.prompt(JSON.stringify(Object.assign({ type: T }, msg)));
        var res = raw == null ? null : JSON.parse(raw);
        if (!res || res.error) throw new Error('durable store: ' + (res && res.error || 'no answer'));
        return res;
      }
      function attempt(msg) {
        if (msg.key === 'handcash.brc100.vault.v1') {
          // Native archives the replaced vault under keys this page never wrote.
          held.forEach(function (_, k) { if (k.indexOf('handcash.brc100.vault.') === 0) held.delete(k); });
        }
        try { return ask(msg).ok === true; } catch (e) { console.warn(String(e)); return false; }
      }
      Object.defineProperty(window, 'HandcashDurableStore', {
        value: Object.freeze({
          get: function (key) {
            key = String(key);
            if (held.has(key)) return held.get(key);
            var value = ask({ op: 'get', key: key }).value;
            held.set(key, value == null ? null : value);
            return value == null ? null : value;
          },
          set: function (key, value, allowVaultIdentityReplace) {
            key = String(key);
            value = String(value);
            var ok = attempt({ op: 'set', key: key, value: value, allow: allowVaultIdentityReplace === true });
            if (ok) held.set(key, value === '' ? null : value); else held.delete(key);
            return ok;
          },
          remove: function (key) {
            key = String(key);
            var ok = attempt({ op: 'remove', key: key });
            if (ok) held.set(key, null); else held.delete(key);
            return ok;
          },
          keys: function () {
            return JSON.stringify(ask({ op: 'keys' }).keys);
          },
        }),
        writable: false,
        configurable: false,
      });
    })();
    """

    init(fallback: WKUIDelegate?, store: DurableStore, origin: URL) {
        self.fallback = fallback
        self.store = store
        self.origin = origin
    }

    /** Put the store in front of the web view's current UI delegate. */
    static func install(on webView: WKWebView, store: DurableStore, origin: URL) -> DurableStorePrompt {
        let prompt = DurableStorePrompt(fallback: webView.uiDelegate, store: store, origin: origin)
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView.uiDelegate = prompt
        return prompt
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (fallback?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let fallback = fallback, fallback.responds(to: aSelector) { return fallback }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        if let reply = answer(prompt, frame: frame) {
            completionHandler(reply)
            return
        }
        guard let fallback = fallback,
              fallback.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)))
        else {
            completionHandler(nil)
            return
        }
        fallback.webView?(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText, initiatedByFrame: frame, completionHandler: completionHandler)
    }

    /** The reply for a store request, or nil when the prompt is not one. */
    private func answer(_ prompt: String, frame: WKFrameInfo) -> String? {
        guard prompt.hasPrefix("{\"type\":\"\(Self.requestType)\"") else { return nil }
        guard frame.isMainFrame, trusted(frame.securityOrigin) else { return reply(["error": "untrusted frame"]) }
        guard
            let data = prompt.data(using: .utf8),
            let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            msg["type"] as? String == Self.requestType,
            let op = msg["op"] as? String
        else { return reply(["error": "bad request"]) }
        let key = msg["key"] as? String ?? ""
        switch op {
        case "get":
            return reply(["value": store.get(key).map { $0 as Any } ?? NSNull()])
        case "set":
            guard let value = msg["value"] as? String else { return reply(["error": "value required"]) }
            return reply(["ok": store.set(key, value, allowVaultIdentityReplace: msg["allow"] as? Bool == true)])
        case "remove":
            return reply(["ok": store.remove(key)])
        case "keys":
            return reply(["keys": store.keys()])
        default:
            return reply(["error": "unknown op"])
        }
    }

    private func trusted(_ source: WKSecurityOrigin) -> Bool {
        source.protocol == origin.scheme && source.host == origin.host
    }

    private func reply(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8)
        else { return "{\"error\":\"encode failed\"}" }
        return text
    }
}
