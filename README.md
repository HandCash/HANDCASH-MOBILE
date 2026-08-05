# HandCash Mobile

**Same wallet as Desktop** — this app mounts `HANDCASH-DESKTOP/src/App` inside Capacitor with a thin `window.handcash` bridge (localStorage durable prefs, no Electron).

Requires sibling checkout:

```
handcash/
  HANDCASH-DESKTOP/
  HANDCASH-MOBILE/   ← you are here
```

## Develop

```bash
npm install
npm run dev          # http://localhost:5174 — full Desktop UI
```

## APK

```bash
bash scripts/build-apk.sh
# → artifacts/handcash-mobile-debug.apk
```

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
| UI / vault / backups / identity handoff | Same Desktop code (BRC-75 phrase / BRC-140 shares) |
| Device link (scan QR + BRC-39 sync) | Same Desktop pair UX; camera via zxing fallback |
| BRC-100 LAN bridge | Native loopback `:3321` when the Android app is running |
| LAN device-peer (`:3340`) | Not yet — cloud History URL is the multi-device path |
| OS keychain seal | DeviceAuth prefers StrongBox (hardware SE) then TEE; password wrap fallback |
| Auto-update | Sideload / store |
| Collectables read | Local only — games talk to the open wallet |
