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

### Mac vs Linux installs

Android refuses an APK when it is signed with a **different key** than the app already on the phone (`App not installed` with no detail). Debug builds use `~/.android/debug.keystore`, which is **different on every machine**.

**One-time setup (recommended):** on the Mac that already installs on your phone:

```bash
bash scripts/export-lab-keystore.sh
# copies ~/.android/debug.keystore → native-android/handcash-lab.keystore
```

Copy `native-android/handcash-lab.keystore` to your Linux box (or commit it for the team). Rebuild — Linux APKs will upgrade Mac installs.

**Quick test:** uninstall HandCash from the phone, then sideload the Linux APK.

Or point at any keystore: `HANDCASH_ANDROID_KEYSTORE=/path/to/debug.keystore bash scripts/build-apk.sh`

Dirty Desktop worktrees fail the build (set `ALLOW_DIRTY_UI_CORE=1` only for local experiments).

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
| UI / vault / backups / identity handoff | Same UI core (BRC-75 phrase / BRC-140 shares) |
| Device link (scan QR + BRC-39 sync) | Same pair UX; camera via zxing fallback |
| BRC-100 LAN bridge | Native loopback `:3321` when the Android app is running |
| LAN device-peer (`:3340`) | Not yet — cloud History URL is the multi-device path |
| OS keychain seal | DeviceAuth prefers StrongBox (hardware SE) then TEE; password wrap fallback |
| Auto-update | Sideload / store |
| Collectables read | Local only — games talk to the open wallet |
