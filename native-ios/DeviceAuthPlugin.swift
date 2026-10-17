import Capacitor
import Foundation
import LocalAuthentication
import Security

/**
 * Device unlock factor: keeps the vault DEK in the Keychain behind user
 * presence (Face ID, Touch ID or the device passcode), the iOS counterpart of
 * `native-android/DeviceAuthPlugin.java`. The item is this-device-only, never
 * synced or backed up, and disappears if the passcode is removed.
 */
@objc(DeviceAuthPlugin)
public class DeviceAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceAuthPlugin"
    public let jsName = "DeviceAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enroll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bringToFront", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "io.handcash.mobile.device-unlock"
    private static let account = "vault-dek-v1"
    private static let installMarker = "handcash.deviceAuth.installed.v1"

    override public func load() {
        // Keychain items outlive an uninstall; app files do not. A DEK sealed
        // by a previous install opens no vault this install holds.
        if !UserDefaults.standard.bool(forKey: Self.installMarker) {
            Self.deleteItem()
            UserDefaults.standard.set(true, forKey: Self.installMarker)
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        call.resolve([
            "available": available,
            "enrolled": available && Self.itemExists(),
            "strongBox": false,
            "label": Self.label(context),
        ])
    }

    @objc func enroll(_ call: CAPPluginCall) {
        let given = call.getString("secret") ?? ""
        let secret = given.isEmpty ? (call.getString("password") ?? "") : given
        if secret.isEmpty {
            call.reject("Unlock material required")
            return
        }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            call.reject("Device unlock is not available on this device")
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Enable device unlock for HandCash") { ok, err in
            guard ok else {
                call.reject(Self.cancelledOr(err))
                return
            }
            guard let access = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                .userPresence,
                nil
            ) else {
                call.reject("Device unlock access control unavailable")
                return
            }
            Self.deleteItem()
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.service,
                kSecAttrAccount as String: Self.account,
                kSecValueData as String: Data(secret.utf8),
                kSecAttrAccessControl as String: access,
                kSecUseAuthenticationContext as String: context,
            ]
            let status = SecItemAdd(query as CFDictionary, nil)
            guard status == errSecSuccess else {
                call.reject("Could not seal device unlock (\(status))")
                return
            }
            call.resolve(["ok": true, "strongBox": false])
        }
    }

    @objc func unlock(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock HandCash"
        guard Self.itemExists() else {
            call.reject("Device unlock is not enabled")
            return
        }
        // Reading an access-controlled item shows the system prompt and blocks.
        DispatchQueue.global(qos: .userInitiated).async {
            let context = LAContext()
            context.localizedReason = reason.isEmpty ? "Unlock HandCash" : reason
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.service,
                kSecAttrAccount as String: Self.account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecUseAuthenticationContext as String: context,
            ]
            var out: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &out)
            switch status {
            case errSecSuccess:
                guard let data = out as? Data, let secret = String(data: data, encoding: .utf8), !secret.isEmpty else {
                    call.reject("No unlock material returned")
                    return
                }
                call.resolve(["ok": true, "secret": secret, "password": secret])
            case errSecUserCanceled:
                call.reject("cancelled")
            case errSecItemNotFound:
                call.reject("Device unlock is not enabled")
            default:
                call.reject("Device unlock failed (\(status))")
            }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        Self.deleteItem()
        call.resolve()
    }

    /** iOS never lets an app raise itself; the notification path covers it. */
    @objc func bringToFront(_ call: CAPPluginCall) {
        call.resolve()
    }

    private static func itemExists() -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseAuthenticationContext as String: context,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    private static func deleteItem() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func label(_ context: LAContext) -> String {
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "Device passcode"
        }
    }

    private static func cancelledOr(_ error: Error?) -> String {
        if let error = error as? LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel: return "cancelled"
            default: return error.localizedDescription
            }
        }
        return error?.localizedDescription ?? "Authentication failed"
    }
}
