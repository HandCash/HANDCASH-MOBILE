# HandCash Mobile

**Same wallet UI core as Desktop** — this shell mounts `@handcash/wallet-ui` (`HANDCASH-DESKTOP/src`) inside Capacitor with a thin `window.handcash` bridge.

Three parts: **UI core** · **Desktop shell** · **Mobile shell** — see [`../docs/handcash-three-parts.md`](../docs/handcash-three-parts.md).

Requires sibling checkout:

```
handcash/
  HANDCASH-DESKTOP/   ← hosts @handcash/wallet-ui
  HANDCASH-MOBILE/    ← you are here
```

## Develop

```bash
npm install
npm run assert:ui-core   # proves Desktop pin (version + git SHA)
npm run dev              # http://localhost:5174 — full UI core
```

## APK

```bash
bash scripts/build-apk.sh
# → artifacts/handcash-mobile-<ver>.apk
# → artifacts/ui-core-pin.json   (Desktop version + SHA baked into the release)
```

### Lab signing + key rotation

Android refuses an APK signed with a **different key** than the app already on the phone (`App not installed`). Lab builds share one keystore (CI secret / local file), and **rotate** with APK Signature Scheme v3 lineage — upgrades stay in place; you do not uninstall.

- `native-android/lab-signing-lineage.bin` — committed lineage (old Mac/debug cert → current lab cert)
- `HANDCASH_ANDROID_LAB_KEYSTORE_BASE64` — current lab keystore (secret)
- `HANDCASH_ANDROID_LAB_OLD_KEYSTORE_BASE64` — previous key phones already trust (secret; required to dual-sign the rotate)
- Local: current key at `native-android/handcash-lab.keystore`, previous at `~/.handcash/android-signing/handcash-lab-old.keystore`

```bash
bash scripts/export-lab-keystore.sh   # first-time: copy ~/.android/debug.keystore → lab keystore
# After a rotate, keep the previous .keystore as handcash-lab-old — do not delete it.
```

Dirty Desktop worktrees fail the build (set `ALLOW_DIRTY_UI_CORE=1` only for local experiments).

## iOS (TestFlight)

Same shell, second native platform: `ios/` is generated and gitignored like
`android/`; everything it needs lives in `native-ios/` (Swift plugins, the
durable store, icon and splash) and `scripts/patch-ios.mjs` applies it after
`cap sync ios`.

Needs full Xcode (`sudo xcode-select -s /Applications/Xcode.app`, then
`xcodebuild -downloadPlatform iOS`) and an App Store Connect API key with
App Manager access. Signing is automatic through that key — no certificate or
profile is kept here.

```bash
export HANDCASH_IOS_TEAM_ID=XXXXXXXXXX
export HANDCASH_ASC_KEY_ID=XXXXXXXXXX
export HANDCASH_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# key at ~/.handcash/ios-signing/AuthKey_<KEY_ID>.p8 (or HANDCASH_ASC_KEY_PATH)
npm run ios:testflight   # archive + upload; `npm run ios` exports an .ipa instead
```

The build number is the Android versionCode (`major*10000 + minor*100 + patch`),
so every version bump is a valid new TestFlight build. Answer
`HANDCASH_IOS_USES_NON_EXEMPT_ENCRYPTION=false|true` once export compliance is
settled to skip the per-build question.

`npm run test:ios-native` compiles the durable store and its synchronous
`prompt()` bridge against macOS and runs them with real files and a real
WKWebView — no Xcode needed. The other plugins compile only in Xcode.

Off on iOS for now (the core falls back): the local BRC-100 bridge, the native
app-tab guest, sideload updates and the background health probe. iOS updates
come from TestFlight.

Camera permission is required for **Scan to link** (device pair QR) and Dashboard Scan.

## Scan to link

1. Restore the **same** identity on phone and Desktop (phrase / slices).
2. Set the **same** History backup URL on both (Settings → History).
3. On Desktop: Settings → Use on another device → show the link QR.
4. On phone: **Scan to link** (or Dashboard **Scan**) → points at that QR.
5. Enter the same unlock password → **Sync via backup URL**.

QR scanning uses `@zxing/browser` when the WebView has no `BarcodeDetector` (typical on Android).

## What differs from Desktop

| Feature | Mobile |
|---------|--------|
| UI / vault / backups / identity handoff | Same UI core (BRC-157 phrase, BRC-75 for older vaults / BRC-140 shares) |
| Device link (scan QR + BRC-39 sync) | Same pair UX; camera via zxing fallback |
| BRC-100 LAN bridge | Native loopback `:3321` when the Android app is running; not on iOS yet |
| Connected apps | Android opens them in a tab inside the wallet by default (WebView message channel, no socket, no app switch). From Chrome, the wallet steps back to Chrome once every prompt is answered. |
| LAN device-peer (`:3340`) | Not yet — cloud History URL is the multi-device path |
| OS keychain seal | Android DeviceAuth prefers StrongBox (hardware SE) then TEE; iOS keeps the unlock key in the Keychain behind Face ID / Touch ID / passcode, this device only; password wrap fallback |
| Auto-update | Android sideload; iOS TestFlight |
| Collectables read | Local only — games talk to the open wallet |
