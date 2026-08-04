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

## What differs from Desktop

| Feature | Mobile |
|---------|--------|
| UI / vault / backups / identity handoff | Same Desktop code (BRC-75 phrase / BRC-140 shares) |
| BRC-100 LAN bridge | Native loopback `:3321` when the Android app is running |
| OS keychain seal | Device auth plugin when available; else password wrap |
| Auto-update | Sideload / store |
| Multi-device funds | Same restored identity shares the chain pot — use Refresh to heal spends; no custom device-link sync |
| Collectables read | Local only — games talk to the open wallet |
