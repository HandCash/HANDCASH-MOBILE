import Capacitor
import Foundation
import Photos
import UIKit

/** Opens the native share sheet for user-controlled key-slice handoff. */
@objc(ShareTextPlugin)
public class ShareTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTextPlugin"
    public let jsName = "ShareText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    @objc func share(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "HandCash key slice"
        guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("text required")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("share failed")
                return
            }
            let sheet = UIActivityViewController(activityItems: [ShareSubject(text: text, subject: title)], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = host.view
                popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            // Android resolves once the chooser opens; the user may still cancel.
            host.present(sheet, animated: true) { call.resolve(["ok": true]) }
        }
    }
}

/** The shared text, with its title as the subject where the target has one (Mail). */
private final class ShareSubject: NSObject, UIActivityItemSource {
    private let text: String
    private let subject: String

    init(text: String, subject: String) {
        self.text = text
        self.subject = subject
    }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        text
    }

    func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        text
    }

    func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        subject
    }
}

/** Hands a link to the system browser or mail app, as Desktop's `shell.openExternal` does. */
@objc(SystemBrowserPlugin)
public class SystemBrowserPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SystemBrowserPlugin"
    public let jsName = "SystemBrowser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    @objc func open(_ call: CAPPluginCall) {
        let raw = (call.getString("url") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty {
            call.reject("url required")
            return
        }
        guard let url = URL(string: raw) else {
            call.reject("url could not be parsed")
            return
        }
        // Same set Desktop's isSafeExternalUrl allows.
        guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto"].contains(scheme) else {
            call.reject("Only http(s) and mailto links can be opened externally")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("No app on this device can open that link") }
            }
        }
    }
}

/** Saves an image the wallet produced (QR, item art) into Photos, add-only. */
@objc(SaveImagePlugin)
public class SaveImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SaveImagePlugin"
    public let jsName = "SaveImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveToGallery", returnType: CAPPluginReturnPromise),
    ]

    @objc func saveToGallery(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), !filename.isEmpty else {
            call.reject("filename required")
            return
        }
        guard let base64 = call.getString("base64"), !base64.isEmpty else {
            call.reject("base64 required")
            return
        }
        guard let bytes = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            call.reject("invalid base64")
            return
        }
        if bytes.isEmpty {
            call.reject("empty image")
            return
        }
        var safeName = filename.replacingOccurrences(of: "[\\\\/]+", with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if safeName.isEmpty { safeName = "handcash-image.png" }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photos access was not allowed")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = safeName
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: bytes, options: options)
            }, completionHandler: { saved, error in
                if saved { call.resolve(["ok": true]) } else { call.reject(error?.localizedDescription ?? "gallery save failed") }
            })
        }
    }
}
