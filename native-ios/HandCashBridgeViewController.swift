import Capacitor
import UIKit
import WebKit

/**
 * The wallet's single web view, as `native-android/MainActivity.java` is on
 * Android. `scripts/patch-ios.mjs` points `Main.storyboard` at this class.
 *
 * Plugins without an iOS counterpart yet (local BRC-100 server, app-tab
 * guests, background health) are absent; `src/bridge.ts` leaves those bridge
 * methods off on iOS.
 */
class HandCashBridgeViewController: CAPBridgeViewController {
    private var durablePrompt: DurableStorePrompt?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        CrashReportPlugin.install()
        bridge?.registerPluginInstance(Brc39ArchivePlugin())
        bridge?.registerPluginInstance(CrashReportPlugin())
        bridge?.registerPluginInstance(DeviceAuthPlugin())
        bridge?.registerPluginInstance(SaveImagePlugin())
        bridge?.registerPluginInstance(ShareTextPlugin())
        bridge?.registerPluginInstance(SystemBrowserPlugin())

        // Before the first navigation, so the page never runs without its store.
        if let webView = webView, let origin = bridge?.config.serverURL {
            durablePrompt = DurableStorePrompt.install(on: webView, store: DurableStore.shared, origin: origin)
        }

        let center = NotificationCenter.default
        for name in [UIApplication.willResignActiveNotification, UIApplication.willTerminateNotification] {
            center.addObserver(self, selector: #selector(drainDurableStore), name: name, object: nil)
        }
    }

    @objc private func drainDurableStore() {
        DurableStore.shared.drain()
    }
}
