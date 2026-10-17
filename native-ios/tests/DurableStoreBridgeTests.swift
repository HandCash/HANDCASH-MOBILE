import AppKit
import WebKit

final class Fallback: NSObject, WKUIDelegate {
    var prompts: [String] = []
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        prompts.append(prompt)
        completionHandler("fallback:" + prompt)
    }
}

func run(_ webView: WKWebView, _ js: String) -> Any? {
    var done = false
    var out: Any?
    webView.evaluateJavaScript(js) { value, error in
        out = error.map { "ERROR \($0)" } ?? value
        done = true
    }
    while !done { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    return out
}

func load(_ webView: WKWebView, _ base: String) {
    let nav = NavWait()
    webView.navigationDelegate = nav
    webView.loadHTMLString("<html><body>t</body></html>", baseURL: URL(string: base))
    while !nav.done { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
}
final class NavWait: NSObject, WKNavigationDelegate {
    var done = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done = true }
}

func check(_ ok: Bool, _ what: String) { print(ok ? "ok   \(what)" : "FAIL \(what)"); if !ok { exit(1) } }

_ = NSApplication.shared
let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dsw-\(UUID().uuidString)")
let store = DurableStore(directory: dir)
let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
let fallback = Fallback()
webView.uiDelegate = fallback
let bridge = DurableStorePrompt.install(on: webView, store: store, origin: URL(string: "https://localhost")!)
_ = bridge

load(webView, "https://localhost/")
check(run(webView, "typeof window.HandcashDurableStore") as? String == "object", "store defined at document start")
check(run(webView, "window.HandcashDurableStore.get('handcash.a')") is NSNull, "missing key is null")
check(run(webView, "window.HandcashDurableStore.set('handcash.a', 'one')") as? Bool == true, "set returns true synchronously")
check(store.get("handcash.a") == "one", "value reached native store")
check(run(webView, "window.HandcashDurableStore.get('handcash.a')") as? String == "one", "get returns value")
check(run(webView, "window.HandcashDurableStore.set('handcash.brc100.vault.v1', JSON.stringify({identityKey:'02aa'}))") as? Bool == true, "vault write")
check(run(webView, "window.HandcashDurableStore.set('handcash.brc100.vault.v1', JSON.stringify({identityKey:'03bb'}))") as? Bool == false, "identity overwrite refused through bridge")
check(run(webView, "JSON.parse(window.HandcashDurableStore.get('handcash.brc100.vault.v1')).identityKey") as? String == "02aa", "vault intact in page")
check(run(webView, "window.HandcashDurableStore.get('handcash.brc100.vault.backup.v1')") is NSNull, "no backup yet")
check(run(webView, "window.HandcashDurableStore.set('handcash.brc100.vault.v1', JSON.stringify({identityKey:'03bb'}), true)") as? Bool == true, "recovery replace through bridge")
check(run(webView, "JSON.parse(window.HandcashDurableStore.get('handcash.brc100.vault.backup.v1')).identityKey") as? String == "02aa", "page sees the archive native wrote")
check(run(webView, "JSON.parse(window.HandcashDurableStore.keys()).includes('handcash.brc100.vault.backup.v1')") as? Bool == true, "keys lists archived vault")
check(run(webView, "window.HandcashDurableStore.remove('handcash.a')") as? Bool == true && store.get("handcash.a") == nil, "remove")
check(run(webView, "window.prompt('{\"type\":\"CapacitorHttp\"}')") as? String == "fallback:{\"type\":\"CapacitorHttp\"}", "other prompts reach the fallback delegate")
check(run(webView, "Object.isFrozen(window.HandcashDurableStore) && (function(){ try { window.HandcashDurableStore = 1 } catch (e) {} return typeof window.HandcashDurableStore })()") as? String == "object", "store cannot be replaced by the page")

load(webView, "https://evil.example/")
check(run(webView, "(function(){ try { window.HandcashDurableStore.get('handcash.brc100.vault.v1'); return 'leaked' } catch (e) { return String(e) } })()") as? String == "Error: durable store: untrusted frame", "other origin refused")
check(fallback.prompts.count == 1, "store traffic never reached the fallback")
print("all bridge checks passed")
